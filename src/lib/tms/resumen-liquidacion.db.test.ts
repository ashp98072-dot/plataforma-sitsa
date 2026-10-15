import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null, log: [] as string[] }));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return holder.pool;
  },
  query: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return (await holder.pool.query(texto, params))[0];
  },
}));

import { crearCargoAdicional, anularCargoAdicional, type ActorCargos } from "./cargos-adicionales";
import { confirmarReporteRecibido, liquidarViaje, reabrirLiquidacion, type ActorLiquidacion } from "./liquidacion-viaje";
import { obtenerResumenLiquidacionViaje, resumenComercialDePlanes } from "./resumen-liquidacion";
import { nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";

/**
 * TMS Fase 5 (resumen comercial de liquidación) contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT
 * (3399 o 3407, solo local). SQL real de las migraciones de Fase 1 y Fase 4.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/tms/resumen-liquidacion.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `res5_test_${randomUUID().replaceAll("-", "")}`;
const A: ActorCargos = { empresaId: 7, usuarioId: 4, usuario: "ana" };
const L = (a: ActorCargos): ActorLiquidacion => a;
let sigPlan = 900;

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];

async function plan(d: { empresa?: number; estado?: string; tarifa?: number | null; moneda?: string | null; cliente?: number | null; terc?: number | null } = {}) {
  const id = sigPlan++;
  await holder.pool!.execute(
    `INSERT INTO tms_planes_viaje (id, empresa_id, codigo, estado, fecha_plan, tarifa_comercial, tarifa_moneda_historico, cliente_id,
       lugar_carga_id, lugar_descarga_id, ruta_codigo_historico, costo_tercerizado)
     VALUES (?, ?, ?, ?, '2026-10-14', ?, ?, ?, 1, 2, 'R-01', ?)`,
    [id, d.empresa ?? 7, `PLAN-${id}`, d.estado ?? "Programado", d.tarifa === undefined ? 1000 : d.tarifa, d.moneda ?? null, d.cliente === undefined ? 1 : d.cliente, d.terc ?? null],
  );
  return id;
}
const cargo = (planId: number, monto: string, concepto = "Espera", actor = A) =>
  crearCargoAdicional(actor, { planId, concepto, monto, claveEnvio: nuevaClaveEnvio() });
const gasto = (planId: number, o: { categoria?: string; cantidad?: number; monto: number; estado: string | null; activo?: number; empresa?: number }) =>
  holder.pool!.execute(
    "INSERT INTO tms_gastos_operativos (empresa_id, plan_id, categoria, cantidad, monto, estado, activo) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [o.empresa ?? 7, planId, o.categoria ?? "Combustible", o.cantidad ?? 1, o.monto, o.estado, o.activo ?? 1],
  );
async function fondo(planId: number, estado: string, monto: number) {
  const [r] = await holder.pool!.execute("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, estado) VALUES (7, ?, ?)", [`SF-${sigPlan++}-${Math.random()}`, estado]);
  await holder.pool!.execute(
    "INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, cantidad, monto, plan_id) VALUES (7, ?, 'Viáticos', 1, ?, ?)",
    [(r as unknown as { insertId: number }).insertId, monto, planId],
  );
}
const cerrar = (id: number) => holder.pool!.execute("UPDATE tms_planes_viaje SET estado = 'Cerrado' WHERE id = ?", [id]);
async function cerradoConReporte(d: Parameters<typeof plan>[0] = {}) {
  const p = await plan(d);
  await confirmarReporteRecibido(L(A), { planId: p });
  await cerrar(p);
  return p;
}
async function huella(planId: number) {
  const t = ["tms_planes_viaje", "tms_viaje_liquidaciones", "tms_viaje_liquidacion_eventos", "tms_viaje_cargos_adicionales", "tms_viaje_cargo_eventos", "tms_gastos_operativos", "tms_solicitud_fondo_lineas", "fact_factura_viajes", "fel_documentos", "cont_eventos", "auditoria"];
  const out: unknown[] = [];
  for (const x of t) out.push((await sql(`SELECT * FROM ${x}`)).map((r) => JSON.stringify(r)).sort());
  void planId;
  return JSON.stringify(out);
}

describe.skipIf(!port)("Resumen comercial de liquidación (Fase 5) / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      const [v] = await c.query<RowDataPacket[]>("SELECT VERSION() AS v");
      expect(String(v[0].v)).toContain("11.8.9");
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE usuarios(id INT PRIMARY KEY, username VARCHAR(100)) ENGINE=InnoDB;
        CREATE TABLE tms_planes_viaje(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(80) NOT NULL,
          estado VARCHAR(40) NOT NULL, fecha_plan DATE NOT NULL, tarifa_comercial DECIMAL(12,2) NULL,
          tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio', referencia_cliente VARCHAR(160) NULL, cliente_id INT NULL,
          lugar_carga_id INT NULL, lugar_descarga_id INT NULL, ruta_codigo_historico VARCHAR(40) NULL, lugar_descarga_historico VARCHAR(300) NULL,
          tarifa_id INT NULL, tarifa_nombre_historico VARCHAR(120) NULL, tarifa_monto_historico DECIMAL(12,2) NULL, tarifa_moneda_historico VARCHAR(10) NULL,
          unidad_id INT NULL, tc_vehiculo_id INT NULL, tc_placa_historica VARCHAR(40) NULL, tc_externo_placa VARCHAR(40) NULL,
          piloto_id INT NULL, auxiliar_id INT NULL, piloto_externo_nombre VARCHAR(160) NULL, auxiliares_externos TEXT NULL,
          unidad_externa_placa VARCHAR(40) NULL, unidad_externa_descripcion VARCHAR(160) NULL, transportista_externo VARCHAR(160) NULL,
          costo_tercerizado DECIMAL(12,2) NULL,
          UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)) ENGINE=InnoDB;
        CREATE TABLE tms_clientes(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_lugares(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_unidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_personal(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE flota_vehiculos(id INT PRIMARY KEY, placa VARCHAR(40) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_plan_auxiliares(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL, personal_id INT NOT NULL, orden TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE tms_plan_pilotos_adicionales(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NOT NULL, personal_id INT NOT NULL, orden TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE flota_viajes(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'abierto', km_salida INT NULL, km_llegada INT NULL,
          hora_salida DATETIME NULL, hora_llegada DATETIME NULL) ENGINE=InnoDB;
        CREATE TABLE tms_solicitudes_fondo(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL,
          estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente') ENGINE=InnoDB;
        CREATE TABLE tms_solicitud_fondo_lineas(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_id INT NOT NULL,
          categoria VARCHAR(40) NOT NULL, cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, plan_id INT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_gastos_operativos(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NULL,
          categoria VARCHAR(40) NOT NULL, cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL,
          activo TINYINT(1) NOT NULL DEFAULT 1, estado VARCHAR(20) NULL) ENGINE=InnoDB;
        CREATE TABLE tms_plan_cuadrilla(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL DEFAULT 7, plan_id INT NOT NULL,
          orden SMALLINT NOT NULL DEFAULT 1, tipo VARCHAR(10) NOT NULL DEFAULT 'EXTERNO', id_empleado INT NULL,
          nombre VARCHAR(200) NOT NULL DEFAULT 'Cuadrilla', identificacion VARCHAR(100) NULL, telefono VARCHAR(50) NULL) ENGINE=InnoDB;
        CREATE TABLE fact_factura_viajes(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE fel_documentos(id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE cont_eventos(id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
        INSERT INTO empresas VALUES (7),(8);
        INSERT INTO usuarios VALUES (4,'ana');
        INSERT INTO tms_clientes VALUES (1,7,'Cliente Uno'),(2,8,'Cliente Ajeno');
        INSERT INTO tms_lugares VALUES (1,7,'Bodega Central'),(2,7,'Puerto Quetzal');
      `);
      for (const f of ["sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql", "sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql"]) {
        await c.query(readFileSync(f, "utf8"));
      }
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 8 });
    const orig = holder.pool.query.bind(holder.pool) as (...a: unknown[]) => unknown;
    (holder.pool as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => {
      holder.log.push(String(typeof a[0] === "string" ? a[0] : (a[0] as { sql?: string })?.sql ?? ""));
      return orig(...a);
    };
  });

  beforeEach(() => {
    holder.log.length = 0;
  });

  afterAll(async () => {
    await holder.pool?.end();
  });

  // 1, 14
  it("tarifa sin cargos: subtotal = tarifa base; no hay IVA", async () => {
    const p = await plan({ tarifa: 1000 });
    const r = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(r.plan).toMatchObject({ id: p, codigo: `PLAN-${p}`, estado: "Programado", cliente: "Cliente Uno", ruta: { codigo: "R-01", origen: "Bodega Central", destino: "Puerto Quetzal" } });
    expect(r.comercial).toMatchObject({ tarifaBase: "1000.00", moneda: "GTQ", subtotalComercial: "1000.00", tratamientoIva: "PENDIENTE" });
    expect(r.comercial.cargosAdicionales).toEqual({ cantidad: 0, total: "0.00", items: [] });
    // Fase 5 jamás calcula IVA (ni 12 %): el subtotal no es el total de factura.
    expect(JSON.stringify(r)).not.toMatch(/"iva(Monto|Calculado)"|1120\.00|1\.12/);
  });

  // 2, 3, 14
  it("tarifa + 1 cargo y varios cargos: suma exacta (Decimal)", async () => {
    const p = await plan({ tarifa: 1000 });
    await cargo(p, "0.10", "Espera A");
    await cargo(p, "0.20", "Espera B");
    await cargo(p, "250.50", "Espera C");
    const r = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(r.comercial.cargosAdicionales).toMatchObject({ cantidad: 3, total: "250.80" });
    expect(r.comercial.cargosAdicionales.items.map((x) => x.concepto)).toEqual(["Espera A", "Espera B", "Espera C"]);
    expect(r.comercial.subtotalComercial).toBe("1250.80");
  });

  // 4
  it("un cargo anulado no suma", async () => {
    const p = await plan({ tarifa: 500 });
    const c1 = await cargo(p, "100.00", "Vigente");
    const c2 = await cargo(p, "40.00", "Anulado");
    await anularCargoAdicional(A, { planId: p, cargoId: c2.cargo.id, versionEsperada: 1, motivo: "Cobro duplicado" });
    const r = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(r.comercial.cargosAdicionales).toMatchObject({ cantidad: 1, total: "100.00" });
    expect(r.comercial.subtotalComercial).toBe("600.00");
    expect(c1.cargo.activo).toBe(true);
  });

  // 5
  it("aislamiento por empresa: un viaje de otra empresa es inexistente y los cargos/gastos ajenos no entran", async () => {
    const ajeno = await plan({ empresa: 8, cliente: 2, tarifa: 900 });
    expect(await obtenerResumenLiquidacionViaje(7, ajeno, { incluirCostos: true })).toBeNull();
    const propio = await plan({ tarifa: 100 });
    // Datos de OTRA empresa colgados al mismo plan_id (inconsistencia simulada): no deben contarse.
    await gasto(propio, { monto: 9999, estado: "Autorizada", empresa: 8 });
    await holder.pool!.execute(
      "INSERT INTO tms_viaje_cargos_adicionales (empresa_id, plan_id, concepto, monto, clave_envio, huella, creado_por) VALUES (8, ?, 'X', 5, ?, ?, 4)",
      [propio, nuevaClaveEnvio(), "b".repeat(64)],
    ).catch(() => undefined); // la FK compuesta puede impedirlo: igualmente no debe contarse
    const r = (await obtenerResumenLiquidacionViaje(7, propio, { incluirCostos: true }))!;
    expect(r.comercial.subtotalComercial).toBe("100.00");
    expect(r.costos!.costoRegistrado!.total).toBe("0.00");
    expect(r.plan.cliente).toBe("Cliente Uno");
  });

  // 6, 7, 8
  it("estados: sin liquidación / EN_AJUSTE sujeto a cambios / LIQUIDADO finalizado, con snapshot congelado", async () => {
    const sin = await plan();
    expect((await obtenerResumenLiquidacionViaje(7, sin, { incluirCostos: false }))!.liquidacion).toEqual({ estado: null, version: null, sujetoACambios: false, finalizada: false });

    const p = await cerradoConReporte({ tarifa: 1000 });
    await cargo(p, "150.00", "Espera");
    const rep = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(rep.liquidacion).toMatchObject({ estado: "REPORTE_RECIBIDO", sujetoACambios: false, finalizada: false });
    expect(rep.snapshotComercial).toBeNull();

    await liquidarViaje(L(A), { planId: p, versionEsperada: 1 });
    const liq = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(liq.liquidacion).toMatchObject({ estado: "LIQUIDADO", sujetoACambios: false, finalizada: true });
    expect(liq.snapshotComercial).toMatchObject({ incluyeCargos: true, tarifaBase: "1000.00", cargosTotal: "150.00", subtotalComercial: "1150.00", difiereDelActual: false });

    await reabrirLiquidacion(L(A), { planId: p, versionEsperada: 2, motivo: "Falta un cargo de maniobra" });
    await cargo(p, "50.00", "Maniobra");
    const aj = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(aj.liquidacion).toMatchObject({ estado: "EN_AJUSTE", sujetoACambios: true, finalizada: false });
    // Lo actual cambió; lo congelado por la última liquidación sigue siendo 1150 y se marca la diferencia.
    expect(aj.comercial.subtotalComercial).toBe("1200.00");
    expect(aj.snapshotComercial).toMatchObject({ subtotalComercial: "1150.00", difiereDelActual: true });
    // Reabrir la liquidación NO reabre el viaje.
    expect(aj.plan.estado).toBe("Cerrado");
  });

  // 9
  it("plan sin tarifa: no se inventa base ni subtotal; los cargos se informan aparte", async () => {
    const p = await plan({ tarifa: null });
    await cargo(p, "75.00");
    const r = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(r.comercial).toMatchObject({ tarifaBase: null, subtotalComercial: null });
    expect(r.comercial.cargosAdicionales.total).toBe("75.00");
  });

  // 11, 12 + mutación: gastos jamás se suman al subtotal
  it("costos: solo con incluirCostos; autorizados/pendientes/rechazados/históricos separados; NUNCA entran al subtotal comercial", async () => {
    const p = await plan({ tarifa: 1000, terc: 300 });
    await cargo(p, "100.00");
    await gasto(p, { categoria: "Combustible", cantidad: 2, monto: 250.5, estado: "Autorizada" });
    await gasto(p, { categoria: "Peajes", monto: 40, estado: "Autorizada" });
    await gasto(p, { categoria: "Peajes", monto: 70, estado: "Pendiente" });
    await gasto(p, { categoria: "Peajes", monto: 11, estado: "Rechazada" });
    await gasto(p, { categoria: "Peajes", monto: 5000, estado: null }); // histórico sin flujo
    await gasto(p, { categoria: "Peajes", monto: 123, estado: "Autorizada", activo: 0 }); // anulado/inactivo
    await fondo(p, "Autorizada", 800);
    await fondo(p, "Pendiente", 100);

    holder.log.length = 0;
    const sin = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false }))!;
    expect(sin.costosAutorizado).toBe(false);
    expect(sin.costos).toBeNull();
    // El SQL de gastos/fondos ni siquiera se ejecutó (filtrado en backend, no en UI).
    expect(holder.log.some((s) => /tms_gastos_operativos|tms_solicitud/.test(s))).toBe(false);
    expect(JSON.stringify(sin)).not.toMatch(/Combustible|Peajes|anticiposFondo|costoRegistrado/);

    const con = (await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: true }))!;
    expect(con.costosAutorizado).toBe(true);
    expect(con.costos!.costoRegistrado).toMatchObject({ total: "541.00", porCategoria: [{ categoria: "Combustible", cantidad: 1, total: "501.00" }, { categoria: "Peajes", cantidad: 1, total: "40.00" }] });
    expect(con.costos!.noIncluidos).toEqual({ pendientes: { cantidad: 1, total: "70.00" }, rechazados: { cantidad: 1 }, historicos: { cantidad: 1, total: "5000.00" } });
    expect(con.costos!.anticiposFondo).toMatchObject({ lineas: 2, montoSolicitado: "900.00" });
    expect(con.costos!.costoTercerizado).toBe("300.00");
    // El bloque comercial es IDÉNTICO con o sin costos: los gastos no lo alteran.
    expect(con.comercial).toEqual(sin.comercial);
    expect(con.comercial.subtotalComercial).toBe("1100.00");
    expect(con.margen.disponible).toBe(false);
  });

  // 13
  it("lote: UNA consulta agrupada por plan (sin N+1) y subtotales por viaje", async () => {
    const ids = [await plan({ tarifa: 100 }), await plan({ tarifa: 200 }), await plan({ tarifa: null })];
    await cargo(ids[0], "10.00");
    await cargo(ids[1], "20.00");
    await cargo(ids[1], "5.00");
    await cargo(ids[2], "7.00");
    holder.log.length = 0;
    const m = await resumenComercialDePlanes(7, [
      { id: ids[0], tarifaComercial: "100.00" }, { id: ids[1], tarifaComercial: 200 }, { id: ids[2], tarifaComercial: null },
    ]);
    expect(holder.log.length).toBe(1);
    expect(m.get(ids[0])).toEqual({ cargosCantidad: 1, cargosTotal: "10.00", subtotalComercial: "110.00" });
    expect(m.get(ids[1])).toEqual({ cargosCantidad: 2, cargosTotal: "25.00", subtotalComercial: "225.00" });
    expect(m.get(ids[2])).toEqual({ cargosCantidad: 1, cargosTotal: "7.00", subtotalComercial: null });
  });

  // 16
  it("consultar el resumen NO modifica nada (plan, liquidación, eventos, cargos, gastos, fondos, facturación, FEL, contabilidad, auditoría)", async () => {
    const p = await cerradoConReporte({ tarifa: 800 });
    await cargo(p, "20.00");
    await gasto(p, { monto: 10, estado: "Autorizada" });
    await liquidarViaje(L(A), { planId: p, versionEsperada: 1 });
    const antes = await huella(p);
    await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: true });
    await obtenerResumenLiquidacionViaje(7, p, { incluirCostos: false });
    await resumenComercialDePlanes(7, [{ id: p, tarifaComercial: 800 }]);
    expect(await huella(p)).toBe(antes);
  });
});
