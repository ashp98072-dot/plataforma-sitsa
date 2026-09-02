import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientes/acceso", () => ({ requireClientesOFacturacion: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ resolverTmsClienteId: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/tms/cliente-usuarios", () => ({
  crearUsuarioCliente: vi.fn(),
  listarUsuariosDeCliente: vi.fn(),
}));

import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resolverTmsClienteId } from "@/lib/clientes/repository";
import { registrarAuditoria } from "@/lib/auditoria";
import { crearUsuarioCliente, listarUsuariosDeCliente } from "@/lib/tms/cliente-usuarios";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco", id: "5" }) };

function req(body: unknown) {
  return new Request("http://localhost/portal-usuarios", {
    method: "POST",
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
});

describe("GET .../clientes/[id]/portal-usuarios", () => {
  it("exige acceso al módulo Clientes antes de resolver nada", async () => {
    vi.mocked(requireClientesOFacturacion).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireClientesOFacturacion>>);
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(403);
    expect(resolverTmsClienteId).not.toHaveBeenCalled();
  });

  it("cliente no sincronizado con TMS → 409 con sincronizado:false, NUNCA lista usuarios de otro tms_clientes.id", async () => {
    vi.mocked(resolverTmsClienteId).mockResolvedValue({
      ok: false,
      mensaje: "Este cliente todavía no está sincronizado con TMS.",
    });
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Este cliente todavía no está sincronizado con TMS.");
    expect(data.sincronizado).toBe(false);
    expect(listarUsuariosDeCliente).not.toHaveBeenCalled();
  });

  it("resuelve clientes.id -> tms_clientes.id y lista con el id RESUELTO, no con el de la URL", async () => {
    vi.mocked(resolverTmsClienteId).mockResolvedValue({
      ok: true,
      tmsClienteId: 42,
      cliente: { id: 5, nombre: "ABASA" } as never,
    });
    vi.mocked(listarUsuariosDeCliente).mockResolvedValue([]);
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(200);
    expect(resolverTmsClienteId).toHaveBeenCalledWith(7, 5);
    // 42 (tms_clientes.id resuelto), NUNCA 5 (clientes.id de la URL).
    expect(listarUsuariosDeCliente).toHaveBeenCalledWith(7, 42);
  });
});

describe("POST .../clientes/[id]/portal-usuarios", () => {
  const body = {
    nombre: "Usuario Prueba",
    email: "portal.pruebas@grupo-sitsa.com",
    passwordInicial: "temporal1",
    confirmarPassword: "temporal1",
  };

  it("confirmación no coincide → 400, nunca llega a resolver el cliente ni a crear nada", async () => {
    const res = await POST(req({ ...body, confirmarPassword: "otra" }), ctx);
    expect(res.status).toBe(400);
    expect(resolverTmsClienteId).not.toHaveBeenCalled();
    expect(crearUsuarioCliente).not.toHaveBeenCalled();
  });

  it("cliente no sincronizado → 409, no crea nada", async () => {
    vi.mocked(resolverTmsClienteId).mockResolvedValue({
      ok: false,
      mensaje: "Este cliente todavía no está sincronizado con TMS.",
    });
    const res = await POST(req(body), ctx);
    expect(res.status).toBe(409);
    expect(crearUsuarioCliente).not.toHaveBeenCalled();
  });

  it("éxito: crea con el tms_clientes.id RESUELTO y audita en el módulo 'clientes' sin exponer la contraseña", async () => {
    vi.mocked(resolverTmsClienteId).mockResolvedValue({
      ok: true,
      tmsClienteId: 42,
      cliente: { id: 5, nombre: "ABASA" } as never,
    });
    vi.mocked(crearUsuarioCliente).mockResolvedValue({
      ok: true,
      usuario: {
        id: 11,
        empresaId: 7,
        clienteId: 42,
        nombre: "Usuario Prueba",
        email: "portal.pruebas@grupo-sitsa.com",
        activo: true,
        debeCambiarPassword: true,
        ultimoAcceso: null,
        creadoPor: "operaciones1",
        creadoEn: "2026-09-01 00:00:00",
      },
    });
    const res = await POST(req(body), ctx);
    expect(res.status).toBe(200);
    expect(crearUsuarioCliente).toHaveBeenCalledWith({
      empresaId: 7,
      clienteId: 42,
      nombre: "Usuario Prueba",
      email: "portal.pruebas@grupo-sitsa.com",
      passwordInicial: "temporal1",
      creadoPor: "operaciones1",
    });
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const call = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(call.modulo).toBe("clientes");
    expect(call.detalle).not.toContain("temporal1");
  });

  it("crearUsuarioCliente rechaza (ej. email duplicado) → error propagado, sin auditar", async () => {
    vi.mocked(resolverTmsClienteId).mockResolvedValue({
      ok: true,
      tmsClienteId: 42,
      cliente: { id: 5, nombre: "ABASA" } as never,
    });
    vi.mocked(crearUsuarioCliente).mockResolvedValue({
      ok: false,
      mensaje: "Ese email ya está en uso.",
    });
    const res = await POST(req(body), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Ese email ya está en uso.");
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
