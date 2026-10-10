import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import PDFDocument from "pdfkit";
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

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn(async () => ({ error: new Response(null, { status: 403 }) })) }));

import { getPool } from "@/lib/db";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import {
  actualizarFacturaBorrador,
  anularFactura,
  crearFactura,
  emitirFactura,
  listarFacturas,
  listarViajesPendientes,
  obtenerFactura,
  obtenerKpisFacturacion,
  previsualizarFactura,
  registrarPago,
  type ActorFacturacion,
} from "./facturas";
import { MENSAJE_MONEDA_NO_SOPORTADA } from "./borrador-calculo";
import { generarPdfFacturaDemo, LEYENDA_NO_FISCAL, MENSAJE_ANULADA_SIN_DETALLE } from "./factura-demo-pdf";
import { fact4Disponible, guardarRetencionIvaCliente, leerRetencionIvaCliente } from "./contexto-factura";
import { resolverEntradaFact4 } from "./entrada-fact4";
import { proponerPartidaVenta } from "./poliza-venta";

const RAIZ = process.cwd();
const E1 = 7; // empresa de la sesión
const E2 = 8; // otra empresa
const actorA: ActorFacturacion = { empresaId: E1, usuarioId: 3, usuario: "facturador-a" };
const actorB: ActorFacturacion = { empresaId: E1, usuarioId: 4, usuario: "facturador-b" };

let admin: Connection;
let seq = 0;
/** Factura Anulada con el comportamiento ANTERIOR a FACT-3 (sus líneas ya se habían borrado). */
let legacyAnuladaId = 0;

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
  // cont_entidades / cont_cuentas (C2B ya aplicado en producción): FACT-4 les referencia con FKs compuestas.
  for (const t of ["empresas", "auditoria", "tms_clientes", "tms_lugares", "tms_unidades", "tms_personal", "tms_planes_viaje", "clientes", "cont_entidades", "cont_cuentas"]) {
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

  it("FACT-3 A) el preflight se ejecuta; la tabla del histórico AÚN no existe y UNIQUE(plan_id) sigue vigente", async () => {
    expect(await filas("SHOW TABLES LIKE 'fact_factura_viajes_anuladas'")).toHaveLength(0);
    await expect(ejecutarArchivo("sql/preflight-2026-10-fact-3-anuladas-historico.sql")).resolves.toBeDefined();
    expect(await filas("SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0")).toHaveLength(1);
  });

  it("datos ANTERIORES a FACT-3: una factura Anulada que ya perdió sus líneas con el comportamiento viejo", async () => {
    const [f] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, subtotal, iva_monto, porcentaje_iva, moneda, estado_admin, creado_por)
       VALUES (${E1}, 20, 212.00, 189.29, 22.71, 12, 'GTQ', 'Anulada', 1)`,
    );
    legacyAnuladaId = f.insertId;
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [legacyAnuladaId])).toBe(0);
  });

  it("FACT-3 B) la migración crea la tabla del histórico con sus columnas, FKs e índices", async () => {
    await expect(ejecutarArchivo("sql/migrate-2026-10-fact-3-anuladas-historico.sql")).resolves.toBeDefined();
    const cols = await columnas("fact_factura_viajes_anuladas");
    for (const c of ["factura_id", "plan_id", "monto_asignado", "codigo_viaje_snapshot", "fecha_viaje_snapshot", "ruta_codigo_snapshot", "origen_snapshot",
      "destino_snapshot", "descripcion", "cantidad", "precio_incluye_iva", "porcentaje_iva", "base_monto", "iva_monto", "total_linea", "linea_creada_en", "anulada_en", "anulada_por"]) {
      expect(cols, c).toContain(c);
    }
    const fks = await filas(
      `SELECT CONSTRAINT_NAME AS nombre, DELETE_RULE AS regla, REFERENCED_TABLE_NAME AS tabla
       FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'fact_factura_viajes_anuladas' ORDER BY CONSTRAINT_NAME`,
    );
    expect(fks.map((r) => [r.nombre, r.regla, r.tabla])).toEqual([
      ["fk_factviajeanul_factura", "CASCADE", "fact_facturas"],
      ["fk_factviajeanul_plan", "SET NULL", "tms_planes_viaje"],
    ]);
    // UNIQUE(factura_id, plan_id) sí; UNIQUE(plan_id) a propósito NO (un viaje puede estar en varias anuladas)
    const unicos = await filas("SHOW INDEX FROM fact_factura_viajes_anuladas WHERE Non_unique = 0 AND Key_name <> 'PRIMARY'");
    expect(unicos.map((r) => r.Column_name)).toEqual(["factura_id", "plan_id"]);
  });

  it("FACT-3 C) ejecutar la migración por SEGUNDA vez es inocua: misma tabla, mismos datos, UNIQUE(plan_id) activo intacto", async () => {
    const antes = await columnas("fact_factura_viajes_anuladas");
    const facturas = await conteo("SELECT COUNT(*) AS n FROM fact_facturas");
    const activas = await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes");
    await expect(ejecutarArchivo("sql/migrate-2026-10-fact-3-anuladas-historico.sql")).resolves.toBeDefined();
    expect(await columnas("fact_factura_viajes_anuladas")).toEqual(antes);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas")).toBe(facturas);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes")).toBe(activas);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas")).toBe(0);
    expect(await filas("SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0")).toHaveLength(1);
    // el esquema de fact_factura_viajes NO cambió con FACT-3 (nada de columnas «activo»)
    expect(await columnas("fact_factura_viajes")).not.toContain("activo");
  });

  it("la Anulada ANTERIOR a FACT-3 sigue sin detalle: la migración no la reconstruye ni inventa líneas", async () => {
    const d = await obtenerFactura(E1, legacyAnuladaId);
    expect(d?.factura).toMatchObject({ estadoAdmin: "Anulada", montoTotal: 212, subtotal: 189.29, iva: 22.71 });
    expect(d?.viajes).toEqual([]);
    expect(d?.anulacion).toBeNull(); // sin auditoría de anulación para esa factura sintética
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas WHERE factura_id = ?", [legacyAnuladaId])).toBe(0);
  });
});

describe.skipIf(!PUERTO)("MariaDB real — D–I: crear, leer, editar, cancelar, snapshots y totales", () => {
  let p1 = 0, p2 = 0, p3 = 0, facturaId = 0;

  it("D) crear un borrador REAL con dos viajes (una sola transacción, auditada)", async () => {
    p1 = await crearPlan({ codigo: "D-1", tarifa_comercial: 1000, fecha_plan: "2026-08-27" });
    p2 = await crearPlan({ codigo: "D-2", tarifa_comercial: 500.5, fecha_plan: "2026-08-28", lugar_descarga_historico: null, ruta_codigo_historico: "RUTA-02", lugar_descarga_id: 12 });
    const r = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: p1, precioIncluyeIva: true }, { planId: p2, precioIncluyeIva: true }], observaciones: "prueba" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    facturaId = r.facturaId;
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [facturaId])).toBe(2);
    const aud = await filas("SELECT usuario, accion, modulo, detalle FROM auditoria WHERE accion = 'crear_factura' ORDER BY id DESC LIMIT 1");
    expect(aud[0]).toMatchObject({ usuario: "facturador-a", modulo: "facturacion" });
    expect(String(aud[0].detalle)).toContain("viajes: D-1 (IVA incluido), D-2 (IVA incluido)");
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
      clienteId: 20, planes: [{ planId: p1, montoAsignado: 900, precioIncluyeIva: true }, { planId: p3, precioIncluyeIva: true }], numeroFactura: "BORR-1", observaciones: "editado",
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
    const otra = await crearFactura(actorB, { clienteId: 20, planes: [{ planId: p1, precioIncluyeIva: true }, { planId: p3, precioIncluyeIva: true }] });
    expect(otra.ok).toBe(true);
  });

  it("la vista previa REAL no escribe nada (ni facturas, ni líneas, ni auditoría)", async () => {
    const p = await crearPlan({ codigo: "PREV-1" });
    const antes = await conteo("SELECT (SELECT COUNT(*) FROM fact_facturas) + (SELECT COUNT(*) FROM fact_factura_viajes) + (SELECT COUNT(*) FROM auditoria) AS n");
    const r = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: p, precioIncluyeIva: true }] });
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

  describe("emitir (emitirFactura lee fecha_emision con su propia consulta)", () => {
    const borrador = async (codigo: string, fecha: string | null): Promise<number> => {
      const plan = await crearPlan({ codigo });
      const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }], numeroFactura: `NUM-${codigo}`, fechaEmision: fecha });
      expect(c.ok).toBe(true);
      return c.ok ? c.facturaId : 0;
    };
    const fechaEnDb = async (id: number) => (await filas("SELECT DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS f FROM fact_facturas WHERE id = ?", [id]))[0].f as string | null;
    const auditoriaEmitir = async (id: number) => String((await filas("SELECT detalle FROM auditoria WHERE accion = 'emitir_factura' AND detalle LIKE ? ORDER BY id DESC LIMIT 1", [`Factura #${id} %`]))[0]?.detalle);

    it("1-5) borrador con 2026-08-27 emitido SIN fecha nueva: conserva «2026-08-27» (BD, lectura y auditoría)", async () => {
      const id = await borrador("EMIT-1", "2026-08-27");
      const r = await emitirFactura(actorA, id, {});
      expect(r.ok).toBe(true);
      expect(await fechaEnDb(id)).toBe("2026-08-27");
      const d = await obtenerFactura(E1, id);
      expect(d?.factura).toMatchObject({ estadoAdmin: "Emitida", fechaEmision: "2026-08-27", numeroFactura: "NUM-EMIT-1" });
      const aud = await auditoriaEmitir(id);
      expect(aud).toContain("fecha 2026-08-27");
      expect(aud).not.toMatch(/GMT|Thu|Aug/);
    });

    it("6) emitir CON fechaEmision nueva usa la nueva", async () => {
      const id = await borrador("EMIT-2", "2026-08-27");
      const r = await emitirFactura(actorA, id, { fechaEmision: "2026-09-01" });
      expect(r.ok).toBe(true);
      expect(await fechaEnDb(id)).toBe("2026-09-01");
      expect(await auditoriaEmitir(id)).toContain("fecha 2026-09-01");
    });

    it("7) sin fecha en el borrador y sin fecha nueva → error de fecha obligatoria y NO se emite", async () => {
      const id = await borrador("EMIT-3", null);
      const r = await emitirFactura(actorA, id, {});
      expect(r).toEqual({ ok: false, status: 400, error: "La fecha de emisión es obligatoria para emitir." });
      expect((await filas("SELECT estado_admin FROM fact_facturas WHERE id = ?", [id]))[0].estado_admin).toBe("Borrador");
      expect(await fechaEnDb(id)).toBeNull();
    });

    it("sin fecha en el borrador pero CON fecha nueva → emite con la nueva", async () => {
      const id = await borrador("EMIT-4", null);
      expect((await emitirFactura(actorA, id, { fechaEmision: "2026-10-09" })).ok).toBe(true);
      expect(await fechaEnDb(id)).toBe("2026-10-09");
    });
  });

  it("editar un borrador con fecha de emisión la conserva como YYYY-MM-DD de ida y vuelta", async () => {
    const plan = await crearPlan({ codigo: "FECHA-EDIT" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }], fechaEmision: "2026-08-27" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const leida = (await obtenerFactura(E1, c.facturaId))!;
    expect(leida.factura.fechaEmision).toBe("2026-08-27");
    // el formulario reenvía exactamente lo que recibió
    const e = await actualizarFacturaBorrador(actorA, c.facturaId, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }], fechaEmision: leida.factura.fechaEmision });
    expect(e.ok).toBe(true);
    expect((await obtenerFactura(E1, c.facturaId))?.factura.fechaEmision).toBe("2026-08-27");
    expect(String((await filas("SELECT DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS f FROM fact_facturas WHERE id = ?", [c.facturaId]))[0].f)).toBe("2026-08-27");
  });
});

