import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ asegurarVinculosTmsClientes: vi.fn() }));
vi.mock("@/lib/clientes/schema", () => ({ asegurarSchemaClientes: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  actualizarFacturaBorrador,
  anularFactura,
  crearFactura,
  listarViajesPendientes,
  obtenerFactura,
  previsualizarFactura,
  type ActorFacturacion,
} from "./facturas";

/**
 * FACT-2 — pruebas del flujo viaje cerrado → borrador. La base de datos es una SIMULACIÓN EN MEMORIA mínima que
 * respeta lo que importa del esquema real: UNIQUE(plan_id) en fact_factura_viajes, filtro por empresa_id y
 * FOR UPDATE como lectura normal. NO prueban MariaDB (bloqueos reales, collations, SQL): eso queda pendiente de
 * una prueba manual contra una base de desarrollo.
 */

type Fila = Record<string, unknown>;
type Estado = {
  planes: Fila[];
  clientes: Fila[];
  lugares: Fila[];
  /** plan_id → factura_id (UNIQUE plan_id). */
  vinculos: Map<number, number>;
  lineasInsertadas: Fila[];
  facturasInsertadas: Fila[];
  facturaBorrador: Fila | null;
  lineasPrevias: Fila[];
  /** Si true, el SELECT de vínculo devuelve «libre» aunque exista (simula la carrera entre validar e insertar). */
  vinculoSelectCiego: boolean;
};

const EMPRESA = 7;
const actor: ActorFacturacion = { empresaId: EMPRESA, usuarioId: 3, usuario: "facturador1" };

function planBase(id: number, over: Fila = {}): Fila {
  return {
    id, codigo: `PLAN-${id}`, empresa_id: EMPRESA, cliente_id: 501, estado: "Cerrado", tarifa_comercial: 1000,
    fecha_plan: "2026-08-27", ruta_codigo_historico: "RUTA-01", lugar_carga_id: 11, lugar_descarga_id: 12,
    lugar_descarga_historico: "Xela", tarifa_moneda_historico: "GTQ", ...over,
  };
}

let db: Estado;
let sqlLeidos: string[];

function nuevoEstado(): Estado {
  return {
    planes: [planBase(1), planBase(2, { codigo: "PLAN-2", lugar_descarga_historico: null, ruta_codigo_historico: "RUTA-02", tarifa_comercial: 500.5 })],
    clientes: [{ id: 20, empresa_id: EMPRESA, nombre: "Comercial X", razon_social: "Cliente X, S.A.", nit: "1234567-8", direccion: "Zona 1", tms_cliente_id: 501 }],
    lugares: [{ id: 11, empresa_id: EMPRESA, nombre: "Guatemala" }, { id: 12, empresa_id: EMPRESA, nombre: "Quetzaltenango" }],
    vinculos: new Map(),
    lineasInsertadas: [],
    facturasInsertadas: [],
    facturaBorrador: null,
    lineasPrevias: [],
    vinculoSelectCiego: false,
  };
}

/** Lecturas (SELECT) comunes a la conexión de la transacción y al pool. */
function leer(sql: string, params: unknown[]): Fila[] {
  sqlLeidos.push(sql);
  if (sql.includes("FROM clientes WHERE id = ?")) {
    return db.clientes.filter((c) => c.id === params[0] && c.empresa_id === params[1]);
  }
  if (sql.includes("FROM tms_planes_viaje WHERE id = ?")) {
    return db.planes.filter((p) => p.id === params[0] && p.empresa_id === params[1]);
  }
  if (sql.includes("FROM tms_lugares WHERE id = ?")) {
    return db.lugares.filter((l) => l.id === params[0] && l.empresa_id === params[1]);
  }
  if (sql.includes("FROM fact_factura_viajes WHERE plan_id = ?")) {
    const f = db.vinculos.get(Number(params[0]));
    return f != null && !db.vinculoSelectCiego ? [{ factura_id: f }] : [];
  }
  if (sql.includes("FROM fact_factura_viajes WHERE factura_id = ?")) return db.lineasPrevias;
  if (sql.includes("FROM fact_facturas WHERE id = ? AND empresa_id = ?")) return db.facturaBorrador ? [db.facturaBorrador] : [];
  throw new Error(`Consulta inesperada: ${sql}`);
}

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
};
const getConnection = vi.fn();
let facturaIdSecuencia = 100;

beforeEach(() => {
  vi.resetAllMocks();
  db = nuevoEstado();
  sqlLeidos = [];
  facturaIdSecuencia = 100;
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => [leer(sql, params)]);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => leer(sql, params)) as never);
  conn.execute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("INSERT INTO fact_facturas")) {
      const id = ++facturaIdSecuencia;
      db.facturasInsertadas.push({ sql, params });
      return [{ affectedRows: 1, insertId: id }, []];
    }
    if (sql.includes("INSERT INTO fact_factura_viajes")) {
      const planId = Number(params[1]);
      if (db.vinculos.has(planId)) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
      db.vinculos.set(planId, Number(params[0]));
      db.lineasInsertadas.push({ sql, params });
      return [{ affectedRows: 1, insertId: 1 }, []];
    }
    if (sql.includes("DELETE FROM fact_factura_viajes WHERE factura_id = ?")) {
      for (const [p, f] of db.vinculos) if (f === Number(params[0])) db.vinculos.delete(p);
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 1, insertId: 1 }, []];
  });
});
afterEach(() => vi.restoreAllMocks());

