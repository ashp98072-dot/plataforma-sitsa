import { beforeEach, describe, expect, it, vi } from "vitest";

/** El historial actual SOLO puede leer: `execute`, `getPool` y cualquier escritura revientan el test. */
const db = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(() => { throw new Error("El historial actual NO debe escribir (execute)"); }),
  getPool: vi.fn(() => { throw new Error("El historial actual NO debe abrir transacciones (getPool)"); }),
}));
vi.mock("@/lib/db", () => ({ query: db.query, execute: db.execute, getPool: db.getPool }));

import { cargarHistorialActual, previsualizarHistorialActual } from "./vacaciones-historial-actual";
import { construirCsvHistorial } from "./vacaciones-historial-export";
import { construirXlsxHistorial } from "./vacaciones-historial-export-xlsx";
import { parsearCsv } from "./vacaciones-historial-import";
import { previsualizarHistorial } from "./vacaciones-historial-preview";
import { leerXlsx } from "./vacaciones-historial-xlsx";

const HOY = new Date(2026, 9, 6);
const EMPLEADOS = [
  { id: 1, codigo: "E-1", nombre: "Ana Pérez", estado: "Activo", fecha_alta: "2023-04-13", fecha_inicio_laboral: "2023-04-13", dpi: "2000111110101" },
  { id: 14, codigo: "E-14", nombre: "Amilcar Bernabé Torres Cho", estado: "Activo", fecha_alta: "2023-04-13", fecha_inicio_laboral: "2023-02-13", dpi: null },
  { id: 20, codigo: "E-20", nombre: "Carlos Mejía", estado: "Activo", fecha_alta: "2020-02-29", fecha_inicio_laboral: "2020-02-29", dpi: null },
  { id: 37, codigo: "E-37", nombre: "Elisa Jiménez López", estado: "Activo", fecha_alta: "1899-12-31", fecha_inicio_laboral: "1899-12-31", dpi: null },
  { id: 40, codigo: "E-40", nombre: "Diana Solís", estado: "Activo", fecha_alta: "2022-01-10", fecha_inicio_laboral: "2022-01-10", dpi: null },
];
type Fila = Record<string, unknown>;
let vacaciones: Fila[] = [];
let incidencias: Fila[] = [];
let dpiDisponible = true;

const v = (id: number, emp: number, ini: string, fin: string, dias: number, extra: Fila = {}): Fila => ({ id, id_empleado: emp, fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias, observaciones: null, estado: "Aprobado", ...extra });
const i = (id: number, emp: number, tipo: string, ini: string, fin: string, dias: number): Fila => ({ id, id_empleado: emp, tipo, fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias });

beforeEach(() => {
  vi.clearAllMocks();
  dpiDisponible = true;
  vacaciones = [
    v(1, 1, "2024-06-03", "2024-06-14", 11, { observaciones: "Boleta 1" }),
    v(2, 1, "2024-12-02", "2024-12-13", 10),
    v(3, 14, "2024-06-03", "2024-06-08", 6),
    v(4, 37, "2025-06-02", "2025-06-07", 6),
    v(5, 20, "2024-03-04", "2024-03-08", 5),              // sin incidencia equivalente → problema administrativo
    v(6, 40, "2026-12-01", "2026-12-05", 5),              // futura
    v(7, 40, "2024-04-05", "2024-04-25", 18),             // A cruza el aniversario…
    v(8, 40, "2024-04-10", "2024-04-12", 3),              // …y B empieza dentro de A (superpuestas)
  ];
  incidencias = [
    i(11, 1, "Vacaciones", "2024-06-03", "2024-06-14", 11),
    i(12, 1, "A cuenta de Vacaciones", "2024-12-02", "2024-12-13", 10),
    i(13, 14, "Vacaciones", "2024-06-03", "2024-06-08", 6),
    i(14, 37, "Vacaciones", "2025-06-02", "2025-06-07", 6),
    i(16, 40, "Vacaciones", "2026-12-01", "2026-12-05", 5),
    i(17, 40, "Vacaciones", "2024-04-05", "2024-04-25", 18),
    i(18, 40, "Vacaciones", "2024-04-10", "2024-04-12", 3),
    i(19, 1, "Vacaciones", "2025-02-03", "2025-02-07", 5), // incidencia sin fila en vacaciones
  ];
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id, dpi FROM empleados")) {
      if (!dpiDisponible) throw new Error("Unknown column 'dpi'");
      return EMPLEADOS.filter((e) => e.dpi).map((e) => ({ id: e.id, dpi: e.dpi }));
    }
    if (sql.includes("estado, fecha_alta")) return EMPLEADOS.map(({ dpi, ...e }) => { void dpi; return e; });
    if (sql.includes("SELECT id, codigo, nombre FROM empleados")) return EMPLEADOS.map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre }));
    if (sql.includes("observaciones, estado FROM vacaciones")) return vacaciones;
    if (sql.includes("FROM incidencias")) return incidencias;
    if (sql.includes("SELECT id, id_empleado, fecha_inicio, fecha_fin, dias_habiles FROM vacaciones")) return vacaciones;
    if (sql.includes("FROM feriados")) return [];
    return [];
  });
});

