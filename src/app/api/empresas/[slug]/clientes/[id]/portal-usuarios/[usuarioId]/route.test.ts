import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientes/acceso", () => ({ requireClientesOFacturacion: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ resolverTmsClienteId: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/tms/cliente-usuarios", () => ({
  activarUsuarioCliente: vi.fn(),
  resetearPasswordUsuarioCliente: vi.fn(),
}));

import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resolverTmsClienteId } from "@/lib/clientes/repository";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  activarUsuarioCliente,
  resetearPasswordUsuarioCliente,
} from "@/lib/tms/cliente-usuarios";
import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco", id: "5", usuarioId: "11" }) };

function req(body: unknown) {
  return new Request("http://localhost/portal-usuarios/11", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClientesOFacturacion).mockResolvedValue({
    empresa: { id: 7, nombre: "KT / Mónaco" },
    session: { username: "operaciones1" },
  } as Awaited<ReturnType<typeof requireClientesOFacturacion>>);
  vi.mocked(resolverTmsClienteId).mockResolvedValue({
    ok: true,
    tmsClienteId: 42,
    cliente: { id: 5, nombre: "ABASA" } as never,
  });
});

describe("PATCH .../clientes/[id]/portal-usuarios/[usuarioId]", () => {
  it("exige acceso al módulo Clientes antes de resolver nada", async () => {
    vi.mocked(requireClientesOFacturacion).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireClientesOFacturacion>>);
    const res = await PATCH(req({ accion: "activar", activo: false }), ctx);
    expect(res.status).toBe(403);
    expect(resolverTmsClienteId).not.toHaveBeenCalled();
  });

  it("cliente no sincronizado → 409, no muta nada", async () => {
    vi.mocked(resolverTmsClienteId).mockResolvedValue({
      ok: false,
      mensaje: "Este cliente todavía no está sincronizado con TMS.",
    });
    const res = await PATCH(req({ accion: "activar", activo: false }), ctx);
    expect(res.status).toBe(409);
    expect(activarUsuarioCliente).not.toHaveBeenCalled();
  });

  it("activar/desactivar: usa el tms_clientes.id RESUELTO (no el de la URL) y audita en 'clientes'", async () => {
    vi.mocked(activarUsuarioCliente).mockResolvedValue({
      ok: true,
      mensaje: "Acceso desactivado.",
    });
    const res = await PATCH(req({ accion: "activar", activo: false }), ctx);
    expect(res.status).toBe(200);
    expect(activarUsuarioCliente).toHaveBeenCalledWith(7, 42, 11, false);
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const call = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(call.modulo).toBe("clientes");
    expect(call.accion).toBe("desactivar_usuario_cliente");
  });

  it("usuario no pertenece a este cliente (0 filas afectadas) → 404, sin auditar", async () => {
    vi.mocked(activarUsuarioCliente).mockResolvedValue({
      ok: false,
      mensaje: "Usuario no encontrado para este cliente.",
    });
    const res = await PATCH(req({ accion: "activar", activo: true }), ctx);
    expect(res.status).toBe(404);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("resetear: usa el tms_clientes.id RESUELTO, audita sin exponer la contraseña nueva", async () => {
    vi.mocked(resetearPasswordUsuarioCliente).mockResolvedValue({
      ok: true,
      mensaje: "Contraseña reiniciada.",
    });
    const res = await PATCH(
      req({ accion: "resetear", passwordNueva: "nueva-temporal-1" }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(resetearPasswordUsuarioCliente).toHaveBeenCalledWith(7, 42, 11, "nueva-temporal-1");
    const call = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(call.detalle).not.toContain("nueva-temporal-1");
  });

  it("contraseña de reseteo corta → 400 antes de llamar a resetearPasswordUsuarioCliente", async () => {
    const res = await PATCH(req({ accion: "resetear", passwordNueva: "abc" }), ctx);
    expect(res.status).toBe(400);
    expect(resetearPasswordUsuarioCliente).not.toHaveBeenCalled();
  });
});