describe.skipIf(!PUERTO)("MariaDB real — tratamiento de IVA POR LÍNEA (incluido en la tarifa / agregado a la tarifa, incluso mezclados)", () => {
  const cabecera = async (id: number) =>
    (await filas("SELECT precio_incluye_iva, porcentaje_iva, subtotal, iva_monto, monto_total, estado_admin FROM fact_facturas WHERE id = ?", [id]))[0];
  const lineasDb = async (id: number) =>
    (await filas("SELECT plan_id, monto_asignado, precio_incluye_iva, porcentaje_iva, base_monto, iva_monto, total_linea, descripcion FROM fact_factura_viajes WHERE factura_id = ? ORDER BY plan_id", [id]))
      .map((l) => ({ plan: Number(l.plan_id), m: Number(l.monto_asignado), incluye: l.precio_incluye_iva == null ? null : Number(l.precio_incluye_iva), pct: l.porcentaje_iva == null ? null : Number(l.porcentaje_iva), base: Number(l.base_monto), iva: Number(l.iva_monto), total: Number(l.total_linea), d: String(l.descripcion) }));
  const inc = (planId: number, montoAsignado?: number) => ({ planId, precioIncluyeIva: true, ...(montoAsignado != null ? { montoAsignado } : {}) });
  const agr = (planId: number, montoAsignado?: number) => ({ planId, precioIncluyeIva: false, ...(montoAsignado != null ? { montoAsignado } : {}) });

  it("1) una línea con IVA INCLUIDO: persiste precio_incluye_iva=1 y porcentaje_iva=12 en la línea; 1000 → 892.86 + 107.14 = 1000", async () => {
    const p = await crearPlan({ codigo: "IVA-INC", tarifa_comercial: 1000 });
    const r = await crearFactura(actorA, { clienteId: 20, planes: [inc(p)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await lineasDb(r.facturaId))[0]).toMatchObject({ incluye: 1, pct: 12, m: 1000, base: 892.86, iva: 107.14, total: 1000 });
    const c = await cabecera(r.facturaId);
    expect([Number(c.precio_incluye_iva), Number(c.porcentaje_iva), Number(c.subtotal), Number(c.iva_monto), Number(c.monto_total)]).toEqual([1, 12, 892.86, 107.14, 1000]);
  });

  it("2) una línea con IVA AGREGADO: persiste precio_incluye_iva=0 y porcentaje_iva=12; 1000 → 1000 + 120 = 1120", async () => {
    const p = await crearPlan({ codigo: "IVA-AGR", tarifa_comercial: 1000 });
    const r = await crearFactura(actorA, { clienteId: 20, planes: [agr(p)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await lineasDb(r.facturaId))[0]).toMatchObject({ incluye: 0, pct: 12, m: 1000, base: 1000, iva: 120, total: 1120 });
    const c = await cabecera(r.facturaId);
    expect([Number(c.precio_incluye_iva), Number(c.subtotal), Number(c.iva_monto), Number(c.monto_total)]).toEqual([0, 1000, 120, 1120]);
  });

  it("3/4/5/11) FACTURA MIXTA Q100 incluido + Q100 agregado: preview y base real coinciden — 89.29+10.71=100 y 100+12=112 → subtotal 189.29, IVA 22.71, total 212; encabezado NULL", async () => {
    const a = await crearPlan({ codigo: "IVA-MIX-1", tarifa_comercial: 100, fecha_plan: "2026-08-27" });
    const b = await crearPlan({ codigo: "IVA-MIX-2", tarifa_comercial: 100, fecha_plan: "2026-08-28" });
    const prev = await previsualizarFactura(actorA, { clienteId: 20, planes: [inc(a), agr(b)] });
    expect(prev.ok).toBe(true);
    if (!prev.ok) return;
    expect(prev.preview.borrador).toMatchObject({ subtotal: 189.29, iva: 22.71, total: 212, precioIncluyeIva: null });
    const r = await crearFactura(actorA, { clienteId: 20, planes: [inc(a), agr(b)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ls = await lineasDb(r.facturaId);
    expect(ls.map((l) => [l.incluye, l.pct, l.m, l.base, l.iva, l.total])).toEqual([[1, 12, 100, 89.29, 10.71, 100], [0, 12, 100, 100, 12, 112]]);
    const c = await cabecera(r.facturaId);
    expect([Number(c.subtotal), Number(c.iva_monto), Number(c.monto_total), Number(c.porcentaje_iva)]).toEqual([189.29, 22.71, 212, 12]);
    expect(c.precio_incluye_iva).toBeNull(); // 11) el resumen NO finge una sola política
    // la lectura: cada línea con SU tratamiento; el encabezado sin política única
    const d = await obtenerFactura(E1, r.facturaId);
    expect(d?.factura).toMatchObject({ precioIncluyeIva: null, subtotal: 189.29, iva: 22.71, montoTotal: 212, porcentajeIva: 12 });
    expect(d?.viajes.map((v) => [v.precioIncluyeIva, v.porcentajeIva, v.base, v.iva, v.total])).toEqual([[true, 12, 89.29, 10.71, 100], [false, 12, 100, 12, 112]]);
    expect(Number((Number(c.subtotal) + Number(c.iva_monto)).toFixed(2))).toBe(Number(c.monto_total));
  });

  it("encabezado: 1 si todas las líneas son «incluido», 0 si todas son «agregado», NULL con mezcla", async () => {
    const casos: [boolean[], number | null][] = [[[true, true], 1], [[false, false], 0], [[true, false], null], [[false, true], null]];
    for (const [flags, esperado] of casos) {
      const ps = [await crearPlan({ codigo: `IVA-ENC-${flags.join("")}-1` }), await crearPlan({ codigo: `IVA-ENC-${flags.join("")}-2` })];
      const r = await crearFactura(actorA, { clienteId: 20, planes: ps.map((planId, i) => ({ planId, precioIncluyeIva: flags[i] })) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const v = (await cabecera(r.facturaId)).precio_incluye_iva;
      expect(v == null ? null : Number(v), flags.join()).toBe(esperado);
    }
  });

  it("la vista previa y crear dan EXACTAMENTE los mismos importes en todas las combinaciones (varias líneas con redondeo)", async () => {
    for (const flags of [[true, true, true], [false, false, false], [true, false, true], [false, true, false]]) {
      const tarifas = [500.5, 33.33, 0.05];
      const ps = [] as number[];
      for (let i = 0; i < 3; i++) ps.push(await crearPlan({ codigo: `IVA-EQ-${flags.join("")}-${i}`, tarifa_comercial: tarifas[i] }));
      const planes = ps.map((planId, i) => ({ planId, precioIncluyeIva: flags[i] }));
      const prev = await previsualizarFactura(actorA, { clienteId: 20, planes });
      expect(prev.ok).toBe(true);
      if (!prev.ok) return;
      const c = await crearFactura(actorA, { clienteId: 20, planes });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      const cab = await cabecera(c.facturaId);
      expect([Number(cab.subtotal), Number(cab.iva_monto), Number(cab.monto_total)]).toEqual([prev.preview.borrador.subtotal, prev.preview.borrador.iva, prev.preview.borrador.total]);
      expect((await lineasDb(c.facturaId)).map((l) => [l.incluye === 1, l.base, l.iva, l.total])).toEqual(prev.preview.borrador.lineas.map((l) => [l.precioIncluyeIva, l.base, l.iva, l.total]));
      expect(Number((Number(cab.subtotal) + Number(cab.iva_monto)).toFixed(2))).toBe(Number(cab.monto_total));
    }
  });

  it("6/7/9) editar: conservar cada política no cambia nada; cambiar SOLO una línea recalcula esa línea y los totales; el snapshot fiscal y los textos quedan estables", async () => {
    const a = await crearPlan({ codigo: "IVA-ED-1", tarifa_comercial: 100 });
    const b = await crearPlan({ codigo: "IVA-ED-2", tarifa_comercial: 100, fecha_plan: "2026-08-28" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [inc(a), agr(b)] });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const id = c.facturaId;
    const original = await lineasDb(id);
    expect(Number((await cabecera(id)).monto_total)).toBe(212);

    // 6) conservar (aunque la tarifa viva y el destino vivo cambien después)
    await admin.query("UPDATE tms_planes_viaje SET tarifa_comercial = 9999, lugar_descarga_historico = 'Destino NUEVO' WHERE id IN (?, ?)", [a, b]);
    expect((await actualizarFacturaBorrador(actorA, id, { clienteId: 20, planes: [inc(a, 100), agr(b, 100)] })).ok).toBe(true);
    expect(await lineasDb(id)).toEqual(original); // 9) mismo snapshot fiscal y mismos textos
    expect(Number((await cabecera(id)).monto_total)).toBe(212);

    // 7) cambiar SOLO la línea 2: agregado → incluido
    expect((await actualizarFacturaBorrador(actorA, id, { clienteId: 20, planes: [inc(a, 100), inc(b, 100)] })).ok).toBe(true);
    let ls = await lineasDb(id);
    expect(ls[0]).toEqual(original[0]); // la línea 1 no cambió
    expect(ls[1]).toMatchObject({ incluye: 1, base: 89.29, iva: 10.71, total: 100 });
    let cab = await cabecera(id);
    expect([Number(cab.precio_incluye_iva), Number(cab.subtotal), Number(cab.iva_monto), Number(cab.monto_total)]).toEqual([1, 178.58, 21.42, 200]);

    // 7b) ahora cambiar SOLO la línea 1: incluido → agregado
    expect((await actualizarFacturaBorrador(actorA, id, { clienteId: 20, planes: [agr(a, 100), inc(b, 100)] })).ok).toBe(true);
    ls = await lineasDb(id);
    expect(ls[0]).toMatchObject({ incluye: 0, base: 100, iva: 12, total: 112 });
    cab = await cabecera(id);
    expect([cab.precio_incluye_iva, Number(cab.subtotal), Number(cab.iva_monto), Number(cab.monto_total)]).toEqual([null, 189.29, 22.71, 212]);
    expect((await lineasDb(id)).map((l) => l.d)).toEqual(original.map((l) => l.d)); // textos congelados intactos
    expect(Number((Number(cab.subtotal) + Number(cab.iva_monto)).toFixed(2))).toBe(Number(cab.monto_total));
  });

  it("compatibilidad: un borrador anterior (líneas con precio_incluye_iva NULL) se lee sin romper y se edita eligiendo el tratamiento de cada línea", async () => {
    const plan = await crearPlan({ codigo: "IVA-LEG", tarifa_comercial: 750 });
    const [f] = await admin.query<mysql.ResultSetHeader>(`INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 750, 'Borrador', 1)`);
    await admin.query("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 750)", [f.insertId, plan]);
    const antes = await obtenerFactura(E1, f.insertId);
    expect(antes?.factura).toMatchObject({ precioIncluyeIva: null, porcentajeIva: null, subtotal: null });
    expect(antes?.viajes[0]).toMatchObject({ precioIncluyeIva: null, porcentajeIva: null, base: null, iva: null, total: null });
    expect((await actualizarFacturaBorrador(actorA, f.insertId, { clienteId: 20, planes: [agr(plan)] })).ok).toBe(true);
    expect((await lineasDb(f.insertId))[0]).toMatchObject({ incluye: 0, pct: 12, base: 750, iva: 90, total: 840 });
  });

  it("10) una factura EMITIDA no puede cambiar el tratamiento de ninguna línea (409) y emitir tampoco lo altera", async () => {
    const a = await crearPlan({ codigo: "IVA-EMI-1", tarifa_comercial: 100 });
    const b = await crearPlan({ codigo: "IVA-EMI-2", tarifa_comercial: 100, fecha_plan: "2026-08-28" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [inc(a), agr(b)], numeroFactura: "NUM-IVA-MIX", fechaEmision: "2026-08-27" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const antesL = await lineasDb(c.facturaId);
    const antesC = await cabecera(c.facturaId);
    expect((await emitirFactura(actorA, c.facturaId, {})).ok).toBe(true);
    expect(await lineasDb(c.facturaId)).toEqual(antesL);
    const emitida = await cabecera(c.facturaId);
    expect([emitida.precio_incluye_iva, emitida.porcentaje_iva, emitida.subtotal, emitida.iva_monto, emitida.monto_total]).toEqual([antesC.precio_incluye_iva, antesC.porcentaje_iva, antesC.subtotal, antesC.iva_monto, antesC.monto_total]);
    for (const planes of [[agr(a), agr(b)], [inc(a), inc(b)], [agr(a), agr(b)]]) {
      expect(await actualizarFacturaBorrador(actorA, c.facturaId, { clienteId: 20, planes })).toMatchObject({ ok: false, status: 409 });
    }
    expect(await lineasDb(c.facturaId)).toEqual(antesL);
    const despues = await cabecera(c.facturaId);
    expect([despues.precio_incluye_iva, despues.subtotal, despues.iva_monto, despues.monto_total]).toEqual([antesC.precio_incluye_iva, antesC.subtotal, antesC.iva_monto, antesC.monto_total]);
  });

  it("12) dos sesiones con tratamientos DISTINTOS sobre el mismo viaje (10 rondas): solo una crea el vínculo, queda SU tratamiento, la otra recibe 409", async () => {
    for (let i = 0; i < 10; i++) {
      const plan = await crearPlan({ codigo: `IVA-CC-${i}`, tarifa_comercial: 1000 });
      const [a, b] = await Promise.all([
        crearFactura(actorA, { clienteId: 20, planes: [inc(plan)] }),
        crearFactura(actorB, { clienteId: 20, planes: [agr(plan)] }),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `ronda ${i}`).toHaveLength(1);
      const ganadora = a.ok ? a : b;
      const perdedora = a.ok ? b : a;
      if (!perdedora.ok) { expect(perdedora.status).toBe(409); expect(perdedora.error).toContain("ya está vinculado a otra factura"); }
      if (ganadora.ok) {
        const l = (await lineasDb(ganadora.facturaId))[0];
        expect([l.incluye, l.total]).toEqual(a.ok ? [1, 1000] : [0, 1120]);
      }
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [plan])).toBe(1);
    }
  });

  it("12b) dos sesiones con selecciones MIXTAS que se traslapan (10 rondas): una gana completa; la otra no deja escrituras parciales", async () => {
    for (let i = 0; i < 10; i++) {
      const [a, b, c] = [await crearPlan({ codigo: `IVA-MX-${i}-a`, tarifa_comercial: 100 }), await crearPlan({ codigo: `IVA-MX-${i}-b`, tarifa_comercial: 100 }), await crearPlan({ codigo: `IVA-MX-${i}-c`, tarifa_comercial: 100 })];
      const [r1, r2] = await Promise.all([
        crearFactura(actorA, { clienteId: 20, planes: [inc(a), agr(b)] }),
        crearFactura(actorB, { clienteId: 20, planes: [agr(b), inc(c)] }),
      ]);
      expect([r1.ok, r2.ok].filter(Boolean), `ronda ${i}`).toHaveLength(1);
      const perdedor = r1.ok ? r2 : r1;
      if (!perdedor.ok) { expect(perdedor.status).toBe(409); expect(perdedor.error).toContain("ya está vinculado a otra factura"); }
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id IN (?, ?, ?)", [a, b, c]), `ronda ${i}`).toBe(2);
    }
  });

  it("13) multiempresa: con cualquier tratamiento un viaje de otra empresa sigue sin existir", async () => {
    const ajeno = await crearPlan({ codigo: "IVA-AJENO", empresa_id: E2, cliente_id: 601, lugar_carga_id: null, lugar_descarga_id: null });
    for (const linea of [inc(ajeno), agr(ajeno)]) {
      expect(await previsualizarFactura(actorA, { clienteId: 20, planes: [linea] })).toMatchObject({ ok: false, status: 404 });
      expect(await crearFactura(actorA, { clienteId: 20, planes: [linea] })).toMatchObject({ ok: false, status: 404 });
    }
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [ajeno])).toBe(0);
  });

  it("sin tratamiento (o no booleano) en alguna línea el servidor responde 400 y no escribe nada", async () => {
    const p = await crearPlan({ codigo: "IVA-SIN-1" });
    const q = await crearPlan({ codigo: "IVA-SIN-2" });
    const antes = await conteo("SELECT (SELECT COUNT(*) FROM fact_facturas) + (SELECT COUNT(*) FROM fact_factura_viajes) AS n");
    for (const valor of [undefined, null, "true", 1]) {
      const datos = { clienteId: 20, planes: [inc(p), { planId: q, precioIncluyeIva: valor }] } as never;
      expect(await previsualizarFactura(actorA, datos)).toMatchObject({ ok: false, status: 400 });
      expect(await crearFactura(actorA, datos)).toMatchObject({ ok: false, status: 400 });
    }
    expect(await conteo("SELECT (SELECT COUNT(*) FROM fact_facturas) + (SELECT COUNT(*) FROM fact_factura_viajes) AS n")).toBe(antes);
  });

  it("11) en TODA la base: subtotal + IVA = total en cabeceras y líneas; el encabezado solo declara una política si TODAS sus líneas la comparten", async () => {
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas WHERE subtotal IS NOT NULL AND ROUND(subtotal + iva_monto, 2) <> monto_total")).toBe(0);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE base_monto IS NOT NULL AND ROUND(base_monto + iva_monto, 2) <> total_linea")).toBe(0);
    // el resumen del encabezado nunca contradice a las líneas
    expect(await conteo(
      `SELECT COUNT(*) AS n FROM fact_facturas f WHERE f.precio_incluye_iva IS NOT NULL AND EXISTS (
         SELECT 1 FROM fact_factura_viajes v WHERE v.factura_id = f.id AND v.precio_incluye_iva IS NOT NULL AND v.precio_incluye_iva <> f.precio_incluye_iva)`)).toBe(0);
    // documento = suma de sus líneas
    expect(await conteo(
      `SELECT COUNT(*) AS n FROM fact_facturas f JOIN (SELECT factura_id, SUM(base_monto) b, SUM(iva_monto) i, SUM(total_linea) t FROM fact_factura_viajes WHERE base_monto IS NOT NULL GROUP BY factura_id) s
         ON s.factura_id = f.id WHERE f.subtotal IS NOT NULL AND (f.subtotal <> s.b OR f.iva_monto <> s.i OR f.monto_total <> s.t)`)).toBe(0);
    expect(await conteo("SELECT COUNT(DISTINCT precio_incluye_iva) AS n FROM fact_factura_viajes WHERE precio_incluye_iva IS NOT NULL")).toBe(2);
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
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }] }),
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
    const esperando = crearFactura(actorB, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }] }).then((r) => { terminada = true; return r; });
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
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: a, precioIncluyeIva: true }, { planId: b, precioIncluyeIva: true }, { planId: c, precioIncluyeIva: true }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: c, precioIncluyeIva: true }, { planId: b, precioIncluyeIva: true }, { planId: a, precioIncluyeIva: true }] }),
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
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: a, precioIncluyeIva: true }, { planId: b, precioIncluyeIva: true }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: b, precioIncluyeIva: true }, { planId: c, precioIncluyeIva: true }] }),
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
        crearFactura(actorA, { clienteId: 20, planes: [{ planId: a, precioIncluyeIva: true }] }),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: b, precioIncluyeIva: true }] }),
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
      const prev = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: id, precioIncluyeIva: true }] });
      expect(listados.has(id), `listado: ${nombre}`).toBe(esperado);
      expect(prev.ok, `servidor: ${nombre}${prev.ok ? "" : " → " + prev.error}`).toBe(esperado);
    }
  });

  it("USD y EUR: el servidor responde 409 con el mensaje exacto y la creación real también se bloquea", async () => {
    for (const n of ["moneda USD", "moneda EUR"]) {
      const r = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: ids.get(n)!, precioIncluyeIva: true }] });
      expect(r).toEqual({ ok: false, status: 409, error: MENSAJE_MONEDA_NO_SOPORTADA });
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [ids.get(n)!])).toBe(0);
    }
    const mezcla = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: ids.get("base")!, precioIncluyeIva: true }, { planId: ids.get("moneda USD")!, precioIncluyeIva: false }] });
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
    const r = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: ajeno, precioIncluyeIva: true }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    const rc = await previsualizarFactura(actorA, { clienteId: 30, planes: [{ planId: ajeno, precioIncluyeIva: true }] }); // cliente de la otra empresa
    expect(rc.ok).toBe(false);
    if (!rc.ok) expect(rc.status).toBe(404);
    const propia = await listarViajesPendientes(E2, { pageSize: 200 });
    // la empresa 8 ve SUS viajes (y solo los suyos): ninguno de la empresa 7
    const deE2 = new Set((await filas("SELECT id FROM tms_planes_viaje WHERE empresa_id = ?", [E2])).map((r) => Number(r.id)));
    expect(propia.items.map((i) => i.planId)).toContain(ajeno);
    for (const it of propia.items) expect(deE2.has(it.planId), `plan ${it.planId} no es de la empresa 8`).toBe(true);
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

