import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({
  obtenerFactura: vi.fn(),
  actualizarFacturaBorrador: vi.fn(),
}));

vi.mock("@/lib/facturacion/contexto-factura", () => ({
  fact4Disponible: vi.fn(),
  leerRetencionIvaCliente: vi.fn(),
  listarEntidadesEmisoras: vi.fn(),
  MENSAJE_FALTA_MIGRACION_FACT4: "Falta aplicar la migración FACT-4.",
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import { actualizarFacturaBorrador, obtenerFactura } from "@/lib/facturacion/facturas";
import { fact4Disponible, leerRetencionIvaCliente, listarEntidadesEmisoras } from "@/lib/facturacion/contexto-factura";
import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

/** FACT-4: desde esta fase toda edición lleva líneas y condición de pago. */
const F4 = {
  lineas: [{ planIds: [1], cantidad: 1, descripcion: "Servicio de transporte", precioUnitario: 100, clasificacion: "SERVICIO", precioIncluyeIva: true }],
  condicionPago: "CREDITO",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fact4Disponible).mockResolvedValue(true);
  vi.mocked(leerRetencionIvaCliente).mockResolvedValue(0);
  vi.mocked(listarEntidadesEmisoras).mockResolvedValue([{ id: 1, codigo: "MON", nombre: "Mónaco" }]);
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas/[id]", () => {
  it("exige facturacion:ver, 404 si no existe", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /facturacion/facturas/[id] — 9/10) solo Borrador editable", () => {
  it("exige facturacion:editar", async () => {
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 10 });
    await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 }) }), ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "editar");
  });

  it("propaga 409 cuando la lib rechaza (factura ya no está en Borrador)", async () => {
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: false, error: "Solo se puede editar una factura en Borrador.", status: 409 });
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 }) }), ctx);
    expect(res.status).toBe(409);
  });
});

describe("PATCH /facturacion/facturas/[id] — FACT-4: sin fallback silencioso", () => {
  it("migración ausente → 503 explícito y NO se edita nada (ni con payload FACT-4 ni con el anterior)", async () => {
    vi.mocked(fact4Disponible).mockResolvedValue(false);
    for (const body of [
      { clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 },
      { clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }] },
    ]) {
      const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), ctx);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain("migración FACT-4");
    }
    expect(actualizarFacturaBorrador).not.toHaveBeenCalled();
  });

  it("con la migración aplicada, un payload del modelo anterior → 400 (no se degrada ni se pierden las líneas)", async () => {
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }] }) }), ctx);
    expect(res.status).toBe(400);
    expect(actualizarFacturaBorrador).not.toHaveBeenCalled();
  });

  it("pasa a la lib las líneas, la condición y la retención resueltas (la ya congelada en el borrador no pide permiso)", async () => {
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 10 });
    vi.mocked(obtenerFactura).mockResolvedValue({
      factura: { clienteId: 1 }, contabilidad: { modeloLineas: true, retencionIva: { aplicadaPct: 30 } },
    } as Awaited<ReturnType<typeof obtenerFactura>>);
    vi.mocked(leerRetencionIvaCliente).mockResolvedValue(15);
    const res = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4, retencionIvaPct: 30 }) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(actualizarFacturaBorrador).toHaveBeenCalledWith(
      expect.anything(), 10,
      expect.objectContaining({ lineas: F4.lineas, condicionPago: "CREDITO", entidadId: 1, retencionIvaPct: 30, retencionIvaClientePct: 15 }),
    );
    // solo se pidió el permiso de editar la factura; el de «Editar requisitos» no hizo falta
    expect(vi.mocked(requireTenantFacturacion).mock.calls.map((c) => c[1])).toEqual(["editar"]);
  });
});

