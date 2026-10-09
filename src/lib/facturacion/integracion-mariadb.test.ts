import { readFileSync } from "node:fs";
import { join } from "node:path";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * FACT-2 — validación contra una MariaDB REAL y DESECHABLE (opt-in).
 *
 * Se OMITE por completo salvo que exista FACT_TEST_DB_PORT. Ejecuta el código REAL de `facturas.ts` (no mocks) y
 * los archivos SQL REALES (`migrate-2026-08-fact-1…`, preflight y migración FACT-2), con:
 *   - base de datos fija «fact_test_fase1» en 127.0.0.1 y usuario root SIN contraseña: el `vi.mock` de «@/lib/db»
 *     NO lee .env ni ninguna otra configuración, así que es imposible que apunte a Hostinger o a producción;
 *   - se BORRA y se recrea «fact_test_fase1» en cada corrida.
 *
 * Cómo correrla (instancia MariaDB desechable en el puerto 3399):
 *   FACT_TEST_DB_PORT=3399 npx vitest run src/lib/facturacion/integracion-mariadb.test.ts
 *
 * El esquema base (empresas, auditoria, tms_*, clientes) se extrae de `sql/schema.sql`; `fact_*` viene del
 * archivo de migración de FACT-1. No hay datos reales.
 */

const PUERTO = Number(process.env.FACT_TEST_DB_PORT ?? 0);
const DB_NAME = "fact_test_fase1";

vi.mock("@/lib/db", async () => {
  const m = await import("mysql2/promise");
  const puerto = Number(process.env.FACT_TEST_DB_PORT ?? 0);
  let pool: Pool | null = null;
  const getPool = (): Pool => {
    if (!puerto) throw new Error("FACT_TEST_DB_PORT no está definido: la prueba de integración está desactivada.");
    pool ??= m.createPool({
      host: "127.0.0.1", port: puerto, user: "root", password: "", database: "fact_test_fase1",
      connectionLimit: 12, timezone: "local",
    });
    return pool;
  };
  return {
    getPool,
    query: async (sql: string, params: unknown[] = []) => (await getPool().query(sql, params))[0],
    execute: async (sql: string, params: unknown[] = []) => (await getPool().execute(sql, params as never))[0],
  };
});

import { getPool } from "@/lib/db";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import {
  actualizarFacturaBorrador,
  anularFactura,
  crearFactura,
  listarFacturas,
  listarViajesPendientes,
  obtenerFactura,
  obtenerKpisFacturacion,
  previsualizarFactura,
  type ActorFacturacion,
} from "./facturas";
import { MENSAJE_MONEDA_NO_SOPORTADA } from "./borrador-calculo";

const RAIZ = process.cwd();
const E1 = 7; // empresa de la sesión
const E2 = 8; // otra empresa
const actorA: ActorFacturacion = { empresaId: E1, usuarioId: 3, usuario: "facturador-a" };
const actorB: ActorFacturacion = { empresaId: E1, usuarioId: 4, usuario: "facturador-b" };

let admin: Connection;
let seq = 0;

const sqlArchivo = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

function extraerCreate(sql: string, tabla: string): string {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`).exec(sql);
  if (!m) throw new Error(`No se encontró CREATE TABLE ${tabla} en sql/schema.sql`);
  return m[0];
}

async function filas(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await admin.query<RowDataPacket[]>(sql, params as never);
  return rows;
}

async function columnas(tabla: string): Promise<string[]> {
  return (await filas(`SHOW COLUMNS FROM ${tabla}`)).map((r) => String(r.Field));
}

async function crearPlan(over: Record<string, unknown> = {}): Promise<number> {
  const n = ++seq;
  const base: Record<string, unknown> = {
    empresa_id: E1, codigo: `P-${n}`, cliente_id: 501, lugar_carga_id: 11, lugar_descarga_id: 12, fecha_plan: "2026-08-27",
    tarifa_comercial: 1000, ruta_codigo_historico: "RUTA-01", lugar_descarga_historico: "Xela", tarifa_moneda_historico: "GTQ",
    estado: "Cerrado", ...over,
  };
  const cols = Object.keys(base);
  const [res] = await admin.query<mysql.ResultSetHeader>(
    `INSERT INTO tms_planes_viaje (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    cols.map((c) => base[c]) as never,
  );
  return res.insertId;
}

async function ejecutarArchivo(rel: string): Promise<unknown> {
  const [r] = await admin.query(sqlArchivo(rel));
  return r;
}

const conteo = async (sql: string, p: unknown[] = []) => Number((await filas(sql, p))[0]?.n ?? 0);
/**
 * Texto de la sección «LATEST DETECTED DEADLOCK» de InnoDB (vacío si nunca hubo uno). Se compara antes/después:
 * si cambia, hubo un deadlock nuevo. (`Innodb_deadlocks` no sirve: en MariaDB 10.4 es siempre 0.)
 */