const LINEA_SQL_COLS = ["factura_id", "plan_id", "monto_asignado", "codigo", "fecha", "ruta", "origen", "destino", "descripcion", "cantidad", "base", "iva", "total"] as const;
function lineaComoObjeto(f: Fila): Record<(typeof LINEA_SQL_COLS)[number], unknown> {
  const p = f.params as unknown[];
  return Object.fromEntries(LINEA_SQL_COLS.map((c, i) => [c, p[i]])) as never;
}

describe("previsualizarFactura — la vista previa NO escribe ni reserva", () => {
  it("10) devuelve líneas, desglose y totales calculados en el servidor sin abrir transacción ni escribir", async () => {
    const r = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.cantidadViajes).toBe(2);
    expect(r.preview.cliente).toEqual({ id: 20, nombre: "Cliente X, S.A.", nit: "1234567-8", direccion: "Zona 1" });
    expect(r.preview.borrador.total).toBe(1500.5);
    expect(r.preview.borrador.lineas[0]).toMatchObject({
      codigo: "PLAN-1", descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026", base: 892.86, iva: 107.14, total: 1000,
    });
    // El destino cae al catálogo de lugares cuando el viaje no tiene destino congelado.
    expect(r.preview.borrador.lineas[1].descripcion).toBe("Servicio de transporte – Guatemala → Quetzaltenango – 27/08/2026");
    // Cero escrituras / cero transacción / cero auditoría / cero bloqueos.
    expect(getConnection).not.toHaveBeenCalled();
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(db.vinculos.size).toBe(0);
    expect(sqlLeidos.length).toBeGreaterThan(0);
    for (const sql of sqlLeidos) {
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(sql).not.toMatch(/FOR UPDATE/i);
    }
  });

  it("la preview NO reserva: el mismo viaje sigue libre y se puede previsualizar dos veces", async () => {
    expect((await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] })).ok).toBe(true);
    expect((await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] })).ok).toBe(true);
    expect(db.vinculos.size).toBe(0);
  });

  it("aplica las mismas reglas que crear: abierto, ya facturado, tarifa/ruta inválidas y otro cliente se rechazan", async () => {
    db.planes[0].estado = "En ruta";
    const abierto = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(abierto.ok).toBe(false);
    if (!abierto.ok) expect(abierto.error).toContain("no está Cerrado");

    db.planes[0].estado = "Cerrado";
    db.vinculos.set(1, 55);
    const facturado = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(facturado.ok).toBe(false);
    if (!facturado.ok) expect(facturado.error).toContain("ya está vinculado");

    db.vinculos.clear();
    db.planes[0].tarifa_comercial = null;
    expect((await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] })).ok).toBe(false);

    db.planes[0].tarifa_comercial = 1000;
    db.planes[0].cliente_id = 999;
    const otroCliente = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(otroCliente.ok).toBe(false);
    if (!otroCliente.ok) expect(otroCliente.status).toBe(400);
  });

  it("7) viajes de clientes distintos no se agrupan: el segundo no pertenece al cliente de la factura", async () => {
    db.planes[1].cliente_id = 777;
    const r = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(400); expect(r.error).toContain("PLAN-2"); expect(r.error).toContain("no pertenece al cliente"); }
  });

  it("monedas distintas se bloquean y se explica por qué", async () => {
    db.planes[1].tarifa_moneda_historico = "USD";
    const r = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("monedas distintas");
  });

  it("16) multiempresa: cliente/viaje/lugares se buscan SIEMPRE con el empresa_id del actor; un viaje de otra empresa «no existe»", async () => {
    db.planes[0].empresa_id = 8;
    const r = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    const consultas = vi.mocked(query).mock.calls;
    for (const [sql, params] of consultas) {
      if (String(sql).includes("FROM tms_planes_viaje") || String(sql).includes("FROM clientes") || String(sql).includes("FROM tms_lugares")) {
        expect(params).toContain(EMPRESA);
      }
    }
  });

  it("cliente de otra empresa → 404; cliente sin puente TMS → 409", async () => {
    db.clientes[0].empresa_id = 8;
    const otra = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(otra.ok).toBe(false);
    if (!otra.ok) expect(otra.status).toBe(404);
    db.clientes[0].empresa_id = EMPRESA;
    db.clientes[0].tms_cliente_id = null;
    const sinPuente = await previsualizarFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(sinPuente.ok).toBe(false);
    if (!sinPuente.ok) expect(sinPuente.status).toBe(409);
  });
});