describe("PATCH /facturacion/facturas/[id] — FACT-4: cambio de cliente y permiso de retención", () => {
  const OK_GUARD = { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>;
  const SIN_PERMISO = { error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>;
  /** «editar» (la factura) siempre pasa; «editar_requisitos» (cambiar retención) depende de `conPermiso`. */
  const permisos = (conPermiso: boolean) =>
    vi.mocked(requireTenantFacturacion).mockImplementation((async (_s: string, accion: string) =>
      (accion === "editar_requisitos" && !conPermiso ? SIN_PERMISO : OK_GUARD)) as never);
  /** Borrador del cliente 1 con la retención congelada indicada. */
  const borrador = (aplicadaPct: number, modeloLineas = true) =>
    vi.mocked(obtenerFactura).mockResolvedValue({
      factura: { clienteId: 1 }, contabilidad: { modeloLineas, retencionIva: { aplicadaPct } },
    } as Awaited<ReturnType<typeof obtenerFactura>>);
  /** Retención configurada por cliente: cliente 1 → 15, cliente 2 → 30. */
  const perfiles = () => vi.mocked(leerRetencionIvaCliente).mockImplementation((async (_e: number, cliente: number) => (cliente === 2 ? 30 : 15)) as never);
  const patch = (body: Record<string, unknown>) =>
    PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ planes: [{ planId: 1, precioIncluyeIva: true }], ...F4, ...body }) }), ctx);

  it("A) MISMO cliente + valor congelado distinto del perfil actual → permitido SIN permiso", async () => {
    perfiles(); permisos(false); borrador(30);
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 10 });
    const res = await patch({ clienteId: 1, retencionIvaPct: 30 });
    expect(res.status).toBe(200);
    expect(actualizarFacturaBorrador).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({ clienteId: 1, retencionIvaPct: 30, retencionIvaClientePct: 15 }));
    expect(vi.mocked(requireTenantFacturacion).mock.calls.map((c) => c[1])).not.toContain("editar_requisitos");
  });

  it("B) cambia cliente 1→2 (congelado 15, cliente 2 configurado 30), payload 15, SIN permiso → 403 y cero mutaciones", async () => {
    perfiles(); permisos(false); borrador(15);
    const res = await patch({ clienteId: 2, retencionIvaPct: 15 });
    expect(res.status).toBe(403);
    expect(actualizarFacturaBorrador).not.toHaveBeenCalled();
    expect(vi.mocked(requireTenantFacturacion).mock.calls.map((c) => c[1])).toContain("editar_requisitos");
  });

  it("C) mismo caso CON permiso → permitido: se guarda 15 aplicado y 30 como configurado del cliente nuevo", async () => {
    perfiles(); permisos(true); borrador(15);
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 10 });
    const res = await patch({ clienteId: 2, retencionIvaPct: 15 });
    expect(res.status).toBe(200);
    expect(actualizarFacturaBorrador).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({ clienteId: 2, retencionIvaPct: 15, retencionIvaClientePct: 30 }));
  });

  it("D) cambia cliente 1→2 y NO manda override → usa la configurada del cliente nuevo (30), sin pedir permiso", async () => {
    perfiles(); permisos(false); borrador(15);
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 10 });
    const res = await patch({ clienteId: 2 });
    expect(res.status).toBe(200);
    expect(actualizarFacturaBorrador).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({ clienteId: 2, retencionIvaPct: 30, retencionIvaClientePct: 30 }));
    expect(vi.mocked(requireTenantFacturacion).mock.calls.map((c) => c[1])).not.toContain("editar_requisitos");
  });

  it("E) borrador ANTERIOR a FACT-4 (su 0 no fue decisión, es el valor por defecto): reenviar 0 con el cliente en 15 → 403 sin permiso", async () => {
    perfiles(); permisos(false); borrador(0, false);
    const res = await patch({ clienteId: 1, retencionIvaPct: 0 });
    expect(res.status).toBe(403);
    expect(actualizarFacturaBorrador).not.toHaveBeenCalled();
  });
});

describe("PATCH /facturacion/facturas/[id] — tratamiento de IVA por línea", () => {
  it("es OBLIGATORIO y booleano en cada línea: sin él → 400 sin llamar a la lib; con true/false (mezcla) se pasa tal cual", async () => {
    vi.mocked(actualizarFacturaBorrador).mockReset();
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 1 });
    for (const mala of [{ planId: 1 }, { planId: 1, precioIncluyeIva: null }, { planId: 1, precioIncluyeIva: "false" }]) {
      const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 2, precioIncluyeIva: true }, mala] }) }), ctx);
      expect(res.status).toBe(400);
    }
    expect(actualizarFacturaBorrador).not.toHaveBeenCalled();
    const planes = [{ planId: 1, precioIncluyeIva: true }, { planId: 2, precioIncluyeIva: false }];
    await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes, ...F4 }) }), ctx);
    expect(actualizarFacturaBorrador).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ planes }));
  });
});
