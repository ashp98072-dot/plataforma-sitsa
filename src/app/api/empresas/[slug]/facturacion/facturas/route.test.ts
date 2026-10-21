import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/contexto-factura", () => ({
  fact4Disponible: vi.fn(),
  leerRetencionIvaCliente: vi.fn(),
  listarEntidadesEmisoras: vi.fn(),
  MENSAJE_FALTA_MIGRACION_FACT4: "Falta aplicar la migración FACT-4.",
}));
vi.mock("@/lib/facturacion/facturas", () => ({
  listarFacturas: vi.fn(() => Promise.resolve({ items: [], totalReal: 0, page: 1, pageSize: 50 })),
  crearFactura: vi.fn(),
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import { crearFactura, listarFacturas } from "@/lib/facturacion/facturas";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/** FACT-4: desde esta fase toda creación/edición/vista previa lleva líneas y condición de pago. */
const F4 = {
  lineas: [{ planIds: [1], cantidad: 1, descripcion: "Servicio de transporte", precioUnitario: 100, clasificacion: "SERVICIO", precioIncluyeIva: true }],
  condicionPago: "CREDITO",
};
const DATOS_F4 = { lineas: F4.lineas, entidadId: 1, condicionPago: "CREDITO", cuentaBancariaId: null, retencionIvaPct: 0, retencionIvaClientePct: 0 };
async function fact4Listo() {
  const c = await import("@/lib/facturacion/contexto-factura");
  vi.mocked(c.fact4Disponible).mockResolvedValue(true);
  vi.mocked(c.leerRetencionIvaCliente).mockResolvedValue(0);
  vi.mocked(c.listarEntidadesEmisoras).mockResolvedValue([{ id: 1, codigo: "MON", nombre: "Mónaco" }]);
  return c;
}

beforeEach(async () => {
  vi.resetAllMocks();
  await fact4Listo();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas — 26) permisos: facturacion:ver", () => {
  it("exige facturacion:ver ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(listarFacturas).not.toHaveBeenCalled();
  });

  it("responde 200 con las facturas del tenant del guard", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(listarFacturas).toHaveBeenCalledWith(7, expect.anything());
  });

  it("responde con totalReal/page/pageSize independientes del contenido de la página (paginación)", async () => {
    vi.mocked(listarFacturas).mockResolvedValue({ items: [], totalReal: 734, page: 2, pageSize: 100 });
    const res = await GET(new Request("http://localhost/x?page=2&pageSize=100"), ctx);
    const body = await res.json();
    expect(body).toEqual({ facturas: [], totalReal: 734, page: 2, pageSize: 100 });
    expect(listarFacturas).toHaveBeenCalledWith(7, expect.objectContaining({ page: 2, pageSize: 100 }));
  });
});

describe("POST /facturacion/facturas — 26) permisos: facturacion:crear", () => {
  it("exige facturacion:crear ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }] }) }), ctx);
    expect(res.status).toBe(403);
    expect(crearFactura).not.toHaveBeenCalled();
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "crear");
  });

  it("crea siempre como Borrador vía la lib (nunca escribe SQL directo en la ruta)", async () => {
    vi.mocked(crearFactura).mockResolvedValue({ ok: true, facturaId: 10 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 }) }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(crearFactura).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 3, usuario: "facturador1" },
      expect.objectContaining({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }] }),
    );
  });

  it("propaga el status de error de la lib (p.ej. 409 viaje ya facturado)", async () => {
    vi.mocked(crearFactura).mockResolvedValue({ ok: false, error: "El viaje ya está vinculado a otra factura.", status: 409 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 }) }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it("el tratamiento de IVA es OBLIGATORIO y booleano en CADA línea: faltante, null, texto o número → 400 sin llamar a la lib", async () => {
    const malas = [{ planId: 1 }, { planId: 1, precioIncluyeIva: null }, { planId: 1, precioIncluyeIva: "true" }, { planId: 1, precioIncluyeIva: 1 }];
    for (const mala of malas) {
      for (const planes of [[mala], [{ planId: 2, precioIncluyeIva: true }, mala]]) {
        const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes }) }), ctx);
        expect(res.status).toBe(400);
      }
    }
    expect(crearFactura).not.toHaveBeenCalled();
  });

  it("el tratamiento a nivel de factura ya NO existe: se ignora y no sustituye al de las líneas", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, precioIncluyeIva: true, planes: [{ planId: 1 }] }) }), ctx);
    expect(res.status).toBe(400);
    expect(crearFactura).not.toHaveBeenCalled();
  });

  it("pasa a la lib el tratamiento de CADA línea (mezcla incluida), tal cual", async () => {
    vi.mocked(crearFactura).mockResolvedValue({ ok: true, facturaId: 9 });
    const planes = [{ planId: 1, montoAsignado: 100, precioIncluyeIva: true }, { planId: 2, montoAsignado: 100, precioIncluyeIva: false }];
    await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes, ...F4 }) }), ctx);
    expect(crearFactura).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ planes }));
  });

  it("FACT-4: pasa a la lib líneas, condición, entidad, banco y retención resueltos en el servidor", async () => {
    vi.mocked(crearFactura).mockResolvedValue({ ok: true, facturaId: 12 });
    await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 }) }), ctx);
    expect(crearFactura).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(DATOS_F4));
  });

  it("FACT-4: migración ausente → 503 explícito y NO se crea nada (ni con payload FACT-4 ni con el anterior)", async () => {
    const c = await import("@/lib/facturacion/contexto-factura");
    vi.mocked(c.fact4Disponible).mockResolvedValue(false);
    for (const body of [
      { clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], ...F4 },
      { clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }] },
    ]) {
      const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), ctx);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain("migración FACT-4");
    }
    expect(crearFactura).not.toHaveBeenCalled();
  });

  it("FACT-4: con la migración aplicada, un payload del modelo anterior o sin condición de pago → 400 (sin degradar)", async () => {
    for (const body of [
      { clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }] },
      { clienteId: 1, planes: [{ planId: 1, precioIncluyeIva: true }], lineas: F4.lineas },
    ]) {
      const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), ctx);
      expect(res.status).toBe(400);
    }
    expect(crearFactura).not.toHaveBeenCalled();
  });

  it("rechaza payload sin planes antes de llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [] }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(crearFactura).not.toHaveBeenCalled();
  });
});
