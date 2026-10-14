import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

it("renovación tardía ANTES de logout: la cookie termina borrada; un POST y una navegación", async () => {
  const { actividadStaff, cerrarSesion } = await import("./session-navigation");
  let resolve!: (r: Response) => void;
  const pending = new Promise<Response>(r => { resolve = r; });
  const trace: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    if (url === "/api/auth/activity") { await pending; trace.push("set-cookie"); }
    else trace.push("delete-cookie");
    return new Response("{}");
  });
  const activity = actividadStaff(fetchFn as typeof fetch, { method: "POST" });
  const navigate = vi.fn(), duplicate = vi.fn();
  const logout = cerrarSesion(fetchFn as typeof fetch, navigate);
  const joined = cerrarSesion(fetchFn as typeof fetch, duplicate);
  expect(joined).toBe(logout);
  await Promise.resolve();
  expect(fetchFn.mock.calls.map(c => c[0])).toEqual(["/api/auth/activity"]);
  expect(await actividadStaff(fetchFn as typeof fetch, { method: "POST" })).toBeNull();
  resolve(new Response("{}")); await activity; await logout;
  expect(trace).toEqual(["set-cookie", "delete-cookie"]);
  expect(fetchFn.mock.calls.map(c => c[0])).toEqual(["/api/auth/activity", "/api/auth/logout"]);
  expect(navigate).toHaveBeenCalledExactlyOnceWith("/login"); expect(duplicate).not.toHaveBeenCalled();
  await cerrarSesion(fetchFn as typeof fetch, duplicate); // GET 401 tardío, antes de abandonar el documento.
  expect(fetchFn).toHaveBeenCalledTimes(2); expect(duplicate).not.toHaveBeenCalled();
});

it("actividad fallida no bloquea logout; sesión nueva no conserva trabajo resuelto", async () => {
  const { actividadStaff, cerrarSesion, reiniciarSalidaStaff } = await import("./session-navigation");
  const fetchFn = vi.fn().mockRejectedValueOnce(new Error("red")).mockResolvedValue(new Response("{}"));
  const activity = actividadStaff(fetchFn, { method: "POST" });
  const handled = activity.catch(() => undefined);
  await cerrarSesion(fetchFn, vi.fn()); await handled;
  expect(fetchFn).toHaveBeenCalledTimes(2);
  reiniciarSalidaStaff();
  await actividadStaff(fetchFn, { method: "POST" });
  await actividadStaff(fetchFn, { method: "POST" });
  expect(fetchFn).toHaveBeenCalledTimes(4); // No cachea Promises resueltas.
});

it("fallo de logout no navega, libera coordinación y admite reintento", async () => {
  const { cerrarSesion, actividadStaff } = await import("./session-navigation");
  const fetchFn = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 })).mockResolvedValue(new Response("{}"));
  const navigate = vi.fn();
  await expect(cerrarSesion(fetchFn, navigate)).rejects.toThrow("No se pudo cerrar sesión");
  expect(navigate).not.toHaveBeenCalled();
  expect(await actividadStaff(fetchFn, { method: "POST" })).not.toBeNull();
  await cerrarSesion(fetchFn, navigate);
  expect(navigate).toHaveBeenCalledTimes(1);
});

it("selección espera renovación previa y bloquea otra escritura de actividad; logout queda al final", async () => {
  const { actividadStaff, seleccionarEmpresa, cerrarSesion } = await import("./session-navigation");
  let resolve!: () => void;
  const pending = new Promise<void>(r => { resolve = r; });
  const trace: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    if (url === "/api/auth/activity") await pending;
    trace.push(url);
    return new Response("{}");
  });
  const activity = actividadStaff(fetchFn as typeof fetch, { method: "POST" });
  const selection = seleccionarEmpresa(fetchFn as typeof fetch, 1);
  await expect(seleccionarEmpresa(fetchFn as typeof fetch, 2)).rejects.toThrow("acción de sesión en curso");
  expect(await actividadStaff(fetchFn as typeof fetch, { method: "POST" })).toBeNull();
  const logout = cerrarSesion(fetchFn as typeof fetch, vi.fn());
  resolve(); await activity; await selection; await logout;
  expect(trace).toEqual(["/api/auth/activity", "/api/auth/select-empresa", "/api/auth/logout"]);
  expect(fetchFn.mock.calls[1][0]).toBe("/api/auth/select-empresa");
});
