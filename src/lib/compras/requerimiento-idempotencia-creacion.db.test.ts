import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE — idempotencia de creación de Requerimientos de Compras (PR B).
 *
 * Se OMITE por defecto (no corre en CI ni en `npm test`). Solo se ejecuta si `IDEMPOTENCIA_DB_PORT` apunta a una MariaDB
 * LOCAL y DESECHABLE (127.0.0.1) con el esquema `u611730801_Plataforma` y la migración
 * sql/migrate-2026-10-compras-idempotencia-requerimientos.sql aplicada. Nunca lee .env ni usa credenciales reales: el pool se
 * crea aquí, fijo a 127.0.0.1 con usuario `root` sin contraseña.
 *
 * Ejecuta `guardarRequerimiento` REAL con peticiones CONCURRENTES verdaderas (incluido GET_LOCK de facturas por proveedor) y
 * comprueba que el UNIQUE (empresa_id, clave_idempotencia) de la base decide la carrera.
 */
const PUERTO = process.env.IDEMPOTENCIA_DB_PORT;
const ESQUEMA = process.env.IDEMPOTENCIA_DB_SCHEMA ?? "u611730801_Plataforma";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) {
      pool = mysql.createPool({
        host: "127.0.0.1", port: Number(process.env.IDEMPOTENCIA_DB_PORT), user: "root", password: "",
        database: process.env.IDEMPOTENCIA_DB_SCHEMA ?? "u611730801_Plataforma", connectionLimit: 20, timezone: "local",
      });
    }
    return pool;
  };
  return {
    getPool: obtener,
    query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0],
    execute: async (sql: string, params: unknown[] = []) => (await obtener().execute(sql, params as never))[0],
  };
});
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => null) }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { getPool } from "@/lib/db";
import { ErrorCompra, guardarRequerimiento } from "./requerimientos";
import { crearRequerimientoSchema } from "./requerimiento-schema";

const EMPRESA_A = 9301;
const EMPRESA_B = 9302;
const USUARIO = 9401;
const ids = { entidad: { [EMPRESA_A]: 0, [EMPRESA_B]: 0 } as Record<number, number>, proveedor: { [EMPRESA_A]: 0, [EMPRESA_B]: 0 } as Record<number, number> };

async function contar(empresa: number, clave: string) {
  const [filas] = await getPool().query("SELECT COUNT(*) AS n FROM compras_requerimientos WHERE empresa_id = ? AND clave_idempotencia = ?", [empresa, clave]);
  return Number((filas as { n: number }[])[0].n);
}
async function contarEmpresa(empresa: number) {
  const [filas] = await getPool().query("SELECT COUNT(*) AS n FROM compras_requerimientos WHERE empresa_id = ?", [empresa]);
  return Number((filas as { n: number }[])[0].n);
}

const cuerpo = (empresa: number, extra: Record<string, unknown> = {}, lineaExtra: Record<string, unknown> = {}) => ({
  fecha_requerimiento: "2026-10-01", entidad_requirente_id: ids.entidad[empresa], requirente_usuario_id: USUARIO, observaciones: "Urgente",
  lineas: [{ fecha: "2026-10-01", proveedor_id: ids.proveedor[empresa], vehiculo_id: null, repuesto_descripcion: "Filtro de aire", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "10.25", ...lineaExtra }],
  ...extra,
});
const crear = (empresa: number, extra: Record<string, unknown> = {}, lineaExtra: Record<string, unknown> = {}) =>
  guardarRequerimiento(empresa, USUARIO, "prueba", crearRequerimientoSchema.parse(cuerpo(empresa, extra, lineaExtra)), false);