describe("crearFactura — snapshot, IVA y persistencia", () => {
  it("11) crea el borrador: cabecera con desglose y snapshot del cliente + una línea congelada por viaje", async () => {
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    expect(r.ok).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);

    const cab = db.facturasInsertadas[0];
    expect(String(cab.sql)).toContain("'Borrador'");
    const cp = cab.params as unknown[];
    // empresa, cliente, numero, fecha, total, moneda, subtotal, iva, %iva, incluye, nombre, nit, direccion, obs, usuario
    expect(cp[0]).toBe(EMPRESA);
    expect(cp[1]).toBe(20);
    expect(cp[2]).toBeNull(); // sin número FEL / de factura en el borrador
    expect(cp[3]).toBeNull();
    expect(cp.slice(4, 13)).toEqual([1500.5, "GTQ", 1339.74, 160.76, 12, 1, "Cliente X, S.A.", "1234567-8", "Zona 1"]);
    expect(cp[14]).toBe(3);

    expect(db.lineasInsertadas).toHaveLength(2);
    const l1 = lineaComoObjeto(db.lineasInsertadas[0]);
    expect(l1).toMatchObject({
      plan_id: 1, monto_asignado: 1000, codigo: "PLAN-1", fecha: "2026-08-27", ruta: "RUTA-01", origen: "Guatemala",
      destino: "Xela", descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026", cantidad: 1,
      base: 892.86, iva: 107.14, total: 1000,
    });
    // El borrador NO tiene ninguna columna/valor de FEL.
    for (const f of [...db.facturasInsertadas, ...db.lineasInsertadas]) {
      expect(String(f.sql)).not.toMatch(/uuid|serie|xml|certific|dte|autorizacion/i);
    }
  });

  it("11b) el total del borrador es la suma exacta de las líneas (sin céntimos perdidos)", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    const cp = db.facturasInsertadas[0].params as unknown[];
    const lineas = db.lineasInsertadas.map(lineaComoObjeto);
    const suma = (k: "base" | "iva" | "total") => Number(lineas.reduce((s, l) => s + Number(l[k]), 0).toFixed(2));
    expect(cp[4]).toBe(suma("total"));
    expect(cp[6]).toBe(suma("base"));
    expect(cp[7]).toBe(suma("iva"));
    expect(Number((Number(cp[6]) + Number(cp[7])).toFixed(2))).toBe(cp[4]);
  });

  it("15) la auditoría registra usuario, empresa, totales, política de IVA y los viajes incluidos — sin datos fiscales del cliente", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    const a = vi.mocked(registrarAuditoriaTx).mock.calls[0][1];
    expect(a).toMatchObject({ empresaId: EMPRESA, usuario: "facturador1", modulo: "facturacion", accion: "crear_factura" });
    expect(a.detalle).toContain("(Borrador)");
    expect(a.detalle).toContain("monto total Q1500.5");
    expect(a.detalle).toContain("subtotal 1339.74");
    expect(a.detalle).toContain("IVA 160.76");
    expect(a.detalle).toContain("viajes: PLAN-1, PLAN-2");
    expect(a.detalle).not.toContain("1234567-8");
    expect(a.detalle).not.toContain("Zona 1");
  });

  it("el nombre fiscal cae al nombre comercial cuando no hay razón social", async () => {
    db.clientes[0].razon_social = null;
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect((db.facturasInsertadas[0].params as unknown[])[10]).toBe("Comercial X");
  });

  it("monedas distintas → 409 y NO se escribe nada", async () => {
    db.planes[1].tarifa_moneda_historico = "USD";
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    expect(r.ok).toBe(false);
    expect(db.facturasInsertadas).toHaveLength(0);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe("12) doble facturación y concurrencia", () => {
  it("el mismo viaje no entra a dos borradores: el segundo usuario recibe 409 y no se crea nada", async () => {
    const a = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(a.ok).toBe(true);
    const facturasAntes = db.facturasInsertadas.length;

    const b = await crearFactura({ ...actor, usuarioId: 4, usuario: "facturador2" }, { clienteId: 20, planes: [{ planId: 1 }, { planId: 2 }] });
    expect(b.ok).toBe(false);
    if (!b.ok) { expect(b.status).toBe(409); expect(b.error).toContain("PLAN-1"); expect(b.error).toContain("ya está vinculado"); }
    expect(db.facturasInsertadas.length).toBe(facturasAntes);
    expect(db.vinculos.has(2)).toBe(false); // el viaje libre del segundo intento tampoco quedó tomado a medias
  });

  it("carrera: si otra transacción se coló entre validar e insertar, el UNIQUE(plan_id) lo frena → 409 y rollback", async () => {
    db.vinculos.set(1, 999); // ya lo tomó otra transacción…
    db.vinculoSelectCiego = true; // …pero nuestra validación todavía lo vio libre
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("ya está vinculado a otra factura"); }
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    expect(vi.mocked(registrarAuditoriaTx)).not.toHaveBeenCalled();
  });

  it("deadlock / lock wait timeout de la base se informa como conflicto 409 reintentable, no como error 500", async () => {
    conn.execute.mockRejectedValueOnce(Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213 }));
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("Otro usuario"); }
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("los viajes se bloquean FOR UPDATE en orden ascendente de id, sin importar el orden de la selección (evita interbloqueos)", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 2 }, { planId: 1 }] });
    const bloqueos = conn.query.mock.calls
      .filter((c) => String(c[0]).includes("FROM tms_planes_viaje WHERE id = ?") && String(c[0]).includes("FOR UPDATE"))
      .map((c) => (c[1] as unknown[])[0]);
    expect(bloqueos).toEqual([1, 2]);
  });

  it("el mismo viaje repetido en la selección se rechaza antes de tocar la base", async () => {
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }, { planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("FROM tms_planes_viaje"))).toBe(false);
  });
});

