import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/api-guard", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorId: vi.fn() }));
vi.mock("@/lib/rrhh/vacaciones", () => ({ sincronizarVacacionesEmpleadosActivos: vi.fn() }));
import { requireSession } from "@/lib/api-guard";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { sincronizarVacacionesEmpleadosActivos } from "@/lib/rrhh/vacaciones";
import * as ruta from "./route";

const invocacionesAlImportar = vi.mocked(sincronizarVacacionesEmpleadosActivos).mock.calls.length;
const request = (body: unknown = { empresaId: 7, confirmacion: "INICIALIZAR VACACIONES EMPRESA 7" }, contentType = "application/json") =>
  new Request("http://localhost/api/admin/vacaciones/inicializar-sync", {
    method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 2, rol: "Admin", username: "admin", empresaId: 1 } });
  vi.mocked(obtenerEmpresaPorId).mockResolvedValue({ id: 7, activa: true, codigo: "TEST" } as NonNullable<Awaited<ReturnType<typeof obtenerEmpresaPorId>>>);
  vi.mocked(sincronizarVacacionesEmpleadosActivos).mockResolvedValue({ empleados: 104, sincronizados: 104, errores: 0 });
});
it("sin sesión no ejecuta motor ni lookup de empresa", async () => {
  vi.mocked(requireSession).mockResolvedValue({ error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) });
  expect((await ruta.POST(request())).status).toBe(401);
  expect(obtenerEmpresaPorId).not.toHaveBeenCalled(); expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
it.each(["RRHH", "Operaciones", "Piloto"] as const)("rol %s no obtiene acceso administrativo", async (rol) => {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 3, rol, username: "normal" } });
  expect((await ruta.POST(request())).status).toBe(403);
  expect(obtenerEmpresaPorId).not.toHaveBeenCalled(); expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
it.each([{}, { empresaId: 0, confirmacion: "" }, { empresaId: "7", confirmacion: "" }, { empresaId: 7, confirmacion: "INICIALIZAR VACACIONES EMPRESA 1" }])("empresa/confirmación inválidas no ejecutan", async (body) => {
  expect((await ruta.POST(request(body))).status).toBe(400);
  expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
it("rechaza formularios y JSON malformado sin efectos", async () => {
  expect((await ruta.POST(request(undefined, "text/plain"))).status).toBe(415);
  const req = new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  expect((await ruta.POST(req)).status).toBe(400); expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
it("rechaza empresa inexistente/inactiva", async () => {
  vi.mocked(obtenerEmpresaPorId).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 7, activa: false } as NonNullable<Awaited<ReturnType<typeof obtenerEmpresaPorId>>>);
  expect((await ruta.POST(request())).status).toBe(404);
  expect((await ruta.POST(request())).status).toBe(404);
  expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
it("empresa explícita validada, distinta de sesión, usa solo batch central y devuelve conteos", async () => {
  const res = await ruta.POST(request());
  expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(obtenerEmpresaPorId).toHaveBeenCalledWith(7);
  expect(sincronizarVacacionesEmpleadosActivos).toHaveBeenCalledExactlyOnceWith(7);
  expect(await res.json()).toEqual({ empresaId: 7, candidatos: 104, sincronizados: 104, errores: 0, omitidos: 0 });
});
it("informa error parcial y segunda ejecución fresca, sin marcar limpio por su cuenta", async () => {
  vi.mocked(sincronizarVacacionesEmpleadosActivos)
    .mockResolvedValueOnce({ empleados: 104, sincronizados: 103, errores: 1 })
    .mockResolvedValueOnce({ empleados: 0, sincronizados: 0, errores: 0 });
  expect(await (await ruta.POST(request())).json()).toMatchObject({ candidatos: 104, sincronizados: 103, errores: 1 });
  expect(await (await ruta.POST(request())).json()).toMatchObject({ candidatos: 0, sincronizados: 0, errores: 0 });
});
it("un claim ocupado se informa omitido, nunca sincronizado ni error artificial", async () => {
  vi.mocked(sincronizarVacacionesEmpleadosActivos).mockResolvedValue({ empleados: 2, sincronizados: 0, errores: 0 });
  expect(await (await ruta.POST(request())).json()).toEqual({ empresaId: 7, candidatos: 2, sincronizados: 0, errores: 0, omitidos: 2 });
});
it("error batch no devuelve stack/secretos ni simula éxito", async () => {
  vi.mocked(sincronizarVacacionesEmpleadosActivos).mockRejectedValue(new Error("detalle interno sensible"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const res = await ruta.POST(request()); expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno sensible");
  } finally { log.mockRestore(); }
});
it("no exporta GET ni dispara sincronización al cargar/importar el módulo", () => {
  expect("GET" in ruta).toBe(false); expect(invocacionesAlImportar).toBe(0);
  expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