describe("cargar el historial actual (SOLO lectura, por empresa)", () => {
  it("solo ejecuta SELECT, siempre con empresa_id, y nunca escribe", async () => {
    await cargarHistorialActual(7);
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.getPool).not.toHaveBeenCalled();
    expect(db.query.mock.calls.length).toBeGreaterThanOrEqual(4);
    for (const [sql, params] of db.query.mock.calls) {
      expect(String(sql)).toMatch(/^\s*SELECT/i);
      expect(String(sql)).toContain("empresa_id = ?");
      expect(params).toEqual([7]);
    }
  });

  it("solo lee incidencias de Vacaciones / A cuenta de Vacaciones: las de otros tipos no se consultan ni se tocan", async () => {
    await cargarHistorialActual(7);
    const sql = String(db.query.mock.calls.map(([s]) => String(s)).find((s) => s.includes("FROM incidencias")));
    expect(sql).toContain("tipo IN ('Vacaciones', 'A cuenta de Vacaciones')");
    expect(sql).not.toMatch(/Permiso|IGSS|Médico/);
  });

  it("empareja, resuelve el tipo y reporta vacaciones sin pareja e incidencias sin vacación; las demás salen exactas", async () => {
    const r = await cargarHistorialActual(7);
    expect(r.resumen).toMatchObject({ vacacionesLeidas: 8, filasExportadas: 7, filasNoExportadas: 1, completo: false });
    const p = r.problemas.find((x) => x.codigo === "VACACION_SIN_INCIDENCIA")!;
    expect(p).toMatchObject({ severidad: "ERROR", empleado: "Carlos Mejía", vacacionIds: [5] });
    expect(r.problemas.find((x) => x.codigo === "INCIDENCIA_SIN_VACACION")!.incidenciaIds).toEqual([19]);
    const ana = r.filas.filter((f) => f.codigo === "E-1");
    expect(ana).toEqual([
      { codigo: "E-1", dpi: "2000111110101", nombre: "Ana Pérez", fecha_inicio: "2024-06-03", fecha_fin: "2024-06-14", dias_habiles: 11, tipo: "Vacaciones", observacion: "Boleta 1" },
      { codigo: "E-1", dpi: "2000111110101", nombre: "Ana Pérez", fecha_inicio: "2024-12-02", fecha_fin: "2024-12-13", dias_habiles: 10, tipo: "A cuenta de Vacaciones", observacion: "" },
    ]);
  });

  it("si la columna dpi aún no existe, exporta igual (código y nombre) sin fallar", async () => {
    dpiDisponible = false;
    const r = await cargarHistorialActual(7);
    expect(r.filas.find((f) => f.codigo === "E-1")!.dpi).toBe("");
    expect(r.filas.length).toBe(7);
  });
});

