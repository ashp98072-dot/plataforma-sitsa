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
  type ActorFacturacion,
} from "./facturas";
import { MENSAJE_MONEDA_NO_SOPORTADA } from "./borrador-calculo";
import { generarPdfFacturaDemo, LEYENDA_NO_FISCAL } from "./factura-demo-pdf";

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

  it("Emitida: lleva su número y fecha de emisión y SIGUE marcada como NO FISCAL; Anulada → 409", async () => {
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
    expect(await generarPdfFacturaDemo(empresa1, b.facturaId)).toMatchObject({ ok: false, status: 409 });
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
