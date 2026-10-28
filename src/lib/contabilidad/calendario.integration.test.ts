/** Solo runner C3C-1 por pipe verificado; las nuevas aserciones esperan validación real autorizada. */
import fs from "node:fs";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const lab = vi.hoisted(() => ({ pool: undefined as unknown as Pick<Pool, "getConnection"> }));
vi.mock("@/lib/db", () => ({
  getPool: () => { if (!lab.pool) throw Error("Pool normal prohibido"); return lab.pool; },
  query: () => { throw Error("Query global prohibida"); }, execute: () => { throw Error("Execute global prohibido"); },
}));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("Prohibido cargar archivos de entorno"); } }));
import { crearPoolLaboratorio, leerManifiesto, controles } from "../../../scripts/ci/c3c1/connection.mjs";
import { crearEjercicioConPeriodos } from "./calendario";
import { clasificarErrorCalendario, ErrorCalendario } from "./calendario-errores";

const manifest = process.env.C3C1_MANIFEST;
let pool: ReturnType<typeof crearPoolLaboratorio>;
const actor = { entidadId: 9, usuarioId: 4, admin: false };
const entrada = (codigo: string, year: number) => ({ codigo, fechaInicio: `${year}-01-01`, fechaFin: `${year}-12-31`, periodos: [
  { codigo: "A", fechaInicio: `${year}-01-01`, fechaFin: `${year}-06-30` },
  { codigo: "B", fechaInicio: `${year}-07-01`, fechaFin: `${year}-12-31` },
] });
async function conteos() {
  const c = await pool.getConnection();
  try {
    const [rows] = await c.query("SELECT (SELECT COUNT(*) FROM cont_ejercicios) AS ejercicios, (SELECT COUNT(*) FROM cont_periodos) AS periodos, (SELECT COUNT(*) FROM auditoria) AS auditoria");
    return rows;
  } finally { c.release(); }
}