describe("13) cancelar el borrador libera los viajes", () => {
  it("anular un Borrador borra sus vínculos y los viajes vuelven a ser facturables", async () => {
    const creada = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;
    expect(db.vinculos.get(1)).toBe(creada.facturaId);

    const original = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT id, estado_admin FROM fact_facturas")) return [[{ id: creada.facturaId, estado_admin: "Borrador" }]];
      if (sql.includes("SELECT COUNT(*) AS c FROM fact_pagos")) return [[{ c: 0 }]];
      return original(sql, params);
    });
    const r = await anularFactura(actor, creada.facturaId);
    expect(r.ok).toBe(true);
    expect(db.vinculos.has(1)).toBe(false);

    // …y ahora otro borrador con el mismo viaje sí es posible.
    expect((await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] })).ok).toBe(true);
  });
});

describe("14) snapshots: lo congelado no cambia aunque cambie el cliente, la ruta o la tarifa", () => {
  it("editar el borrador conserva descripción/ruta/origen/destino/fecha de la línea y el nombre/NIT/dirección del cliente", async () => {
    db.facturaBorrador = {
      id: 100, estado_admin: "Borrador", cliente_id: 20,
      cliente_nombre_snapshot: "Razón Social CONGELADA", cliente_nit_snapshot: "9999999-9", cliente_direccion_snapshot: "Dirección CONGELADA",
    };
    db.lineasPrevias = [{
      plan_id: 1, fecha_viaje_snapshot: "2026-08-27", ruta_codigo_snapshot: "RUTA-OLD", origen_snapshot: "Origen OLD",
      destino_snapshot: "Destino OLD", descripcion: "Servicio de transporte – Origen OLD → Destino OLD – 27/08/2026",
    }];
    // Después del snapshot cambiaron el cliente y la ruta del viaje:
    db.clientes[0].razon_social = "Razón NUEVA";
    db.planes[0].ruta_codigo_historico = "RUTA-NUEVA";
    db.planes[0].lugar_descarga_historico = "Destino NUEVO";

    const r = await actualizarFacturaBorrador(actor, 100, { clienteId: 20, planes: [{ planId: 1, montoAsignado: 900 }] });
    expect(r.ok).toBe(true);

    const l = lineaComoObjeto(db.lineasInsertadas[0]);
    expect(l).toMatchObject({
      ruta: "RUTA-OLD", origen: "Origen OLD", destino: "Destino OLD",
      descripcion: "Servicio de transporte – Origen OLD → Destino OLD – 27/08/2026", monto_asignado: 900, total: 900,
    });
    const upd = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE fact_facturas"));
    expect(upd?.[1]).toEqual(expect.arrayContaining(["Razón Social CONGELADA", "9999999-9", "Dirección CONGELADA"]));
    expect(upd?.[1]).not.toContain("Razón NUEVA");
  });

  it("si el borrador cambia de cliente, ahora SÍ se fotografía el cliente nuevo", async () => {
    db.facturaBorrador = {
      id: 100, estado_admin: "Borrador", cliente_id: 21,
      cliente_nombre_snapshot: "Otro cliente", cliente_nit_snapshot: null, cliente_direccion_snapshot: null,
    };
    await actualizarFacturaBorrador(actor, 100, { clienteId: 20, planes: [{ planId: 1 }] });
    const upd = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE fact_facturas"));
    expect(upd?.[1]).toEqual(expect.arrayContaining(["Cliente X, S.A.", "1234567-8"]));
  });

  it("una línea anterior a FACT-2 (sin descripción) se fotografía ahora con los datos vigentes", async () => {
    db.facturaBorrador = { id: 100, estado_admin: "Borrador", cliente_id: 20, cliente_nombre_snapshot: null };
    db.lineasPrevias = [{ plan_id: 1, fecha_viaje_snapshot: null, ruta_codigo_snapshot: null, origen_snapshot: null, destino_snapshot: null, descripcion: null }];
    await actualizarFacturaBorrador(actor, 100, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(lineaComoObjeto(db.lineasInsertadas[0]).descripcion).toContain("Guatemala → Xela");
  });

  it("al LEER una factura se muestra lo congelado (nombre, NIT, descripción, desglose), no el dato vivo", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM fact_facturas f")) {
        return [{
          id: 100, cliente_id: 20, cliente: "Nombre VIVO nuevo", numero_factura: null, fecha_emision: null, monto_total: "1000.00",
          estado_admin: "Borrador", observaciones: null, creado_por: 3, creado_en: "2026-08-27 10:00:00",
          actualizado_por: null, actualizado_en: null, total_pagado: 0, moneda: "GTQ", subtotal: "892.86", iva_monto: "107.14",
          porcentaje_iva: "12.00", precio_incluye_iva: 1, cliente_nombre_snapshot: "Razón CONGELADA", cliente_nit_snapshot: "1234567-8",
          cliente_direccion_snapshot: "Zona 1",
        }];
      }
      if (sql.includes("FROM fact_factura_viajes ffv")) {
        return [{
          id: 1, plan_id: 1, codigo: "PLAN-1", fecha_plan: "2026-08-27", monto_asignado: "1000.00",
          descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026", ruta_codigo_snapshot: "RUTA-01",
          origen_snapshot: "Guatemala", destino_snapshot: "Xela", cantidad: "1.00", base_monto: "892.86", iva_monto: "107.14", total_linea: "1000.00",
        }];
      }
      return [];
    }) as never);
    const d = await obtenerFactura(EMPRESA, 100);
    expect(d?.factura).toMatchObject({
      cliente: "Razón CONGELADA", clienteNit: "1234567-8", clienteDireccion: "Zona 1", moneda: "GTQ",
      subtotal: 892.86, iva: 107.14, porcentajeIva: 12, precioIncluyeIva: true, montoTotal: 1000,
    });
    expect(d?.viajes[0]).toMatchObject({ descripcion: expect.stringContaining("Xela"), base: 892.86, iva: 107.14, total: 1000, cantidad: 1 });
    const sqlLineas = vi.mocked(query).mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM fact_factura_viajes ffv"))!;
    expect(sqlLineas).toContain("COALESCE(ffv.codigo_viaje_snapshot, p.codigo)");
    expect(sqlLineas).toContain("COALESCE(ffv.fecha_viaje_snapshot, p.fecha_plan)");
  });

  it("una factura anterior a FACT-2 se lee sin desglose (null) y con el nombre vivo — sin romper", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM fact_facturas f")) {
        return [{
          id: 5, cliente_id: 20, cliente: "Nombre vivo", numero_factura: "F-1", fecha_emision: "2026-08-01", monto_total: "500.00",
          estado_admin: "Emitida", observaciones: null, creado_por: 3, creado_en: "2026-08-01 10:00:00", actualizado_por: null,
          actualizado_en: null, total_pagado: 0, moneda: "GTQ", subtotal: null, iva_monto: null, porcentaje_iva: null,
          precio_incluye_iva: null, cliente_nombre_snapshot: null, cliente_nit_snapshot: null, cliente_direccion_snapshot: null,
        }];
      }
      return [];
    }) as never);
    const d = await obtenerFactura(EMPRESA, 5);
    expect(d?.factura).toMatchObject({ cliente: "Nombre vivo", subtotal: null, iva: null, porcentajeIva: null, precioIncluyeIva: null, clienteNit: null });
  });
});