describe("previsualizar el historial actual (reutiliza el motor de #418; SOLO lectura)", () => {
  it("el preview es EXACTAMENTE el del motor del importador sobre el archivo exportado (CSV y XLSX reimportados dan lo mismo)", async () => {
    const directo = await previsualizarHistorialActual(7, HOY);
    const exp = await cargarHistorialActual(7);

    const csv = parsearCsv(construirCsvHistorial(exp.filas));
    const desdeCsv = await previsualizarHistorial(7, csv, HOY);
    const xlsx = await leerXlsx(await construirXlsxHistorial(exp));
    const desdeXlsx = await previsualizarHistorial(7, xlsx, HOY);

    expect(directo.preview).toEqual(desdeCsv);
    expect(directo.preview).toEqual(desdeXlsx);
    expect(directo.preview.modo).toBe("PREVIEW");
    expect(directo.preview.escribio).toBe(false);
  });

  it("NO escribe: nunca llama a execute/getPool y todo lo consultado fue SELECT", async () => {
    await previsualizarHistorialActual(7, HOY);
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.getPool).not.toHaveBeenCalled();
    expect(db.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(String(sql)))).toBe(true);
  });

  it("filas válidas, Elisa (bloqueante), Amílcar (fecha_inicio_laboral distinta), futura, superposición y vacaciones sin pareja", async () => {
    const { exportacion, preview } = await previsualizarHistorialActual(7, HOY);
    expect(preview.resumen.filasLeidas).toBe(7);
    expect(preview.resumen.filasValidas).toBe(7);
    expect(preview.resumen.filasInvalidas).toBe(0);

    const elisa = preview.empleados.find((e) => e.empleadoId === 37)!;
    expect(elisa.bloqueado).toBe("FECHA_SOSPECHOSA");
    expect(preview.problemas.some((p) => p.empleadoId === 37 && p.severidad === "BLOQUEANTE")).toBe(true);

    const amilcar = preview.empleados.find((e) => e.empleadoId === 14)!;
    expect(amilcar.bloqueado).toBeNull();
    expect(preview.problemas.find((p) => p.empleadoId === 14 && p.codigo === "FECHA_INICIO_LABORAL_DISTINTA")!.mensaje).toContain("Diferencia entre fecha entrada laboral y base de vacaciones");

    expect(preview.problemas.find((p) => p.codigo === "VACACION_FUTURA")).toMatchObject({ severidad: "ERROR", empleadoId: 40 });
    expect(preview.problemas.find((p) => p.codigo === "VACACIONES_SUPERPUESTAS")).toMatchObject({ severidad: "ERROR", empleadoId: 40 });
    expect(preview.empleados.find((e) => e.empleadoId === 40)!.bloqueado).toBe("VACACIONES_SUPERPUESTAS");

    expect(exportacion.problemas.map((p) => p.codigo).sort()).toEqual(["INCIDENCIA_SIN_VACACION", "VACACION_SIN_INCIDENCIA"]);
    expect(preview.puedeAplicarse).toBe(false);
  });

  it("las vacaciones actuales se comparan como equivalentes al archivo exportado (mismo origen)", async () => {
    const { preview } = await previsualizarHistorialActual(7, HOY);
    expect(preview.existentes.vacaciones).toBe(8);
    expect(preview.existentes.equivalentesEnArchivo).toBe(7); // la de Carlos no se exportó
    expect(preview.existentes.noEnArchivo).toBe(1);
  });

  it("duplicados idénticos: ERROR administrativo, no se incluyen en el archivo y el export NO es completo", async () => {
    vacaciones = [v(1, 1, "2024-06-03", "2024-06-14", 11), v(2, 1, "2024-06-03", "2024-06-14", 11)];
    incidencias = [i(11, 1, "Vacaciones", "2024-06-03", "2024-06-14", 11), i(12, 1, "Vacaciones", "2024-06-03", "2024-06-14", 11)];
    const { exportacion, preview } = await previsualizarHistorialActual(7, HOY);
    expect(exportacion.problemas.map((p) => [p.codigo, p.severidad])).toEqual([["DUPLICADO_IDENTICO", "ERROR"]]);
    expect(exportacion.resumen).toMatchObject({ completo: false, filasExportadas: 0, vacacionesLeidas: 2 });
    expect(preview.resumen.filasLeidas).toBe(0);
  });

  it("un historial limpio y completo no tiene errores y se puede revisar como aplicable", async () => {
    vacaciones = [v(1, 1, "2024-06-03", "2024-06-14", 11), v(2, 1, "2024-12-02", "2024-12-13", 10)];
    incidencias = [i(11, 1, "Vacaciones", "2024-06-03", "2024-06-14", 11), i(12, 1, "A cuenta de Vacaciones", "2024-12-02", "2024-12-13", 10)];
    const { exportacion, preview } = await previsualizarHistorialActual(7, HOY);
    expect(exportacion.resumen).toMatchObject({ completo: true, problemasError: 0 });
    expect(preview.puedeAplicarse).toBe(true);
  });
});