async function concurrencia(caso: string, inputs: ReturnType<typeof entrada>[]) {
  const conexiones = [await pool.getConnection()];
  try { conexiones.push(await pool.getConnection()); }
  catch (e) { conexiones[0].release(); throw e; }
  const ids: number[] = [];
  try {
  for (const c of conexiones) {
    const [r] = await c.query<RowDataPacket[]>("SELECT CONNECTION_ID() AS id, @@tx_isolation AS aislamiento, @@innodb_snapshot_isolation AS snapshot");
    ids.push(Number(r[0].id));
    console.info(JSON.stringify({ evento: "conexion", caso, fecha: new Date().toISOString(), ...r[0] }));
  }
  expect(new Set(ids).size).toBe(2);
  } catch (e) { conexiones.forEach((c) => c.release()); throw e; }
  let siguiente = 0;
  lab.pool = { getConnection: async () => {
    const index = siguiente++;
    if (!conexiones[index]) throw Error("Conexión adicional inesperada");
    const c = conexiones[index];
    return new Proxy(c, { get(t, k) {
      if (["query", "execute", "beginTransaction", "commit", "rollback"].includes(String(k))) {
        const metodo = t[k as "query"] as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          const operacion = { caso, conexion: ids[index], metodo: String(k),
            sentencia: typeof args[0] === "string" ? args[0] : undefined };
          console.info(JSON.stringify({ evento: "inicio", fecha: new Date().toISOString(), ...operacion }));
          try { return await metodo.apply(t, args); }
          catch (e) {
            console.info(JSON.stringify({ evento: "error_sql", fecha: new Date().toISOString(), ...operacion, ...clasificarErrorCalendario(e) }));
            throw e;
          }
        };
      }
      const v = t[k as keyof typeof t]; return typeof v === "function" ? v.bind(t) : v;
    } });
  } } as unknown as Pick<Pool, "getConnection">;
  let resultados: PromiseSettledResult<{ id: number }>[];
  try { resultados = await Promise.allSettled(inputs.map((input) => crearEjercicioConPeriodos(7, "actor_ficticio", actor, input))); }
  finally { lab.pool = pool as unknown as Pick<Pool, "getConnection">; }
  console.info(JSON.stringify({ evento: "resultados", caso, fecha: new Date().toISOString(), resultados: resultados.map((r) =>
    r.status === "fulfilled" ? { estado: r.status, id: r.value.id } : { estado: r.status,
      mensajeServicio: r.reason instanceof ErrorCalendario ? r.reason.message : undefined,
      ...clasificarErrorCalendario(r.reason) }) }));
  const c = await pool.getConnection();
  try {
    const [ejercicios] = await c.query<RowDataPacket[]>("SELECT id,codigo FROM cont_ejercicios WHERE empresa_id=7 AND entidad_id=9 AND codigo IN (?,?)", inputs.map((i) => i.codigo));
    expect(ejercicios).toHaveLength(1);
    const id = ejercicios[0].id;
    const [periodos] = await c.query<RowDataPacket[]>("SELECT orden FROM cont_periodos WHERE empresa_id=7 AND entidad_id=9 AND ejercicio_id=? ORDER BY orden", [id]);
    expect(periodos).toMatchObject([{ orden: 1 }, { orden: 2 }]); expect(periodos).toHaveLength(2);
    const [auditoria] = await c.query<RowDataPacket[]>("SELECT empresa_id,detalle FROM auditoria WHERE accion='calendario_crear' AND modulo='contabilidad'");
    const delCaso = auditoria.filter((a) => inputs.some((i) => i.codigo === JSON.parse(a.detalle).codigo));
    expect(delCaso).toHaveLength(1);
    expect(delCaso[0].empresa_id).toBe(7);
    expect(JSON.parse(delCaso[0].detalle)).toMatchObject({ ejercicioId: id, entidadId: 9, actorId: 4, codigo: ejercicios[0].codigo, periodos: inputs.find((i) => i.codigo === ejercicios[0].codigo)!.periodos });
    for (const a of auditoria) {
      const d = JSON.parse(a.detalle);
      const [padre] = await c.query<RowDataPacket[]>("SELECT id FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=? AND id=? AND codigo=?", [a.empresa_id, d.entidadId, d.ejercicioId, d.codigo]);
      expect(padre).toHaveLength(1);
    }
    // Incluye huérfanos, solapamientos, cobertura, consecutividad y estructura.
    await controles(c, fs.readFileSync("sql/postcheck-2026-10-contabilidad-calendario-c3c1.sql", "utf8"));
  } finally { c.release(); }
  expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rechazos = resultados.filter((r) => r.status === "rejected");
  expect(rechazos).toHaveLength(1);
  const error = (rechazos[0] as PromiseRejectedResult).reason;
  expect(error).toBeInstanceOf(ErrorCalendario);
  expect(clasificarErrorCalendario(error).tipo).toBe("funcional");
  expect(error.status).toBe(409); expect(error.message).toContain("solapan");
}

