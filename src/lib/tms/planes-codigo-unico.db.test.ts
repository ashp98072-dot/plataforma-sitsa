import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
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

import { asegurarCodigoPlanUnico, asegurarCodigoPlanUnicoTx } from "./codigo-plan";
import { idUnidadTrasUpsert } from "./unidad-upsert";
import { CodigoPlanAgotadoError, esColisionIndiceCodigoPlan, insertarPlanConCodigoUnico } from "./codigo-plan-colision";

/**
 * URGENTE — creación individual y copia masiva de viajes bloqueadas en producción.
 *
 * Reproduce, contra MariaDB DESECHABLE con el esquema REAL de sql/schema.sql (tms_planes_viaje y sus FKs) y la migración REAL
 * sql/migrate-2026-11-flota-fusiones.sql (triggers BEFORE INSERT `ffi_*`), por qué el alta mostraba «No se pudo generar un código de
 * plan único» y la copia masiva «No se pudo crear el lote». Se OMITE salvo que exista PLANES_DB_PORT (3399 o 3407, solo local):
 *   PLANES_DB_PORT=3399 npx vitest run src/lib/tms/planes-codigo-unico.db.test.ts --no-file-parallelism
 * Nunca lee .env ni usa credenciales reales. Con MariaDB < 11.3 la colación uca1400 del esquema se sustituye solo al armar la BD de prueba.
 */
const port = Number(process.env.PLANES_DB_PORT ?? 0);
const database = `planes_cu_${randomUUID().replaceAll("-", "")}`;
const EMP = 7;
const FECHA = "2026-11-13";

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const conteo = async (tabla: string) => Number((await sql(`SELECT COUNT(*) AS n FROM ${tabla}`))[0].n);

/** Sentencias de un script SQL con soporte de DELIMITER (como el cliente `mysql`); los comentarios entre sentencias se descartan. */
export function sentencias(script: string): string[] {
  const out: string[] = [];
  let delim = ";";
  let acc: string[] = [];
  for (const linea of script.split(/\r?\n/)) {
    const m = linea.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (m) { delim = m[1]; continue; }
    if (!acc.length && (!linea.trim() || linea.trim().startsWith("--"))) continue;
    acc.push(linea);
    if (linea.trimEnd().endsWith(delim)) {
      const s = acc.join("\n").trimEnd();
      out.push(s.slice(0, s.length - delim.length).trim());
      acc = [];
    }
  }
  if (acc.join("").trim()) out.push(acc.join("\n").trim());
  return out;
}

