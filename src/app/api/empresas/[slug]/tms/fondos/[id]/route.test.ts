import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({
  requireTenantGastos: vi.fn(),
  requireTenantGastosAutorizar: vi.fn(),
}));
vi.mock("@/lib/tms/gastos", () => ({ CATEGORIAS_GASTO: ["Combustible", "Otros"] }));
vi.mock("@/lib/tms/fondos", () => ({
  actualizarSolicitudFondo: vi.fn(),
  cambiarEstadoSolicitudFondo: vi.fn(),
  obtenerSolicitudFondo: vi.fn(),
  MENSAJE_FIRMA_REQUERIDA_AUTORIZAR: "Debes registrar tu firma en Mi firma antes de autorizar la solicitud.",
}));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));

import { requireTenantGastos, requireTenantGastosAutorizar } from "@/lib/tenant";
import { cambiarEstadoSolicitudFondo } from "@/lib/tms/fondos";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "1" }) };
const sesionOk = {
  empresa: { id: 7, nombre: "SITSA" },
  session: { id: 9, username: "hsitan", nombre: "Heber Sitan", rol: "JefeOperaciones" },
} as Awaited<ReturnType<typeof requireTenantGastos>>;

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue(sesionOk);
  vi.mocked(requireTenantGastosAutorizar).mockResolvedValue(sesionOk);
  vi.mocked(leerBytesFirmaGuardada).mockResolvedValue({ bytes: new ArrayBuffer(4), original: "firma.png" } as never);
  vi.mocked(cambiarEstadoSolicitudFondo).mockResolvedValue({ id: 1, estado: "Autorizada" } as never);
});
afterEach(() => vi.restoreAllMocks());

/**
 * FONDOS-AUTORIZAR-PERMISO-1 — "autorizar" es una acción independiente: el
 * endpoint la gatea con requireTenantGastosAutorizar (permiso propio
 * 'gastos_autorizar', sin fallback a gastos:editar / tms:editar). El resto
 * de acciones sigue bajo requireTenantGastos("editar").
 */
describe("PATCH /tms/fondos/[id] — permiso de autorización", () => {
  it("sin permiso 'gastos_autorizar' -> 403, NUNCA llama a cambiarEstadoSolicitudFondo", async () => {
    vi.mocked(requireTenantGastosAutorizar).mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Sin permiso para autorizar solicitudes de fondo." }), { status: 403 }),
    } as never);
    const res = await PATCH(req({ accion: "autorizar" }), ctx);
    expect(res.status).toBe(403);
    expect(cambiarEstadoSolicitudFondo).not.toHaveBeenCalled();
    // gastos:editar NO alcanza para autorizar
    expect(requireTenantGastos).not.toHaveBeenCalledWith("prueba", "editar");
  });

  it("con permiso 'gastos_autorizar' + firma -> autoriza (usa requireTenantGastosAutorizar, no el guard genérico)", async () => {
    const res = await PATCH(req({ accion: "autorizar" }), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantGastosAutorizar).toHaveBeenCalledWith("prueba", "editar");
    expect(cambiarEstadoSolicitudFondo).toHaveBeenCalledWith(7, 1, "autorizar", expect.objectContaining({
      usuario: "hsitan",
      autorizante: expect.objectContaining({ usuarioId: 9, nombre: "Heber Sitan" }),
    }));
  });

  it("con permiso pero SIN firma en 'Mi firma' -> 400 con el mensaje fijo, sin tocar la lib", async () => {
    vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null);
    const res = await PATCH(req({ accion: "autorizar" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Mi firma");
    expect(cambiarEstadoSolicitudFondo).not.toHaveBeenCalled();
  });

  it("intenta autorizar su propia solicitud -> 400 con 'No puede autorizar su propia solicitud.'", async () => {
    vi.mocked(cambiarEstadoSolicitudFondo).mockRejectedValue(new Error("No puede autorizar su propia solicitud."));
    const res = await PATCH(req({ accion: "autorizar" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No puede autorizar su propia solicitud.");
  });

  it("accion 'rechazar' usa el guard genérico 'gastos:editar', NO el de autorización", async () => {
    const res = await PATCH(req({ accion: "rechazar", motivoRechazo: "Falta soporte" }), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantGastos).toHaveBeenCalledWith("prueba", "editar");
    expect(requireTenantGastosAutorizar).not.toHaveBeenCalled();
  });

  it("accion 'liquidar' usa el guard genérico, NO el de autorización", async () => {
    vi.mocked(cambiarEstadoSolicitudFondo).mockResolvedValue({ id: 1, estado: "Liquidada" } as never);
    await PATCH(req({ accion: "liquidar" }), ctx);
    expect(requireTenantGastos).toHaveBeenCalledWith("prueba", "editar");
    expect(requireTenantGastosAutorizar).not.toHaveBeenCalled();
  });
});
