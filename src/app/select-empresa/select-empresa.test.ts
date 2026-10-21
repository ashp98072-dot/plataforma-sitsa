import { beforeEach, afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ token: "", query: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => { throw new Error("Sin BD real"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => m.token ? { value: m.token } : undefined, set: m.set, delete: m.delete }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const empresa = { id: 1, codigo: "KT", nombre: "Kuiqtrans / Logiservicios Mónaco", slug: "kt-monaco", logo_url: null, activa: 1, modulos_json: '["rrhh","tms"]' };
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("AUTH_SECRET", "synthetic-test-secret-never-production-32");
  m.set.mockReset();
  m.delete.mockReset();
  m.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("FROM usuarios")) return [{ username: "fixture", nombre: "Usuario fixture", rol_global: "Operaciones", activo: 1, acceso_todas_empresas: 0 }];
    if (sql.includes("FROM empresas")) return [empresa];
    if (sql.includes("FROM usuario_modulo")) return [{ modulo: "programacion", puede_ver: 1, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }];
    throw new Error(`Query inesperada: ${sql}`);
  });
  const { createSessionToken } = await import("@/lib/session");
  m.token = await createSessionToken({ id: 7, username: "cookie-fixture", rol: "Operaciones" });
});

it("logout backend existente: cero SELECT, borra cookie y responde una sola vez", async () => {
  const { POST } = await import("@/app/api/auth/logout/route");
  expect((await POST()).status).toBe(200);
  expect(m.delete).toHaveBeenCalledExactlyOnceWith("sitsa_session");
  expect(m.query).not.toHaveBeenCalled();
});

it("BASE reproduce carrera: actividad iniciada antes de salir puede volver a escribir cookie después de logout", async () => {
  let resolve!: (rows: unknown[]) => void;
  m.query.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const trace: string[] = [];
  m.delete.mockImplementation(() => trace.push("delete"));
  m.set.mockImplementation(() => trace.push("set"));
  const { POST: activity } = await import("@/app/api/auth/activity/route");
  const { POST: logout } = await import("@/app/api/auth/logout/route");
  const pending = activity();
  // Esperar que el JWT válido llegue a la lectura revocable de usuarios.
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await logout();
  expect(trace).toEqual(["delete"]);
  resolve([{ username: "fixture", nombre: "Usuario fixture", rol_global: "Operaciones", activo: 1, acceso_todas_empresas: 0 }]);
  await pending;
  expect(trace).toEqual(["delete", "set"]);
});
afterEach(() => vi.unstubAllEnvs());

it("BASE pipeline /auth/me: 3 SELECT fríos; el selector no usa la matriz devuelta", async () => {
  const { GET } = await import("@/app/api/auth/me/route");
  const response = await GET();
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.empresas.map((e: { id: number }) => e.id)).toEqual([1]);
  expect(m.query).toHaveBeenCalledTimes(3);
});

it("HEAD SSR: 2 SELECT fríos, mismos datos permitidos y usuario público desde BD", async () => {
  const { default: page } = await import("./page");
  const tree = await page();
  expect(tree.props.user).toEqual({ username: "fixture", rol: "Operaciones" });
  expect(tree.props.empresas.map((e: { id: number }) => e.id)).toEqual([1]);
  expect(Object.keys(tree.props.user).sort()).toEqual(["rol", "username"]);
  expect(m.query).toHaveBeenCalledTimes(2);
  expect(m.query.mock.calls.some(c => c[0].includes("usuario_modulo"))).toBe(false);
  expect(m.query.mock.calls.find(c => c[0].includes("usuario_empresa"))?.[1]).toEqual([7]);
});

it("sin sesión no lee empresas y redirige a login", async () => {
  m.token = "";
  const { default: page } = await import("./page");
  await expect(page()).rejects.toThrow("REDIRECT /login");
  expect(m.query).not.toHaveBeenCalled();
});

it("el POST existente rechaza empresa ajena y no escribe cookie", async () => {
  const { POST } = await import("@/app/api/auth/select-empresa/route");
  const response = await POST(new Request("http://localhost/api/auth/select-empresa", { method: "POST", body: JSON.stringify({ empresaId: 2 }) }));
  expect(response.status).toBe(403);
  expect(m.set).not.toHaveBeenCalled();
});

it("el POST existente selecciona empresa permitida y conserva la sesión/redirect del servidor", async () => {
  const { POST } = await import("@/app/api/auth/select-empresa/route");
  const response = await POST(new Request("http://localhost/api/auth/select-empresa", { method: "POST", body: JSON.stringify({ empresaId: 1 }) }));
  expect(response.status).toBe(200);
  expect((await response.json()).redirect).toBe("/e/kt-monaco/dashboard-operaciones");
  expect(m.set).toHaveBeenCalledTimes(1);
});
