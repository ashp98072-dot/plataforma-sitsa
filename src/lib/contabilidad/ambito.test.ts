import { beforeEach, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import type { SessionPayload } from "@/lib/session";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
import { getPool } from "@/lib/db";
import { ambitoDesdeRequest, bloquearAmbito, consultarLibro, errorAmbito, exigirEsquemaC2b } from "./ambito";
import { indicesC2b, fksC2b } from "./__fixtures__/esquema-c2b";

const a = { entidadId: 9, usuarioId: 4, admin: false };
const session = { id: 4, rol: "Contabilidad" } as SessionPayload;
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const connection = conn as unknown as PoolConnection;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM empresas")) return [[{ id: 7 }]];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 9, activa: 1 }]];
    if (sql.includes("FROM cont_entidad_usuarios")) return [[{ activo: 1, puede_editar: 1 }]];
    return [[{ id: 20 }]];
  });
});
it.each(["", "?entidad=0", "?entidad=-1", "?entidad=1.5", "?entidad=9&entidad=10", "?entidad=1e2", "?entidad=2147483648"])("exige selección inequívoca: %s", (q) => {
  expect(() => ambitoDesdeRequest(new Request("https://local.test/" + q), session)).toThrow("Selecciona");
  expect(getPool).not.toHaveBeenCalled();
});
it("solo toma entidad de la URL; actor y privilegio salen de sesión", () => {
  expect(ambitoDesdeRequest(new Request("https://local.test/?entidad=9&admin=true&usuarioId=1"), session)).toEqual(a);
});
it("bloquea empresa, entidad y acceso en orden, antes de leer/escribir", async () => {
  await bloquearAmbito(connection, 7, a, true);
  expect(conn.query.mock.calls.map((c) => c[1])).toEqual([[7], [7, 9], [7, 9, 4]]);
  for (const [sql] of conn.query.mock.calls) expect(sql).toContain("FOR UPDATE");
  expect(conn.execute).not.toHaveBeenCalled();
});
it.each([0, 1, 2])("deniega empresa, entidad o asignación ausente (paso %s)", async (paso) => {
  for (let n = 0; n < paso; n++) conn.query.mockResolvedValueOnce([[{ id: 7, activa: 1 }]]);
  conn.query.mockResolvedValueOnce([[]]);
  await expect(bloquearAmbito(connection, 7, a, true)).rejects.toMatchObject({ status: 403 });
});
it("entidad inactiva bloqueada incluso para Admin", async () => {
  conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[{ id: 9, activa: 0 }]]);
  await expect(bloquearAmbito(connection, 7, { ...a, admin: true }, true)).rejects.toThrow("Entidad no disponible");
});
it("Admin aún valida tenant/entidad; no requiere asignación", async () => {
  await bloquearAmbito(connection, 7, { ...a, admin: true }, true);
  expect(conn.query).toHaveBeenCalledTimes(2);
});
it.each([{ activo: 0, puede_editar: 1 }, { activo: 1, puede_editar: 0 }])("acceso revocado o de consulta no escribe: %o", async (acceso) => {
  conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[{ id: 9, activa: 1 }]]).mockResolvedValueOnce([[acceso]]);
  await expect(bloquearAmbito(connection, 7, a, true)).rejects.toMatchObject({ status: 403 });
});
it("consulta permitida sin permiso de edición", async () => {
  conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[{ id: 9, activa: 1 }]]).mockResolvedValueOnce([[{ activo: 1, puede_editar: 0 }]]);
  await bloquearAmbito(connection, 7, a, false);
});
it.each(["cuentas", "asientos", "cxc", "cxp"] as const)("lectura %s no incluye NULL ni otras entidades; no escribe", async (tipo) => {
  expect(await consultarLibro(tipo, 7, a)).toEqual([{ id: 20 }]);
  expect(conn.query.mock.calls.at(-1)).toEqual([expect.stringContaining("WHERE empresa_id = ? AND entidad_id = ?"), [7, 9]]);
  expect(conn.query.mock.calls.at(-1)?.[0]).not.toContain("IS NULL");
  expect(conn.beginTransaction).toHaveBeenCalledOnce();
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(conn.execute).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it("fallo de autorización revierte antes de consultar el libro", async () => {
  conn.query.mockResolvedValueOnce([[]]);
  await expect(consultarLibro("cuentas", 7, a)).rejects.toThrow();
  expect(conn.query).toHaveBeenCalledTimes(1);
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.release).toHaveBeenCalledOnce();
});
it.each(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"])("esquema incompleto %s devuelve 503 sin fallback al libro legado", async (code) => {
  const res = errorAmbito({ code, sql: "privado" })!;
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain("privado");
});
it("C2B completo permite continuar sin ejecutar DDL", async () => {
  conn.query.mockResolvedValueOnce([indicesC2b]).mockResolvedValueOnce([fksC2b]);
  await exigirEsquemaC2b(connection);
  expect(conn.execute).not.toHaveBeenCalled();
});
it.each(["sin-indice", "indice-antiguo", "sin-fk", "fk-cruzada"])("C2B incompleto %s bloquea escritura", async (caso) => {
  const indices = caso === "sin-indice" ? [] : caso === "indice-antiguo" ? [...indicesC2b, { nombre: "uq_cuenta" }] : indicesC2b;
  const fks = caso === "sin-fk" ? fksC2b.slice(1) : caso === "fk-cruzada" ? fksC2b.map((f) => ({ ...f, destino: "id" })) : fksC2b;
  conn.query.mockResolvedValueOnce([indices]).mockResolvedValueOnce([fks]);
  await expect(exigirEsquemaC2b(connection)).rejects.toMatchObject({ status: 503 });
});