const esquema = readFileSync("sql/schema.sql", "utf8");
function tablaDelEsquema(nombre: string): string {
  const m = esquema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${nombre} \\([\\s\\S]*?\\n\\)[^;]*;`));
  if (!m) throw new Error(`No se encontró ${nombre} en sql/schema.sql`);
  return m[0];
}
const alterDePlanes = () => [...esquema.matchAll(/ALTER TABLE tms_planes_viaje\b[\s\S]*?;/g)].map((m) => m[0]);

const INSERT_PLAN =
  "INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan, tipo_viaje, tc_vehiculo_id, vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre) VALUES (?, ?, ?, 'Propio', ?, ?, ?)";

/** Código del alta individual ANTERIOR (catch {} que regenera el código ante CUALQUIER error): es el defecto reproducido. */
async function altaIndividualLegacy(conn: PoolConnection, perfilId: number | null, tcId: number | null) {
  let codigo = await asegurarCodigoPlanUnico(EMP, FECHA, null);
  let planId = 0;
  let intentos = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      intentos++;
      const [r] = await conn.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, tcId, perfilId, perfilId == null ? null : `Perfil ${perfilId}`]);
      planId = Number(r.insertId);
      break;
    } catch {
      codigo = await asegurarCodigoPlanUnico(EMP, FECHA, null);
    }
  }
  return { planId, intentos };
}

/** Alta con el helper corregido (lo que ahora ejecutan POST /tms/planes y la copia masiva). */
const altaCorregida = (conn: PoolConnection, perfilId: number | null, tcId: number | null, codigoInicial: string) =>
  insertarPlanConCodigoUnico({
    empresaId: EMP,
    codigoInicial,
    siguienteCodigo: () => asegurarCodigoPlanUnico(EMP, FECHA, null),
    intentarInsertar: async (codigo) =>
      Number((await conn.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, tcId, perfilId, perfilId == null ? null : `Perfil ${perfilId}`]))[0].insertId),
  });

const capturar = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { code?: string; errno?: number; sqlState?: string; sqlMessage?: string });

describe.skipIf(!port)("Alta de viajes / MariaDB DESECHABLE SOLO LOCAL — error SQL real vs colisión de código", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: false });
    try {
      const [v] = await c.query<RowDataPacket[]>("SELECT VERSION() AS v");
      const version = String(v[0].v);
      expect(version).toMatch(/MariaDB/i);
      const [mayor, menor] = version.split(".").map(Number);
      const sinUca1400 = mayor * 100 + menor < 1103; // uca1400 llegó en MariaDB 11.3
      const adaptar = (s: string) => (sinUca1400 ? s.replaceAll("utf8mb4_uca1400_ai_ci", "utf8mb4_unicode_ci").replaceAll("utf8mb4_uca1400_as_cs", "utf8mb4_bin") : s);
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE ${sinUca1400 ? "utf8mb4_unicode_ci" : "utf8mb4_uca1400_ai_ci"}`);
      await c.query(`USE ${database}`);
      await c.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const t of ["empresas", "usuarios", "tms_clientes", "tms_lugares", "tms_personal", "tms_unidades", "flota_vehiculos", "tms_cotizacion_costeo_perfiles", "tms_planes_viaje"]) {
        await c.query(adaptar(tablaDelEsquema(t)));
      }
      for (const a of alterDePlanes()) await c.query(adaptar(a));
      await c.query("SET FOREIGN_KEY_CHECKS = 1");
      await c.query("INSERT INTO empresas (id, codigo, nombre, slug) VALUES (7, 'KT', 'KT', 'kt'), (8, 'OT', 'Otra', 'otra')");
      await c.query("INSERT INTO usuarios (id, username, password_hash, salt) VALUES (1, 'adm', 'x', 'x')");
      // 5 vehículos propios (ids 1..5) y 3 perfiles de costeo (ids 1..3) — ids que se SOLAPAN, como en producción (ambos autoincrementales).
      await c.query("INSERT INTO flota_vehiculos (id, empresa_id, placa) VALUES (1,7,'A-1'),(2,7,'A-2'),(3,7,'A-3'),(4,7,'A-4'),(5,7,'A-5')");
      await c.query(`INSERT INTO tms_cotizacion_costeo_perfiles (id, empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon)
                     VALUES (1,7,'P1','Perfil 1',26,10000,60000,6),(2,7,'P2','Perfil 2',26,10000,60000,6),(3,7,'P3','Perfil 3',26,10000,60000,6)`);
      // Migración REAL de fusiones (con DELIMITER): instala las guardas `ffi_*`/`ffu_*` sobre toda columna *_vehiculo_id.
      for (const s of sentencias(readFileSync("sql/migrate-2026-11-flota-fusiones.sql", "utf8"))) await c.query(s);
      // Fusión registrada: vehículo 2 (origen) → 5 (destino).
      await c.query("INSERT INTO flota_vehiculos_fusiones (origen_id, destino_id, empresa_id, administrador_id, motivo, origen_snapshot, destino_snapshot) VALUES (2, 5, 7, 1, 'prueba', '{}', '{}')");
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 24 });
  });

  afterAll(async () => {
    await holder.pool?.end();
    if (port) {
      const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
      try { await c.query(`DROP DATABASE IF EXISTS ${database}`); } finally { await c.end(); }
    }
  });

  beforeEach(async () => {
    await sql("DELETE FROM tms_planes_viaje");
    await sql("DELETE FROM tms_lugares");
  });

  describe("la causa reproducida: guarda de fusión sobre una columna que NO es un vehículo", () => {
    it("tms_planes_viaje recibe DOS triggers BEFORE INSERT; uno vigila tc_vehiculo_id (FK a flota_vehiculos) y otro vehiculo_solicitado_perfil_id (FK a PERFILES)", async () => {
      const t = await sql("SELECT TRIGGER_NAME, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'tms_planes_viaje' AND EVENT_MANIPULATION = 'INSERT' AND ACTION_TIMING = 'BEFORE'");
      expect(t.map((x) => String(x.ACTION_STATEMENT).match(/v\.id=NEW\.`([^`]+)`/)?.[1]).sort()).toEqual(["tc_vehiculo_id", "vehiculo_solicitado_perfil_id"]);
      const fk = await sql(
        "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_planes_viaje' AND COLUMN_NAME IN ('tc_vehiculo_id','vehiculo_solicitado_perfil_id') AND REFERENCED_TABLE_NAME IS NOT NULL",
      );
      const ref = Object.fromEntries(fk.map((r) => [r.COLUMN_NAME, r.REFERENCED_TABLE_NAME]));
      expect(ref.tc_vehiculo_id).toBe("flota_vehiculos");
      expect(ref.vehiculo_solicitado_perfil_id).toBe("tms_cotizacion_costeo_perfiles"); // un perfil, no un vehículo: la guarda lo busca en flota_vehiculos
    });

    it("el mismo INSERT funciona si el perfil NO coincide con un vehículo fusionado y FALLA (SQLSTATE 45000) si coincide", async () => {
      const ok = await holder.pool!.execute<ResultSetHeader>(INSERT_PLAN, [EMP, "PLAN-20261113-001", FECHA, 4, 3, "Perfil 3"]);
      expect(Number(ok[0].insertId)).toBeGreaterThan(0);
      const err = await capturar(holder.pool!.execute(INSERT_PLAN, [EMP, "PLAN-20261113-002", FECHA, 4, 2, "Perfil 2"]));
      expect(err).toMatchObject({ code: "ER_SIGNAL_EXCEPTION", errno: 1644, sqlState: "45000", sqlMessage: "Seleccione la unidad principal: ID fusionado" });
    });

    it("la guarda LEGÍTIMA del TC fusionado sigue protegiendo (no se toca): tc_vehiculo_id = 2 se rechaza, = 4 se acepta", async () => {
      expect(await capturar(holder.pool!.execute(INSERT_PLAN, [EMP, "PLAN-20261113-003", FECHA, 2, 3, "Perfil 3"]))).toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
      expect(await capturar(holder.pool!.execute(INSERT_PLAN, [EMP, "PLAN-20261113-004", FECHA, 4, 3, "Perfil 3"]))).toBeNull();
    });
  });

  describe("REPRODUCCIÓN 1 — alta individual", () => {
    it("ANTES: el catch {} agota 5 intentos y el usuario ve «código de plan único» aunque el error real es la guarda; DESPUÉS: se propaga el error verdadero", async () => {
      const conn = await holder.pool!.getConnection();
      try {
        await conn.beginTransaction();
        const antes = await altaIndividualLegacy(conn, 2, null);
        expect(antes).toEqual({ planId: 0, intentos: 5 }); // → la ruta respondía 409 «No se pudo generar un código de plan único»
        await conn.rollback();

        await conn.beginTransaction();
        let intentos = 0;
        const error = await capturar(
          insertarPlanConCodigoUnico({
            empresaId: EMP,
            codigoInicial: "PLAN-20261113-001",
            siguienteCodigo: () => asegurarCodigoPlanUnico(EMP, FECHA, null),
            intentarInsertar: async (codigo) => {
              intentos++;
              return Number((await conn.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, null, 2, "Perfil 2"]))[0].insertId);
            },
          }),
        );
        expect(error).toMatchObject({ code: "ER_SIGNAL_EXCEPTION", errno: 1644, sqlState: "45000" });
        expect(error).not.toBeInstanceOf(CodigoPlanAgotadoError);
        expect(intentos).toBe(1); // no reintenta
        await conn.rollback();
      } finally {
        conn.release();
      }
      expect(await conteo("tms_planes_viaje")).toBe(0);
    });

    it("el rollback conserva la atomicidad: una escritura previa de la MISMA transacción (el lugar) también se revierte", async () => {
      const conn = await holder.pool!.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute("INSERT INTO tms_lugares (empresa_id, nombre) VALUES (?, ?)", [EMP, "Bodega Central"]);
        const error = await capturar(altaCorregida(conn, 2, null, "PLAN-20261113-001"));
        expect(error).toMatchObject({ code: "ER_SIGNAL_EXCEPTION" });
        await conn.rollback();
      } finally {
        conn.release();
      }
      expect(await conteo("tms_lugares")).toBe(0);
      expect(await conteo("tms_planes_viaje")).toBe(0);
    });
  });

  describe("REPRODUCCIÓN 2 — copia masiva (mismo INSERT, misma guarda; todo o nada)", () => {
    it("lote de 3 filas donde la 3.ª usa el perfil que colisiona: la transacción se revierte COMPLETA y el error identifica la causa", async () => {
      const conn = await holder.pool!.getConnection();
      const perfiles = [3, 1, 2]; // la fila 3 usa el perfil 2 (= id del vehículo fusionado)
      let filaFallida = 0;
      let error: unknown = null;
      try {
        await conn.beginTransaction();
        for (let i = 0; i < perfiles.length; i++) {
          const codigoInicial = await asegurarCodigoPlanUnicoTx(conn, EMP, FECHA, null);
          try {
            await insertarPlanConCodigoUnico({
              empresaId: EMP,
              codigoInicial,
              siguienteCodigo: () => asegurarCodigoPlanUnicoTx(conn, EMP, FECHA, null),
              intentarInsertar: async (codigo) =>
                Number((await conn.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, 4, perfiles[i], `Perfil ${perfiles[i]}`]))[0].insertId),
            });
          } catch (e) {
            filaFallida = i + 1;
            error = e;
            throw e;
          }
        }
        await conn.commit();
      } catch {
        await conn.rollback();
      } finally {
        conn.release();
      }
      expect(filaFallida).toBe(3);
      expect(error).toMatchObject({ code: "ER_SIGNAL_EXCEPTION", errno: 1644, sqlMessage: "Seleccione la unidad principal: ID fusionado" });
      expect(await conteo("tms_planes_viaje")).toBe(0); // ni las filas 1 y 2
    });

    it("el mismo lote sin la fila conflictiva se confirma completo, con códigos consecutivos", async () => {
      const conn = await holder.pool!.getConnection();
      try {
        await conn.beginTransaction();
        const codigos: string[] = [];
        for (const perfil of [3, 1, 3]) {
          const r = await insertarPlanConCodigoUnico({
            empresaId: EMP,
            codigoInicial: await asegurarCodigoPlanUnicoTx(conn, EMP, FECHA, null),
            siguienteCodigo: () => asegurarCodigoPlanUnicoTx(conn, EMP, FECHA, null),
            intentarInsertar: async (codigo) =>
              Number((await conn.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, 4, perfil, `Perfil ${perfil}`]))[0].insertId),
          });
          codigos.push(r.codigo);
        }
        await conn.commit();
        expect(codigos).toEqual(["PLAN-20261113-001", "PLAN-20261113-002", "PLAN-20261113-003"]);
      } finally {
        conn.release();
      }
      expect(await conteo("tms_planes_viaje")).toBe(3);
    });
  });

  describe("errores REALES de MariaDB distintos de una colisión de código: se propagan sin reintentar", () => {
    const intentos = async (columnasSql: string, params: unknown[]) => {
      const conn = await holder.pool!.getConnection();
      let n = 0;
      try {
        await conn.beginTransaction();
        const error = await capturar(
          insertarPlanConCodigoUnico({
            empresaId: EMP,
            codigoInicial: "PLAN-20261113-001",
            siguienteCodigo: () => asegurarCodigoPlanUnico(EMP, FECHA, null),
            intentarInsertar: async () => { n++; return Number((await conn.execute<ResultSetHeader>(columnasSql, params as never))[0].insertId); },
          }),
        );
        await conn.rollback();
        return { error, n };
      } finally {
        conn.release();
      }
    };

    it("columna inexistente (esquema de producción desactualizado) -> ER_BAD_FIELD_ERROR", async () => {
      const r = await intentos("INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan, columna_que_no_existe) VALUES (?, ?, ?, 1)", [EMP, "PLAN-X-001", FECHA]);
      expect(r.error).toMatchObject({ code: "ER_BAD_FIELD_ERROR", errno: 1054 });
      expect(r.n).toBe(1);
    });
    it("FK de perfil inexistente -> ER_NO_REFERENCED_ROW_2", async () => {
      const r = await intentos(INSERT_PLAN, [EMP, "PLAN-X-002", FECHA, null, 99, "Perfil 99"]);
      expect(r.error).toMatchObject({ code: "ER_NO_REFERENCED_ROW_2", errno: 1452 });
      expect(r.n).toBe(1);
    });
    it("dato demasiado largo en modo estricto -> ER_DATA_TOO_LONG", async () => {
      const r = await intentos("INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan) VALUES (?, ?, ?)", [EMP, "P".repeat(81), FECHA]);
      expect(r.error).toMatchObject({ code: "ER_DATA_TOO_LONG", errno: 1406 });
      expect(r.n).toBe(1);
    });
    it("duplicado de PRIMARY (id explícito): es ER_DUP_ENTRY pero NO es el índice del código -> no se reintenta", async () => {
      await holder.pool!.execute("INSERT INTO tms_planes_viaje (id, empresa_id, codigo, fecha_plan) VALUES (900, 7, 'PLAN-A-900', ?)", [FECHA]);
      const r = await intentos("INSERT INTO tms_planes_viaje (id, empresa_id, codigo, fecha_plan) VALUES (900, ?, ?, ?)", [EMP, "PLAN-X-003", FECHA]);
      expect(r.error).toMatchObject({ code: "ER_DUP_ENTRY", errno: 1062 });
      expect(esColisionIndiceCodigoPlan(r.error, { empresaId: EMP, codigo: "PLAN-X-003" })).toBe(false);
      expect(r.n).toBe(1);
    });
  });

  describe("colisión REAL del UNIQUE (empresa_id, codigo) y concurrencia", () => {
    it("el mensaje REAL de MariaDB se reconoce como colisión del índice uq_plan", async () => {
      await holder.pool!.execute("INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan) VALUES (7, 'PLAN-20261113-005', ?)", [FECHA]);
      const err = await capturar(holder.pool!.execute("INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan) VALUES (7, 'PLAN-20261113-005', ?)", [FECHA]));
      expect(err).toMatchObject({ code: "ER_DUP_ENTRY", errno: 1062 });
      expect(String((err as { sqlMessage: string }).sqlMessage)).toContain("'uq_plan'");
      expect(esColisionIndiceCodigoPlan(err)).toBe(true);
      // misma clave pero de OTRA empresa: no hay colisión (índice compuesto)
      expect(await capturar(holder.pool!.execute("INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan) VALUES (8, 'PLAN-20261113-005', ?)", [FECHA]))).toBeNull();
    });

    it("dos transacciones con el mismo código: la 2.ª espera, choca al confirmar la 1.ª, y reintenta con el siguiente", async () => {
      const a = await holder.pool!.getConnection();
      const b = await holder.pool!.getConnection();
      try {
        await a.beginTransaction();
        await b.beginTransaction();
        await a.execute(INSERT_PLAN, [EMP, "PLAN-20261113-001", FECHA, null, 3, "Perfil 3"]); // sin confirmar: retiene el índice
        const pendiente = altaCorregida(b, 3, null, "PLAN-20261113-001"); // choca cuando A confirme
        await new Promise((r) => setTimeout(r, 150));
        await a.commit();
        const r = await pendiente;
        await b.commit();
        expect(r.codigo).toBe("PLAN-20261113-002");
        expect(await conteo("tms_planes_viaje")).toBe(2);
      } finally {
        await a.rollback().catch(() => undefined);
        await b.rollback().catch(() => undefined);
        a.release();
        b.release();
      }
    });

    it("5 altas SIMULTÁNEAS del mismo día (= el máximo de intentos) terminan todas bien, con códigos distintos y sin agotar reintentos", async () => {
      const N = 5; // cada ronda de colisión deja pasar a una: N <= MAX_INTENTOS_CODIGO_PLAN
      const conns = await Promise.all(Array.from({ length: N }, () => holder.pool!.getConnection()));
      try {
        await Promise.all(conns.map((c) => c.beginTransaction()));
        const iniciales = await Promise.all(conns.map((c) => asegurarCodigoPlanUnicoTx(c, EMP, FECHA, null))); // todas proponen el MISMO código
        expect(new Set(iniciales).size).toBe(1);
        const resultados = await Promise.all(
          conns.map(async (c) => {
            const r = await insertarPlanConCodigoUnico({
              empresaId: EMP,
              codigoInicial: iniciales[0],
              siguienteCodigo: () => asegurarCodigoPlanUnico(EMP, FECHA, null),
              intentarInsertar: async (codigo) =>
                Number((await c.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, null, 3, "Perfil 3"]))[0].insertId),
            });
            await c.commit(); // cada alta confirma al terminar, liberando el índice a las demás
            return r;
          }),
        );
        const codigos = resultados.map((r) => r.codigo);
        expect(new Set(codigos).size).toBe(N);
        expect(await conteo("tms_planes_viaje")).toBe(N);
      } finally {
        await Promise.all(conns.map((c) => c.rollback().catch(() => undefined))); // libera cualquier bloqueo si la prueba falló
        conns.forEach((c) => c.release());
      }
    });

    it("snapshot REPEATABLE READ: una transacción que no ve el código que otra confirmó igual avanza (progreso garantizado)", async () => {
      const a = await holder.pool!.getConnection();
      try {
        await a.beginTransaction();
        await a.query("SELECT COUNT(*) FROM tms_planes_viaje"); // fija el snapshot de A
        await holder.pool!.execute(INSERT_PLAN, [EMP, "PLAN-20261113-001", FECHA, null, 3, "Perfil 3"]); // otra sesión confirma el 001
        const ciega = await asegurarCodigoPlanUnicoTx(a, EMP, FECHA, null);
        expect(ciega).toBe("PLAN-20261113-001"); // A no lo ve: propondría el mismo código siempre
        const r = await insertarPlanConCodigoUnico({
          empresaId: EMP,
          codigoInicial: ciega,
          siguienteCodigo: () => asegurarCodigoPlanUnicoTx(a, EMP, FECHA, null), // sigue ciega
          intentarInsertar: async (codigo) => Number((await a.execute<ResultSetHeader>(INSERT_PLAN, [EMP, codigo, FECHA, null, 3, "Perfil 3"]))[0].insertId),
        });
        await a.commit();
        expect(r.codigo).toBe("PLAN-20261113-002");
      } finally {
        a.release();
      }
    });
  });

  describe("CAUSA RAÍZ — upsert de tms_unidades con las guardas de fusión: insertId = 0 -> fk_tmsplan_uni", () => {
    const UPSERT = `INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id) VALUES (?, ?, 'Camion', ?)
                    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), flota_vehiculo_id = COALESCE(flota_vehiculo_id, VALUES(flota_vehiculo_id))`;
    const buscar = (placa: string) => async () => {
      const f = await sql("SELECT id FROM tms_unidades WHERE empresa_id = ? AND placa = ? LIMIT 1", [EMP, placa]);
      return f[0] ? Number(f[0].id) : null;
    };
    const INSERT_CON_UNIDAD = "INSERT INTO tms_planes_viaje (empresa_id, codigo, fecha_plan, unidad_id) VALUES (?, ?, ?, ?)";

    it("las guardas de fusión están instaladas en tms_unidades (BEFORE INSERT y BEFORE UPDATE)", async () => {
      const t = await sql("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'tms_unidades'");
      expect(t.map((x) => String(x.TRIGGER_NAME).slice(0, 4)).sort()).toEqual(["ffi_", "ffu_"]);
    });

    it("REPRODUCCIÓN: unidad ya existente sin cambios -> insertId 0; con ese 0 el viaje falla con ER_NO_REFERENCED_ROW_2 sobre fk_tmsplan_uni", async () => {
      await holder.pool!.execute(UPSERT, [EMP, "C-111AAA", 4]);
      const repetido = (await holder.pool!.execute<ResultSetHeader>(UPSERT, [EMP, "C-111AAA", 4]))[0];
      expect(Number(repetido.insertId)).toBe(0); // el valor que el código anterior usaba como unidad_id
      const err = await capturar(holder.pool!.execute(INSERT_CON_UNIDAD, [EMP, "PLAN-20261113-001", FECHA, Number(repetido.insertId)]));
      expect(err).toMatchObject({ code: "ER_NO_REFERENCED_ROW_2", errno: 1452 });
      expect(String((err as { sqlMessage: string }).sqlMessage)).toContain("`fk_tmsplan_uni`");
    });

    it.each([
      ["inserción nueva", async () => undefined, "C-300CCC"],
      ["unidad existente sin cambios (insertId 0)", async () => { await holder.pool!.execute(UPSERT, [EMP, "C-301CCC", 4]); }, "C-301CCC"],
      ["unidad existente sin vínculo que se completa", async () => { await holder.pool!.execute("INSERT INTO tms_unidades (empresa_id, placa, tipo) VALUES (?, ?, 'Camion')", [EMP, "C-302CCC"]); }, "C-302CCC"],
    ])("CORRECCIÓN idUnidadTrasUpsert — %s: el id resuelto existe y el viaje se crea", async (_n, preparar, placa) => {
      await preparar();
      const r = (await holder.pool!.execute<ResultSetHeader>(UPSERT, [EMP, placa, 4]))[0];
      const unidadId = await idUnidadTrasUpsert(r.insertId, buscar(placa));
      const real = await sql("SELECT id FROM tms_unidades WHERE empresa_id = ? AND placa = ?", [EMP, placa]);
      expect(unidadId).toBe(Number(real[0].id));
      const ok = await holder.pool!.execute<ResultSetHeader>(INSERT_CON_UNIDAD, [EMP, `PLAN-${placa}`, FECHA, unidadId]);
      expect(Number(ok[0].insertId)).toBeGreaterThan(0);
    });
  });

  describe("el SQL de diagnóstico para Hostinger detecta la causa en esta BD", () => {
    it("corre completo sin errores; el bloque 5 señala la guarda sobre el perfil y el 7 el perfil que colisiona", async () => {
      const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database });
      try {
        const resultados: { sentencia: string; filas: unknown[] }[] = [];
        for (const s of sentencias(readFileSync("sql/diagnostico-2026-11-tms-planes-creacion-bloqueada.sql", "utf8"))) {
          const [filas] = await c.query(s);
          resultados.push({ sentencia: s, filas: Array.isArray(filas) ? filas : [] });
        }
        const de = (parte: string) => resultados.find((r) => r.sentencia.includes(parte))!.filas as RowDataPacket[];
        expect(Number(de("columnas_presentes_de_39")[0].columnas_presentes_de_39)).toBe(39);
        const ajenas = de("columna_vigilada").filter((f) => f.referencia_fk && f.referencia_fk !== "flota_vehiculos");
        expect(ajenas.map((f) => [f.tabla, f.columna_vigilada, f.referencia_fk])).toEqual([["tms_planes_viaje", "vehiculo_solicitado_perfil_id", "tms_cotizacion_costeo_perfiles"]]);
        expect(de("id_vehiculo_fusionado")[0]).toMatchObject({ id_vehiculo_fusionado: 2, perfil_id: 2 });
        expect(de("tablas_cb2")[0].tablas_cb2).toBe(0);
      } finally {
        await c.end();
      }
    });
  });
});