describe.skipIf(!PUERTO)("MariaDB real — columna «Unidad» de Viajes pendientes: placa interna, externa (tercerizado) o «Tercerizado»", () => {
  const ids = new Map<string, number>();
  let unidadPropia = 0;
  let unidadAjena = 0;

  it("preparación: una unidad interna de la empresa 7, otra de la empresa 8 y un viaje por caso", async () => {
    const [u1] = await admin.query<mysql.ResultSetHeader>(`INSERT INTO tms_unidades (empresa_id, placa) VALUES (${E1}, 'C-INT-001')`);
    const [u2] = await admin.query<mysql.ResultSetHeader>(`INSERT INTO tms_unidades (empresa_id, placa) VALUES (${E2}, 'C-AJENA-9')`);
    unidadPropia = u1.insertId;
    unidadAjena = u2.insertId;
    const casos: [string, Record<string, unknown>][] = [
      ["propio con unidad", { unidad_id: unidadPropia }],
      ["propio sin unidad", {}],
      ["propio con unidad de OTRA empresa", { unidad_id: unidadAjena }],
      ["tercerizado con placa externa", { tipo_viaje: "Tercerizado", unidad_externa_placa: "TC-555XYZ", unidad_externa_descripcion: "Camión 10 t", transportista_externo: "Proveedor Demo", piloto_externo_nombre: "Piloto Externo" }],
      ["tercerizado sin placa", { tipo_viaje: "Tercerizado", unidad_externa_placa: null }],
      ["tercerizado con placa en blanco", { tipo_viaje: "Tercerizado", unidad_externa_placa: "   " }],
      ["tercerizado con unidad interna huérfana", { tipo_viaje: "Tercerizado", unidad_id: unidadPropia, unidad_externa_placa: "TC-777ABC" }],
      ["tercerizado SIN tarifa (no facturable)", { tipo_viaje: "Tercerizado", unidad_externa_placa: "TC-000", tarifa_comercial: null }],
    ];
    for (const [nombre, over] of casos) ids.set(nombre, await crearPlan({ codigo: `UN-${nombre}`.slice(0, 70), ...over }));
    expect(ids.size).toBe(casos.length);
  });

  it("1-4) cada caso muestra la unidad correcta, sin datos extra del proveedor", async () => {
    const lista = await listarViajesPendientes(E1, { ruta: "RUTA-01", pageSize: 200 });
    const placa = (nombre: string) => lista.items.find((i) => i.planId === ids.get(nombre)!)?.placa;
    expect(placa("propio con unidad")).toBe("C-INT-001");
    expect(placa("propio sin unidad")).toBeNull();
    expect(placa("tercerizado con placa externa")).toBe("TC-555XYZ");
    expect(placa("tercerizado sin placa")).toBe("Tercerizado");
    expect(placa("tercerizado con placa en blanco")).toBe("Tercerizado");
    expect(placa("tercerizado con unidad interna huérfana")).toBe("TC-777ABC"); // misma regla que Programación
    const claves = Object.keys(lista.items[0]).sort();
    expect(claves).toEqual(["cerradoEn", "cliente", "clienteId", "codigo", "destino", "estado", "fechaPlan", "moneda", "origen", "piloto", "placa", "planId", "rutaCodigo", "tarifaComercial"]);
    expect(JSON.stringify(lista.items)).not.toMatch(/Camión 10 t|Proveedor Demo/);
  });

  it("5) multiempresa: una unidad de OTRA empresa asociada por id NO se muestra", async () => {
    const lista = await listarViajesPendientes(E1, { ruta: "RUTA-01", pageSize: 200 });
    const item = lista.items.find((i) => i.planId === ids.get("propio con unidad de OTRA empresa")!);
    expect(item).toBeDefined();
    expect(item?.placa).toBeNull();
    expect(JSON.stringify(lista.items)).not.toContain("C-AJENA-9");
  });

  it("7) la facturabilidad NO cambió: aparece en el listado exactamente lo que el servidor acepta; el tercerizado sin tarifa sigue fuera", async () => {
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    const listados = new Set(lista.items.map((i) => i.planId));
    for (const [nombre, id] of ids) {
      const prev = await previsualizarFactura(actorA, { clienteId: 20, planes: [{ planId: id, precioIncluyeIva: true }] });
      expect(listados.has(id), `listado: ${nombre}`).toBe(nombre !== "tercerizado SIN tarifa (no facturable)");
      expect(prev.ok, `servidor: ${nombre}`).toBe(nombre !== "tercerizado SIN tarifa (no facturable)");
    }
  });

  it("6) listado, conteo, KPI y filtro de ruta siguen coherentes", async () => {
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    expect(lista.totalReal).toBe(lista.items.length);
    expect((await obtenerKpisFacturacion(E1)).viajesPendientes).toBe(lista.totalReal);
    const filtrada = await listarViajesPendientes(E1, { ruta: "RUTA-01", pageSize: 200 });
    expect(filtrada.totalReal).toBe(filtrada.items.length);
    expect(filtrada.items.map((i) => i.planId)).toContain(ids.get("tercerizado con placa externa")!);
  });
});

