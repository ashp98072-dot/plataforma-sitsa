import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({
  requireTenantGastos: vi.fn(),
  requireTenantGastosAutorizar: vi.fn(),
}));
vi.mock("@/lib/tms/gastos", () => ({
  // GASTOS-COMPROBANTE-404-1 — incluye "Bonificación" y "Reintegro de
  // gastos" (catálogo COMPARTIDO real con Gastos, ver gastos.ts).
  CATEGORIAS_GASTO: ["Combustible", "Bonificación", "Reintegro de gastos", "Otros"],
  // FONDOS-GASTOS-METODO-PAGO-1 — la ruta hace z.enum(METODOS_PAGO_GASTO) al cargar el módulo; sin este mock, undefined revienta el schema.
  METODOS_PAGO_GASTO: ["Efectivo", "Transferencia", "Transferencia móvil", "Tarjeta", "Cheque", "Otro"],
}));
vi.mock("@/lib/tms/fondos", () => ({
  actualizarSolicitudFondo: vi.fn(),
  cambiarEstadoSolicitudFondo: vi.fn(),
  obtenerSolicitudFondo: vi.fn(),
  MENSAJE_FIRMA_REQUERIDA_AUTORIZAR: "Debes registrar tu firma en Mi firma antes de autorizar la solicitud.",
}));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));

import { requireTenantGastos, requireTenantGastosAutorizar } from "@/lib/tenant";
import { actualizarSolicitudFondo, cambiarEstadoSolicitudFondo } from "@/lib/tms/fondos";
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
 * Rechazar usa el mismo permiso; liquidar/editar siguen bajo el general.
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

  /** FONDOS-GASTOS-METODO-PAGO-1 — mismo schema de metodoPago que el POST de creación (fondos/route.ts). */
  describe("accion: editar — schema de metodoPago por línea", () => {
    beforeEach(() => vi.mocked(actualizarSolicitudFondo).mockResolvedValue({ id: 1 } as never));

    it("acepta un método del catálogo existente", async () => {
      const res = await PATCH(req({ accion: "editar", entidadRequirenteId: 10, lineas: [{ categoria: "Combustible", monto: 100, metodoPago: "Transferencia móvil" }] }), ctx);
      expect(res.status).toBe(200);
      expect(actualizarSolicitudFondo).toHaveBeenCalled();
    });

    it("rechaza un método fuera del catálogo, sin llegar a actualizarSolicitudFondo", async () => {
      const res = await PATCH(req({ accion: "editar", lineas: [{ categoria: "Combustible", monto: 100, metodoPago: "Bitcoin" }] }), ctx);
      expect(res.status).toBe(400);
      expect(actualizarSolicitudFondo).not.toHaveBeenCalled();
    });

    /** GASTOS-COMPROBANTE-404-1 — categorías compartidas nuevas, también al EDITAR una solicitud existente. */
    it.each(["Bonificación", "Reintegro de gastos"])("acepta la categoría '%s' al editar", async (categoria) => {
      const res = await PATCH(req({ accion: "editar", entidadRequirenteId: 10, lineas: [{ categoria, monto: 100 }] }), ctx);
      expect(res.status).toBe(200);
      expect(actualizarSolicitudFondo).toHaveBeenCalled();
    });
  });

  it("accion 'rechazar' exige el mismo permiso propio que autorizar", async () => {
    const res = await PATCH(req({ accion: "rechazar", motivoRechazo: "Falta soporte" }), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantGastosAutorizar).toHaveBeenCalledWith("prueba", "editar");
    expect(requireTenantGastos).not.toHaveBeenCalled();
  });

  it("sin permiso propio tampoco permite rechazar", async () => {
    vi.mocked(requireTenantGastosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await PATCH(req({ accion: "rechazar", motivoRechazo: "Falta soporte" }), ctx);
    expect(res.status).toBe(403);
    expect(cambiarEstadoSolicitudFondo).not.toHaveBeenCalled();
  });

  it("accion 'liquidar' usa el guard genérico, NO el de autorización", async () => {
    vi.mocked(cambiarEstadoSolicitudFondo).mockResolvedValue({ id: 1, estado: "Liquidada" } as never);
    await PATCH(req({ accion: "liquidar" }), ctx);
    expect(requireTenantGastos).toHaveBeenCalledWith("prueba", "editar");
    expect(requireTenantGastosAutorizar).not.toHaveBeenCalled();
  });
});
