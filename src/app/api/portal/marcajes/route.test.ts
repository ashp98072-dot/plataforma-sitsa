import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/marcajes", () => ({ registrarMarcajePortal: vi.fn(), listarMarcajesEmpleadoRango: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { registrarMarcajePortal } from "@/lib/rrhh/marcajes";
import { guardarUpload, borrarUpload } from "@/lib/uploads";
import { POST } from "./route";
const enviar = (foto = true, gps = true) => {
  const body = new FormData();
  if (foto) body.set("foto", new File([new Uint8Array([255, 216, 255])], "foto.jpg"));
  if (gps) { body.set("latitud", "14"); body.set("longitud", "-90"); }
  body.set("empleadoId", "999"); body.set("empresaId", "999");
  return POST(new Request("http://localhost/api/portal/marcajes", { method: "POST", body }));
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 3, empleadoId: 7 } as NonNullable<Awaited<ReturnType<typeof getColaboradorSession>>>);
  vi.mocked(guardarUpload).mockResolvedValue({ relative: "prueba.jpg", original: "foto.jpg", size: 3 });
  vi.mocked(registrarMarcajePortal).mockResolvedValue({ ok: true, empresaId: 3, sesionId: 12, tipo: "Entrada", nombre: "Prueba", hora: "07:00" });
});
afterEach(() => vi.restoreAllMocks());
it("exige sesión", async () => {
  vi.mocked(getColaboradorSession).mockResolvedValue(null);
  expect((await enviar()).status).toBe(401);
  expect(guardarUpload).not.toHaveBeenCalled();
});
it("exige foto y coordenadas sin aceptar JSON antiguo", async () => {
  expect((await enviar(false)).status).toBe(400);
  expect((await enviar(true, false)).status).toBe(400);
  expect((await POST(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitud: 14, longitud: -90 }) }))).status).toBe(400);
  expect(registrarMarcajePortal).not.toHaveBeenCalled();
});
it("ignora identidad enviada y utiliza sesión", async () => {
  expect((await enviar()).status).toBe(200);
  expect(registrarMarcajePortal).toHaveBeenCalledWith(3, 7, { latitud: 14, longitud: -90 }, expect.objectContaining({ mime: "image/jpeg" }));
});
it("limpia el archivo cuando la geocerca rechaza o la transacción falla", async () => {
  vi.mocked(registrarMarcajePortal).mockResolvedValueOnce({ ok: false, code: "FUERA_GEOCERCA", error: "Fuera" }).mockRejectedValueOnce(new Error("fallo simulado"));
  expect((await enviar()).status).toBe(409);
  expect((await enviar()).status).toBe(500);
  expect(borrarUpload).toHaveBeenCalledTimes(2);
});