describe("listarViajesPendientes — «viajes por facturar»: SOLO elegibles (se deriva, sin columna «facturable»)", () => {
  async function sqlDelListado(filtros: Parameters<typeof listarViajesPendientes>[1] = {}) {
    vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("COUNT(*)") ? [{ total: 0 }] : [])) as never);
    await listarViajesPendientes(EMPRESA, filtros);
    const llamadas = vi.mocked(query).mock.calls;
    return { listado: llamadas[0], conteo: llamadas[1] };
  }

  it("1/2/3/4/5) el WHERE exige empresa del actor, estado Cerrado, ninguna factura viva, tarifa > 0 y ruta/destino — igual en listado y COUNT", async () => {
    const { listado, conteo } = await sqlDelListado();
    for (const [sql, params] of [listado, conteo]) {
      const s = String(sql);
      expect(s).toContain("p.empresa_id = ?");
      expect(s).toContain("p.estado = 'Cerrado'");
      expect(s).toContain("NOT EXISTS (SELECT 1 FROM fact_factura_viajes ffv WHERE ffv.plan_id = p.id)");
      expect(s).toContain("p.tarifa_comercial > 0");
      expect(s).toContain("p.ruta_codigo_historico");
      expect(s).toContain("p.lugar_descarga_id IS NOT NULL");
      expect((params as unknown[])[0]).toBe(EMPRESA);
    }
  });

  it("los catálogos que se unen (lugares, personal) se filtran por la MISMA empresa del viaje", async () => {
    const { listado } = await sqlDelListado();
    const s = String(listado[0]);
    expect(s).toContain("lc.empresa_id = p.empresa_id");
    expect(s).toContain("ld.empresa_id = p.empresa_id");
    expect(s).toContain("pil.empresa_id = p.empresa_id");
  });

  it("filtro por ruta: usa el código o destino congelados, parametrizado (sin interpolar texto del usuario en el SQL)", async () => {
    const { listado } = await sqlDelListado({ ruta: "RUTA-01'; DROP TABLE x;--" });
    const [sql, params] = listado;
    expect(String(sql)).toContain("(p.ruta_codigo_historico LIKE ? OR p.lugar_descarga_historico LIKE ?)");
    expect(String(sql)).not.toContain("DROP TABLE");
    expect(params).toContain("%RUTA-01'; DROP TABLE x;--%");
  });

  it("mapea ruta, origen, destino, piloto, estado y moneda normalizada", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) =>
      String(sql).includes("COUNT(*)")
        ? [{ total: 1 }]
        : [{
            id: 1, codigo: "PLAN-1", fecha_plan: "2026-08-27", cliente_id: 20, cliente: "Cliente X", placa: "C-034BXR",
            tarifa_comercial: 1000, cerrado_en: "2026-08-27T18:00", estado: "Cerrado", tarifa_moneda_historico: null,
            ruta_codigo: "RUTA-01", origen: "Guatemala", destino: "Xela", piloto: "Juan Pérez",
          }]) as never);
    const r = await listarViajesPendientes(EMPRESA, {});
    expect(r.items[0]).toMatchObject({
      rutaCodigo: "RUTA-01", origen: "Guatemala", destino: "Xela", piloto: "Juan Pérez", estado: "Cerrado", moneda: "GTQ", tarifaComercial: 1000,
    });
  });
});