describe.skipIf(!PUERTO)("MariaDB real — FACT-3: la factura anulada conserva su detalle y sus viajes se liberan", () => {
  const actorE2: ActorFacturacion = { empresaId: E2, usuarioId: 9, usuario: "facturador-e2" };
  const sinId = <T extends { id: number }>(v: T): Omit<T, "id"> => { const { id, ...resto } = v; void id; return resto; };
  const activas = (planId: number) => conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [planId]);
  const historicas = (facturaId: number) => conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas WHERE factura_id = ?", [facturaId]);
  let planes: number[] = [];
  let facturaId = 0;
  let previa: Awaited<ReturnType<typeof obtenerFactura>> = null;
  let anulada: Awaited<ReturnType<typeof obtenerFactura>> = null;
  let otraFacturaId = 0;

  it("1-3) un borrador con varios viajes (IVA mixto) se anula y SIGUE mostrando todas sus líneas, importes, cliente y observaciones", async () => {
    await admin.query("UPDATE clientes SET razon_social = 'Cliente X, S.A.', nit = '1234567-8', direccion = 'Zona 1' WHERE id = 20");
    planes = [
      await crearPlan({ codigo: "AN-1", tarifa_comercial: 100, fecha_plan: "2026-09-01" }),
      await crearPlan({ codigo: "AN-2", tarifa_comercial: 100, fecha_plan: "2026-09-02" }),
      await crearPlan({ codigo: "AN-3", tarifa_comercial: 250.5, fecha_plan: "2026-09-03" }),
    ];
    const c = await crearFactura(actorA, {
      clienteId: 20,
      planes: [{ planId: planes[0], precioIncluyeIva: true }, { planId: planes[1], precioIncluyeIva: false }, { planId: planes[2], precioIncluyeIva: true }],
      observaciones: "obs de la factura anulada",
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    facturaId = c.facturaId;
    previa = await obtenerFactura(E1, facturaId);
    expect(previa?.viajes).toHaveLength(3);

    const r = await anularFactura(actorA, facturaId);
    expect(r.ok).toBe(true);
    anulada = await obtenerFactura(E1, facturaId);
    expect(anulada?.factura).toMatchObject({
      estadoAdmin: "Anulada", observaciones: "obs de la factura anulada", cliente: "Cliente X, S.A.", clienteNit: "1234567-8",
      clienteDireccion: "Zona 1", montoTotal: previa?.factura.montoTotal, subtotal: previa?.factura.subtotal, iva: previa?.factura.iva, porcentajeIva: 12,
    });
    // las TRES líneas, con descripción congelada y base/IVA/total por línea, idénticas a las del borrador
    expect(anulada?.viajes).toHaveLength(3);
    expect(anulada?.viajes.map(sinId)).toEqual(previa?.viajes.map(sinId));
    expect(anulada?.viajes.map((v) => [v.codigo, v.precioIncluyeIva, v.base, v.iva, v.total])).toEqual([
      ["AN-1", true, 89.29, 10.71, 100], ["AN-2", false, 100, 12, 112], ["AN-3", true, 223.66, 26.84, 250.5],
    ]);
    // quién y cuándo anuló (de la auditoría)
    expect(anulada?.anulacion?.usuario).toBe("facturador-a");
    expect(anulada?.anulacion?.fecha).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // estado de las tablas: histórico completo; ningún vínculo ACTIVO
    expect(await historicas(facturaId)).toBe(3);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [facturaId])).toBe(0);
    const aud = await filas("SELECT detalle FROM auditoria WHERE accion = 'anular_factura' ORDER BY id DESC LIMIT 1");
    expect(String(aud[0].detalle)).toContain("3 línea(s) conservadas");
  });

  it("4) esos viajes vuelven a «Viajes pendientes» (y a las notificaciones/KPI que usan la misma condición)", async () => {
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    for (const p of planes) expect(lista.items.map((i) => i.planId)).toContain(p);
    for (const p of planes) expect(await activas(p)).toBe(0);
  });

  it("5-6) esos viajes se facturan en OTRA factura y la anulada original queda intacta, aunque cambien cliente, ruta y tarifa vivos", async () => {
    await admin.query("UPDATE tms_planes_viaje SET tarifa_comercial = 9999, lugar_descarga_historico = 'DESTINO NUEVO', ruta_codigo_historico = 'RUTA-NUEVA' WHERE id IN (?, ?, ?)", planes);
    await admin.query("UPDATE clientes SET razon_social = 'Razón NUEVA', nit = '0000000-0', direccion = 'Otra zona' WHERE id = 20");
    const otra = await crearFactura(actorB, { clienteId: 20, planes: planes.map((planId) => ({ planId, precioIncluyeIva: true })) });
    expect(otra.ok).toBe(true);
    if (!otra.ok) return;
    otraFacturaId = otra.facturaId;
    // la nueva toma los datos vivos de ahora; la anulada NO cambia ni en una coma
    const nueva = await obtenerFactura(E1, otraFacturaId);
    expect(nueva?.factura).toMatchObject({ cliente: "Razón NUEVA", montoTotal: 29997 });
    expect(nueva?.viajes.map((v) => v.destino)).toEqual(["DESTINO NUEVO", "DESTINO NUEVO", "DESTINO NUEVO"]);
    expect(await obtenerFactura(E1, facturaId)).toEqual(anulada);
    expect(await historicas(facturaId)).toBe(3);
    for (const p of planes) expect(await activas(p)).toBe(1);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [otraFacturaId])).toBe(3);
    await admin.query("UPDATE clientes SET razon_social = 'Cliente X, S.A.', nit = '1234567-8', direccion = 'Zona 1' WHERE id = 20");
  });

  it("9-11) una Anulada NO se puede editar, emitir ni recibir pagos, y nada cambia (ni reintentando la anulación)", async () => {
    const huella = async () => JSON.stringify([
      await filas("SELECT estado_admin, numero_factura, fecha_emision, monto_total, subtotal, iva_monto, observaciones FROM fact_facturas WHERE id = ?", [facturaId]),
      await filas("SELECT plan_id, base_monto, iva_monto, total_linea, descripcion FROM fact_factura_viajes_anuladas WHERE factura_id = ? ORDER BY id", [facturaId]),
      await conteo("SELECT COUNT(*) AS n FROM fact_pagos WHERE factura_id = ?", [facturaId]),
      await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [facturaId]),
    ]);
    const antes = await huella();
    const editar = await actualizarFacturaBorrador(actorA, facturaId, { clienteId: 20, planes: [{ planId: planes[0], precioIncluyeIva: true }], observaciones: "cambio" });
    expect(editar).toMatchObject({ ok: false, status: 409 });
    const emitir = await emitirFactura(actorA, facturaId, { numeroFactura: "F-ANUL-1", fechaEmision: "2026-10-09" });
    expect(emitir).toMatchObject({ ok: false, status: 409 });
    const pago = await registrarPago(actorA, facturaId, { fechaPago: "2026-10-09", monto: 10 });
    expect(pago).toMatchObject({ ok: false, status: 409 });
    const otraVez = await anularFactura(actorA, facturaId);
    expect(otraVez).toMatchObject({ ok: false, status: 409 });
    expect(await huella()).toBe(antes);
  });

  it("12) dos facturas ACTIVAS no pueden usar el mismo plan_id; el histórico de la anulada convive con la activa del mismo viaje", async () => {
    // por la aplicación
    const dup = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: planes[0], precioIncluyeIva: true }] });
    expect(dup).toMatchObject({ ok: false, status: 409 });
    // por SQL directo: UNIQUE(plan_id) sigue siendo una garantía real de base de datos
    await expect(
      admin.query("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 1)", [facturaId, planes[0]]),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(await filas("SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0")).toHaveLength(1);
    // el mismo viaje está en el histórico de la anulada Y activo en la nueva
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas WHERE plan_id = ?", [planes[0]])).toBe(1);
    expect(await activas(planes[0])).toBe(1);
    // el histórico no es «facturación viva»: nada impide anular también la nueva y que el viaje vuelva a quedar libre
    expect((await anularFactura(actorB, otraFacturaId)).ok).toBe(true);
    for (const p of planes) expect(await activas(p)).toBe(0);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas WHERE plan_id = ?", [planes[0]])).toBe(2);
    const lista = await listarViajesPendientes(E1, { pageSize: 200 });
    for (const p of planes) expect(lista.items.map((i) => i.planId)).toContain(p);
  });

  it("13) multiempresa: la empresa 8 no ve el detalle de la anulada de la 7 ni puede anular/consultar sus facturas", async () => {
    expect(await obtenerFactura(E2, facturaId)).toBeNull();
    expect(await obtenerFactura(E2, otraFacturaId)).toBeNull();
    const total = await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas");
    const intento = await anularFactura(actorE2, otraFacturaId);
    expect(intento).toMatchObject({ ok: false, status: 404 });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas")).toBe(total);
    // el PDF de la anulada tampoco es alcanzable desde la otra empresa
    const pdf = await generarPdfFacturaDemo({ id: E2, nombre: "Empresa 8", logoUrl: null }, facturaId);
    expect(pdf).toEqual({ ok: false, status: 404, error: "Factura no encontrada." });
  });

  it("14a) doble anulación simultánea (reintentos): exactamente una copia del detalle y una sola anulación", async () => {
    for (let ronda = 0; ronda < 8; ronda++) {
      const p1 = await crearPlan({ codigo: `DA-${ronda}-1` });
      const p2 = await crearPlan({ codigo: `DA-${ronda}-2` });
      const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: p1, precioIncluyeIva: true }, { planId: p2, precioIncluyeIva: false }] });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      const [a, b] = await Promise.all([anularFactura(actorA, c.facturaId), anularFactura(actorB, c.facturaId)]);
      expect([a.ok, b.ok].filter(Boolean), `ronda ${ronda}`).toHaveLength(1);
      const perdedora = a.ok ? b : a;
      expect(perdedora).toMatchObject({ ok: false, status: 409 });
      expect(await historicas(c.facturaId)).toBe(2);
      expect(await activas(p1)).toBe(0);
      expect(await activas(p2)).toBe(0);
      // reintento tardío: sigue siendo 409 y no duplica nada
      expect(await anularFactura(actorA, c.facturaId)).toMatchObject({ ok: false, status: 409 });
      expect(await historicas(c.facturaId)).toBe(2);
    }
  });

  it("14b) anular mientras otra sesión factura el MISMO viaje (rondas): nunca dos activos, nunca se pierde el detalle, sin deadlock", async () => {
    const deadlockAntes = await ultimoDeadlock();
    let creadasDespues = 0;
    let rechazadas = 0;
    for (let ronda = 0; ronda < 20; ronda++) {
      const p = await crearPlan({ codigo: `AV-${ronda}` });
      const f1 = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: p, precioIncluyeIva: true }] });
      expect(f1.ok).toBe(true);
      if (!f1.ok) return;
      const [anula, nueva] = await Promise.all([
        anularFactura(actorA, f1.facturaId),
        crearFactura(actorB, { clienteId: 20, planes: [{ planId: p, precioIncluyeIva: false }] }),
      ]);
      expect(anula.ok, `ronda ${ronda}: anular`).toBe(true); // la anulación nunca falla por la otra sesión
      expect(await activas(p), `ronda ${ronda}`).toBeLessThanOrEqual(1);
      expect(await historicas(f1.facturaId), `ronda ${ronda}: detalle conservado`).toBe(1);
      if (nueva.ok) {
        creadasDespues++;
        expect(Number((await filas("SELECT factura_id FROM fact_factura_viajes WHERE plan_id = ?", [p]))[0].factura_id)).toBe(nueva.facturaId);
      } else {
        rechazadas++;
        expect(nueva.status).toBe(409); // «ya vinculado»/concurrencia: nunca un 500
        expect(await activas(p)).toBe(0);
      }
    }
    expect(creadasDespues + rechazadas).toBe(20);
    expect(await ultimoDeadlock()).toBe(deadlockAntes);
  });

  it("14c) anular vs editar el mismo borrador en paralelo: o se anula con el detalle completo, o la edición gana y se anula después; nunca queda a medias", async () => {
    for (let ronda = 0; ronda < 10; ronda++) {
      const p1 = await crearPlan({ codigo: `AE-${ronda}-1` });
      const p2 = await crearPlan({ codigo: `AE-${ronda}-2` });
      const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: p1, precioIncluyeIva: true }] });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      const [anula, edita] = await Promise.all([
        anularFactura(actorA, c.facturaId),
        actualizarFacturaBorrador(actorB, c.facturaId, { clienteId: 20, planes: [{ planId: p1, precioIncluyeIva: true }, { planId: p2, precioIncluyeIva: true }] }),
      ]);
      expect(anula.ok, `ronda ${ronda}`).toBe(true);
      const hist = await historicas(c.facturaId);
      // la edición pudo ganar (2 líneas) o perder (409 y 1 línea): el detalle conservado coincide con lo que había al anular
      expect(hist).toBe(edita.ok ? 2 : 1);
      if (!edita.ok) expect(edita.status).toBe(409);
      expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE factura_id = ?", [c.facturaId])).toBe(0);
      expect(await activas(p1)).toBe(0);
      expect(await activas(p2)).toBe(0);
    }
  });

  it("15) integridad referencial: borrar un viaje conserva su línea histórica (plan_id = NULL, con su fotografía) y borrar la factura se lleva su histórico", async () => {
    const pv = await crearPlan({ codigo: "FK-1", tarifa_comercial: 300 });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: pv, precioIncluyeIva: true }] });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect((await anularFactura(actorA, c.facturaId)).ok).toBe(true);
    await admin.query("DELETE FROM tms_planes_viaje WHERE id = ?", [pv]); // permitido: la anulada ya no lo retiene
    const d = await obtenerFactura(E1, c.facturaId);
    expect(d?.viajes).toHaveLength(1);
    expect(d?.viajes[0]).toMatchObject({ codigo: "FK-1", total: 300, planId: 0 });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes_anuladas WHERE factura_id = ? AND plan_id IS NULL", [c.facturaId])).toBe(1);
    await admin.query("DELETE FROM fact_facturas WHERE id = ?", [c.facturaId]);
    expect(await historicas(c.facturaId)).toBe(0);
  });

  it("una Emitida (sin pagos) también conserva su detalle al anularse; con pagos NO se puede anular y no se toca nada", async () => {
    const pe = await crearPlan({ codigo: "EM-1", tarifa_comercial: 500 });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: pe, precioIncluyeIva: true }], numeroFactura: "F-FACT3-1", fechaEmision: "2026-10-01" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect((await emitirFactura(actorA, c.facturaId, {})).ok).toBe(true);
    expect((await registrarPago(actorA, c.facturaId, { fechaPago: "2026-10-02", monto: 100 })).ok).toBe(true);
    const conPagos = await anularFactura(actorA, c.facturaId);
    expect(conPagos).toMatchObject({ ok: false, status: 409 });
    expect(await historicas(c.facturaId)).toBe(0);
    expect(await activas(pe)).toBe(1);

    const pf = await crearPlan({ codigo: "EM-2", tarifa_comercial: 700 });
    const c2 = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: pf, precioIncluyeIva: false }], numeroFactura: "F-FACT3-2", fechaEmision: "2026-10-03" });
    expect(c2.ok).toBe(true);
    if (!c2.ok) return;
    expect((await emitirFactura(actorA, c2.facturaId, {})).ok).toBe(true);
    expect((await anularFactura(actorA, c2.facturaId)).ok).toBe(true);
    const d = await obtenerFactura(E1, c2.facturaId);
    expect(d?.factura).toMatchObject({ estadoAdmin: "Anulada", numeroFactura: "F-FACT3-2", fechaEmision: "2026-10-03", montoTotal: 784 });
    expect(d?.viajes.map((v) => [v.codigo, v.base, v.iva, v.total])).toEqual([["EM-2", 700, 84, 784]]);
    expect(await activas(pf)).toBe(0);
  });
});

