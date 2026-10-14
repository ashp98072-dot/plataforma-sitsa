import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  permiso: true,
  listar: vi.fn(),
  guardLlamadas: [] as [string, string, string][],
}));

vi.mock("@/lib/tenant", () => ({
  requireTenantRrhh: vi.fn(async (slug: string, sub: string, accion: string) => {
    m.guardLlamadas.push([slug, sub, accion]);
    return m.permiso
      ? { session: { id: 3, username: "rrhh", rol: "RRHH" }, empresa: { id: 7, nombre: "Empresa Siete" } }
      : { error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }) };
  }),
}));
vi.mock("@/lib/rrhh/cumpleanios", async (original) => {
  const real = await original<typeof import("./cumpleanios-shared")>();
  return { ...real, listarCumpleaniosDelMes: m.listar, resumenCumpleaniosDelMes: vi.fn() };
});
vi.mock("@/lib/rrhh/dates", () => ({ hoyLocal: () => "2026-10-14" }));

import {
  edadQueCumple,
  fechaCumpleanios,
  filasExcelCumpleanios,
  nombreArchivoCumpleanios,
  parseAnio,
  parseMes,
  type CumpleaniosEmpleado,
} from "./cumpleanios-shared";
import { GET } from "../../app/api/empresas/[slug]/rrhh/cumpleanios/route";

const leer = (p: string) => readFileSync(p, "utf8");
const ctx = { params: Promise.resolve({ slug: "acme" }) };
const emp = (o: Partial<CumpleaniosEmpleado> = {}): CumpleaniosEmpleado => ({
  id: 1, codigo: "E-001", nombre: "Ana Pérez", puesto: "Piloto", area: "Operaciones", estado: "Activo",
  fecha: "2026-10-05", dia: 5, edad: 36, ...o,
});
const listado = (empleados: CumpleaniosEmpleado[] = [emp()]) => ({
  mes: 10, anio: 2026, nombreMes: "Octubre", incluirInactivos: false, total: empleados.length, truncado: false, empleados,
});

beforeEach(() => {
  m.permiso = true;
  m.guardLlamadas.length = 0;
  m.listar.mockReset().mockResolvedValue(listado());
});

describe("Cumpleaños · reglas de fecha y edad (puras)", () => {
  it("edad = año consultado − año de nacimiento (no depende del día)", () => {
    expect(edadQueCumple("1990-10-05", 2026)).toBe(36);
    expect(edadQueCumple("1990-12-31", 2026)).toBe(36);
    expect(edadQueCumple("2000-02-29", 2026)).toBe(26);
    expect(edadQueCumple("2026-10-05", 2026)).toBeNull(); // dato incoherente: no se inventa una edad 0
    expect(edadQueCumple("2030-01-01", 2026)).toBeNull();
    expect(edadQueCumple(null, 2026)).toBeNull();
  });

  it("29 de febrero: se muestra su fecha REAL (29/feb) en cualquier año; no se convierte a 28/02 ni a 01/03", () => {
    expect(fechaCumpleanios("2000-02-29", 2024)).toEqual({ iso: "2024-02-29", dia: 29, mes: 2 });
    expect(fechaCumpleanios("2000-02-29", 2026)).toEqual({ iso: "2026-02-29", dia: 29, mes: 2 });
    expect(fechaCumpleanios("1990-02-28", 2026)).toEqual({ iso: "2026-02-28", dia: 28, mes: 2 });
    expect(fechaCumpleanios("basura", 2026)).toBeNull();
    // La edad sigue siendo año consultado − año de nacimiento, también para quien nació un 29/02.
    expect(edadQueCumple("2000-02-29", 2026)).toBe(26);
    expect(edadQueCumple("2000-02-29", 2024)).toBe(24);
  });

  it("mes/año: solo enteros válidos", () => {
    expect(parseMes("10")).toBe(10);
    expect(parseMes(1)).toBe(1);
    for (const malo of ["0", "13", "abc", "", "1.5", "-1", null, undefined]) expect(parseMes(malo), String(malo)).toBeNull();
    expect(parseAnio("2026")).toBe(2026);
    for (const malo of ["26", "1899", "2101", "abcd", "", null]) expect(parseAnio(malo), String(malo)).toBeNull();
  });

  it("nombre de archivo sugerido sin tildes ni eñes", () => {
    expect(nombreArchivoCumpleanios(10, 2026)).toBe("Cumpleanios_Octubre_2026.xlsx");
    expect(nombreArchivoCumpleanios(9, 2026)).toBe("Cumpleanios_Septiembre_2026.xlsx");
    expect(nombreArchivoCumpleanios(1, 2027)).toBe("Cumpleanios_Enero_2027.xlsx");
  });
});