describe.skipIf(!manifest)("C3C-1 / InnoDB real desechable: requiere runner autorizado", () => {
  beforeAll(async () => {
    // Si alguien configura DB_* se rechaza, incluso aunque el pipe fuera correcto.
    if (Object.keys(process.env).some((k) => k.startsWith("DB_"))) throw Error("Entorno DB_* prohibido");
    pool = crearPoolLaboratorio(leerManifiesto(manifest!)); lab.pool = pool as unknown as Pick<Pool, "getConnection">;
  });
  afterAll(async () => { if (pool) await pool.end(); });
  it("confirma ejercicio, períodos y auditoría reales en una transacción", async () => {
    const r = await crearEjercicioConPeriodos(7, "actor_ficticio", actor, entrada("REAL", 2030));
    const c = await pool.getConnection();
    try {
      const [p] = await c.query("SELECT orden, estado FROM cont_periodos WHERE empresa_id=7 AND entidad_id=9 AND ejercicio_id=? ORDER BY orden", [r.id]);
      expect(p).toMatchObject([{ orden: 1, estado: "CONFIGURADO" }, { orden: 2, estado: "CONFIGURADO" }]);
      const [a] = await c.query<RowDataPacket[]>("SELECT detalle FROM auditoria WHERE accion='calendario_crear'");
      expect(a).toHaveLength(1);
      expect(JSON.parse(a[0].detalle)).toMatchObject({ ejercicioId: r.id, entidadId: 9, actorId: 4 });
    } finally { c.release(); }
  });
  it("concurrencia C3C-1: dos conexiones con ejercicios solapados y rechazo funcional", async () => {
    await concurrencia("solape", [entrada("CARRERA-A", 2031), entrada("CARRERA-B", 2031)]);
  });
  it("concurrencia C3C-1: duplicados y códigos repetidos con rechazo funcional", async () => {
    await concurrencia("duplicado", [entrada("DUP", 2035), entrada("DUP", 2035)]);
    await expect(crearEjercicioConPeriodos(7, "actor_ficticio", actor, entrada("DUP", 2036))).rejects.toBeInstanceOf(ErrorCalendario);
    await crearEjercicioConPeriodos(7, "actor_ficticio", actor, entrada("ADYACENTE", 2036));
  });
  it("fallo SQL real de auditoría revierte cabecera y todos los períodos", async () => {
    const antes = await conteos();
    await expect(crearEjercicioConPeriodos(7, "X".repeat(101), actor, entrada("AUD-ROLLBACK", 2032))).rejects.toThrow();
    expect(await conteos()).toEqual(antes);
  });
  it("fallo SQL real en segundo período revierte también el primero", async () => {
    const antes = await conteos();
    // Inyección de fallo sobre la conexión segura: el segundo código excede VARCHAR(40).
    // Es el servidor, en modo estricto, quien rechaza el INSERT tras escrituras reales previas.
    lab.pool = { getConnection: async () => {
      const c = await pool.getConnection(); let periodos = 0;
      return new Proxy(c, { get(t, k) {
        if (k === "execute") return async (sql: string, params: (string | number | null)[]) => {
          if (sql.startsWith("INSERT INTO cont_periodos") && ++periodos === 2) return t.execute(sql, params.map((v, i) => i === 3 ? "X".repeat(41) : v));
          return t.execute(sql, params);
        };
        const v = t[k as keyof typeof t]; return typeof v === "function" ? v.bind(t) : v;
      } });
    } } as unknown as Pick<Pool, "getConnection">;
    try { await expect(crearEjercicioConPeriodos(7, "actor_ficticio", actor, entrada("PER-ROLLBACK", 2033))).rejects.toThrow(); }
    finally { lab.pool = pool as unknown as Pick<Pool, "getConnection">; }
    expect(await conteos()).toEqual(antes);
  });
  it("misma clave/rango en libros y empresas distintos no se mezclan", async () => {
    await crearEjercicioConPeriodos(7, "actor_ficticio", { ...actor, entidadId: 10 }, entrada("REAL", 2030));
    await crearEjercicioConPeriodos(8, "actor_ficticio", { ...actor, entidadId: 11 }, entrada("REAL", 2030));
    await expect(crearEjercicioConPeriodos(7, "actor_ficticio", { ...actor, entidadId: 11 }, entrada("AJENO", 2034))).rejects.toThrow();
  });
  it("FK compuesta y CHECK se aplican realmente; postcheck debe aprobar todo", async () => {
    const c = await pool.getConnection();
    try {
      await expect(c.query("INSERT INTO cont_periodos (empresa_id,entidad_id,ejercicio_id,codigo,orden,fecha_inicio,fecha_fin,estado,creado_por) SELECT 8,11,id,'CRUZADO',3,'2030-01-01','2030-01-02','CONFIGURADO',4 FROM cont_ejercicios WHERE empresa_id=7 AND entidad_id=9 AND codigo='REAL'")).rejects.toThrow();
      for (const [tabla, cambio] of [
        ["cont_ejercicios", "estado='ABIERTO'"], ["cont_ejercicios", "fecha_fin='2029-12-31'"],
        ["cont_ejercicios", "codigo='@'"], ["cont_periodos", "estado='ABIERTO'"],
        ["cont_periodos", "fecha_fin='2029-12-31'"], ["cont_periodos", "codigo='@'"], ["cont_periodos", "orden=0"],
      ]) await expect(c.query(`UPDATE ${tabla} SET ${cambio} WHERE empresa_id=7 AND entidad_id=9 LIMIT 1`)).rejects.toThrow();
      await controles(c, fs.readFileSync("sql/postcheck-2026-10-contabilidad-calendario-c3c1.sql", "utf8"));
    } finally { c.release(); }
  });
});
