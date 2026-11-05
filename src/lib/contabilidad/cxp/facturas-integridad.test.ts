import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn(), poolQuery: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ query: m.poolQuery }) }));
vi.mock("@/lib/tenant", () => ({ requireTenantCxp: m.guard }));
import { listarFacturas, obtenerFactura } from "./facturas";
import { calcularSaldo } from "./saldo";
import { GET as listado } from "@/app/api/empresas/[slug]/contabilidad/cxp/facturas/route";
import { GET as individual } from "@/app/api/empresas/[slug]/contabilidad/cxp/facturas/[id]/route";

const fila = (id: number, extra: Record<string, unknown> = {}) => ({
  id, empresa_id: 1, entidad_id: 5, proveedor_id: id + 10, nombre_comercial: `Proveedor ${id}`,
  tipo_documento: "FACTURA", serie: "A", numero: String(id), fecha_documento: "2026-11-01", fecha_vencimiento: null,
  base_neto: "100.00", iva_monto: "12.00", total_documento: "112.00", isr_porcentaje: "5.00", isr_monto: "5.00", total_neto_pagar: "107.00",
  estado_admin: "REGISTRADA", regimen_fiscal_snapshot: "GENERAL", sujeto_isr_snapshot: 1,
  creado_por: 1, creado_en: "2026-11-01 10:00:00", anulado_por: null, anulado_en: null, motivo_anulacion: null, observaciones: null,
  ...extra,
});
let rows: ReturnType<typeof fila>[];
let applications: { factura_id: number; pagado: string }[];
beforeEach(() => {
  vi.resetAllMocks();
  rows = [fila(1), fila(2)];
  applications = [{ factura_id: 1, pagado: "107.01" }];
  m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 91, username: "qa", rol: "Contabilidad" } });
  m.query.mockImplementation(async (sql: string, params: number[]) => {
    expect(sql).toContain("x.empresa_id = ? AND x.entidad_id = ?");
    let found = rows.filter(r => r.empresa_id === params[0] && r.entidad_id === params[1]);
    if (sql.includes("x.id = ?")) found = found.filter(r => r.id === params[2]);
    if (sql.includes("x.proveedor_id = ?")) found = found.filter(r => r.proveedor_id === params[2]);
    return sql.includes("COUNT(*)") ? [{ n: found.length }] : found;
  });
  m.poolQuery.mockImplementation(async (sql: string, params: number[]) => {
    expect(sql).toContain("a.empresa_id = ? AND a.entidad_id = ?");
    expect(sql).toContain("p.empresa_id = a.empresa_id AND p.entidad_id = a.entidad_id");
    expect(sql).toContain("p.estado = 'REGISTRADO'");
    expect(sql).toContain("SUM(a.monto)");
    return [applications.filter(a => params.slice(2).includes(a.factura_id)), []];
  });
});