async function limpiar() {
  const pool = getPool();
  await pool.query("DELETE FROM compras_requerimiento_lineas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM compras_requerimientos WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
}

describe.skipIf(!PUERTO)(`BD real desechable (${ESQUEMA}) — Compras`, () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const e of [EMPRESA_A, EMPRESA_B]) {
      await pool.query("INSERT IGNORE INTO empresas (id, codigo, nombre, slug) VALUES (?, ?, ?, ?)", [e, `C${e}`, `Prueba ${e}`, `prueba-${e}`]);
      await pool.query("INSERT IGNORE INTO cont_entidades (empresa_id, codigo, nombre, activa) VALUES (?, 'KT', 'Entidad prueba', 1)", [e]);
      const [ent] = await pool.query("SELECT id FROM cont_entidades WHERE empresa_id = ? ORDER BY id LIMIT 1", [e]);
      ids.entidad[e] = Number((ent as { id: number }[])[0].id);
      await pool.query("INSERT IGNORE INTO compras_proveedores (empresa_id, nombre_comercial, activo) VALUES (?, 'Proveedor prueba', 1)", [e]);
      const [prov] = await pool.query("SELECT id FROM compras_proveedores WHERE empresa_id = ? ORDER BY id LIMIT 1", [e]);
      ids.proveedor[e] = Number((prov as { id: number }[])[0].id);
    }
    await pool.query(
      "INSERT IGNORE INTO usuarios (id, username, nombre, password_hash, salt, rol_global, activo, acceso_todas_empresas) VALUES (?, ?, 'Operador Prueba', 'x', 'x', 'Operaciones', 1, 1)",
      [USUARIO, `compras${USUARIO}`],
    );
  });
  beforeEach(limpiar);
  afterAll(async () => {
    await limpiar();
    await (getPool() as unknown as { end(): Promise<void> }).end();
  });

  it("misma clave + mismo contenido → misma creación (1 fila, 1 juego de líneas)", async () => {
    const clave = "real-compras-misma-clave1";
    const a = await crear(EMPRESA_A, { clave_idempotencia: clave });
    const b = await crear(EMPRESA_A, { clave_idempotencia: clave });
    expect(b).toEqual(a);
    expect(await contar(EMPRESA_A, clave)).toBe(1);
    const [l] = await getPool().query("SELECT COUNT(*) AS n FROM compras_requerimiento_lineas WHERE empresa_id = ?", [EMPRESA_A]);
    expect(Number((l as { n: number }[])[0].n)).toBe(1);
  });

  it("misma clave + contenido distinto → 409 (ErrorCompra)", async () => {
    const clave = "real-compras-distinto-001";
    await crear(EMPRESA_A, { clave_idempotencia: clave });
    const error = await crear(EMPRESA_A, { clave_idempotencia: clave, observaciones: "Otra" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorCompra);
    expect((error as ErrorCompra).status).toBe(409);
    expect(await contar(EMPRESA_A, clave)).toBe(1);
  });

  it("clave distinta + mismo contenido → dos creaciones legítimas", async () => {
    const a = await crear(EMPRESA_A, { clave_idempotencia: "real-compras-clave-a-0001" });
    const b = await crear(EMPRESA_A, { clave_idempotencia: "real-compras-clave-b-0001" });
    expect(b.id).not.toBe(a.id);
    expect(await contarEmpresa(EMPRESA_A)).toBe(2);
  });

  it("misma clave en otra empresa → independiente", async () => {
    const clave = "real-compras-aislamiento1";
    const a = await crear(EMPRESA_A, { clave_idempotencia: clave });
    const b = await crear(EMPRESA_B, { clave_idempotencia: clave });
    expect(b.id).not.toBe(a.id);
    expect(await contar(EMPRESA_A, clave)).toBe(1);
    expect(await contar(EMPRESA_B, clave)).toBe(1);
  });

  it("CONCURRENCIA real SIN facturas: 12 peticiones simultáneas con la misma clave → UNA fila y el mismo id para todas", async () => {
    const clave = "real-compras-concurrencia-12";
    const r = await Promise.all(Array.from({ length: 12 }, () => crear(EMPRESA_A, { clave_idempotencia: clave })));
    expect(new Set(r.map(x => x.id)).size).toBe(1);
    expect(await contarEmpresa(EMPRESA_A)).toBe(1);
    const [l] = await getPool().query("SELECT COUNT(*) AS n FROM compras_requerimiento_lineas WHERE empresa_id = ?", [EMPRESA_A]);
    expect(Number((l as { n: number }[])[0].n)).toBe(1); // sin líneas huérfanas de las perdedoras
  });

  it("CONCURRENCIA real CON factura (GET_LOCK por proveedor): 8 peticiones con la misma clave → UNA fila, sin 409 de factura duplicada", async () => {
    const clave = "real-compras-concurrencia-fa";
    const r = await Promise.all(Array.from({ length: 8 }, () => crear(EMPRESA_A, { clave_idempotencia: clave }, { serie_factura: "A", numero_factura: "9001" })));
    expect(new Set(r.map(x => x.id)).size).toBe(1);
    expect(await contarEmpresa(EMPRESA_A)).toBe(1);
  });

  it("reintento (no concurrente) de un requerimiento con factura → la creación original; sin clave sigue siendo 409 de factura", async () => {
    const clave = "real-compras-reintento-fact";
    const original = await crear(EMPRESA_A, { clave_idempotencia: clave }, { serie_factura: "B", numero_factura: "9002" });
    expect(await crear(EMPRESA_A, { clave_idempotencia: clave }, { serie_factura: "B", numero_factura: "9002" })).toEqual(original);
    const sinClave = await crear(EMPRESA_A, {}, { serie_factura: "B", numero_factura: "9002" }).catch((e: unknown) => e);
    expect(sinClave).toBeInstanceOf(ErrorCompra);
    expect((sinClave as ErrorCompra).status).toBe(409);
    expect(await contarEmpresa(EMPRESA_A)).toBe(1);
  });

  it("CONCURRENCIA real con claves distintas → una fila por clave", async () => {
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => crear(EMPRESA_A, { clave_idempotencia: `real-compras-claves-dist-${i}-x` })));
    expect(new Set(r.map(x => x.id)).size).toBe(6);
    expect(await contarEmpresa(EMPRESA_A)).toBe(6);
  });

  it("sin clave (legado) → cada envío crea un requerimiento", async () => {
    const a = await crear(EMPRESA_A);
    const b = await crear(EMPRESA_A);
    expect(b.id).not.toBe(a.id);
    expect(await contarEmpresa(EMPRESA_A)).toBe(2);
  });
});
