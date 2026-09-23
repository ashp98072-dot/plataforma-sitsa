import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ listarEmpleados: vi.fn() }));
vi.mock("@/lib/rrhh/empleados-export", () => ({
  exportarEmpleadosExcel: vi.fn(),
  exportarEmpleadosPdf: vi.fn(),
  generarPlantillaEmpleados: vi.fn(),
}));

import { requireTenantRrhh } from "@/lib/tenant";
import { listarEmpleados } from "@/lib/rrhh/empleados";
import { exportarEmpleadosExcel, exportarEmpleadosPdf, generarPlantillaEmpleados } from "@/lib/rrhh/empleados-export";
import { GET } from "./route";

/**
 * RRHH-EMPLEADOS-EXPORT-FILTROS-1 — Excel/PDF exportan EXACTAMENTE el conjunto
 * filtrado de la pantalla; la plantilla no depende de filtros.
 */
const ctx = { params: Promise.resolve({ slug: "acme" }) };
const get = (qs = "") => GET(new Request(`http://x/api/empresas/acme/empleados/export${qs}`), ctx);
const empleados = [{ id: 1 }, { id: 2 }];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7, nombre: "ACME" }, session: {} } as never);
  vi.mocked(listarEmpleados).mockResolvedValue(empleados as never);
  vi.mocked(exportarEmpleadosExcel).mockResolvedValue(Buffer.from("xlsx"));
  vi.mocked(exportarEmpleadosPdf).mockResolvedValue(Buffer.from("pdf"));
  vi.mocked(generarPlantillaEmpleados).mockResolvedValue(Buffer.from("plantilla"));
});

const opts = () => vi.mocked(listarEmpleados).mock.calls[0];

describe("filtros propagados a listarEmpleados (mismo criterio que la pantalla)", () => {
  it("sin filtros: sin q y sin restricciones (todos los empleados de la empresa)", async () => {
    const r = await get("?format=xlsx");
    expect(r.status).toBe(200);
    expect(opts()).toEqual([7, "", { completo: true, conDocs: false, tipoContrato: undefined, formaPago: undefined, estado: undefined }]);
  });

  it.each(["Activo", "Baja"])("estado=%s se propaga", async (estado) => {
    await get(`?format=xlsx&estado=${estado}`);
    expect(opts()[2]).toMatchObject({ estado });
  });

  it("Todos = `estado` ausente (o vacío): NO filtra por estado (Activos + Bajas)", async () => {
    await get("?format=xlsx");
    expect(opts()[2]!.estado).toBeUndefined();
    vi.mocked(listarEmpleados).mockClear();
    await get("?format=xlsx&estado=");
    expect(opts()[2]!.estado).toBeUndefined();
  });

  it("q se propaga (recortada) como búsqueda", async () => {
    await get("?format=pdf&q=%20Walter%20");
    expect(opts()[1]).toBe("Walter");
  });

  it("tipoContrato y formaPago se propagan (en minúsculas, valores del catálogo)", async () => {
    await get("?format=xlsx&tipoContrato=Outsourcing&formaPago=cheque");
    expect(opts()[2]).toMatchObject({ tipoContrato: "outsourcing", formaPago: "cheque" });
  });

  it("combinación de todos los filtros, igual para Excel y PDF", async () => {
    await get("?format=xlsx&q=Walter&tipoContrato=fijo&formaPago=transferencia&estado=Baja");
    const xlsx = opts();
    vi.mocked(listarEmpleados).mockClear();
    await get("?format=pdf&q=Walter&tipoContrato=fijo&formaPago=transferencia&estado=Baja");
    expect(opts()).toEqual(xlsx);
    expect(xlsx).toEqual([7, "Walter", { completo: true, conDocs: false, tipoContrato: "fijo", formaPago: "transferencia", estado: "Baja" }]);
  });

  it("el formato elige el exportador y recibe EXACTAMENTE los empleados filtrados", async () => {
    await get("?format=xlsx&estado=Activo");
    expect(exportarEmpleadosExcel).toHaveBeenCalledWith(empleados, "ACME");
    expect(exportarEmpleadosPdf).not.toHaveBeenCalled();
    await get("?format=pdf&estado=Activo");
    expect(exportarEmpleadosPdf).toHaveBeenCalledWith(empleados, "ACME");
  });

  it("formato omitido = xlsx (como antes)", async () => {
    const r = await get("?estado=Baja");
    expect(r.headers.get("Content-Disposition")).toContain("empleados-acme.xlsx");
    expect(opts()[2]).toMatchObject({ estado: "Baja" });
  });
});

describe("validación: ningún valor arbitrario llega al SQL", () => {
  it.each(["Todos", "activo", "ACTIVO", "Activo' OR '1'='1", "Inactivo", "1"])("estado inválido %j -> 400 'Estado inválido.' sin consultar", async (estado) => {
    const r = await get(`?format=xlsx&estado=${encodeURIComponent(estado)}`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Estado inválido." });
    expect(listarEmpleados).not.toHaveBeenCalled();
  });

  it("tipoContrato o formaPago fuera del catálogo -> 400", async () => {
    expect((await get("?format=xlsx&tipoContrato=eterno")).status).toBe(400);
    expect((await get("?format=pdf&formaPago=bitcoin")).status).toBe(400);
    expect(listarEmpleados).not.toHaveBeenCalled();
  });
});

describe("plantilla y aislamiento", () => {
  it("format=plantilla ignora TODOS los filtros (incluso inválidos) y no lista empleados", async () => {
    const r = await get("?format=plantilla&estado=Baja&q=x&tipoContrato=zzz&formaPago=zzz");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toContain("plantilla_empleados.xlsx");
    expect(generarPlantillaEmpleados).toHaveBeenCalledTimes(1);
    expect(listarEmpleados).not.toHaveBeenCalled();
  });

  it("la empresa sale SIEMPRE de la sesión; empresa_id/empresaId del cliente se ignoran", async () => {
    await get("?format=xlsx&empresa_id=99&empresaId=99");
    expect(opts()[0]).toBe(7);
  });

  it("exige permiso empleados:ver del tenant; sin permiso no consulta nada", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({ error: "no" }, { status: 403 }) } as never);
    expect((await get("?format=xlsx&estado=Baja")).status).toBe(403);
    expect(requireTenantRrhh).toHaveBeenCalledWith("acme", "empleados", "ver");
    expect(listarEmpleados).not.toHaveBeenCalled();
  });

  it("un fallo interno responde 500 genérico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(listarEmpleados).mockRejectedValue(new Error("SQL privado"));
    const r = await get("?format=xlsx");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("SQL privado");
  });
});
