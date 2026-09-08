import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/rrhh/export-files", () => ({
  tablaAExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx"))),
  tablaAPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}));

import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * PROGRAMACION-REPORTES-FILTROS-1 — el reporte tradicional de
 * Programación (Excel/PDF) SOLO aceptaba fecha/fechaDesde/fechaHasta:
 * cualquier otro filtro activo en el tablero (Estado, Piloto, Unidad,
 * Cliente) se ignoraba al exportar. Estas pruebas cubren la corrección —
 * mismo criterio SQL que ya usa `visibles` en programacion-client.tsx.
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantModulo>>,
  );
  vi.mocked(query).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/programacion/reporte — exige permiso y rango de fechas", () => {
  it("exige el permiso de módulo TMS antes de consultar nada", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantModulo>>);
    const res = await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("sin fecha/rango y sin estado=PendienteCierre, responde 400 (nunca exporta todo el histórico sin acotar)", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("GET /tms/programacion/reporte — respeta estado (mismo criterio que el filtro rápido del tablero)", () => {
  it("estado=Cerrado exporta SOLO viajes cerrados", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(params).toContain("Cerrado");
  });

  it("estado=Programado exporta SOLO viajes programados", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Programado"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado = ?");
    expect(params).toContain("Programado");
  });

  it("un valor de estado no soportado se ignora (nunca se concatena texto arbitrario en el WHERE)", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=algo-invalido"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).not.toContain("p.estado = ?");
    expect(params).not.toContain("algo-invalido");
  });

  it("estado=PendienteCierre usa el MISMO criterio SQL que tms/planes?pendienteCierre=1 y reportes-viajes.ts, e ignora el rango de fechas", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx&estado=PendienteCierre"), ctx);
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.estado NOT IN ('Cerrado', 'Cancelado')");
    expect(sql).toContain("fv.estado = 'cerrado'");
    expect(sql).not.toContain("p.fecha_plan BETWEEN");
    expect(params).toEqual([7]);
  });
});

describe("GET /tms/programacion/reporte — respeta fechaDesde/fechaHasta", () => {
  it("aplica el rango exacto recibido", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.fecha_plan BETWEEN ? AND ?");
    expect(params).toEqual([7, "2026-09-01", "2026-09-08"]);
  });

  it("fecha=X (día específico) equivale a fechaDesde=fechaHasta=X", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fecha=2026-09-03"), ctx);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([7, "2026-09-03", "2026-09-03"]);
  });
});

describe("GET /tms/programacion/reporte — respeta piloto/unidad/cliente (match exacto, igual que el tablero)", () => {
  it("filtra por piloto exacto", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&piloto=Carlos+Ruiz"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("pil.nombre = ?");
    expect(params).toContain("Carlos Ruiz");
  });

  it("filtra por unidad (placa) exacta", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&unidad=P123ABC"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("u.placa = ?");
    expect(params).toContain("P123ABC");
  });

  it("filtra por cliente exacto", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&cliente=Cliente+X"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("c.nombre = ?");
    expect(params).toContain("Cliente X");
  });

  it("combina fecha + estado + piloto + unidad + cliente en una sola consulta (AND, todos aplican a la vez)", async () => {
    await GET(new Request(
      "http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado&piloto=Carlos+Ruiz&unidad=P123ABC&cliente=Cliente+X",
    ), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.fecha_plan BETWEEN ? AND ?");
    expect(sql).toContain("p.estado = ?");
    expect(sql).toContain("pil.nombre = ?");
    expect(sql).toContain("u.placa = ?");
    expect(sql).toContain("c.nombre = ?");
    expect(params).toEqual([7, "2026-09-01", "2026-09-08", "Cerrado", "Carlos Ruiz", "P123ABC", "Cliente X"]);
  });
});

describe("GET /tms/programacion/reporte — aislamiento multiempresa", () => {
  it("siempre filtra por el empresa_id resuelto por requireTenantModulo, nunca por uno enviado por el cliente", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue(
      { empresa: { id: 42, nombre: "Otra Empresa" }, session: { id: 1, username: "x" } } as Awaited<ReturnType<typeof requireTenantModulo>>,
    );
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08&empresaId=999"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.empresa_id = ?");
    expect(params?.[0]).toBe(42);
  });
});

describe("GET /tms/programacion/reporte — columnas del reporte tradicional sin cambios", () => {
  it("el Excel sigue sin incluir costo operativo de referencia, referencia de cliente ni observaciones (nunca los tuvo)", async () => {
    await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
    const headers = vi.mocked(tablaAExcel).mock.calls[0][0].headers;
    expect(headers).toEqual([
      "Mes", "Día", "Placa", "Piloto", "Auxiliar 1", "Auxiliar 2",
      "Código", "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga",
    ]);
  });

  it("formato=pdf sigue generando PDF (tablaAPdf) sin romper el flujo existente", async () => {
    const res = await GET(new Request("http://localhost/x?formato=pdf&fechaDesde=2026-09-01&fechaHasta=2026-09-08&estado=Cerrado"), ctx);
    expect(res.status).toBe(200);
    expect(tablaAPdf).toHaveBeenCalledTimes(1);
    const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
    expect(llamada.subtitle).toContain("Estado: Cerrado");
  });
});
