import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE — idempotencia de creación (Fondos y Gastos).
 *
 * Se OMITE por defecto (no corre en CI ni en `npm test`). Solo se ejecuta si `IDEMPOTENCIA_DB_PORT` apunta a una MariaDB
 * LOCAL y DESECHABLE (127.0.0.1) con el esquema `u611730801_Plataforma` y la migración
 * sql/migrate-2026-10-operaciones-idempotencia-fondos-gastos.sql aplicada. Nunca lee .env ni usa credenciales reales: el
 * pool se crea aquí, fijo a 127.0.0.1 con usuario `root` sin contraseña.
 *
 * Ejecuta las funciones REALES (crearGasto / crearSolicitudFondo) con peticiones CONCURRENTES verdaderas, y comprueba que
 * el UNIQUE (empresa_id, clave_idempotencia) de la base es lo que decide la carrera.
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
        database: process.env.IDEMPOTENCIA_DB_SCHEMA ?? "u611730801_Plataforma", connectionLimit: 12, timezone: "local",
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
import { crearGasto } from "./gastos";
import { crearSolicitudFondo } from "./fondos";
import { ConflictoIdempotencia } from "./idempotencia-envio";

const EMPRESA_A = 9101;
const EMPRESA_B = 9102;
const USUARIO = 9201;

async function contar(tabla: string, empresa: number, clave: string) {
  const [filas] = await getPool().query(`SELECT COUNT(*) AS n FROM ${tabla} WHERE empresa_id = ? AND clave_idempotencia = ?`, [empresa, clave]);
  return Number((filas as { n: number }[])[0].n);
}

const gasto = (extra: Record<string, unknown> = {}) => ({ fechaSolicitud: "2026-10-01", categoria: "Combustible", monto: 450, observaciones: "obs", ...extra });
const fondo = (extra: Record<string, unknown> = {}) => ({
  fechaRequerimiento: "2026-10-01", requirenteUsuarioId: USUARIO, solicitanteUsuarioId: USUARIO, observaciones: "obs",
  lineas: [{ categoria: "Combustible", cantidad: 1, monto: 100 }], ...extra,
});

describe.skipIf(!PUERTO)(`BD real desechable (${ESQUEMA})`, () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const id of [EMPRESA_A, EMPRESA_B]) {
      await pool.query("INSERT IGNORE INTO empresas (id, codigo, nombre, slug) VALUES (?, ?, ?, ?)", [id, `T${id}`, `Prueba ${id}`, `prueba-${id}`]);
    }
    await pool.query(
      "INSERT IGNORE INTO usuarios (id, username, nombre, password_hash, salt, rol_global, activo, acceso_todas_empresas) VALUES (?, ?, 'Operador Prueba', 'x', 'x', 'Operaciones', 1, 1)",
      [USUARIO, `prueba${USUARIO}`],
    );
  });

  beforeEach(async () => {
    const pool = getPool();
    for (const t of ["tms_gasto_operativo_lineas", "tms_solicitud_fondo_lineas"]) await pool.query(`DELETE FROM ${t} WHERE empresa_id IN (?, ?)`, [EMPRESA_A, EMPRESA_B]);
    for (const t of ["tms_gastos_operativos", "tms_solicitudes_fondo"]) await pool.query(`DELETE FROM ${t} WHERE empresa_id IN (?, ?)`, [EMPRESA_A, EMPRESA_B]);
  });

  afterAll(async () => {
    const pool = getPool();
    for (const t of ["tms_gasto_operativo_lineas", "tms_solicitud_fondo_lineas"]) await pool.query(`DELETE FROM ${t} WHERE empresa_id IN (?, ?)`, [EMPRESA_A, EMPRESA_B]);
    for (const t of ["tms_gastos_operativos", "tms_solicitudes_fondo"]) await pool.query(`DELETE FROM ${t} WHERE empresa_id IN (?, ?)`, [EMPRESA_A, EMPRESA_B]);
    await (pool as unknown as { end(): Promise<void> }).end();
  });

  describe.each([
    {
      nombre: "Gastos", tabla: "tms_gastos_operativos",
      crear: (e: number, x: Record<string, unknown>) => crearGasto(e, gasto(x) as never, "prueba"),
      distinto: { monto: 451 },
    },
    {
      nombre: "Fondos", tabla: "tms_solicitudes_fondo",
      crear: (e: number, x: Record<string, unknown>) => crearSolicitudFondo(e, fondo(x) as never, "prueba"),
      distinto: { observaciones: "otra" },
    },
  ])("$nombre", ({ tabla, crear, distinto }) => {
    it("misma clave + mismo contenido → misma creación (1 fila)", async () => {
      const clave = "real-misma-clave-0001";
      const a = await crear(EMPRESA_A, { claveIdempotencia: clave });
      const b = await crear(EMPRESA_A, { claveIdempotencia: clave });
      expect(b.id).toBe(a.id);
      expect(await contar(tabla, EMPRESA_A, clave)).toBe(1);
    });

    it("misma clave + contenido distinto → 409", async () => {
      const clave = "real-contenido-distinto-1";
      await crear(EMPRESA_A, { claveIdempotencia: clave });
      await expect(crear(EMPRESA_A, { claveIdempotencia: clave, ...distinto })).rejects.toBeInstanceOf(ConflictoIdempotencia);
      expect(await contar(tabla, EMPRESA_A, clave)).toBe(1);
    });

    it("clave distinta + mismo contenido → dos registros legítimos", async () => {
      const a = await crear(EMPRESA_A, { claveIdempotencia: "real-clave-distinta-00a" });
      const b = await crear(EMPRESA_A, { claveIdempotencia: "real-clave-distinta-00b" });
      expect(b.id).not.toBe(a.id);
    });

    it("misma clave en otra empresa → independiente", async () => {
      const clave = "real-aislamiento-empresa";
      const a = await crear(EMPRESA_A, { claveIdempotencia: clave });
      const b = await crear(EMPRESA_B, { claveIdempotencia: clave });
      expect(b.id).not.toBe(a.id);
      expect(await contar(tabla, EMPRESA_A, clave)).toBe(1);
      expect(await contar(tabla, EMPRESA_B, clave)).toBe(1);
    });

    it("CONCURRENCIA real: 12 peticiones simultáneas con la misma clave → UNA sola fila y todas reciben el mismo id", async () => {
      const clave = "real-concurrencia-12-req";
      const resultados = await Promise.all(Array.from({ length: 12 }, () => crear(EMPRESA_A, { claveIdempotencia: clave })));
      expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
      expect(await contar(tabla, EMPRESA_A, clave)).toBe(1);
      const [filas] = await getPool().query(`SELECT COUNT(*) AS n FROM ${tabla} WHERE empresa_id = ?`, [EMPRESA_A]);
      expect(Number((filas as { n: number }[])[0].n)).toBe(1); // ninguna fila huérfana de las peticiones perdedoras
    });

    it("CONCURRENCIA real con claves distintas → una fila por clave", async () => {
      const resultados = await Promise.all(Array.from({ length: 6 }, (_, i) => crear(EMPRESA_A, { claveIdempotencia: `real-claves-distintas-${i}-xx` })));
      expect(new Set(resultados.map((r) => r.id)).size).toBe(6);
    });

    it("sin clave (legado) → cada envío crea un registro", async () => {
      const a = await crear(EMPRESA_A, {});
      const b = await crear(EMPRESA_A, {});
      expect(b.id).not.toBe(a.id);
    });
  });
});