describe.skipIf(!PUERTO)("MariaDB real — PDF DEMO (no fiscal) desde lo congelado en la base", () => {
  // El logo es OBLIGATORIO: cada empresa usa un archivo real de su propio directorio dentro de un `uploads` temporal.
  const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const empresa1 = { id: E1, nombre: "Empresa 7", logoUrl: `empresas/${E1}/logo.png` };
  const empresa2 = { id: E2, nombre: "Empresa 8", logoUrl: `empresas/${E2}/logo.png` };
  let uploadsTemporal = "";
  let uploadDirOriginal: string | undefined;
  beforeAll(() => {
    uploadDirOriginal = process.env.UPLOAD_DIR;
    uploadsTemporal = mkdtempSync(join(tmpdir(), "fact-real-uploads-"));
    process.env.UPLOAD_DIR = uploadsTemporal;
    for (const e of [E1, E2]) {
      mkdirSync(dirname(join(uploadsTemporal, `empresas/${e}/logo.png`)), { recursive: true });
      writeFileSync(join(uploadsTemporal, `empresas/${e}/logo.png`), PNG_1X1);
    }
  });
  afterAll(() => {
    if (uploadDirOriginal === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = uploadDirOriginal;
    rmSync(uploadsTemporal, { recursive: true, force: true });
  });
  const textoPdf = async (fn: () => Promise<unknown>): Promise<string> => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    try { await fn(); return spy.mock.calls.map((c) => String(c[0])).join("\n"); } finally { spy.mockRestore(); }
  };
  let mixtaId = 0;

  it("factura MIXTA real (Q100 incluido + Q100 agregado): el PDF muestra Código / Descripción / Total (Q100.00 y Q112.00), TOTAL Q212.00 y en letras; el desglose 89.29 + 10.71 / 22.71 se guarda pero NO se imprime", async () => {
    // (pruebas anteriores de este archivo cambiaron los datos vivos del cliente 20: se restablecen antes de congelarlos)
    await admin.query("UPDATE clientes SET razon_social = 'Cliente X, S.A.', nit = '1234567-8', direccion = 'Zona 1', codigo = '0000020' WHERE id = 20");
    await admin.query("UPDATE clientes SET codigo = 'COD-OTRA-EMPRESA' WHERE id = 30");
    const a = await crearPlan({ codigo: "PDF-A", tarifa_comercial: 100, fecha_plan: "2026-09-01" });
    const b = await crearPlan({ codigo: "PDF-B", tarifa_comercial: 100, fecha_plan: "2026-09-02" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: a, precioIncluyeIva: true }, { planId: b, precioIncluyeIva: false }] });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    mixtaId = c.facturaId;
    let r: Awaited<ReturnType<typeof generarPdfFacturaDemo>> | null = null;
    const t = await textoPdf(async () => { r = await generarPdfFacturaDemo(empresa1, mixtaId); });
    expect(r).toMatchObject({ ok: true, nombreArchivo: `factura-demo-${mixtaId}.pdf` });
    for (const v of ["Q100.00", "Q112.00", "Q212.00", "PDF-A", "PDF-B", LEYENDA_NO_FISCAL, "Cliente X, S.A.", "1234567-8", "0000020", "DOSCIENTOS DOCE CON 00/100", "CÓDIGO", "DESCRIPCIÓN", "TOTAL EN LETRAS:", "SERVICIO DE TRANSPORTE"]) {
      expect(t, v).toContain(v);
    }
    // Base e IVA se calculan y se guardan (verificado en otras pruebas), pero la factura no los imprime
    for (const v of ["Q89.29", "Q10.71", "Q12.00", "Q189.29", "Q22.71", "IVA", "SUBTOTAL"]) expect(t, v).not.toContain(v);
    const [guardado] = await filas(`SELECT subtotal, iva_monto, monto_total, precio_incluye_iva FROM fact_facturas WHERE id = ${mixtaId}`);
    expect([Number(guardado.subtotal), Number(guardado.iva_monto), Number(guardado.monto_total), guardado.precio_incluye_iva]).toEqual([189.29, 22.71, 212, null]);
    const lineasGuardadas = await filas(`SELECT base_monto, iva_monto, total_linea, precio_incluye_iva FROM fact_factura_viajes WHERE factura_id = ${mixtaId} ORDER BY id`);
    expect(lineasGuardadas.map((l) => [Number(l.base_monto), Number(l.iva_monto), Number(l.total_linea), l.precio_incluye_iva])).toEqual([[89.29, 10.71, 100, 1], [100, 12, 112, 0]]);
  });

  it("usa lo CONGELADO: si después cambian el cliente, la ruta, el destino y la tarifa vivos, el PDF no cambia", async () => {
    await admin.query("UPDATE clientes SET razon_social = 'Razón NUEVA', nit = '0000000-0', direccion = 'Otra zona' WHERE id = 20");
    await admin.query("UPDATE tms_planes_viaje SET lugar_descarga_historico = 'Destino NUEVO', ruta_codigo_historico = 'RUTA-NUEVA', tarifa_comercial = 9999 WHERE codigo IN ('PDF-A', 'PDF-B')");
    const t = await textoPdf(() => generarPdfFacturaDemo(empresa1, mixtaId));
    expect(t).toContain("Cliente X, S.A.");
    expect(t).toContain("1234567-8");
    expect(t).toContain("Q212.00");
    expect(t).not.toMatch(/Razón NUEVA|0000000-0|Destino NUEVO|9,?999/);
  });

  it("código de cliente: es lectura VIVA de clientes.codigo (filtrada por empresa); sin código dice «Pendiente de definir» y el de otra empresa nunca aparece", async () => {
    const conCodigo = await textoPdf(() => generarPdfFacturaDemo(empresa1, mixtaId));
    expect(conCodigo).toContain("0000020");
    expect(conCodigo).not.toContain("COD-OTRA-EMPRESA");
    await admin.query("UPDATE clientes SET codigo = NULL WHERE id = 20");
    const sinCodigo = await textoPdf(() => generarPdfFacturaDemo(empresa1, mixtaId));
    expect(sinCodigo).toContain("Pendiente de definir");
    expect(sinCodigo).not.toContain("0000020");
    // un cliente de la empresa 8 con el mismo id de factura no se cuela: la consulta lleva empresa_id
    await admin.query("UPDATE clientes SET codigo = '0000020' WHERE id = 20");
  });

  it("multiempresa: la empresa 8 no puede generar el PDF de una factura de la empresa 7 (404, sin PDF), tenga o no logo", async () => {
    expect(await generarPdfFacturaDemo(empresa2, mixtaId)).toEqual({ ok: false, status: 404, error: "Factura no encontrada." });
    expect(await generarPdfFacturaDemo({ ...empresa2, logoUrl: null }, mixtaId)).toEqual({ ok: false, status: 404, error: "Factura no encontrada." });
  });

  it("LOGO obligatorio: sin logo, con archivo inexistente o con el logo de OTRA empresa → 409 y no se genera el PDF de una factura válida", async () => {
    const esperado = { ok: false, status: 409, error: "Esta empresa no tiene un logo válido configurado para la factura." };
    expect(await generarPdfFacturaDemo({ ...empresa1, logoUrl: null }, mixtaId)).toEqual(esperado);
    expect(await generarPdfFacturaDemo({ ...empresa1, logoUrl: `empresas/${E1}/no-existe.png` }, mixtaId)).toEqual(esperado);
    expect(await generarPdfFacturaDemo({ ...empresa1, logoUrl: `empresas/${E2}/logo.png` }, mixtaId)).toEqual(esperado);
    const ok = await generarPdfFacturaDemo(empresa1, mixtaId);
    expect(ok.ok).toBe(true);
    // (un PNG con canal alfa se guarda como imagen + máscara: puede haber más de un objeto de imagen)
    if (ok.ok) expect((ok.buffer.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("Emitida: lleva su número y fecha de emisión y SIGUE marcada como NO FISCAL; la Anulada ahora SÍ tiene PDF, con su detalle y la marca ANULADA", async () => {
    const p = await crearPlan({ codigo: "PDF-E", tarifa_comercial: 500.5 });
    const c = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: p, precioIncluyeIva: false }], numeroFactura: "F-PDF-1", fechaEmision: "2026-08-27" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect((await emitirFactura(actorA, c.facturaId, {})).ok).toBe(true);
    const t = await textoPdf(() => generarPdfFacturaDemo(empresa1, c.facturaId));
    expect(t).toContain("F-PDF-1");
    expect(t).toContain("27/08/2026");
    expect(t).toContain("Q560.56");
    expect(t).toContain("QUINIENTOS SESENTA CON 56/100");
    expect(t).toContain(LEYENDA_NO_FISCAL);
    const pb = await crearPlan({ codigo: "PDF-X" });
    const b = await crearFactura(actorA, { clienteId: 20, planes: [{ planId: pb, precioIncluyeIva: true }] });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect((await anularFactura(actorA, b.facturaId)).ok).toBe(true);
    // 7-8) el PDF de la Anulada sale de su histórico: las líneas originales + la marca ANULADA + DEMO NO FISCAL
    let r: Awaited<ReturnType<typeof generarPdfFacturaDemo>> | null = null;
    const ta = await textoPdf(async () => { r = await generarPdfFacturaDemo(empresa1, b.facturaId); });
    expect(r).toMatchObject({ ok: true, nombreArchivo: `factura-demo-${b.facturaId}.pdf` });
    expect(ta).toContain("PDF-X");
    expect(ta).toContain("FACTURA DEMO — ANULADA");
    expect(ta).toContain(`ANULADA — ${LEYENDA_NO_FISCAL}`);
    expect(ta).toContain("DEMO - NO FISCAL");
    expect(ta).toContain("Q1,000.00"); // el viaje conserva su importe congelado
    // el PDF de la anulada no cambia si luego cambian los datos vivos del viaje
    await admin.query("UPDATE tms_planes_viaje SET codigo = 'RENOMBRADO', tarifa_comercial = 1 WHERE id = ?", [pb]);
    const t2 = await textoPdf(() => generarPdfFacturaDemo(empresa1, b.facturaId));
    expect(t2).toContain("PDF-X");
    expect(t2).not.toContain("RENOMBRADO");
  });

  it("la Anulada ANTERIOR a FACT-3 (sin líneas conservadas) no genera PDF: 409 con su motivo, sin reconstruirla", async () => {
    expect(legacyAnuladaId).toBeGreaterThan(0);
    expect(await generarPdfFacturaDemo(empresa1, legacyAnuladaId)).toEqual({ ok: false, status: 409, error: MENSAJE_ANULADA_SIN_DETALLE });
  });

  it("una factura ANTERIOR al desglose por línea (sin snapshot fiscal) no genera PDF: no se inventan importes", async () => {
    const plan = await crearPlan({ codigo: "PDF-LEG", tarifa_comercial: 750 });
    const [f] = await admin.query<mysql.ResultSetHeader>(`INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 750, 'Borrador', 1)`);
    await admin.query("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 750)", [f.insertId, plan]);
    const r = await generarPdfFacturaDemo(empresa1, f.insertId);
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toContain("anterior al desglose de IVA por línea");
  });

  it("solo LEE: generar el PDF no cambia ninguna fila de facturación", async () => {
    const huella = async () => JSON.stringify(await filas("SELECT (SELECT COUNT(*) FROM fact_facturas) f, (SELECT COUNT(*) FROM fact_factura_viajes) v, (SELECT COUNT(*) FROM auditoria) a, (SELECT SUM(monto_total) FROM fact_facturas) t"));
    const antes = await huella();
    await generarPdfFacturaDemo(empresa1, mixtaId);
    expect(await huella()).toBe(antes);
  });
});

