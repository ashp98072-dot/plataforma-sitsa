import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

const db = vi.hoisted(() => ({ getConnection: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: db.getConnection }), query: db.query }));
vi.mock("./dates", async (original) => ({ ...await original<typeof import("./dates")>(), hoyLocal: () => "2026-10-12" }));
import { candidatosVacaciones, fingerprintVacaciones, invalidarVacacionesEmpresaEnConexion, marcarVacacionesDirty,
  necesitaSync, sincronizarCandidatoVacaciones, SQL_CANDIDATOS, SQL_DIRTY, SQL_LIMPIAR, type EstadoSync } from "./vacaciones-sync-estado";
import { POLITICA_NORMAL, POLITICA_CARGA_HISTORICA } from "./vacaciones-politica";
import { sincronizarVacacionesEmpleadosActivos } from "./vacaciones";

type Fila = EstadoSync & { fecha_alta: string };
const filas = new Map<string, Fila>();
const locks = new Set<string>();
const empleados: { empresa: number; id: number }[] = [];
let historico = false;
const fp = () => fingerprintVacaciones(historico ? POLITICA_CARGA_HISTORICA : POLITICA_NORMAL);
const inicial = (): Fila => ({ dirty: 1, generacion: "0", ultima_sync_fecha: null, politica_fingerprint: null, fecha_alta_sync: null, fecha_alta: "2020-01-01" });
function conexion() {
  const owned = new Set<string>();
  let cerrada = false;
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    destroy: vi.fn(() => { cerrada = true; for (const key of owned) locks.delete(key); owned.clear(); }),
    query: vi.fn(async (sql: string, p: unknown[] = []) => {
      if (cerrada) throw new Error("conexión cerrada");
      if (sql.includes("GET_LOCK")) {
        const key = String(p[0]);
        if (locks.has(key)) return [[{ adquirido: 0 }]];
        locks.add(key); owned.add(key); return [[{ adquirido: 1 }]];
      }
      if (sql.includes("RELEASE_LOCK")) { locks.delete(String(p[0])); owned.delete(String(p[0])); return [[{ liberado: 1 }]]; }
      if (sql.includes("SELECT valor FROM configuracion")) return [[{ valor: historico ? "1" : "0" }]];
      if (sql.includes("SELECT s.*")) { const f = filas.get(`${p[0]}:${p[1]}`); return [f ? [{ ...f }] : []]; }
      if (sql.includes("SELECT fecha_alta")) return [[{ fecha_alta: "2020-01-01" }]];
      return [[]];
    }),
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      let affectedRows = 1;
      if (sql.includes("INSERT IGNORE INTO rrhh_vacaciones_sync_estado")) {
        const key = `${p[0]}:${p[1]}`; if (!filas.has(key)) filas.set(key, inicial());
      } else if (sql === SQL_DIRTY) {
        const key = `${p[0]}:${p[1]}`; const f = filas.get(key) ?? inicial();
        f.generacion = String(BigInt(f.generacion) + BigInt(1)); f.dirty = 1; filas.set(key, f);
      } else if (sql === SQL_LIMPIAR) {
        const f = filas.get(`${p[3]}:${p[4]}`);
        if (f && f.generacion === p[5]) Object.assign(f, { dirty: 0, ultima_sync_fecha: p[0], politica_fingerprint: p[1], fecha_alta_sync: p[2] });
        else affectedRows = 0;
      } else if (sql.includes("UPDATE rrhh_vacaciones_sync_estado")) {
        for (const [key, f] of filas) if (key.startsWith(`${p[0]}:`)) { f.dirty = 1; f.generacion = String(BigInt(f.generacion) + BigInt(1)); }
      }
      return [{ affectedRows, insertId: 1 }];
    }),
  };
  return conn;
}
const asConn = (c: ReturnType<typeof conexion>) => c as unknown as PoolConnection;
const limpio = (): Fila => ({ ...inicial(), dirty: 0, ultima_sync_fecha: "2026-10-12", politica_fingerprint: fp(), fecha_alta_sync: "2020-01-01" });
beforeEach(() => {
  filas.clear(); locks.clear(); empleados.length = 0; historico = false; vi.clearAllMocks();
  db.getConnection.mockImplementation(async () => conexion());
  db.query.mockImplementation(async (sql: string, p: unknown[]) => {
    if (sql.includes("SELECT valor FROM configuracion")) return [{ valor: historico ? "1" : "0" }];
    if (sql === SQL_CANDIDATOS) return empleados.filter((e) => e.empresa === p[0] && (!filas.has(`${e.empresa}:${e.id}`)
      || necesitaSync(filas.get(`${e.empresa}:${e.id}`)!, String(p[1]), String(p[2]), "2020-01-01"))).map((e) => ({ id: e.id }));
    throw new Error(`Consulta no soportada: ${sql}`);
  });
});

