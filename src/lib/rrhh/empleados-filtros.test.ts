import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { construirParamsEmpleados, hrefExportEmpleados, parsearFiltrosEmpleados } from "./empleados-filtros";

const src = readFileSync("src/app/e/[slug]/rrhh/empleados/page.tsx", "utf8").replace(/\r\n/g, "\n");
const qs = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

describe("enlaces Excel / PDF (helper compartido con el listado)", () => {
  const todos = { q: "Walter", tipoContrato: "fijo", formaPago: "transferencia", estado: "Baja" };

  it("Excel incluye los filtros actuales", () => {
    expect(hrefExportEmpleados("acme", "xlsx", todos)).toBe("/api/empresas/acme/empleados/export?format=xlsx&q=Walter&tipoContrato=fijo&formaPago=transferencia&estado=Baja");
  });

  it("PDF incluye los filtros actuales", () => {
    expect(hrefExportEmpleados("acme", "pdf", todos)).toBe("/api/empresas/acme/empleados/export?format=pdf&q=Walter&tipoContrato=fijo&formaPago=transferencia&estado=Baja");
  });

  it("Excel y PDF usan EXACTAMENTE los mismos filtros (solo cambia el formato)", () => {
    const { format: f1, ...x } = qs(hrefExportEmpleados("acme", "xlsx", todos));
    const { format: f2, ...p } = qs(hrefExportEmpleados("acme", "pdf", todos));
    expect([f1, f2]).toEqual(["xlsx", "pdf"]);
    expect(x).toEqual(p);
  });

  it("'Todos' (estado vacío) NO envía `estado`; tampoco se envían parámetros vacíos", () => {
    const href = hrefExportEmpleados("acme", "xlsx", { q: "  ", tipoContrato: "", formaPago: "", estado: "" });
    expect(href).toBe("/api/empresas/acme/empleados/export?format=xlsx");
    expect(href).not.toContain("estado");
  });

  it("vista por defecto (Activos): sólo estado=Activo", () => {
    expect(qs(hrefExportEmpleados("acme", "pdf", { estado: "Activo" }))).toEqual({ format: "pdf", estado: "Activo" });
  });

  it("cambiar un filtro cambia la URL de exportación", () => {
    const base = { estado: "Activo" };
    const a = hrefExportEmpleados("acme", "xlsx", base);
    expect(hrefExportEmpleados("acme", "xlsx", { ...base, estado: "Baja" })).not.toBe(a);
    expect(hrefExportEmpleados("acme", "xlsx", { ...base, estado: "" })).not.toBe(a);
    expect(hrefExportEmpleados("acme", "xlsx", { ...base, q: "Ana" })).not.toBe(a);
    expect(hrefExportEmpleados("acme", "xlsx", { ...base, tipoContrato: "prueba" })).not.toBe(a);
    expect(hrefExportEmpleados("acme", "xlsx", { ...base, formaPago: "cheque" })).not.toBe(a);
  });

  it("la búsqueda se codifica (espacios, tildes, & y =) sin romper otros parámetros", () => {
    const r = qs(hrefExportEmpleados("acme", "xlsx", { q: "Ñ&o=1 ú", estado: "Activo" }));
    expect(r.q).toBe("Ñ&o=1 ú");
    expect(r.estado).toBe("Activo");
    expect(r.o).toBeUndefined();
  });

  it("el listado (cargar) y la exportación construyen los MISMOS parámetros de filtro (mismo helper)", () => {
    const f = { q: " Ana ", tipoContrato: "fijo", formaPago: "cheque", estado: "Activo" };
    const { format, ...delExport } = qs(hrefExportEmpleados("acme", "xlsx", f));
    expect(format).toBe("xlsx");
    expect(delExport).toEqual(Object.fromEntries(construirParamsEmpleados(f)));
  });
});

describe("pantalla (código fuente)", () => {
  it("cargar() y los dos enlaces salen del MISMO objeto filtrosActuales (q aplicada/debounced, tipo, pago, estado)", () => {
    expect(src).toContain("q: qDebounced, tipoContrato: filtroTipo, formaPago: filtroPago, estado: filtroEstado");
    expect(src).toContain("construirParamsEmpleados(filtrosActuales)");
    expect(src).toContain('href={hrefExportEmpleados(slug, "xlsx", filtrosActuales)}');
    expect(src).toContain('href={hrefExportEmpleados(slug, "pdf", filtrosActuales)}');
  });

  it("la plantilla Excel sigue sin filtros", () => {
    expect(src).toContain("href={`/api/empresas/${slug}/empleados/export?format=plantilla`}");
  });
});

describe("parsearFiltrosEmpleados (servidor)", () => {
  const parse = (s: string) => parsearFiltrosEmpleados(new URLSearchParams(s));

  it("vacío = sin filtros", () => {
    expect(parse("")).toEqual({ ok: true, filtros: { q: "", tipoContrato: undefined, formaPago: undefined, estado: undefined } });
  });

  it("solo Activo, Baja o ausente; cualquier otro valor -> 'Estado inválido.'", () => {
    expect(parse("estado=Activo")).toMatchObject({ ok: true, filtros: { estado: "Activo" } });
    expect(parse("estado=Baja")).toMatchObject({ ok: true, filtros: { estado: "Baja" } });
    expect(parse("estado=")).toMatchObject({ ok: true, filtros: { estado: undefined } });
    for (const v of ["Todos", "activo", "x", "Baja;DROP"]) expect(parse(`estado=${encodeURIComponent(v)}`)).toEqual({ ok: false, error: "Estado inválido." });
  });

  it("contrato y pago se validan contra los catálogos existentes", () => {
    expect(parse("tipoContrato=Fijo&formaPago=Efectivo")).toMatchObject({ ok: true, filtros: { tipoContrato: "fijo", formaPago: "efectivo" } });
    expect(parse("tipoContrato=otro")).toEqual({ ok: false, error: "Tipo de contrato inválido." });
    expect(parse("formaPago=otro")).toEqual({ ok: false, error: "Forma de pago inválida." });
  });
});
