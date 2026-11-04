import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { requireTenantGastos } from "@/lib/tenant";
import { query } from "@/lib/db";
import { GET } from "./route";

/** OP-FONDOS-REP-01 — GET del reporte de fondos con filtro de categoría (reportes-gastos.ts REAL, base mockeada). */
const ctx = { params: Promise.resolve({ slug: "demo" }) };
const get = (qs: string) => GET(new Request(`http://localhost/api/empresas/demo/tms/reportes/gastos?${qs}`), ctx);
const fila = (o: Record<string, unknown>) => ({
  linea_id: 1, solicitud_id: 10, solicitud_codigo: "F-10", fecha_solicitud: "2026-09-03", fecha_viaje: null, empleado_id: null, empleado_nombre: null,
  cuenta: null, metodo_pago: null, cargo: null, vehiculo_id: null, placa: null, cliente_id: null, cliente_nombre: null, plan_id: null,
  categoria: "Combustible", cantidad: "2.00", descripcion: null, monto: "100.50", total_solicitud: "501.00", estado: "Autorizada", observaciones: null, ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue({ session: { id: 1, rol: "Admin" }, empresa: { id: 7, nombre: "SITSA", modulos: ["tms"] } } as never);
});

describe("GET /tms/reportes/gastos?tipo=fondos&categoria=…", () => {
  it("sin permiso: 403 y NO se valida ni se consulta nada (autorización antes que filtros)", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }) } as never);
    const res = await get("tipo=fondos&categoria=Inexistente");
    expect(res.status).toBe(403);
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });
  it("categoría inválida: 400 FILTRO_INVALIDO y no se ejecuta ninguna consulta (no es una búsqueda general)", async () => {
    for (const c of ["Inexistente", "combustible", "%20", "Gasolina%20vieja"]) {
      const res = await get(`tipo=fondos&categoria=${c}`);
      expect(res.status, c).toBe(400);
      const cuerpo = await res.json();
      expect(cuerpo.codigo).toBe("FILTRO_INVALIDO");
      expect(cuerpo.error).toMatch(/Categoría inválida/);
    }
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });
  it("categoría válida: filtra por la línea, usa la empresa de la SESIÓN y devuelve filas + resumen del mismo conjunto", async () => {
    vi.mocked(query).mockResolvedValue([fila({}), fila({ linea_id: 2, cantidad: "1.00", monto: "10.00" })] as never);
    const res = await get("tipo=fondos&categoria=Combustible&clienteId=5&empresaId=999");
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("l.categoria = ?");
    expect(params).toEqual([7, 5, "Combustible"]); // empresaId=999 del cliente se ignora
    const cuerpo = await res.json();
    expect(cuerpo.filas).toHaveLength(2);
    expect(cuerpo.resumen).toMatchObject({ categoria: "Combustible", cantidad: 1, totalSolicitado: 211 });
    expect(cuerpo.filas[0]).toMatchObject({ categoria: "Combustible", totalExacto: "201.0000", subtotalCategoria: 211, totalSolicitud: 501 });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("sin categoría: comportamiento anterior (sin condición de categoría, resumen sin 'categoria')", async () => {
    vi.mocked(query).mockResolvedValue([fila({})] as never);
    const res = await get("tipo=fondos");
    expect(res.status).toBe(200);
    const [sql] = vi.mocked(query).mock.calls[0] as unknown as [string];
    expect(sql).not.toContain("l.categoria = ?");
    const cuerpo = await res.json();
    expect("categoria" in cuerpo.resumen).toBe(false);
    expect(cuerpo.resumen.totalSolicitado).toBe(501);
  });
  it("otros tipos de reporte no cambian: una categoría desconocida no produce 400 (heredado, documentado)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const res = await get("tipo=gastosDetalle&categoria=Inexistente");
    expect(res.status).toBe(200);
  });
});
