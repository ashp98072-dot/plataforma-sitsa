import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastosOperativosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/gastos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/gastos")>();
  return { ...actual, autorizarGasto: vi.fn() };
});
// GASTOS-ADMINISTRATIVO-1 (Fase 5) — leerBytesFirmaGuardada se mockea por
// completo (nunca toca disco/DB real en un test unitario).
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));

import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { ErrorGasto, MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, autorizarGasto } from "@/lib/tms/gastos";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };
const IMAGEN_FIRMA = { bytes: new ArrayBuffer(4), original: "firma.png" };

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sesionOk = {
  empresa: { id: 7 },
  session: { id: 9, username: "hsitan", nombre: "Heber Sitan", rol: "JefeOperaciones" },
} as Awaited<ReturnType<typeof requireTenantGastosOperativosAutorizar>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue(sesionOk);
  vi.mocked(autorizarGasto).mockResolvedValue({ id: 10, estado: "Autorizada" } as never);
  // Default seguro: SÍ tiene "Mi firma" guardada — los tests de la
  // Fase 5 sobreescriben explícitamente el caso "sin firma".
  vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(IMAGEN_FIRMA as never);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/gastos/[id]/autorizar", () => {
  it("exige EXACTAMENTE gastos_operativos_autorizar:editar antes de tocar el body", async () => {
    await POST(req({}), ctx);
    expect(requireTenantGastosOperativosAutorizar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("sin permiso propio -> 403, nunca llama a la lib ni a leerBytesFirmaGuardada", async () => {
    vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(403);
    expect(autorizarGasto).not.toHaveBeenCalled();
    expect(leerBytesFirmaGuardada).not.toHaveBeenCalled();
  });

  it("ID inválido -> 400, nunca llama a la lib", async () => {
    const res = await POST(req({}), { params: Promise.resolve({ slug: "prueba", id: "abc" }) });
    expect(res.status).toBe(400);
    expect(autorizarGasto).not.toHaveBeenCalled();
  });

  it("la identidad del autorizante viene SIEMPRE de guard.session — nunca del body, aunque el body intente forzarla", async () => {
    await POST(req({
      estado: "Autorizada",
      autorizanteUsuarioId: 999,
      autorizanteNombre: "Nombre Falso",
    }), ctx);
    expect(autorizarGasto).toHaveBeenCalledWith(7, 10, {
      usuario: "hsitan",
      autorizanteUsuarioId: 9,
      autorizanteNombre: "Heber Sitan",
      autorizanteRol: "JefeOperaciones",
      autorizanteEmpleadoId: undefined,
      firmaImagen: IMAGEN_FIRMA,
      permitirAutoautorizacion: true,
    });
  });

  it("usa el username como nombre si la sesión no trae nombre real", async () => {
    vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue({
      empresa: { id: 7 }, session: { id: 9, username: "hsitan", nombre: "", rol: "JefeOperaciones" },
    } as never);
    await POST(req({}), ctx);
    expect(autorizarGasto).toHaveBeenCalledWith(7, 10, expect.objectContaining({ autorizanteNombre: "hsitan" }));
  });

  it("acepta autorizanteEmpleadoId como único campo legado del body", async () => {
    await POST(req({ autorizanteEmpleadoId: 5 }), ctx);
    expect(autorizarGasto).toHaveBeenCalledWith(7, 10, expect.objectContaining({ autorizanteEmpleadoId: 5 }));
  });

  it("gasto no encontrado -> 404", async () => {
    vi.mocked(autorizarGasto).mockResolvedValue(null);
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(404);
  });

  it("respuesta 200 con el gasto actualizado", async () => {
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mensaje).toBe("Gasto autorizado.");
    expect(body.gasto.estado).toBe("Autorizada");
  });

  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo patrón EXACTO que
   * fondos/[id]/route.test.ts: leerBytesFirmaGuardada(guard.session.id)
   * se valida ANTES de llamar a la lib; sin firma, 400 con el mensaje fijo,
   * sin tocar la base de datos.
   */
  describe("firma obligatoria del autorizante (Fase 5)", () => {
    it("con permiso pero SIN firma en 'Mi firma' -> 400 con el mensaje fijo, sin tocar la lib", async () => {
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null);
      const res = await POST(req({}), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR);
      expect(autorizarGasto).not.toHaveBeenCalled();
    });

    it("con firma guardada -> consulta leerBytesFirmaGuardada con el id de sesión y pasa la imagen a la lib", async () => {
      await POST(req({}), ctx);
      expect(leerBytesFirmaGuardada).toHaveBeenCalledWith(9);
      expect(autorizarGasto).toHaveBeenCalledWith(7, 10, expect.objectContaining({ firmaImagen: IMAGEN_FIRMA }));
    });
  });

  /** GASTOS-ADMINISTRATIVO-1 (Fase 3) — mapeo de errores por instanceof, NUNCA por texto. */
  describe("mapeo de errores HTTP (ErrorGasto)", () => {
    it("ErrorGasto 409 (histórico o transición inválida) se propaga tal cual", async () => {
      vi.mocked(autorizarGasto).mockRejectedValue(new ErrorGasto("Este gasto es histórico y no tiene flujo de autorización.", 409));
      const res = await POST(req({}), ctx);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("Este gasto es histórico y no tiene flujo de autorización.");
    });

    it("ErrorGasto 403 de la librería se propaga tal cual", async () => {
      vi.mocked(autorizarGasto).mockRejectedValue(new ErrorGasto("No puede autorizar su propio gasto.", 403));
      const res = await POST(req({}), ctx);
      expect(res.status).toBe(403);
    });

    it("Error plano (validación, p. ej. empleado fuera de la empresa) -> 400", async () => {
      vi.mocked(autorizarGasto).mockRejectedValue(new Error("El autorizante indicado no pertenece a esta empresa."));
      const res = await POST(req({}), ctx);
      expect(res.status).toBe(400);
    });

    it("excepción inesperada (no Error) -> 500 con cuerpo JSON, nunca un 500 vacío", async () => {
      vi.mocked(autorizarGasto).mockRejectedValue("fallo real de DB");
      const res = await POST(req({}), ctx);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
    });
  });
});