describe("índice persistente de frescura", () => {
  it("nunca sincronizado ejecuta el motor y queda fresco", async () => {
    const motor = vi.fn(); await sincronizarCandidatoVacaciones(1, 1, motor);
    expect(motor).toHaveBeenCalledTimes(1); expect(filas.get("1:1")).toMatchObject({ dirty: 0, ultima_sync_fecha: "2026-10-12", politica_fingerprint: fp() });
  });
  it("limpio hoy no ejecuta el motor", async () => {
    filas.set("1:1", limpio()); const motor = vi.fn(); expect(await sincronizarCandidatoVacaciones(1, 1, motor)).toBe(false); expect(motor).not.toHaveBeenCalled();
  });
  it.each(["dirty", "día anterior", "política", "fecha alta"])("%s vuelve elegible", async (caso) => {
    const s = limpio(); if (caso === "dirty") s.dirty = 1;
    if (caso === "día anterior") s.ultima_sync_fecha = "2026-10-11";
    if (caso === "política") historico = true;
    if (caso === "fecha alta") s.fecha_alta_sync = "2019-01-01";
    filas.set("1:1", s); const motor = vi.fn(); await sincronizarCandidatoVacaciones(1, 1, motor); expect(motor).toHaveBeenCalledTimes(1);
  });
  it("error no marca actualizado y libera el lock para recuperar", async () => {
    await expect(sincronizarCandidatoVacaciones(1, 1, async () => { throw new Error("fallo"); })).rejects.toThrow("fallo");
    expect(filas.get("1:1")).toMatchObject({ dirty: 1, ultima_sync_fecha: null }); expect(locks.size).toBe(0);
    expect(await sincronizarCandidatoVacaciones(1, 1, vi.fn())).toBe(true);
  });
  it("cierre de conexión de worker libera claim y permite recuperar sin falsa frescura", async () => {
    await expect(sincronizarCandidatoVacaciones(1, 1, async (conn) => {
      conn.destroy(); throw new Error("worker desconectado");
    })).rejects.toThrow("worker desconectado");
    expect(locks.size).toBe(0);
    expect(filas.get("1:1")).toMatchObject({ dirty: 1, ultima_sync_fecha: null });
    expect(await sincronizarCandidatoVacaciones(1, 1, vi.fn())).toBe(true);
  });
  it("si liberar claim falla destruye la conexión y no la devuelve al pool", async () => {
    const conn = conexion(); const consulta = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (sql, p) => {
      if (sql.includes("RELEASE_LOCK")) throw new Error("liberación fallida");
      return consulta(sql, p);
    });
    db.getConnection.mockResolvedValueOnce(conn);
    expect(await sincronizarCandidatoVacaciones(1, 1, vi.fn())).toBe(true);
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled(); expect(locks.size).toBe(0);
  });
  it.each([1, 2])("%i invalidaciones durante el motor sobreviven al CAS", async (cantidad) => {
    const otra = asConn(conexion());
    await sincronizarCandidatoVacaciones(1, 1, async () => { for (let i = 0; i < cantidad; i++) await marcarVacacionesDirty(otra, 1, 1); });
    expect(filas.get("1:1")).toMatchObject({ dirty: 1, generacion: String(cantidad), ultima_sync_fecha: null });
  });
  it("generaciones BIGINT no pierden precisión", async () => {
    filas.set("1:1", { ...inicial(), generacion: "9007199254740993" });
    await sincronizarCandidatoVacaciones(1, 1, async () => { await marcarVacacionesDirty(asConn(conexion()), 1, 1); });
    expect(filas.get("1:1")).toMatchObject({ dirty: 1, generacion: "9007199254740994" });
  });
  it("dos workers solo uno ejecuta; el segundo revalida frescura después", async () => {
    let continuar!: () => void; const pendiente = new Promise<void>((r) => { continuar = r; });
    let started!: () => void; const inicio = new Promise<void>((r) => { started = r; });
    const motor = vi.fn(async () => { started(); await pendiente; });
    const primero = sincronizarCandidatoVacaciones(1, 1, motor); await inicio;
    expect(await sincronizarCandidatoVacaciones(1, 1, motor)).toBe(false);
    continuar(); await primero;
    expect(await sincronizarCandidatoVacaciones(1, 1, motor)).toBe(false); expect(motor).toHaveBeenCalledTimes(1);
  });
  it("aislamiento completo de dos empresas", async () => {
    filas.set("1:1", limpio()); filas.set("2:1", limpio());
    await marcarVacacionesDirty(asConn(conexion()), 2, 1);
    empleados.push({ empresa: 1, id: 1 }, { empresa: 2, id: 1 });
    expect(await candidatosVacaciones(1)).toEqual([]); expect(await candidatosVacaciones(2)).toEqual([1]);
  });
  it("limpieza administrativa deja dirty y vuelve a seleccionar", async () => {
    filas.set("1:1", limpio()); empleados.push({ empresa: 1, id: 1 });
    await invalidarVacacionesEmpresaEnConexion(asConn(conexion()), 1);
    expect(await candidatosVacaciones(1)).toEqual([1]);
  });
  it.each([0, 2])("105 empleados y %i dirty: dos SELECT batch y exactamente esos motores", async (dirty) => {
    for (let id = 1; id <= 105; id++) { empleados.push({ empresa: 1, id }); filas.set(`1:${id}`, { ...limpio(), dirty: Number(id <= dirty) }); }
    const ids = await candidatosVacaciones(1); const motor = vi.fn();
    for (const id of ids) await sincronizarCandidatoVacaciones(1, id, motor);
    expect(ids.length).toBe(dirty); expect(motor).toHaveBeenCalledTimes(dirty); expect(db.query).toHaveBeenCalledTimes(2);
  });
  it("Map libera una ejecución fallida y permite un intento posterior", async () => {
    db.query.mockRejectedValueOnce(new Error("lectura fallida"));
    await expect(sincronizarVacacionesEmpleadosActivos(1)).rejects.toThrow("lectura fallida");
    await expect(sincronizarVacacionesEmpleadosActivos(1)).resolves.toEqual({ empleados: 0, errores: 0 });
    expect(db.query).toHaveBeenCalledTimes(3);
  });
  it("Map comparte trabajo simultáneo pero no conserva Promise resuelta", async () => {
    let terminar!: () => void; const pendiente = new Promise<void>((r) => { terminar = r; });
    const consulta = db.query.getMockImplementation()!;
    db.query.mockImplementationOnce(async (...args) => { await pendiente; return consulta(...args); });
    const a = sincronizarVacacionesEmpleadosActivos(1); const b = sincronizarVacacionesEmpleadosActivos(1);
    terminar(); await Promise.all([a, b]); expect(db.query).toHaveBeenCalledTimes(2);
    empleados.push({ empresa: 1, id: 1 });
    await marcarVacacionesDirty(asConn(conexion()), 1, 1);
    expect(await sincronizarVacacionesEmpleadosActivos(1)).toEqual({ empleados: 1, errores: 0 });
    expect(db.query).toHaveBeenCalledTimes(4);
  });
});