describe("Cumpleaños · endpoint (tenant, permiso, parámetros)", () => {
  it("exige el permiso de lectura de Reportes de RRHH y no consulta sin él", async () => {
    m.permiso = false;
    const r = await GET(new Request("http://x/api"), ctx);
    expect(r.status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled();
    expect(m.guardLlamadas).toEqual([["acme", "reportes", "ver"]]);
  });

  it("la empresa sale de la sesión aunque el cliente mande otra (query)", async () => {
    const r = await GET(new Request("http://x/api?mes=10&anio=2026&empresaId=999&empresa_id=999&empresa=otra"), ctx);
    expect(r.status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(7, 10, 2026, { incluirInactivos: false });
  });

  it("por defecto usa el mes y año actuales y solo activos; incluirInactivos solo con 1", async () => {
    await GET(new Request("http://x/api"), ctx);
    expect(m.listar).toHaveBeenLastCalledWith(7, 10, 2026, { incluirInactivos: false });
    await GET(new Request("http://x/api?mes=2&anio=2024&incluirInactivos=1"), ctx);
    expect(m.listar).toHaveBeenLastCalledWith(7, 2, 2024, { incluirInactivos: true });
    await GET(new Request("http://x/api?incluirInactivos=true"), ctx);
    expect(m.listar).toHaveBeenLastCalledWith(7, 10, 2026, { incluirInactivos: false });
  });

  it("parámetros inválidos = 400 sin consultar", async () => {
    for (const q of ["mes=13", "mes=0", "mes=abc", "anio=26", "anio=3000", "formato=pdf"]) {
      const r = await GET(new Request(`http://x/api?${q}`), ctx);
      expect(r.status, q).toBe(400);
    }
    expect(m.listar).not.toHaveBeenCalled();
  });

  it("JSON: devuelve el listado de la empresa sin campos sensibles", async () => {
    const r = await GET(new Request("http://x/api?mes=10&anio=2026"), ctx);
    const body = await r.json();
    expect(body).toMatchObject({ mes: 10, anio: 2026, total: 1, empresa: "Empresa Siete" });
    const claves = JSON.stringify(body);
    expect(claves).not.toMatch(/dpi|nit|igss|irtra|direccion|telefono|email|sueldo|cuenta/i);
  });

  it("Excel: nombre sugerido, columnas exactas y solo datos no sensibles", async () => {
    m.listar.mockResolvedValue(listado([
      emp({ id: 1, codigo: "E-001", nombre: "Ana Pérez", dia: 5, fecha: "2026-10-05", edad: 36, puesto: "Piloto", area: "Operaciones" }),
      emp({ id: 2, codigo: "E-002", nombre: "Luis Gómez", dia: 20, fecha: "2026-10-20", edad: 41, puesto: "Contador", area: "Administración" }),
    ]));
    const r = await GET(new Request("http://x/api?mes=10&anio=2026&formato=xlsx"), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="Cumpleanios_Octubre_2026.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const filas = ws.getSheetValues().slice(1).map((f) => (f as unknown[]).slice(1));
    expect(filas[0]).toEqual(["Código", "Empleado", "Fecha de cumpleaños", "Edad que cumple", "Puesto", "Área"]);
    expect(filas[1]).toEqual(["E-001", "Ana Pérez", "05/10/2026", "36", "Piloto", "Operaciones"]);
    expect(filas[2]).toEqual(["E-002", "Luis Gómez", "20/10/2026", "41", "Contador", "Administración"]);
    expect(ws.columnCount).toBe(6);
  });

  it("filas de Excel: exactamente 6 columnas y fecha dd/mm/aaaa", () => {
    const filas = filasExcelCumpleanios([emp({ edad: null })]);
    expect(filas).toEqual([["E-001", "Ana Pérez", "05/10/2026", "", "Piloto", "Operaciones"]]);
  });
});

describe("Cumpleaños · alcance (arquitectura)", () => {
  const lib = leer("src/lib/rrhh/cumpleanios.ts");
  const ruta = leer("src/app/api/empresas/[slug]/rrhh/cumpleanios/route.ts");

  it("la consulta filtra por empresa + mes de nacimiento + estado y no selecciona datos sensibles", () => {
    expect(lib).toMatch(/WHERE empresa_id = \? AND fecha_nacimiento IS NOT NULL AND MONTH\(fecha_nacimiento\) = \?/);
    expect(lib).toMatch(/AND estado = 'Activo'/);
    expect(lib).toMatch(/ORDER BY DAY\(fecha_nacimiento\) ASC, nombre ASC, id ASC/);
    // Sin convención de celebración: el 29/feb no se traslada a otro día (ni en SQL ni en código).
    expect(lib).not.toMatch(/LEAST\(|esBisiesto|ajuste29/);
    expect(leer("src/lib/rrhh/cumpleanios-shared.ts")).not.toMatch(/esBisiesto|ajuste29|dia = 28/);
    const selects = lib.match(/SELECT[\s\S]*?FROM empleados/g) ?? [];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const s of selects) expect(s, s).not.toMatch(/\b(dpi|nit|igss|irtra|direccion|telefono|email|sueldo|cuenta_bancaria|contacto_emergencia)\b/i);
    expect(lib).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/);
  });

  it("el endpoint usa el guard de Reportes de RRHH, es solo lectura y no toma empresa del cliente", () => {
    expect(ruta).toMatch(/requireTenantRrhh\(slug, "reportes", "ver"\)/);
    expect(ruta).toMatch(/guard\.empresa\.id/);
    expect(ruta).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)/);
    expect(ruta).not.toMatch(/searchParams\.get\("(empresa|empresaId|empresa_id)"\)/);
  });

  it("no crea migración ni columna: no hay SQL nuevo de cumpleaños", () => {
    expect(lib).not.toMatch(/ADD COLUMN|CREATE INDEX/i);
  });

  it("el dashboard solo recibe el resumen (conteo + próximos), no el listado completo", () => {
    const dash = leer("src/app/api/empresas/[slug]/rrhh/dashboard/route.ts");
    expect(dash).toMatch(/resumenCumpleaniosDelMes\(/);
    expect(dash).not.toMatch(/listarCumpleaniosDelMes/);
    expect(lib).toMatch(/LIMIT \$\{max\}/);
  });

  it("la UI enlaza el listado desde el dashboard y desde Reportes", () => {
    expect(leer("src/app/e/[slug]/dashboard-rrhh/page.tsx")).toMatch(/rrhh\/reportes\/cumpleanios/);
    expect(leer("src/app/e/[slug]/rrhh/reportes/page.tsx")).toMatch(/rrhh\/reportes\/cumpleanios/);
    const pagina = leer("src/app/e/[slug]/rrhh/reportes/cumpleanios/page.tsx");
    expect(pagina).toMatch(/cumpleanios-shared/);
    expect(pagina).not.toMatch(/from "@\/lib\/rrhh\/cumpleanios"/); // la página de cliente no importa código de BD
    const sinComentarios = pagina.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(sinComentarios).not.toMatch(/dpi|\bnit\b|igss|telefono|direccion/i);
    expect(sinComentarios).not.toMatch(/ajuste29|nació 29/);
  });

  it("el control Excel no inicia descargas mientras carga o si no hay empleados (deshabilitado de verdad)", () => {
    const pagina = leer("src/app/e/[slug]/rrhh/reportes/cumpleanios/page.tsx");
    expect(pagina).toMatch(/const puedeExportar = !cargando && !error && datos != null && datos\.total > 0;/);
    // El enlace de descarga solo existe dentro de la rama «puedeExportar»; la otra rama es un <button disabled>.
    expect(pagina).toMatch(/\{puedeExportar \? \(\s*<a href=\{consulta\("xlsx"\)\}/);
    expect(pagina).toMatch(/<button\s+type="button"\s+disabled/);
    expect(pagina).not.toMatch(/aria-disabled/);
    expect(pagina.match(/consulta\("xlsx"\)/g)?.length).toBe(1);
  });
});
