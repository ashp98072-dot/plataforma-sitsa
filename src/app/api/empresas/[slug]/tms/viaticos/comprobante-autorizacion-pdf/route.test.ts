import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosComprobantes: vi.fn() }));
vi.mock("@/lib/tms/viaticos-comprobante-pdf", () => ({ comprobanteAutorizacionesPdf: vi.fn() }));

import { requireTenantViaticosComprobantes } from "@/lib/tenant";
import { comprobanteAutorizacionesPdf } from "@/lib/tms/viaticos-comprobante-pdf";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * VIATICOS-COMPROBANTE-PERIODO — la ruta ya NO acepta descarga directa sin parámetros: exige `?periodo=DIA|
 * SEMANA|MES&valor=...`, valida con resolverPeriodoComprobante (real, sin mockear — es lógica pura) y solo
 * entonces llama a comprobanteAutorizacionesPdf(empresaId, empresaNombre, periodo). empresa_id/nombre SIEMPRE
 * vienen del guard (guard.empresa), nunca del cliente.
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosComprobantes).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "op1", nombre: "Ana", rol: "JefeOperaciones" } } as Awaited<
      ReturnType<typeof requireTenantViaticosComprobantes>
    >,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/viaticos/comprobante-autorizacion-pdf", () => {
  it("19) exige viaticos_comprobantes:ver ANTES de tocar la lib o validar parámetros", async () => {
    vi.mocked(requireTenantViaticosComprobantes).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantViaticosComprobantes>>);
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.status).toBe(403);
    expect(comprobanteAutorizacionesPdf).not.toHaveBeenCalled();
    expect(requireTenantViaticosComprobantes).toHaveBeenCalledWith("prueba", "ver");
  });

  it("20) sin ?periodo -> 400, nunca llega a la lib", async () => {
    const res = await GET(new Request("http://localhost/x?valor=2026-09-30"), ctx);
    expect(res.status).toBe(400);
    expect(comprobanteAutorizacionesPdf).not.toHaveBeenCalled();
  });

  it("20) ?periodo con un valor no reconocido (ni DIA/SEMANA/MES) -> 400", async () => {
    const res = await GET(new Request("http://localhost/x?periodo=ANIO&valor=2026"), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(comprobanteAutorizacionesPdf).not.toHaveBeenCalled();
  });

  it("20) ?periodo válido pero ?valor con formato inválido -> 400", async () => {
    const res = await GET(new Request("http://localhost/x?periodo=MES&valor=2026-13"), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(comprobanteAutorizacionesPdf).not.toHaveBeenCalled();
  });

  it("20) ?valor ausente -> 400", async () => {
    const res = await GET(new Request("http://localhost/x?periodo=DIA"), ctx);
    expect(res.status).toBe(400);
    expect(comprobanteAutorizacionesPdf).not.toHaveBeenCalled();
  });

  it("21) período válido sin viáticos autorizados -> 404 con mensaje estructurado, nunca un PDF vacío", async () => {
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No hay viáticos autorizados en el período seleccionado.");
  });

  it("22) lote válido -> 200 application/pdf, y la lib recibe empresa_id/nombre del guard + el período resuelto", async () => {
    const buffer = Buffer.from("%PDF-1.4 contenido de prueba");
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(buffer);
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(comprobanteAutorizacionesPdf).toHaveBeenCalledWith(
      7,
      "SITSA",
      expect.objectContaining({ inicio: "2026-09-30 00:00:00", finExclusivo: "2026-10-01 00:00:00" }),
    );
    const arrBuf = await res.arrayBuffer();
    expect(Buffer.from(arrBuf).equals(buffer)).toBe(true);
  });

  it("23) Content-Disposition correcto para DÍA", async () => {
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(Buffer.from("%PDF"));
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="viaticos-autorizados-2026-09-30.pdf"');
  });

  it("24) Content-Disposition correcto para SEMANA", async () => {
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(Buffer.from("%PDF"));
    const res = await GET(new Request("http://localhost/x?periodo=SEMANA&valor=2026-W40"), ctx);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="viaticos-autorizados-2026-W40.pdf"');
    expect(comprobanteAutorizacionesPdf).toHaveBeenCalledWith(
      7,
      "SITSA",
      expect.objectContaining({ inicio: "2026-09-28 00:00:00", finExclusivo: "2026-10-05 00:00:00" }),
    );
  });

  it("25) Content-Disposition correcto para MES", async () => {
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(Buffer.from("%PDF"));
    const res = await GET(new Request("http://localhost/x?periodo=MES&valor=2026-09"), ctx);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="viaticos-autorizados-2026-09.pdf"');
    expect(comprobanteAutorizacionesPdf).toHaveBeenCalledWith(
      7,
      "SITSA",
      expect.objectContaining({ inicio: "2026-09-01 00:00:00", finExclusivo: "2026-10-01 00:00:00" }),
    );
  });

  it("empresa_id/nombre SIEMPRE vienen del guard, nunca de un parámetro del cliente", async () => {
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(Buffer.from("%PDF"));
    await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30&empresa_id=999"), ctx);
    expect(comprobanteAutorizacionesPdf).toHaveBeenCalledWith(7, "SITSA", expect.anything());
  });
});