const ultimoDeadlock = async (): Promise<string> => {
  const texto = String((await filas("SHOW ENGINE INNODB STATUS"))[0]?.Status ?? "");
  const i = texto.indexOf("LATEST DETECTED DEADLOCK");
  if (i < 0) return "";
  const j = texto.indexOf("TRANSACTIONS", i);
  return texto.slice(i, j > i ? j : i + 4000);
};

beforeAll(async () => {
  if (!PUERTO) return;
  admin = await mysql.createConnection({ host: "127.0.0.1", port: PUERTO, user: "root", password: "", multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await admin.query(`CREATE DATABASE ${DB_NAME} CHARACTER SET utf8mb4`);
  await admin.query(`USE ${DB_NAME}`);

  const schema = sqlArchivo("sql/schema.sql");
  for (const t of ["empresas", "auditoria", "tms_clientes", "tms_lugares", "tms_unidades", "tms_personal", "tms_planes_viaje", "clientes"]) {
    await admin.query(extraerCreate(schema, t));
  }
  // El código de la app completa columnas de `clientes` (rtu, condicion_credito…) con su propio asegurador.
  await asegurarSchemaClientes();
  // fact_* tal como existe hoy en producción (migración de FACT-1, ya aplicada allí).
  await ejecutarArchivo("sql/migrate-2026-08-fact-1-facturas-pagos.sql");

  await admin.query(`INSERT INTO empresas (id, codigo, nombre, slug) VALUES (${E1}, 'E7', 'Empresa 7', 'e7'), (${E2}, 'E8', 'Empresa 8', 'e8')`);
  await admin.query(`INSERT INTO tms_clientes (id, empresa_id, nombre) VALUES (501, ${E1}, 'Cliente X'), (502, ${E1}, 'Cliente Y'), (601, ${E2}, 'Cliente Z')`);
  await admin.query(
    `INSERT INTO clientes (id, empresa_id, nombre, razon_social, nit, direccion, tms_cliente_id) VALUES
       (20, ${E1}, 'Comercial X', 'Cliente X, S.A.', '1234567-8', 'Zona 1', 501),
       (21, ${E1}, 'Comercial Y', NULL, NULL, NULL, 502),
       (30, ${E2}, 'Comercial Z', NULL, NULL, NULL, 601)`,
  );
  await admin.query(
    `INSERT INTO tms_lugares (id, empresa_id, nombre) VALUES
       (11, ${E1}, 'Guatemala'), (12, ${E1}, 'Quetzaltenango'), (13, ${E1}, '   '), (14, ${E2}, 'Lugar de otra empresa')`,
  );
}, 60_000);

afterAll(async () => {
  if (!PUERTO) return;
  await getPool().end().catch(() => undefined);
  await admin?.end().catch(() => undefined);
});

describe.skipIf(!PUERTO)("MariaDB real — A/B/C: preflight, migración e idempotencia", () => {
  let legacyFacturaId = 0;

  it("A) el preflight se ejecuta sin error y muestra que las columnas nuevas AÚN no existen", async () => {
    expect(await columnas("fact_facturas")).not.toContain("iva_monto");
    expect(await columnas("fact_factura_viajes")).not.toContain("descripcion");
    await expect(ejecutarArchivo("sql/preflight-2026-10-fact-2-borrador-snapshots-iva.sql")).resolves.toBeDefined();
    const idx = await filas("SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0");
    expect(idx).toHaveLength(1); // la garantía anti doble facturación existe
  });

  it("datos ANTERIORES a FACT-2 (una factura Borrador con su línea, creada con el esquema viejo)", async () => {
    const plan = await crearPlan({ codigo: "LEGACY-1" });
    const [f] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 750.00, 'Borrador', 1)`,
    );
    legacyFacturaId = f.insertId;
    await admin.query(`INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (${legacyFacturaId}, ${plan}, 750.00)`);
  });

  it("B) la migración se ejecuta sin error y agrega TODAS las columnas previstas", async () => {
    await expect(ejecutarArchivo("sql/migrate-2026-10-fact-2-borrador-snapshots-iva.sql")).resolves.toBeDefined();
    const f = await columnas("fact_facturas");
    for (const c of ["moneda", "subtotal", "iva_monto", "porcentaje_iva", "precio_incluye_iva", "cliente_nombre_snapshot", "cliente_nit_snapshot", "cliente_direccion_snapshot"]) {
      expect(f, c).toContain(c);
    }
    const v = await columnas("fact_factura_viajes");
    for (const c of ["codigo_viaje_snapshot", "fecha_viaje_snapshot", "ruta_codigo_snapshot", "origen_snapshot", "destino_snapshot", "descripcion", "cantidad", "base_monto", "iva_monto", "total_linea"]) {
      expect(v, c).toContain(c);
    }
  });

  it("C) ejecutar la migración por SEGUNDA vez es inocuo: mismas columnas, mismos datos, mismo índice UNIQUE", async () => {
    const antesF = await columnas("fact_facturas");
    const antesV = await columnas("fact_factura_viajes");
    const filasAntes = await conteo("SELECT COUNT(*) AS n FROM fact_facturas");
    await expect(ejecutarArchivo("sql/migrate-2026-10-fact-2-borrador-snapshots-iva.sql")).resolves.toBeDefined();
    expect(await columnas("fact_facturas")).toEqual(antesF);
    expect(await columnas("fact_factura_viajes")).toEqual(antesV);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas")).toBe(filasAntes);
    expect(await filas("SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0")).toHaveLength(1);
  });

  it("la factura anterior a FACT-2 sobrevive intacta: moneda GTQ por defecto, snapshots NULL, monto original", async () => {
    const d = await obtenerFactura(E1, legacyFacturaId);
    expect(d?.factura).toMatchObject({
      montoTotal: 750, moneda: "GTQ", subtotal: null, iva: null, porcentajeIva: null, precioIncluyeIva: null, clienteNit: null,
      cliente: "Comercial X", // sin snapshot → nombre vivo
    });
    expect(d?.viajes[0]).toMatchObject({ montoAsignado: 750, descripcion: null, base: null, iva: null, total: null, cantidad: 1, codigo: "LEGACY-1" });
  });
});

describe.skipIf(!PUERTO)("MariaDB real — D–I: crear, leer, editar, cancelar, snapshots y totales", () => {
  let p1 = 0, p2 = 0, p3 = 0, facturaId = 0;

  it("D) crear un borrador REAL con dos viajes (una sola transacción, auditada)", async () => {
    p1 = await crearPlan({ codigo: "D-1", tarifa_comercial: 1000, fecha_plan: "2026-08-27" });
    p2 = await crearPlan({ codigo: "D-2", tarifa_comercial: 500.5, fecha_plan: "2026-08-28", lugar_descarga_historico: null, ruta_codigo_historico: "RUTA-02", lugar_descarga_id: 12 });
    const r = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: p1 }, { planId: p2 }], observaciones: "prueba" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    facturaId = r.facturaId;
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [facturaId])).toBe(2);
    const aud = await filas("SELECT usuario, accion, modulo, detalle FROM auditoria WHERE accion = 'crear_factura' ORDER BY id DESC LIMIT 1");
    expect(aud[0]).toMatchObject({ usuario: "facturador-a", modulo: "facturacion" });
    expect(String(aud[0].detalle)).toContain("viajes: D-1, D-2");
    expect(String(aud[0].detalle)).not.toContain("1234567-8");
  });

  it("E) leer el borrador REAL: cabecera, snapshot del cliente y líneas congeladas", async () => {
    const d = await obtenerFactura(E1, facturaId);
    expect(d?.factura).toMatchObject({
      estadoAdmin: "Borrador", numeroFactura: null, fechaEmision: null, moneda: "GTQ", porcentajeIva: 12, precioIncluyeIva: true,
      cliente: "Cliente X, S.A.", clienteNit: "1234567-8", clienteDireccion: "Zona 1", montoTotal: 1500.5, subtotal: 1339.74, iva: 160.76,
    });
    expect(d?.viajes).toHaveLength(2);
    expect(d?.viajes[0]).toMatchObject({
      codigo: "D-1", fechaPlan: "2026-08-27", descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026",
      rutaCodigo: "RUTA-01", origen: "Guatemala", destino: "Xela", base: 892.86, iva: 107.14, total: 1000, cantidad: 1,
    });
    // destino resuelto desde el catálogo de lugares (la fila no tiene destino congelado)
    expect(d?.viajes[1]).toMatchObject({ codigo: "D-2", destino: "Quetzaltenango", fechaPlan: "2026-08-28" });
  });

  it("I) subtotal + IVA = total en TODAS las facturas y líneas guardadas (verificado en SQL)", async () => {
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas WHERE subtotal IS NOT NULL AND ROUND(subtotal + iva_monto, 2) <> monto_total")).toBe(0);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE base_monto IS NOT NULL AND ROUND(base_monto + iva_monto, 2) <> total_linea")).toBe(0);
    // el documento = suma exacta de sus líneas
    const r = await filas(
      `SELECT f.monto_total, f.subtotal, f.iva_monto, SUM(v.total_linea) st, SUM(v.base_monto) sb, SUM(v.iva_monto) si
       FROM fact_facturas f JOIN fact_factura_viajes v ON v.factura_id = f.id WHERE f.id = ? GROUP BY f.id`, [facturaId]);
    expect(Number(r[0].monto_total)).toBe(Number(r[0].st));
    expect(Number(r[0].subtotal)).toBe(Number(r[0].sb));
    expect(Number(r[0].iva_monto)).toBe(Number(r[0].si));
  });

  it("H) los snapshots NO cambian aunque luego cambien el cliente, la ruta, el destino y la tarifa originales", async () => {
    await admin.query("UPDATE clientes SET razon_social = 'Razón NUEVA', nit = '0000000-0', direccion = 'Otra zona' WHERE id = 20");
    await admin.query("UPDATE tms_planes_viaje SET ruta_codigo_historico = 'RUTA-NUEVA', lugar_descarga_historico = 'Destino NUEVO', tarifa_comercial = 99 WHERE id = ?", [p1]);
    await admin.query("UPDATE tms_lugares SET nombre = 'Quetzaltenango NUEVO' WHERE id = 12");
    const d = await obtenerFactura(E1, facturaId);
    expect(d?.factura).toMatchObject({ cliente: "Cliente X, S.A.", clienteNit: "1234567-8", clienteDireccion: "Zona 1", montoTotal: 1500.5 });
    expect(d?.viajes[0]).toMatchObject({ rutaCodigo: "RUTA-01", destino: "Xela", total: 1000, descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026" });
    expect(d?.viajes[1]).toMatchObject({ destino: "Quetzaltenango" });
  });

  it("F) editar el borrador: quita un viaje, agrega otro, cambia un monto — y lo ya congelado NO se refresca", async () => {
    p3 = await crearPlan({ codigo: "F-3", tarifa_comercial: 300, fecha_plan: "2026-08-29" });
    // p1 se conserva (con su ruta/destino/tarifa vivos ya cambiados), p2 sale, p3 entra
    const r = await actualizarFacturaBorrador(actorA, facturaId, {
      clienteId: 20, planes: [{ planId: p1, montoAsignado: 900 }, { planId: p3 }], numeroFactura: "BORR-1", observaciones: "editado",
    });
    expect(r.ok).toBe(true);
    const d = await obtenerFactura(E1, facturaId);
    expect(d?.viajes.map((v) => v.codigo)).toEqual(["D-1", "F-3"]);
    expect(d?.viajes[0]).toMatchObject({ rutaCodigo: "RUTA-01", destino: "Xela", descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026", montoAsignado: 900, total: 900, base: 803.57, iva: 96.43 });
    expect(d?.factura).toMatchObject({ cliente: "Cliente X, S.A.", clienteNit: "1234567-8", montoTotal: 1200, numeroFactura: "BORR-1", observaciones: "editado" });
    // p2 quedó libre y vuelve a la lista de facturables
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [p2])).toBe(0);
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    expect(lista.items.map((i) => i.planId)).toContain(p2);
    expect(lista.items.map((i) => i.planId)).not.toContain(p1);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas WHERE ROUND(subtotal + iva_monto, 2) <> monto_total")).toBe(0);
  });

  it("G) cancelar el borrador libera los viajes (y se pueden volver a facturar)", async () => {
    const r = await anularFactura(actorA, facturaId);
    expect(r.ok).toBe(true);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [facturaId])).toBe(0);
    expect((await filas("SELECT estado_admin FROM fact_facturas WHERE id = ?", [facturaId]))[0].estado_admin).toBe("Anulada");
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    for (const p of [p1, p3]) expect(lista.items.map((i) => i.planId)).toContain(p);
    const otra = await crearFactura(actorB, { clienteId: 20, planes: [{ planId: p1 }, { planId: p3 }] });
    expect(otra.ok).toBe(true);
  });

  it("la vista previa REAL no escribe nada (ni facturas, ni líneas, ni auditoría)", async () => {
    const p = await crearPlan({ codigo: "PREV-1" });
    const antes = await conteo("SELECT (SELECT COUNT(*) FROM fact_facturas) + (SELECT COUNT(*) FROM fact_factura_viajes) + (SELECT COUNT(*) FROM auditoria) AS n");
    const r = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: p }] });
    expect(r.ok).toBe(true);
    expect(await conteo("SELECT (SELECT COUNT(*) FROM fact_facturas) + (SELECT COUNT(*) FROM fact_factura_viajes) + (SELECT COUNT(*) FROM auditoria) AS n")).toBe(antes);
  });
});

describe.skipIf(!PUERTO)("MariaDB real — fecha_emision llega como YYYY-MM-DD (bug de DATE → «Thu Aug 27»)", () => {
  const creadas: number[] = [];
  const insertar = async (fecha: string | null, estado: string, numero: string | null): Promise<number> => {
    const [r] = await admin.query<mysql.ResultSetHeader>(
      "INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por, fecha_emision, numero_factura) VALUES (?, 20, 100, ?, 1, ?, ?)",
      [E1, estado, fecha, numero],
    );
    creadas.push(r.insertId);
    return r.insertId;
  };
  // Estas facturas sintéticas no tienen líneas: se borran para no alterar las invariantes de las pruebas J/K/L.
  afterAll(async () => {
    if (creadas.length) await admin.query("DELETE FROM fact_facturas WHERE id IN (?)", [creadas]);
  });

  it("el driver SÍ entrega un objeto Date para una columna DATE (por eso hay que formatear en SQL)", async () => {
    const id = await insertar("2026-08-27", "Emitida", "F-FECHA-0");
    const [rows] = await getPool().query<RowDataPacket[]>("SELECT fecha_emision FROM fact_facturas WHERE id = ?", [id]);
    expect(rows[0].fecha_emision).toBeInstanceOf(Date);
    expect(String(rows[0].fecha_emision).slice(0, 10)).not.toBe("2026-08-27"); // es lo que mostraba «Thu Aug 27»
  });

  it("detalle y listado devuelven «2026-08-27» (Emitida y Borrador) y NULL sigue siendo null", async () => {
    const emitida = await insertar("2026-08-27", "Emitida", "F-FECHA-1");
    const borrador = await insertar("2026-01-05", "Borrador", null);
    const sinFecha = await insertar(null, "Borrador", null);

    expect((await obtenerFactura(E1, emitida))?.factura.fechaEmision).toBe("2026-08-27");
    expect((await obtenerFactura(E1, borrador))?.factura.fechaEmision).toBe("2026-01-05"); // lo que recibe el formulario de edición
    expect((await obtenerFactura(E1, sinFecha))?.factura.fechaEmision).toBeNull();

    const lista = await listarFacturas(E1, { pageSize: 200 });
    const porId = new Map(lista.items.map((f) => [f.id, f.fechaEmision]));
    expect(porId.get(emitida)).toBe("2026-08-27");
    expect(porId.get(borrador)).toBe("2026-01-05");
    expect(porId.get(sinFecha)).toBeNull();
    for (const f of lista.items) if (f.fechaEmision != null) expect(f.fechaEmision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("el filtro por rango de fechas sigue funcionando (compara la columna, no el texto formateado)", async () => {
    const dentro = await insertar("2026-08-27", "Emitida", "F-FECHA-2");
    const fuera = await insertar("2025-01-01", "Emitida", "F-FECHA-3");
    const lista = await listarFacturas(E1, { fechaDesde: "2026-08-01", fechaHasta: "2026-08-31", pageSize: 200 });
    const ids = lista.items.map((f) => f.id);
    expect(ids).toContain(dentro);
    expect(ids).not.toContain(fuera);
  });

  it("editar un borrador con fecha de emisión la conserva como YYYY-MM-DD de ida y vuelta", async () => {
    const plan = await crearPlan({ codigo: "FECHA-EDIT" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: plan }], fechaEmision: "2026-08-27" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const leida = (await obtenerFactura(E1, c.facturaId))!;
    expect(leida.factura.fechaEmision).toBe("2026-08-27");
    // el formulario reenvía exactamente lo que recibió
    const e = await actualizarFacturaBorrador(actorA, c.facturaId, { clienteId: 20, planes: [{ planId: plan }], fechaEmision: leida.factura.fechaEmision });
    expect(e.ok).toBe(true);
    expect((await obtenerFactura(E1, c.facturaId))?.factura.fechaEmision).toBe("2026-08-27");
    expect(String((await filas("SELECT DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS f FROM fact_facturas WHERE id = ?", [c.facturaId]))[0].f)).toBe("2026-08-27");
  });
});

describe.skipIf(!PUERTO)("MariaDB real — J/K: dos sesiones, mismo viaje y viajes en distinto orden", () => {
  const invariantes = async () => {
    expect(await conteo("SELECT COUNT(*) AS n FROM (SELECT plan_id FROM fact_factura_viajes GROUP BY plan_id HAVING COUNT(*) > 1) x")).toBe(0);
    // ninguna factura Borrador huérfana (sin líneas) creada por un intento fallido
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas f WHERE f.estado_admin = 'Borrador' AND NOT EXISTS (SELECT 1 FROM fact_factura_viajes v WHERE v.factura_id = f.id)")).toBe(0);
  };

  it("J) dos sesiones simultáneas con el MISMO viaje (20 rondas): solo una crea el vínculo; la otra termina en 409", async () => {
    let ganadasA = 0, ganadasB = 0;
    for (let i = 0; i < 20; i++) {
      const plan = await crearPlan({ codigo: `J-${i}` });
      const [a, b] = await Promise.all([
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: plan }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: plan }] }),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `ronda ${i}`).toHaveLength(1);
      const perdedor = a.ok ? b : a;
      expect(perdedor.ok).toBe(false);
      if (!perdedor.ok) { expect(perdedor.status).toBe(409); expect(perdedor.error, `ronda ${i}`).toContain("ya está vinculado a otra factura"); }
      if (a.ok) ganadasA++; else ganadasB++;
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [plan]), `ronda ${i}`).toBe(1);
      expect(await conteo("SELECT COUNT(DISTINCT factura_id) AS n FROM fact_factura_viajes WHERE plan_id = ?", [plan])).toBe(1);
    }
    expect(ganadasA + ganadasB).toBe(20);
    await invariantes();
  }, 60_000);

  it("J2) serialización por bloqueo: una sesión que ya tiene el viaje bloqueado hace ESPERAR a la otra, que luego ve el vínculo (409 «ya vinculado», no un error de clave duplicada)", async () => {
    const plan = await crearPlan({ codigo: "J2-1" });
    const c1 = await getPool().getConnection();
    await c1.beginTransaction();
    await c1.query("SELECT id FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? FOR UPDATE", [plan, E1]);

    let terminada = false;
    const esperando = crearFactura(actorB, { clienteId: 20, planes: [{ planId: plan }] }).then((r) => { terminada = true; return r; });
    await new Promise((r) => setTimeout(r, 700));
    expect(terminada, "la segunda sesión debería estar bloqueada esperando el FOR UPDATE").toBe(false);

    const [f] = await c1.execute<mysql.ResultSetHeader>(`INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 1000, 'Borrador', 3)`);
    await c1.execute("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 1000)", [f.insertId, plan]);
    await c1.commit();
    c1.release();

    const r = await esperando;
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("ya está vinculado a otra factura"); }
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [plan])).toBe(1);
    await invariantes();
  }, 30_000);

  it("J3) defensa de base de datos: dos INSERT directos del mismo plan (saltándose la aplicación) → el UNIQUE rechaza el segundo", async () => {
    const plan = await crearPlan({ codigo: "J3-1" });
    const [f1] = await admin.query<mysql.ResultSetHeader>(`INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 1, 'Borrador', 3)`);
    const [f2] = await admin.query<mysql.ResultSetHeader>(`INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 1, 'Borrador', 3)`);
    await admin.query("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 1)", [f1.insertId, plan]);
    await expect(admin.query("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 1)", [f2.insertId, plan])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await admin.query("DELETE FROM fact_facturas WHERE id IN (?, ?)", [f1.insertId, f2.insertId]); // limpieza (cascada borra las líneas)
  });

  it("K) varios viajes en DISTINTO ORDEN desde dos sesiones (10 rondas): una gana completa, la otra no deja escrituras parciales y no hay deadlocks", async () => {
    const deadlocksAntes = await ultimoDeadlock();
    for (let i = 0; i < 10; i++) {
      const [a, b, c] = [await crearPlan({ codigo: `K-${i}-a` }), await crearPlan({ codigo: `K-${i}-b` }), await crearPlan({ codigo: `K-${i}-c` })];
      const [r1, r2] = await Promise.all([
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: a }, { planId: b }, { planId: c }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: c }, { planId: b }, { planId: a }] }),
      ]);
      expect([r1.ok, r2.ok].filter(Boolean), `ronda ${i}`).toHaveLength(1);
      const perdedor = r1.ok ? r2 : r1;
      expect(perdedor.ok).toBe(false);
      // pierde porque el viaje YA es de la otra factura (serialización por bloqueo), no por un deadlock/timeout
      if (!perdedor.ok) { expect(perdedor.status).toBe(409); expect(perdedor.error, `ronda ${i}`).toContain("ya está vinculado a otra factura"); }
      // los TRES viajes pertenecen a UNA sola factura (nada parcial)
      expect(await conteo("SELECT COUNT(DISTINCT factura_id) AS n FROM fact_factura_viajes WHERE plan_id IN (?, ?, ?)", [a, b, c]), `ronda ${i}`).toBe(1);
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id IN (?, ?, ?)", [a, b, c])).toBe(3);
    }
    await invariantes();
    expect(await ultimoDeadlock(), "InnoDB no debe haber detectado ningún deadlock nuevo durante K").toBe(deadlocksAntes);
  }, 60_000);

  it("K2) selecciones que SOLO se traslapan (A=[a,b], B=[b,c], 10 rondas): una gana; el viaje no compartido de la perdedora NO queda vinculado", async () => {
    const deadlocksAntes = await ultimoDeadlock();
    for (let i = 0; i < 10; i++) {
      const [a, b, c] = [await crearPlan({ codigo: `K2-${i}-a` }), await crearPlan({ codigo: `K2-${i}-b` }), await crearPlan({ codigo: `K2-${i}-c` })];
      const [r1, r2] = await Promise.all([
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: a }, { planId: b }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: b }, { planId: c }] }),
      ]);
      expect([r1.ok, r2.ok].filter(Boolean), `ronda ${i}`).toHaveLength(1);
      const perdedorK2 = r1.ok ? r2 : r1;
      if (!perdedorK2.ok) { expect(perdedorK2.status).toBe(409); expect(perdedorK2.error, `ronda ${i}`).toContain("ya está vinculado a otra factura"); }
      if (r1.ok) {
        expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [c]), `ronda ${i}: c debe quedar libre`).toBe(0);
        expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id IN (?, ?)", [a, b])).toBe(2);
      } else {
        expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [a]), `ronda ${i}: a debe quedar libre`).toBe(0);
        expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id IN (?, ?)", [b, c])).toBe(2);
      }
    }
    await invariantes();
    expect(await ultimoDeadlock(), "InnoDB no debe haber detectado ningún deadlock nuevo durante K2").toBe(deadlocksAntes);
  }, 60_000);

  it("L) sesiones con viajes DISTINTOS y contiguos no se estorban (30 rondas): ambas terminan bien, sin falsos conflictos ni deadlocks", async () => {
    const antes = await ultimoDeadlock();
    for (let i = 0; i < 30; i++) {
      const [a, b] = [await crearPlan({ codigo: `L-${i}-a` }), await crearPlan({ codigo: `L-${i}-b` })];
      const [r1, r2] = await Promise.all([
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: a }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: b }] }),
      ]);
      expect(r1.ok, `ronda ${i}: ${r1.ok ? "" : r1.error}`).toBe(true);
      expect(r2.ok, `ronda ${i}: ${r2.ok ? "" : r2.error}`).toBe(true);
    }
    expect(await ultimoDeadlock()).toBe(antes);
    await invariantes();
  }, 60_000);

  it("CONTROL: sin el orden estable, dos transacciones que bloquean en orden opuesto SÍ se interbloquean en esta MariaDB (la prueba K tiene dientes)", async () => {
    const deadlocksAntes = await ultimoDeadlock();
    const a = await crearPlan({ codigo: "CTRL-a" });
    const b = await crearPlan({ codigo: "CTRL-b" });
    const c1 = await getPool().getConnection();
    const c2 = await getPool().getConnection();
    await c1.beginTransaction();
    await c2.beginTransaction();
    await c1.query("SELECT id FROM tms_planes_viaje WHERE id = ? FOR UPDATE", [a]);
    await c2.query("SELECT id FROM tms_planes_viaje WHERE id = ? FOR UPDATE", [b]);
    const q1 = c1.query("SELECT id FROM tms_planes_viaje WHERE id = ? FOR UPDATE", [b]).then(() => "ok", (e: { code?: string }) => e.code);
    await new Promise((r) => setTimeout(r, 300));
    const q2 = c2.query("SELECT id FROM tms_planes_viaje WHERE id = ? FOR UPDATE", [a]).then(() => "ok", (e: { code?: string }) => e.code);
    const resultados = await Promise.all([q1, q2]);
    expect(resultados).toContain("ER_LOCK_DEADLOCK");
    expect(await ultimoDeadlock()).not.toBe(deadlocksAntes);
    await c1.rollback().catch(() => undefined);
    await c2.rollback().catch(() => undefined);
    c1.release();
    c2.release();
  }, 30_000);
});

describe.skipIf(!PUERTO)("MariaDB real — «Viajes por facturar» == lo que el servidor acepta (moneda, destino, ruta)", () => {
  type Caso = { nombre: string; over: Record<string, unknown>; facturable: boolean; foraneo?: boolean };
  const casos: Caso[] = [
    { nombre: "base", over: {}, facturable: true },
    { nombre: "moneda null", over: { tarifa_moneda_historico: null }, facturable: true },
    { nombre: "moneda vacía", over: { tarifa_moneda_historico: "" }, facturable: true },
    { nombre: "moneda Q", over: { tarifa_moneda_historico: "Q" }, facturable: true },
    { nombre: "moneda QTZ", over: { tarifa_moneda_historico: "QTZ" }, facturable: true },
    { nombre: "moneda ' gtq '", over: { tarifa_moneda_historico: " gtq " }, facturable: true },
    { nombre: "moneda USD", over: { tarifa_moneda_historico: "USD" }, facturable: false },
    { nombre: "moneda EUR", over: { tarifa_moneda_historico: "EUR" }, facturable: false },
    { nombre: "solo ruta (sin destino)", over: { lugar_descarga_historico: null, lugar_descarga_id: null }, facturable: true },
    { nombre: "destino solo de catálogo, válido", over: { ruta_codigo_historico: null, lugar_descarga_historico: null, lugar_descarga_id: 12 }, facturable: true },
    { nombre: "destino de catálogo de OTRA empresa", over: { ruta_codigo_historico: null, lugar_descarga_historico: null, lugar_descarga_id: 14 }, facturable: false },
    { nombre: "destino de catálogo con nombre vacío", over: { ruta_codigo_historico: null, lugar_descarga_historico: null, lugar_descarga_id: 13 }, facturable: false },
    { nombre: "ruta y destino en blanco", over: { ruta_codigo_historico: "  ", lugar_descarga_historico: "\t", lugar_descarga_id: null }, facturable: false },
    { nombre: "sin ruta, sin destino, sin catálogo", over: { ruta_codigo_historico: null, lugar_descarga_historico: null, lugar_descarga_id: null }, facturable: false },
    { nombre: "tarifa 0", over: { tarifa_comercial: 0 }, facturable: false },
    { nombre: "tarifa NULL", over: { tarifa_comercial: null }, facturable: false },
    { nombre: "estado En ruta", over: { estado: "En ruta" }, facturable: false },
    { nombre: "estado Descargado", over: { estado: "Descargado" }, facturable: false },
  ];
  const ids = new Map<string, number>();
  let huerfano = 0;

  it("preparación: un plan por caso + un destino HUÉRFANO (id inexistente, FK desactivada solo para simular datos viejos/inconsistentes)", async () => {
    for (const c of casos) ids.set(c.nombre, await crearPlan({ codigo: `M-${c.nombre}`.slice(0, 70), ...c.over }));
    await admin.query("SET foreign_key_checks = 0");
    huerfano = await crearPlan({ codigo: "M-huerfano", ruta_codigo_historico: null, lugar_descarga_historico: null, lugar_descarga_id: 99999 });
    await admin.query("SET foreign_key_checks = 1");
    expect(huerfano).toBeGreaterThan(0);
  });

  it("listado ⇔ servidor: cada viaje aparece en «por facturar» EXACTAMENTE cuando la vista previa del servidor lo acepta", async () => {
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    const listados = new Set(lista.items.map((i) => i.planId));
    const todos: [string, number, boolean][] = [...casos.map((c) => [c.nombre, ids.get(c.nombre)!, c.facturable] as [string, number, boolean]), ["destino huérfano", huerfano, false]];
    for (const [nombre, id, esperado] of todos) {
      const prev = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: id }] });
      expect(listados.has(id), `listado: ${nombre}`).toBe(esperado);
      expect(prev.ok, `servidor: ${nombre}${prev.ok ? "" : " → " + prev.error}`).toBe(esperado);
    }
  });

  it("USD y EUR: el servidor responde 409 con el mensaje exacto y la creación real también se bloquea", async () => {
    for (const n of ["moneda USD", "moneda EUR"]) {
      const r = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: ids.get(n)! }] });
      expect(r).toEqual({ ok: false, status: 409, error: MENSAJE_MONEDA_NO_SOPORTADA });
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [ids.get(n)!])).toBe(0);
    }
    const mezcla = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: ids.get("base")! }, { planId: ids.get("moneda USD")! }] });
    expect(mezcla).toEqual({ ok: false, status: 409, error: MENSAJE_MONEDA_NO_SOPORTADA });
  });

  it("conteo y KPI usan la MISMA definición que el listado", async () => {
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    expect(lista.totalReal).toBe(lista.items.length);
    const kpi = await obtenerKpisFacturacion(E1);
    expect(kpi.viajesPendientes).toBe(lista.totalReal);
    expect(kpi.valorPendiente).toBeCloseTo(lista.items.reduce((s, i) => s + (i.tarifaComercial ?? 0), 0), 2);
  });

  it("multiempresa: un viaje de otra empresa no aparece, y no se puede previsualizar ni siquiera conociendo su id", async () => {
    const ajeno = await crearPlan({ codigo: "M-ajeno", empresa_id: E2, cliente_id: 601, lugar_carga_id: null, lugar_descarga_id: null });
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    expect(lista.items.map((i) => i.planId)).not.toContain(ajeno);
    const r = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: ajeno }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    const rc = await previsualizarFactura(actorA, { clienteId: 30, planes: [{ planId: ajeno }] }); // cliente de la otra empresa
    expect(rc.ok).toBe(false);
    if (!rc.ok) expect(rc.status).toBe(404);
    const propia = await listarViajesPendientes(E2, { pageSize: 200 });
    expect(propia.items.map((i) => i.planId)).toEqual([ajeno]);
  });

  it("filtro «ruta o destino» encuentra el nombre del destino de CATÁLOGO (el que se muestra) y no encuentra uno que no se muestra", async () => {
    const solo = await listarViajesPendientes(E1, { ruta: "Quetzal", pageSize: 200 });
    const idCatalogo = ids.get("destino solo de catálogo, válido")!;
    expect(solo.items.map((i) => i.planId)).toContain(idCatalogo);
    // (el lugar fue renombrado en la prueba H: el destino mostrado es el nombre ACTUAL del catálogo, no un snapshot)
    expect(solo.items.find((i) => i.planId === idCatalogo)?.destino).toBe("Quetzaltenango NUEVO");
    expect(solo.totalReal).toBe(solo.items.length);

    // La fila «base» tiene destino congelado «Xela» y lugar_descarga_id = 12 (Quetzaltenango): se MUESTRA «Xela», así que
    // buscar «Quetzal» no debe traerla (mismo COALESCE que la columna), pero «Xela» sí.
    expect(solo.items.map((i) => i.planId)).not.toContain(ids.get("base")!);
    const xela = await listarViajesPendientes(E1, { ruta: "Xela", pageSize: 200 });
    expect(xela.items.map((i) => i.planId)).toContain(ids.get("base")!);

    const porRuta = await listarViajesPendientes(E1, { ruta: "RUTA-01", pageSize: 200 });
    expect(porRuta.items.length).toBeGreaterThan(0);
    const otraEmpresa = await listarViajesPendientes(E2, { ruta: "Quetzal", pageSize: 200 });
    expect(otraEmpresa.items).toHaveLength(0); // el catálogo de la empresa 7 no es visible desde la 8
  });

  it("listado: ruta/origen/destino/piloto/estado/moneda salen correctos del SQL real", async () => {
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    const base = lista.items.find((i) => i.planId === ids.get("base")!);
    expect(base).toMatchObject({ rutaCodigo: "RUTA-01", origen: "Guatemala", destino: "Xela", estado: "Cerrado", moneda: "GTQ", cliente: "Comercial X", tarifaComercial: 1000, piloto: null });
    const qtz = lista.items.find((i) => i.planId === ids.get("moneda QTZ")!);
    expect(qtz?.moneda).toBe("GTQ");
  });
});
