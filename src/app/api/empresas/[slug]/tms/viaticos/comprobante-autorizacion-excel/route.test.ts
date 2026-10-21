import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosComprobantes: vi.fn() }));
vi.mock("@/lib/tms/viaticos-comprobante-excel", () => ({ comprobanteAutorizacionesExcel: vi.fn() }));

import { requireTenantViaticosComprobantes } from "@/lib/tenant";
import { comprobanteAutorizacionesExcel } from "@/lib/tms/viaticos-comprobante-excel";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 — equivalente Excel de comprobante-autorizacion-pdf/route.test.ts: mismo
 * contrato (permiso, validación de período, 400/404/200), único cambio real es el Content-Type/nombre de
 * archivo. empresa_id/nombre SIEMPRE vienen del guard, nunca del cliente.
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

describe("GET /tms/viaticos/comprobante-autorizacion-excel", () => {
  it("exige viaticos_comprobantes:ver ANTES de tocar la lib o validar parámetros", async () => {
    vi.mocked(requireTenantViaticosComprobantes).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantViaticosComprobantes>>);
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.status).toBe(403);
    expect(comprobanteAutorizacionesExcel).not.toHaveBeenCalled();
    expect(requireTenantViaticosComprobantes).toHaveBeenCalledWith("prueba", "ver");
  });

  it("sin ?periodo -> 400, nunca llega a la lib", async () => {
    const res = await GET(new Request("http://localhost/x?valor=2026-09-30"), ctx);
    expect(res.status).toBe(400);
    expect(comprobanteAutorizacionesExcel).not.toHaveBeenCalled();
  });

  it("?periodo con un valor no reconocido (ni DIA/SEMANA/MES) -> 400", async () => {
    const res = await GET(new Request("http://localhost/x?periodo=ANIO&valor=2026"), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(comprobanteAutorizacionesExcel).not.toHaveBeenCalled();
  });

  it("?periodo válido pero ?valor con formato inválido -> 400", async () => {
    const res = await GET(new Request("http://localhost/x?periodo=MES&valor=2026-13"), ctx);
    expect(res.status).toBe(400);
    expect(comprobanteAutorizacionesExcel).not.toHaveBeenCalled();
  });

  it("período válido sin viáticos autorizados -> 404 con mensaje estructurado, nunca un Excel vacío", async () => {
    vi.mocked(comprobanteAutorizacionesExcel).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No hay viáticos autorizados en el período seleccionado.");
  });

  it("lote válido -> 200 con Content-Type de xlsx, y la lib recibe empresa_id/nombre del guard + el período resuelto", async () => {
    const buffer = Buffer.from("PK contenido de prueba");
    vi.mocked(comprobanteAutorizacionesExcel).mockResolvedValue(buffer);
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(comprobanteAutorizacionesExcel).toHaveBeenCalledWith(
      7,
      "SITSA",
      expect.objectContaining({ inicio: "2026-09-30 00:00:00", finExclusivo: "2026-10-01 00:00:00" }),
    );
    const arrBuf = await res.arrayBuffer();
    expect(Buffer.from(arrBuf).equals(buffer)).toBe(true);
  });

  it("Content-Disposition correcto para DÍA (.xlsx, no .pdf)", async () => {
    vi.mocked(comprobanteAutorizacionesExcel).mockResolvedValue(Buffer.from("PK"));
    const res = await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30"), ctx);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="viaticos-autorizados-2026-09-30.xlsx"');
  });

  it("Content-Disposition correcto para SEMANA", async () => {
    vi.mocked(comprobanteAutorizacionesExcel).mockResolvedValue(Buffer.from("PK"));
    const res = await GET(new Request("http://localhost/x?periodo=SEMANA&valor=2026-W40"), ctx);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="viaticos-autorizados-2026-W40.xlsx"');
  });

  it("Content-Disposition correcto para MES", async () => {
    vi.mocked(comprobanteAutorizacionesExcel).mockResolvedValue(Buffer.from("PK"));
    const res = await GET(new Request("http://localhost/x?periodo=MES&valor=2026-09"), ctx);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="viaticos-autorizados-2026-09.xlsx"');
  });

  it("empresa_id/nombre SIEMPRE vienen del guard, nunca de un parámetro del cliente", async () => {
    vi.mocked(comprobanteAutorizacionesExcel).mockResolvedValue(Buffer.from("PK"));
    await GET(new Request("http://localhost/x?periodo=DIA&valor=2026-09-30&empresa_id=999"), ctx);
    expect(comprobanteAutorizacionesExcel).toHaveBeenCalledWith(7, "SITSA", expect.anything());
  });
});