describe.skipIf(!PUERTO)("MariaDB real — FACT-4: líneas agrupables, contado/crédito, banco y retención de IVA", () => {
  const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const empresa1 = { id: E1, nombre: "Empresa 7", logoUrl: `empresas/${E1}/logo.png` };
  let uploadsTemporal = "";
  let uploadDirOriginal: string | undefined;
  const textoPdf = async (fn: () => Promise<unknown>): Promise<string> => {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    try { await fn(); return spy.mock.calls.map((c) => String(c[0])).join("\n"); } finally { spy.mockRestore(); }
  };

  // Entidades, cuentas contables y bancos de prueba (ids se llenan en beforeAll).
  let entKT = 0, entMON = 0, entE2 = 0;
  let bancoMON = 0, bancoKT = 0, bancoE2 = 0, bancoInactivo = 0, bancoUSD = 0;
  let legacyBorradorId = 0;

  beforeAll(async () => {
    uploadDirOriginal = process.env.UPLOAD_DIR;
    uploadsTemporal = mkdtempSync(join(tmpdir(), "fact4-real-uploads-"));
    process.env.UPLOAD_DIR = uploadsTemporal;
    mkdirSync(dirname(join(uploadsTemporal, `empresas/${E1}/logo.png`)), { recursive: true });
    writeFileSync(join(uploadsTemporal, `empresas/${E1}/logo.png`), PNG_1X1);

    const insEnt = async (empresa: number, codigo: string, nombre: string) =>
      (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, ?, ?)", [empresa, codigo, nombre]))[0].insertId;
    entKT = await insEnt(E1, "KT", "Kuiqtrans");
    entMON = await insEnt(E1, "MON", "Logiservicios Mónaco");
    entE2 = await insEnt(E2, "OTRA", "Entidad de otra empresa");
  }, 30_000);

  afterAll(() => {
    if (uploadDirOriginal === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = uploadDirOriginal;
    rmSync(uploadsTemporal, { recursive: true, force: true });
  });

  const linea = (planIds: number[], over: Partial<{ cantidad: number; descripcion: string; precioUnitario: number; clasificacion: "SERVICIO" | "BIEN"; precioIncluyeIva: boolean }> = {}) => ({
    planIds, cantidad: 1, descripcion: "Servicio de transporte", precioUnitario: 1000, clasificacion: "SERVICIO" as const, precioIncluyeIva: true, ...over,
  });
  const planes = (ids: number[]) => ids.map((planId) => ({ planId, precioIncluyeIva: true }));

  it("ANTES de la migración: el modelo anterior sigue funcionando y lo nuevo falla con 503 sin tocar nada", async () => {
    expect(await filas("SHOW TABLES LIKE 'fact_factura_lineas'")).toHaveLength(0);
    const p0 = await crearPlan({ codigo: "F4-LEG" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: planes([p0]) });
    expect(c).toMatchObject({ ok: true });
    if (c.ok) legacyBorradorId = c.facturaId;
    const pn = await crearPlan({ codigo: "F4-NUEVO" });
    const antes = await conteo("SELECT COUNT(*) AS n FROM fact_facturas");
    const r = await crearFactura(actorA, { clienteId: 20, planes: planes([pn]), lineas: [linea([pn])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas")).toBe(antes);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [pn])).toBe(0);
    // borde HTTP (resolverEntradaFact4) con la base REAL sin migración: bloquea con 503, con payload FACT-4 y con el anterior
    expect(await fact4Disponible()).toBe(false);
    for (const entrada of [
      { lineas: [linea([pn])], entidadId: 1, condicionPago: "CREDITO" as const },
      {},
    ]) {
      expect(await resolverEntradaFact4({ slug: "e7", empresaId: E1, clienteId: 20, entrada })).toMatchObject({ ok: false, status: 503 });
    }
    // el borrador anterior NO cambió (no hubo mutación parcial)
    const [antesBorrador] = await filas(`SELECT monto_total, estado_admin FROM fact_facturas WHERE id = ${legacyBorradorId}`);
    expect([Number(antesBorrador.monto_total), antesBorrador.estado_admin]).toEqual([1000, "Borrador"]);
    // la lectura tolera el esquema pendiente
    const d = await obtenerFactura(E1, legacyBorradorId);
    expect(d?.contabilidad).toMatchObject({ modeloLineas: false, esquemaPendiente: true });
    expect(d?.lineas).toHaveLength(1);
  });

  it("A) el preflight de FACT-4 se ejecuta sin error y confirma las bases (entidades, cuentas y UNIQUE(plan_id))", async () => {
    await expect(ejecutarArchivo("sql/preflight-2026-10-fact-4-lineas-contado-retencion.sql")).resolves.toBeDefined();
    expect(await filas("SHOW INDEX FROM cont_entidades WHERE Key_name = 'uq_cont_entidad_empresa_id'")).not.toHaveLength(0);
    expect(await filas("SHOW INDEX FROM cont_cuentas WHERE Key_name = 'uq_cont_cuenta_ambito'")).not.toHaveLength(0);
  });

  it("B) la migración se ejecuta sin error y crea tablas, columnas y FKs previstas", async () => {
    await expect(ejecutarArchivo("sql/migrate-2026-10-fact-4-lineas-contado-retencion.sql")).resolves.toBeDefined();
    for (const t of ["cont_cuentas_bancarias", "fact_entidad_config", "fact_factura_lineas", "fact_factura_linea_viajes"]) {
      expect(await filas(`SHOW TABLES LIKE '${t}'`), t).toHaveLength(1);
    }
    const f = await columnas("fact_facturas");
    for (const c of ["entidad_id", "modelo_lineas", "condicion_pago", "cuenta_bancaria_id", "cuenta_bancaria_snapshot", "retencion_iva_pct", "retencion_iva_cliente_pct", "retencion_iva_monto"]) {
      expect(f, c).toContain(c);
    }
    expect(await columnas("fact_cliente_perfil")).toContain("retencion_iva_pct");
    const fks = await filas(
      `SELECT CONSTRAINT_NAME AS n, DELETE_RULE AS r FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('fact_factura_lineas', 'fact_factura_linea_viajes') ORDER BY CONSTRAINT_NAME`,
    );
    const porNombre = new Map(fks.map((r) => [String(r.n), String(r.r)]));
    expect(porNombre.get("fk_factlinea_factura")).toBe("CASCADE");
    // el vínculo a viaje se pone en NULL si el viaje desaparece: nunca bloquea ni borra la línea
    expect([...porNombre.values()]).toContain("SET NULL");
  });

  it("C) ejecutar la migración por SEGUNDA vez es inocuo y UNIQUE(plan_id) de fact_factura_viajes sigue vigente", async () => {
    const antesF = await columnas("fact_facturas");
    const antesL = await columnas("fact_factura_lineas");
    const facturas = await conteo("SELECT COUNT(*) AS n FROM fact_facturas");
    await expect(ejecutarArchivo("sql/migrate-2026-10-fact-4-lineas-contado-retencion.sql")).resolves.toBeDefined();
    expect(await columnas("fact_facturas")).toEqual(antesF);
    expect(await columnas("fact_factura_lineas")).toEqual(antesL);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas")).toBe(facturas);
    expect(await filas("SHOW INDEX FROM fact_factura_viajes WHERE Key_name = 'uq_factviaje_plan' AND Non_unique = 0")).toHaveLength(1);
    // las tablas de líneas NO llevan UNIQUE(plan_id) (un viaje puede estar en flete + descarga)
    const u = await filas("SHOW INDEX FROM fact_factura_linea_viajes WHERE Non_unique = 0 AND Key_name <> 'PRIMARY'");
    expect(u.map((r) => r.Column_name)).toEqual(["linea_id", "plan_id"]);
  });

  it("tras la migración: fact4Disponible=true y el borde HTTP acepta el payload FACT-4 pero sigue rechazando el anterior (400)", async () => {
    expect(await fact4Disponible()).toBe(true);
    const ok = await resolverEntradaFact4({
      slug: "e7", empresaId: E1, clienteId: 20, entrada: { lineas: [linea([1])], entidadId: entMON, condicionPago: "CREDITO" },
    });
    expect(ok).toMatchObject({ ok: true, datos: { entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 } });
    expect(await resolverEntradaFact4({ slug: "e7", empresaId: E1, clienteId: 20, entrada: {} })).toMatchObject({ ok: false, status: 400 });
  });

  it("la factura anterior a FACT-4 sobrevive intacta: modelo anterior, una línea implícita por viaje, sin retención", async () => {
    const d = await obtenerFactura(E1, legacyBorradorId);
    expect(d?.contabilidad).toMatchObject({
      modeloLineas: false, condicionPago: null, cuentaBancaria: null, esquemaPendiente: false,
      retencionIva: { aplicadaPct: 0, monto: 0 },
    });
    expect(d?.lineas).toHaveLength(1);
    expect(d?.lineas[0]).toMatchObject({ cantidad: 1, clasificacion: null, viajes: [{ codigo: "F4-LEG" }] });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_lineas")).toBe(0);
  });

  it("alta manual de cuentas bancarias y plantilla por entidad (lo que haría Contabilidad con las plantillas del SQL)", async () => {
    const cuenta = async (empresa: number, entidad: number, codigo: string, nombre: string, activa = 1) =>
      (await admin.query<mysql.ResultSetHeader>(
        "INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa) VALUES (?, ?, ?, ?, 'ACTIVO', 3, ?)",
        [empresa, entidad, codigo, nombre, activa],
      ))[0].insertId;
    const banco = async (empresa: number, entidad: number, cuentaId: number, b: string, alias: string, moneda = "GTQ", activa = 1) =>
      (await admin.query<mysql.ResultSetHeader>(
        "INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda, activa) VALUES (?, ?, ?, ?, ?, '***1234', ?, ?)",
        [empresa, entidad, cuentaId, b, alias, moneda, activa],
      ))[0].insertId;
    bancoMON = await banco(E1, entMON, await cuenta(E1, entMON, "1.1.2.01", "Bancos MON"), "Banco Industrial", "Monetaria Q MON");
    bancoKT = await banco(E1, entKT, await cuenta(E1, entKT, "1.1.2.01", "Bancos KT"), "BAM", "Monetaria Q KT");
    bancoE2 = await banco(E2, entE2, await cuenta(E2, entE2, "1.1.2.01", "Bancos E2"), "Banrural", "Otra empresa");
    bancoInactivo = await banco(E1, entMON, await cuenta(E1, entMON, "1.1.2.02", "Bancos MON inactivo"), "G&T", "Cerrada", "GTQ", 0);
    bancoUSD = await banco(E1, entMON, await cuenta(E1, entMON, "1.1.2.03", "Bancos MON USD"), "Banco Industrial", "Dólares", "USD");
    // composite FK: una cuenta contable de OTRA entidad no puede colgarse a un banco de esta (rechazado por la base)
    const ajena = await cuenta(E1, entKT, "1.1.2.99", "Cuenta de KT");
    await expect(
      admin.query("INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, moneda) VALUES (?, ?, ?, 'X', 'Cruzada', 'GTQ')", [E1, entMON, ajena]),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    await admin.query(
      "INSERT INTO fact_entidad_config (empresa_id, entidad_id, plantilla_factura) VALUES (?, ?, 'CANTIDAD_DESCRIPCION_UNITARIO_VALOR')",
      [E1, entMON],
    );
  });

  it("3 viajes → UNA línea (3 × precio) + una línea de DESCARGA: totales de las líneas, trazabilidad viaje→línea y UNIQUE(plan_id) intacto", async () => {
    const a = await crearPlan({ codigo: "F4-A" });
    const b = await crearPlan({ codigo: "F4-B" });
    const c = await crearPlan({ codigo: "F4-C" });
    const lineas = [
      linea([a, b, c], { cantidad: 3, precioUnitario: 1000, descripcion: "3 servicios de transporte Guatemala – Xela" }),
      linea([a, b, c], { cantidad: 3, precioUnitario: 100, descripcion: "Descarga", precioIncluyeIva: false }),
    ];
    // preview: no escribe
    const antes = await conteo("SELECT COUNT(*) AS n FROM fact_factura_lineas");
    const pv = await previsualizarFactura(actorA, { clienteId: 20, planes: planes([a, b, c]), lineas, entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(pv).toMatchObject({ ok: true });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_lineas")).toBe(antes);
    if (!pv.ok) return;
    // 3×1000 con IVA incluido (3000) + 3×100 con IVA agregado (300 + 36 = 336) = 3,336.00
    expect(pv.preview.borrador.total).toBe(3336);
    expect(pv.preview.lineas?.map((l) => [l.valor, l.base, l.iva, l.total])).toEqual([[3000, 2678.57, 321.43, 3000], [300, 300, 36, 336]]);

    const r = await crearFactura(actorA, { clienteId: 20, planes: planes([a, b, c]), lineas, entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0, retencionIvaClientePct: 0 });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const d = await obtenerFactura(E1, r.facturaId);
    expect(d?.factura.montoTotal).toBe(3336);
    expect(d?.contabilidad).toMatchObject({ modeloLineas: true, entidadId: entMON, entidadNombre: "Logiservicios Mónaco", condicionPago: "CREDITO", cuentaBancaria: null });
    expect(d?.lineas.map((l) => [l.orden, l.cantidad, l.precioUnitario, l.valor, l.clasificacion])).toEqual([[1, 3, 1000, 3000, "SERVICIO"], [2, 3, 100, 300, "SERVICIO"]]);
    // trazabilidad: ambas líneas conocen sus 3 viajes (por código congelado)
    for (const l of d!.lineas) expect(l.viajes.map((v) => v.codigo).sort()).toEqual(["F4-A", "F4-B", "F4-C"]);
    // los viajes siguen reservados una sola vez (UNIQUE(plan_id)) y sin desglose fiscal duplicado en el modelo de líneas
    const viajes = await filas(`SELECT plan_id, base_monto, iva_monto, total_linea FROM fact_factura_viajes WHERE factura_id = ${r.facturaId} ORDER BY plan_id`);
    expect(viajes).toHaveLength(3);
    expect(viajes.every((v) => v.base_monto == null && v.iva_monto == null && v.total_linea == null)).toBe(true);
    const [enc] = await filas(`SELECT subtotal, iva_monto, monto_total FROM fact_facturas WHERE id = ${r.facturaId}`);
    expect([Number(enc.subtotal), Number(enc.iva_monto), Number(enc.monto_total)]).toEqual([2978.57, 357.43, 3336]);
    // un viaje ya facturado no se puede usar en otra factura (aunque ahora haya líneas)
    const dup = await crearFactura(actorB, { clienteId: 20, planes: planes([a]), lineas: [linea([a])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(dup).toMatchObject({ ok: false, status: 409 });
  });

  it("validaciones del servidor: viaje sin línea, línea sin viaje de la factura, precio 0 (descarga sin capturar) y condición inválida → 400, sin escribir", async () => {
    const x = await crearPlan({ codigo: "F4-V1" });
    const y = await crearPlan({ codigo: "F4-V2" });
    const antes = await conteo("SELECT COUNT(*) AS n FROM fact_facturas");
    const casos: [string, Parameters<typeof crearFactura>[1]][] = [
      ["viaje sin línea", { clienteId: 20, planes: planes([x, y]), lineas: [linea([x])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 }],
      ["línea con un viaje ajeno a la factura", { clienteId: 20, planes: planes([x]), lineas: [linea([x, y])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 }],
      ["precio unitario 0", { clienteId: 20, planes: planes([x]), lineas: [linea([x], { precioUnitario: 0 })], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 }],
      ["retención 10 %", { clienteId: 20, planes: planes([x]), lineas: [linea([x])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 10 }],
      ["entidad de OTRA empresa", { clienteId: 20, planes: planes([x]), lineas: [linea([x])], entidadId: entE2, condicionPago: "CREDITO", retencionIvaPct: 0 }],
    ];
    for (const [nombre, datos] of casos) {
      const r = await crearFactura(actorA, datos);
      expect(r, nombre).toMatchObject({ ok: false, status: 400 });
    }
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_facturas")).toBe(antes);
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id IN (?, ?)", [x, y])).toBe(0);
  });

  it("CRÉDITO y CONTADO exigen entidad emisora: sin entidad (y sin banco que la derive) → 400 y nada se guarda", async () => {
    const p = await crearPlan({ codigo: "F4-SINENT" });
    const credito = await crearFactura(actorA, { clienteId: 20, planes: planes([p]), lineas: [linea([p])], condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(credito).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("entidad emisora") });
    const sinCondicion = await crearFactura(actorA, { clienteId: 20, planes: planes([p]), lineas: [linea([p])], entidadId: entMON, retencionIvaPct: 0 });
    expect(sinCondicion).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("condición de pago") });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [p])).toBe(0);
    // CRÉDITO congela la condición y no lleva banco
    const ok = await crearFactura(actorA, { clienteId: 20, planes: planes([p]), lineas: [linea([p])], entidadId: entKT, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) {
      const [f] = await filas(`SELECT entidad_id, condicion_pago, cuenta_bancaria_id, cuenta_bancaria_snapshot FROM fact_facturas WHERE id = ${ok.facturaId}`);
      expect([f.entidad_id, f.condicion_pago, f.cuenta_bancaria_id, f.cuenta_bancaria_snapshot]).toEqual([entKT, "CREDITO", null, null]);
    }
  });

  it("CONTADO: exige banco ACTIVO de la empresa, misma moneda y de la entidad emisora; CRÉDITO no lleva banco; el snapshot queda congelado", async () => {
    const p = await crearPlan({ codigo: "F4-CON" });
    const base = { clienteId: 20, planes: planes([p]), lineas: [linea([p])], retencionIvaPct: 0 };
    const rechazos: [string, Parameters<typeof crearFactura>[1]][] = [
      ["contado sin banco", { ...base, entidadId: entMON, condicionPago: "CONTADO" }],
      ["banco de otra empresa", { ...base, entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: bancoE2 }],
      ["banco inactivo", { ...base, entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: bancoInactivo }],
      ["banco de OTRA entidad", { ...base, entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: bancoKT }],
      ["banco en otra moneda", { ...base, entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: bancoUSD }],
      ["crédito con banco", { ...base, entidadId: entMON, condicionPago: "CREDITO", cuentaBancariaId: bancoMON }],
      ["banco inexistente", { ...base, entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: 987654 }],
    ];
    for (const [nombre, datos] of rechazos) {
      expect(await crearFactura(actorA, datos), nombre).toMatchObject({ ok: false, status: 400 });
    }
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [p])).toBe(0);

    const ok = await crearFactura(actorA, { ...base, entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: bancoMON });
    expect(ok).toMatchObject({ ok: true });
    if (!ok.ok) return;
    const d = await obtenerFactura(E1, ok.facturaId);
    expect(d?.contabilidad).toMatchObject({ condicionPago: "CONTADO", cuentaBancaria: { cuentaBancariaId: bancoMON, banco: "Banco Industrial", alias: "Monetaria Q MON", moneda: "GTQ" } });
    // lo que cambie después en el catálogo de bancos NO altera la factura
    await admin.query("UPDATE cont_cuentas_bancarias SET alias = 'RENOMBRADA', activa = 0 WHERE id = ?", [bancoMON]);
    const d2 = await obtenerFactura(E1, ok.facturaId);
    expect(d2?.contabilidad.cuentaBancaria?.alias).toBe("Monetaria Q MON");
    await admin.query("UPDATE cont_cuentas_bancarias SET alias = 'Monetaria Q MON', activa = 1 WHERE id = ?", [bancoMON]);
  });

  it("al CONTADO sin entidad explícita, la entidad sale del banco elegido", async () => {
    const p = await crearPlan({ codigo: "F4-DER" });
    const r = await crearFactura(actorA, { clienteId: 20, planes: planes([p]), lineas: [linea([p])], condicionPago: "CONTADO", cuentaBancariaId: bancoKT, retencionIvaPct: 0 });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect((await obtenerFactura(E1, r.facturaId))?.contabilidad).toMatchObject({ entidadId: entKT, entidadNombre: "Kuiqtrans" });
  });

  it("RETENCIÓN IVA 15 %: Q3,000 con IVA incluido → retención 48.21 y a cobrar 2,951.79; la partida propuesta cuadra; CONGELADA aunque el cliente cambie", async () => {
    await guardarRetencionIvaCliente(E1, 20, 15, 3);
    expect(await leerRetencionIvaCliente(E1, 20)).toBe(15);
    const p = await crearPlan({ codigo: "F4-RET", tarifa_comercial: 3000 });
    const datos = { clienteId: 20, planes: planes([p]), lineas: [linea([p], { precioUnitario: 3000 })], entidadId: entMON, condicionPago: "CREDITO" as const, retencionIvaPct: 15, retencionIvaClientePct: 15 };
    const pv = await previsualizarFactura(actorA, datos);
    expect(pv).toMatchObject({ ok: true, preview: { retencionIva: { aplicadaPct: 15, clientePct: 15, monto: 48.21, netoCobrar: 2951.79 } } });
    const r = await crearFactura(actorA, datos);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const [enc] = await filas(`SELECT retencion_iva_pct, retencion_iva_cliente_pct, retencion_iva_monto, monto_total FROM fact_facturas WHERE id = ${r.facturaId}`);
    expect([enc.retencion_iva_pct, enc.retencion_iva_cliente_pct, Number(enc.retencion_iva_monto), Number(enc.monto_total)]).toEqual([15, 15, 48.21, 3000]);

    // partida propuesta desde lo guardado (sin escribir asientos): DEBE = HABER = 3,000.00
    const d = await obtenerFactura(E1, r.facturaId);
    const partida = proponerPartidaVenta({
      lineas: d!.lineas.map((l) => ({ clasificacion: l.clasificacion, base: l.base!, iva: l.iva!, total: l.total! })),
      condicionPago: d!.contabilidad.condicionPago, retencionIvaPct: d!.contabilidad.retencionIva.aplicadaPct,
    });
    expect(partida).toMatchObject({ ok: true, partida: { retencionIva: 48.21, netoCobrar: 2951.79, totalDebe: 3000, totalHaber: 3000 } });
    expect(await conteo("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cont_asientos'")).toBe(0);

    // si después el cliente pasa a 30 %, la factura ya creada conserva 15 % / 48.21
    await guardarRetencionIvaCliente(E1, 20, 30, 3);
    const d2 = await obtenerFactura(E1, r.facturaId);
    expect(d2?.contabilidad.retencionIva).toEqual({ aplicadaPct: 15, clientePct: 15, monto: 48.21 });
    // y una factura nueva con 30 % lleva 96.43 (321.43 × 0.30)
    const p2 = await crearPlan({ codigo: "F4-RET30", tarifa_comercial: 3000 });
    const r30 = await crearFactura(actorA, { ...datos, planes: planes([p2]), lineas: [linea([p2], { precioUnitario: 3000 })], retencionIvaPct: 30, retencionIvaClientePct: 30 });
    expect(r30).toMatchObject({ ok: true });
    if (r30.ok) expect((await obtenerFactura(E1, r30.facturaId))?.contabilidad.retencionIva).toMatchObject({ aplicadaPct: 30, monto: 96.43 });
    await guardarRetencionIvaCliente(E1, 20, 0, 3);
  });

  it("SERVICIO / BIEN: cada línea congela su clasificación y no cambia al recalcular otras líneas ni al reeditar", async () => {
    const a = await crearPlan({ codigo: "F4-CL1" });
    const b = await crearPlan({ codigo: "F4-CL2" });
    const c = await crearFactura(actorA, {
      clienteId: 20, planes: planes([a, b]), entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0,
      lineas: [linea([a], { clasificacion: "SERVICIO", descripcion: "Flete" }), linea([b], { clasificacion: "BIEN", descripcion: "Tarimas", precioIncluyeIva: false })],
    });
    expect(c).toMatchObject({ ok: true });
    if (!c.ok) return;
    const guardado = await filas(`SELECT orden, clasificacion FROM fact_factura_lineas WHERE factura_id = ${c.facturaId} ORDER BY orden`);
    expect(guardado.map((r) => [r.orden, r.clasificacion])).toEqual([[1, "SERVICIO"], [2, "BIEN"]]);
    // una clasificación inválida no entra (rechazada por el servidor)
    const p3 = await crearPlan({ codigo: "F4-CL3" });
    const mala = await crearFactura(actorA, {
      clienteId: 20, planes: planes([p3]), entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0,
      lineas: [{ ...linea([p3]), clasificacion: "OTRO" as never }],
    });
    expect(mala).toMatchObject({ ok: false, status: 400 });
    // y la base lo defiende aunque alguien escriba por SQL directo (CHECK)
    await expect(
      admin.query(
        `INSERT INTO fact_factura_lineas (factura_id, orden, cantidad, descripcion, precio_unitario, valor, clasificacion, precio_incluye_iva, porcentaje_iva, base_monto, iva_monto, total_linea)
         VALUES (${c.facturaId}, 99, 1, 'x', 10, 10, 'OTRO', 1, 12, 8.93, 1.07, 10)`,
      ),
    ).rejects.toMatchObject({ errno: 4025 });
  });

  it("editar el borrador: reemplaza líneas y viajes en una transacción; un payload del modelo anterior sobre un borrador con líneas se rechaza", async () => {
    const a = await crearPlan({ codigo: "F4-E1" });
    const b = await crearPlan({ codigo: "F4-E2" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: planes([a, b]), lineas: [linea([a, b], { cantidad: 2 })], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(c).toMatchObject({ ok: true });
    if (!c.ok) return;
    const u = await actualizarFacturaBorrador(actorA, c.facturaId, {
      clienteId: 20, planes: planes([a, b]),
      lineas: [linea([a], { descripcion: "Flete A", precioUnitario: 400 }), linea([b], { descripcion: "Flete B", precioUnitario: 600 }), linea([a, b], { descripcion: "Descarga", precioUnitario: 50 })],
      entidadId: entMON, condicionPago: "CONTADO", cuentaBancariaId: bancoMON, retencionIvaPct: 0,
    });
    expect(u).toMatchObject({ ok: true });
    const d = await obtenerFactura(E1, c.facturaId);
    expect(d?.lineas.map((l) => [l.orden, l.descripcion, l.valor])).toEqual([[1, "Flete A", 400], [2, "Flete B", 600], [3, "Descarga", 50]]);
    expect(d?.factura.montoTotal).toBe(1050);
    expect(d?.contabilidad.condicionPago).toBe("CONTADO");
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_lineas WHERE factura_id = ?", [c.facturaId])).toBe(3);
    // sin filas huérfanas en la tabla puente
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_linea_viajes lv LEFT JOIN fact_factura_lineas l ON l.id = lv.linea_id WHERE l.id IS NULL")).toBe(0);
    // payload del modelo anterior sobre un borrador que YA tiene líneas → rechazado, no se pierden las líneas
    const legacy = await actualizarFacturaBorrador(actorA, c.facturaId, { clienteId: 20, planes: planes([a, b]) });
    expect(legacy).toMatchObject({ ok: false, status: 400 });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_lineas WHERE factura_id = ?", [c.facturaId])).toBe(3);
  });

  it("emitir y anular: la factura anulada CONSERVA sus líneas y su condición/retención; sus viajes quedan libres", async () => {
    const a = await crearPlan({ codigo: "F4-AN1" });
    const c = await crearFactura(actorA, {
      clienteId: 20, planes: planes([a]), lineas: [linea([a], { precioUnitario: 1120 })],
      entidadId: entKT, condicionPago: "CREDITO", retencionIvaPct: 15, retencionIvaClientePct: 0, numeroFactura: "F4-1", fechaEmision: "2026-09-10",
    });
    expect(c).toMatchObject({ ok: true });
    if (!c.ok) return;
    expect((await emitirFactura(actorA, c.facturaId, {})).ok).toBe(true);
    expect((await anularFactura(actorA, c.facturaId)).ok).toBe(true);
    const d = await obtenerFactura(E1, c.facturaId);
    expect(d?.factura.estadoAdmin).toBe("Anulada");
    expect(d?.lineas).toHaveLength(1);
    expect(d?.lineas[0]).toMatchObject({ valor: 1120, viajes: [{ codigo: "F4-AN1" }] });
    expect(d?.contabilidad).toMatchObject({ modeloLineas: true, condicionPago: "CREDITO", retencionIva: { aplicadaPct: 15, clientePct: 0, monto: 18 } });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [a])).toBe(0);
    // la asociación línea↔viaje para auditoría sobrevive en la tabla puente (código congelado + plan)
    const puente = await filas(
      `SELECT lv.plan_id, lv.codigo_viaje_snapshot FROM fact_factura_linea_viajes lv
       INNER JOIN fact_factura_lineas l ON l.id = lv.linea_id WHERE l.factura_id = ${c.facturaId}`,
    );
    expect(puente.map((r) => [Number(r.plan_id), r.codigo_viaje_snapshot])).toEqual([[a, "F4-AN1"]]);
    // y la anulada genera su PDF desde las líneas finales (modelo de líneas), con la marca ANULADA
    let pdf: Awaited<ReturnType<typeof generarPdfFacturaDemo>> | null = null;
    const tAn = await textoPdf(async () => { pdf = await generarPdfFacturaDemo(empresa1, c.facturaId); });
    expect(pdf).toMatchObject({ ok: true });
    expect(tAn).toContain("ANULADA");
    expect(tAn).toContain("Q1,120.00");
    // el viaje liberado se puede facturar otra vez
    const otra = await crearFactura(actorB, { clienteId: 20, planes: planes([a]), lineas: [linea([a])], entidadId: entKT, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(otra).toMatchObject({ ok: true });
  });

  it("un viaje no puede quedar ACTIVO en dos facturas ni por SQL directo (UNIQUE(plan_id) sigue siendo la defensa)", async () => {
    const a = await crearPlan({ codigo: "F4-UQ" });
    const c1 = await crearFactura(actorA, { clienteId: 20, planes: planes([a]), lineas: [linea([a])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(c1).toMatchObject({ ok: true });
    const [otra] = await admin.query<mysql.ResultSetHeader>(
      `INSERT INTO fact_facturas (empresa_id, cliente_id, monto_total, estado_admin, creado_por) VALUES (${E1}, 20, 1, 'Borrador', 1)`,
    );
    await expect(
      admin.query("INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, 1)", [otra.insertId, a]),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("PDF por entidad: Mónaco (plantilla Cantidad | Descripción | Precio unitario | Valor) y KT (Código | Descripción | Total) con el MISMO motor", async () => {
    await admin.query("UPDATE clientes SET razon_social = 'Cliente X, S.A.', nit = '1234567-8', direccion = 'Zona 1', codigo = '0000020' WHERE id = 20");
    const a = await crearPlan({ codigo: "F4-PDF-A" });
    const b = await crearPlan({ codigo: "F4-PDF-B" });
    const lineas = [linea([a, b], { cantidad: 2, precioUnitario: 500, descripcion: "2 servicios de transporte Guatemala – Quetzaltenango" })];
    const mon = await crearFactura(actorA, { clienteId: 20, planes: planes([a, b]), lineas, entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(mon).toMatchObject({ ok: true });
    if (!mon.ok) return;
    let r: Awaited<ReturnType<typeof generarPdfFacturaDemo>> | null = null;
    const tMon = await textoPdf(async () => { r = await generarPdfFacturaDemo(empresa1, mon.facturaId); });
    expect(r).toMatchObject({ ok: true });
    for (const v of ["CANTIDAD", "DESCRIPCIÓN", "PRECIO UNITARIO", "VALOR", "Q500.00", "Q1,000.00", "2 SERVICIOS DE TRANSPORTE GUATEMALA - QUETZALTENANGO", LEYENDA_NO_FISCAL]) {
      expect(tMon, v).toContain(v);
    }
    expect(tMon).not.toMatch(/^CÓDIGO$/m); // (el «CÓDIGO CLIENTE:» del encabezado no es la columna)

    const c = await crearPlan({ codigo: "F4-PDF-C" });
    const kt = await crearFactura(actorA, { clienteId: 20, planes: planes([c]), lineas: [linea([c], { descripcion: "Servicio KT" })], entidadId: entKT, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(kt).toMatchObject({ ok: true });
    if (!kt.ok) return;
    const tKt = await textoPdf(() => generarPdfFacturaDemo(empresa1, kt.facturaId));
    expect(tKt).toMatch(/^CÓDIGO$/m);
    expect(tKt).not.toContain("PRECIO UNITARIO");
    expect(tKt).toContain("SERVICIO KT");
  });

  it("MULTIEMPRESA: otra empresa no ve, no edita ni usa lo de la empresa 7 (facturas, líneas, bancos y entidades)", async () => {
    const p = await crearPlan({ codigo: "F4-MT" });
    const c = await crearFactura(actorA, { clienteId: 20, planes: planes([p]), lineas: [linea([p])], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(c).toMatchObject({ ok: true });
    if (!c.ok) return;
    const otro: ActorFacturacion = { empresaId: E2, usuarioId: 9, usuario: "otra" };
    expect(await obtenerFactura(E2, c.facturaId)).toBeNull();
    expect(await actualizarFacturaBorrador(otro, c.facturaId, { clienteId: 30, planes: planes([p]), lineas: [linea([p])], entidadId: entE2, condicionPago: "CREDITO", retencionIvaPct: 0 }))
      .toMatchObject({ ok: false });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_lineas WHERE factura_id = ?", [c.facturaId])).toBe(1);
    // la empresa 7 no puede usar el banco ni la entidad de la 8
    const q = await crearPlan({ codigo: "F4-MT2" });
    expect(await crearFactura(actorA, { clienteId: 20, planes: planes([q]), lineas: [linea([q])], entidadId: entE2, condicionPago: "CREDITO", retencionIvaPct: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await crearFactura(actorA, { clienteId: 20, planes: planes([q]), lineas: [linea([q])], condicionPago: "CONTADO", cuentaBancariaId: bancoE2, retencionIvaPct: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(await conteo("SELECT COUNT(*) AS n FROM fact_factura_viajes WHERE plan_id = ?", [q])).toBe(0);
  });

  it("MUTACIÓN: sin la validación de entidad/banco por empresa la prueba anterior detectaría el cruce (se verifica la consulta real con ids de otra empresa)", async () => {
    const filasBanco = await filas(
      `SELECT b.id FROM cont_cuentas_bancarias b WHERE b.id = ? AND b.empresa_id = ?`, [bancoE2, E1],
    );
    expect(filasBanco).toHaveLength(0);
    const cruzada = await filas(`SELECT id FROM cont_cuentas_bancarias WHERE id = ?`, [bancoE2]);
    expect(cruzada).toHaveLength(1); // el banco existe: solo el filtro por empresa lo oculta
  });
});