describe("regresión de lectura CxP con sobreaplicación", () => {
  it("una sobreaplicada no hace desaparecer las otras facturas ni inventa saldo cero", async () => {
    const result = await listarFacturas(1, 5);
    expect(result.facturas).toHaveLength(2);
    expect(result.facturas[0]).toMatchObject({ totalDocumento: "112.00", isrMonto: "5.00", montoPagadero: "107.00", pagado: "107.01", saldo: null, estadoFinanciero: "SOBREAPLICADA", excesoAplicado: "0.01" });
    expect(result.facturas[0]).toHaveProperty("advertenciasIntegridad", [expect.objectContaining({ codigo: "SOBREAPLICACION", facturaId: 1 })]);
    expect(result.facturas[1]).toMatchObject({ saldo: "107.00", estadoFinanciero: "PENDIENTE" });
  });
  it("la consulta individual conserva importes y advierte", async () => {
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ saldo: null, pagado: "107.01", estadoFinanciero: "SOBREAPLICADA" });
  });
  it.each([["0.00", "107.00", "PENDIENTE"], ["7.01", "99.99", "PARCIAL"], ["107.00", "0.00", "PAGADA"]])("aplicado %s conserva saldo %s y estado %s", async (pagado, saldo, estadoFinanciero) => {
    applications = [{ factura_id: 1, pagado }];
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ pagado, saldo, estadoFinanciero, advertenciasIntegridad: [] });
  });
  it("una anulada normal conserva saldo administrativo cero", async () => {
    rows[0].estado_admin = "ANULADA"; applications = [];
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ saldo: "0.00", estadoFinanciero: "ANULADA", advertenciasIntegridad: [] });
  });
  it.each(["1.01", "107.01"])("anulada con pago vigente %s no oculta la anomalía", async pagado => {
    rows[0].estado_admin = "ANULADA"; applications = [{ factura_id: 1, pagado }];
    const result = await obtenerFactura(1, 5, 1);
    expect(result).toMatchObject({ saldo: null, estadoFinanciero: "ANULADA", pagado });
    expect(result).toHaveProperty("advertenciasIntegridad", expect.arrayContaining([expect.objectContaining({ codigo: "PAGO_VIGENTE_EN_ANULADA" })]));
  });
  it("reversos no suman; discrepancias de cabecera no sustituyen la suma de aplicaciones", async () => {
    // Doble del agregado SQL: cero tras reverso, luego suma de aplicaciones 7.01 aunque la cabecera fuera 100.
    applications = [];
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ pagado: "0.00", saldo: "107.00" });
    applications = [{ factura_id: 1, pagado: "7.01" }];
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ pagado: "7.01", saldo: "99.99" });
  });
  it("conserva precisión DECIMAL en importes grandes y exceso de un centavo", async () => {
    rows[0] = fila(1, { total_documento: "9999999999.99", isr_monto: "0.00", total_neto_pagar: "9999999999.99" });
    applications = [{ factura_id: 1, pagado: "10000000000.00" }];
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ montoPagadero: "9999999999.99", pagado: "10000000000.00", excesoAplicado: "0.01", saldo: null });
  });
  it("mantiene la invariante estricta para escrituras", () => {
    expect(() => calcularSaldo({ totalNetoPagar: "107.00" }, "107.01")).toThrow(RangeError);
  });
});

describe("rutas GET reales con servicio y agregado doblado", () => {
  const request = (query = "entidad=5") => new Request(`http://qa/facturas?${query}`);
  const ctx = { params: Promise.resolve({ slug: "qa" }) };
  it("listado e individual devuelven 200 privado sin detalles de pagos", async () => {
    for (const response of [await listado(request(), ctx), await individual(request(), { params: Promise.resolve({ slug: "qa", id: "1" }) })]) {
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json();
      const text = JSON.stringify(body); expect(text).toContain("SOBREAPLICACION");
      for (const key of ['"pagos"', '"pagoId"', '"referencia"', '"medio"', '"motivoReversion"']) expect(text).not.toContain(key);
    }
    expect(m.guard).toHaveBeenCalledWith("qa", "cxp_facturas", "ver", expect.any(String));
  });
  it("sin permiso no consulta datos", async () => {
    m.guard.mockResolvedValue({ error: new Response("prohibido", { status: 403 }) });
    expect((await listado(request(), ctx)).status).toBe(403);
    expect((await individual(request(), { params: Promise.resolve({ slug: "qa", id: "1" }) })).status).toBe(403);
    expect(m.query).not.toHaveBeenCalled(); expect(m.poolQuery).not.toHaveBeenCalled();
  });
  it("filtra proveedor, entidad y empresa sin aceptar empresa de la query", async () => {
    rows.push(fila(3, { empresa_id: 2 }), fila(4, { entidad_id: 6 }));
    const response = await listado(request("entidad=5&proveedorId=12&empresaId=2"), ctx);
    expect(response.status).toBe(200); expect((await response.json()).facturas.map((f: { id: number }) => f.id)).toEqual([2]);
    expect(await obtenerFactura(2, 5, 1)).toBeNull(); expect(await obtenerFactura(1, 6, 1)).toBeNull();
    expect((await individual(request("entidad=6"), { params: Promise.resolve({ slug: "qa", id: "1" }) })).status).toBe(404);
  });
  it("migración de facturas pendiente sigue siendo 503 y errores desconocidos no se convierten en cero", async () => {
    m.query.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });
    const response = await listado(request(), ctx); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ codigo: "MIGRACION_PENDIENTE" });
    m.poolQuery.mockRejectedValueOnce(new Error("fallo de lectura"));
    await expect(obtenerFactura(1, 5, 1)).rejects.toThrow("fallo de lectura");
  });
  it("pagos sin migración mantienen la tolerancia existente de M-3A", async () => {
    m.poolQuery.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE" });
    expect(await obtenerFactura(1, 5, 1)).toMatchObject({ pagado: "0.00", saldo: "107.00", advertenciasIntegridad: [] });
  });
});
