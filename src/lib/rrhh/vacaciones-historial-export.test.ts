import { describe, expect, it } from "vitest";
import {
  COLUMNAS_EXPORT,
  armarHistorialExportable,
  construirCsvHistorial,
  filasComoArchivo,
  type EmpleadoExport,
  type FilaExport,
  type IncidenciaActual,
  type VacacionActual,
} from "./vacaciones-historial-export";
import { construirXlsxHistorial } from "./vacaciones-historial-export-xlsx";
import { detectarColumnas, llaveLogica, normalizarFilas, parsearCsv } from "./vacaciones-historial-import";
import { leerXlsx } from "./vacaciones-historial-xlsx";

const EMPS: EmpleadoExport[] = [
  { id: 1, codigo: "E-1", dpi: "2000111110101", nombre: "Ana Pérez" },
  { id: 2, codigo: "E-2", dpi: null, nombre: "Beto Ruiz" },
];
let nid = 100;
const vac = (idEmpleado: number, inicio: string, fin: string, dias: number, extra: Partial<VacacionActual> = {}): VacacionActual =>
  ({ id: ++nid, idEmpleado, inicio, fin, dias, observaciones: null, estado: "Aprobado", ...extra });
const inc = (idEmpleado: number, tipo: string, inicio: string, fin: string, dias: number): IncidenciaActual => ({ id: ++nid, idEmpleado, tipo, inicio, fin, dias });
const codigos = (r: ReturnType<typeof armarHistorialExportable>) => r.problemas.map((p) => p.codigo);

describe("export: una vacación normal y una «A cuenta de Vacaciones»", () => {
  it("vacación normal → fila con código, DPI, nombre, fechas y días exactos, tipo Vacaciones y observación", () => {
    const r = armarHistorialExportable(
      [vac(1, "2024-06-03", "2024-06-14", 11, { observaciones: "  Boleta 1  " })],
      [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)],
      EMPS,
    );
    expect(r.filas).toEqual([{ codigo: "E-1", dpi: "2000111110101", nombre: "Ana Pérez", fecha_inicio: "2024-06-03", fecha_fin: "2024-06-14", dias_habiles: 11, tipo: "Vacaciones", observacion: "Boleta 1" }]);
    expect(r.problemas).toEqual([]);
    expect(r.resumen).toMatchObject({ vacacionesLeidas: 1, filasExportadas: 1, filasNoExportadas: 0, completo: true });
  });

  it("«A cuenta de Vacaciones» se exporta con ese tipo exacto", () => {
    const r = armarHistorialExportable([vac(1, "2024-12-02", "2024-12-13", 10)], [inc(1, "A cuenta de Vacaciones", "2024-12-02", "2024-12-13", 10)], EMPS);
    expect(r.filas[0].tipo).toBe("A cuenta de Vacaciones");
    expect(r.resumen.completo).toBe(true);
  });

  it("días fraccionarios y observación vacía / DPI vacío se exportan sin inventar nada", () => {
    const r = armarHistorialExportable([vac(2, "2025-02-03", "2025-02-07", 4.5)], [inc(2, "Vacaciones", "2025-02-03", "2025-02-07", 4.5)], EMPS);
    expect(r.filas[0]).toMatchObject({ dpi: "", observacion: "", dias_habiles: 4.5 });
  });
});

describe("export: emparejamiento vacaciones ↔ incidencias (nunca se inventa el tipo)", () => {
  it("vacación SIN incidencia: ERROR, no se exporta y no se asume tipo", () => {
    const v = vac(1, "2024-03-04", "2024-03-08", 5);
    const r = armarHistorialExportable([v], [], EMPS);
    expect(r.filas).toEqual([]);
    expect(codigos(r)).toEqual(["VACACION_SIN_INCIDENCIA"]);
    expect(r.problemas[0]).toMatchObject({ severidad: "ERROR", vacacionIds: [v.id], empleado: "Ana Pérez" });
    expect(r.resumen).toMatchObject({ filasExportadas: 0, filasNoExportadas: 1, problemasError: 1, completo: false });
  });

  it("una incidencia de OTRO tipo con las mismas fechas (Permiso con goce) NO sirve de pareja", () => {
    const r = armarHistorialExportable([vac(1, "2024-03-04", "2024-03-08", 5)], [inc(1, "Permiso con goce", "2024-03-04", "2024-03-08", 5)], EMPS);
    expect(r.filas).toEqual([]);
    expect(codigos(r)).toEqual(["VACACION_SIN_INCIDENCIA"]);
    expect(r.resumen.incidenciasVacaciones).toBe(0); // las incidencias de otros tipos ni se cuentan
  });

  it("incidencia AMBIGUA (candidatas de ambos tipos): ERROR TIPO_AMBIGUO y no se exporta", () => {
    const r = armarHistorialExportable(
      [vac(1, "2024-06-03", "2024-06-14", 11), vac(1, "2024-06-03", "2024-06-14", 11)],
      [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11), inc(1, "A cuenta de Vacaciones", "2024-06-03", "2024-06-14", 11)],
      EMPS,
    );
    expect(r.filas).toEqual([]);
    expect(codigos(r)).toEqual(["TIPO_AMBIGUO"]);
  });

  it("más de una incidencia candidata para una sola vacación (o al revés): ERROR de cantidad distinta", () => {
    const masIncidencias = armarHistorialExportable([vac(1, "2024-06-03", "2024-06-14", 11)], [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11), inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)], EMPS);
    expect(masIncidencias.filas).toEqual([]);
    expect(codigos(masIncidencias)).toEqual(["INCIDENCIAS_CANTIDAD_DISTINTA"]);
    const masVacaciones = armarHistorialExportable([vac(1, "2024-06-03", "2024-06-14", 11), vac(1, "2024-06-03", "2024-06-14", 11)], [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)], EMPS);
    expect(masVacaciones.filas).toEqual([]);
    expect(codigos(masVacaciones)).toEqual(["INCIDENCIAS_CANTIDAD_DISTINTA"]);
  });

  it("la llave incluye al empleado: la incidencia de OTRO empleado con las mismas fechas no empareja", () => {
    const r = armarHistorialExportable([vac(1, "2024-06-03", "2024-06-14", 11)], [inc(2, "Vacaciones", "2024-06-03", "2024-06-14", 11)], EMPS);
    expect(codigos(r).sort()).toEqual(["INCIDENCIA_SIN_VACACION", "VACACION_SIN_INCIDENCIA"]);
    expect(r.filas).toEqual([]);
  });

  it("incidencia de vacaciones SIN fila en vacaciones: se reporta como ERROR (no se puede exportar desde la tabla fuente)", () => {
    const i = inc(1, "Vacaciones", "2025-02-03", "2025-02-07", 5);
    const r = armarHistorialExportable([], [i], EMPS);
    expect(r.problemas[0]).toMatchObject({ severidad: "ERROR", codigo: "INCIDENCIA_SIN_VACACION", incidenciaIds: [i.id] });
    expect(r.resumen.completo).toBe(false);
  });

  it("estado distinto de Aprobado, empleado inexistente y fechas inválidas: ERROR y no se exportan", () => {
    const r = armarHistorialExportable(
      [vac(1, "2024-06-03", "2024-06-14", 11, { estado: "Cancelado" }), vac(99, "2024-06-03", "2024-06-14", 11), vac(1, "2024-06-14", "2024-06-03", 5)],
      [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)],
      EMPS,
    );
    expect(r.filas).toEqual([]);
    expect(codigos(r)).toEqual(expect.arrayContaining(["ESTADO_NO_APROBADO", "EMPLEADO_NO_ENCONTRADO", "FECHA_INVALIDA"]));
  });

  it("estado «aprobado» en cualquier capitalización es válido", () => {
    const r = armarHistorialExportable([vac(1, "2024-06-03", "2024-06-14", 11, { estado: " APROBADO " })], [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)], EMPS);
    expect(r.filas).toHaveLength(1);
  });
});

describe("export: duplicados", () => {
  it("dos vacaciones idénticas con dos incidencias idénticas se exportan ambas y se advierte (el importador ignora las repetidas)", () => {
    const r = armarHistorialExportable(
      [vac(1, "2024-06-03", "2024-06-14", 11), vac(1, "2024-06-03", "2024-06-14", 11)],
      [inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11), inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)],
      EMPS,
    );
    expect(r.filas).toHaveLength(2);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toMatchObject({ severidad: "ADVERTENCIA", codigo: "DUPLICADO_IDENTICO" });
    expect(r.resumen).toMatchObject({ completo: true, problemasError: 0, problemasAdvertencia: 1 });
    // y al reimportar, el MISMO criterio de llave lógica del importador las reconoce como duplicado
    const { validas } = normalizarFilas(filasComoArchivo(r.filas).filas, detectarColumnas(COLUMNAS_EXPORT as unknown as string[]));
    expect(llaveLogica(1, validas[0])).toBe(llaveLogica(1, validas[1]));
  });
});

const muestra = (): { filas: FilaExport[]; resultado: ReturnType<typeof armarHistorialExportable> } => {
  const vacs = [
    vac(1, "2024-06-03", "2024-06-14", 11, { observaciones: 'Boleta "7", con coma;\nsegunda línea' }),
    vac(1, "2024-12-02", "2024-12-13", 10),
    vac(2, "2025-02-03", "2025-02-07", 4.5, { observaciones: "=SUMA(A1)" }),
    vac(2, "2024-02-29", "2024-03-01", 2), // 29 de febrero (bisiesto)
  ];
  const incs = [
    inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11),
    inc(1, "A cuenta de Vacaciones", "2024-12-02", "2024-12-13", 10),
    inc(2, "Vacaciones", "2025-02-03", "2025-02-07", 4.5),
    inc(2, "A cuenta de Vacaciones", "2024-02-29", "2024-03-01", 2),
  ];
  const resultado = armarHistorialExportable(vacs, incs, EMPS);
  return { filas: resultado.filas, resultado };
};

function reimportar(encabezados: string[], filas: Parameters<typeof normalizarFilas>[0]) {
  const columnas = detectarColumnas(encabezados);
  expect(columnas.faltantes).toEqual([]);
  expect(columnas.ignoradas).toEqual([]); // el archivo exportado no trae columnas que el importador ignore
  return normalizarFilas(filas, columnas);
}

describe("export: CSV reimportable sin transformación", () => {
  it("encabezados exactos, UTF-8 con BOM, fechas ISO y días como número", () => {
    const { filas } = muestra();
    const csv = construirCsvHistorial(filas);
    expect(csv.startsWith("﻿codigo,dpi,nombre,fecha_inicio,fecha_fin,dias_habiles,tipo,observacion\r\n")).toBe(true);
    expect(COLUMNAS_EXPORT).toEqual(["codigo", "dpi", "nombre", "fecha_inicio", "fecha_fin", "dias_habiles", "tipo", "observacion"]);
    expect(csv).toContain("2024-02-29,2024-03-01,2,A cuenta de Vacaciones");
    expect(csv).toContain(",4.5,Vacaciones");
  });

  it("el CSV vuelve a leerse con el importador y reproduce EXACTAMENTE fechas, días, tipos, identificadores y observaciones", () => {
    const { filas } = muestra();
    const { encabezados, filas: crudas } = parsearCsv(construirCsvHistorial(filas));
    const { validas, invalidas } = reimportar(encabezados, crudas);
    expect(invalidas).toEqual([]);
    expect(validas).toHaveLength(filas.length);
    validas.forEach((v, i) => {
      const f = filas[i];
      expect(v).toMatchObject({ codigo: f.codigo, nombre: f.nombre, inicio: f.fecha_inicio, fin: f.fecha_fin, dias: f.dias_habiles, tipo: f.tipo });
      expect(v.dpi).toBe(f.dpi === "" ? null : f.dpi);
      expect(v.observacion).toBe(f.observacion === "" ? null : f.observacion); // incluso con comillas, coma, ; y salto de línea
    });
  });

  it("una observación que empieza como fórmula no se exporta como fórmula y se reimporta igual", () => {
    const { filas } = muestra();
    const csv = construirCsvHistorial(filas);
    expect(csv).not.toMatch(/(^|,)=SUMA/m);
    const { encabezados, filas: crudas } = parsearCsv(csv);
    const { validas } = reimportar(encabezados, crudas);
    expect(validas.some((v) => v.observacion === "=SUMA(A1)")).toBe(true);
  });
});

describe("export: XLSX reimportable sin transformación", () => {
  it("la PRIMERA hoja es el historial con las columnas del importador y se lee de vuelta con fechas y días exactos", async () => {
    const { filas, resultado } = muestra();
    const buffer = await construirXlsxHistorial(resultado);
    const leido = await leerXlsx(buffer);
    expect(leido.encabezados).toEqual([...COLUMNAS_EXPORT]);
    const { validas, invalidas } = reimportar(leido.encabezados, leido.filas);
    expect(invalidas).toEqual([]);
    validas.forEach((v, i) => {
      const f = filas[i];
      expect(v).toMatchObject({ codigo: f.codigo, nombre: f.nombre, inicio: f.fecha_inicio, fin: f.fecha_fin, dias: f.dias_habiles, tipo: f.tipo });
      expect(v.dpi).toBe(f.dpi === "" ? null : f.dpi);
      expect(v.observacion).toBe(f.observacion === "" ? null : f.observacion);
    });
  });

  it("CSV y XLSX producen exactamente las mismas filas normalizadas", async () => {
    const { filas, resultado } = muestra();
    const csv = parsearCsv(construirCsvHistorial(filas));
    const xlsx = await leerXlsx(await construirXlsxHistorial(resultado));
    expect(reimportar(xlsx.encabezados, xlsx.filas).validas).toEqual(reimportar(csv.encabezados, csv.filas).validas);
  });

  it("incluye la hoja «Problemas» con el reporte administrativo, que el importador ignora", async () => {
    const r = armarHistorialExportable([vac(1, "2024-03-04", "2024-03-08", 5)], [], EMPS);
    const buffer = await construirXlsxHistorial(r);
    const ExcelJS = (await import("exceljs")).default;
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual(["Historial", "Problemas"]);
    expect(libro.worksheets[1].getRow(2).getCell(2).value).toBe("VACACION_SIN_INCIDENCIA");
    const leido = await leerXlsx(buffer);
    expect(leido.filas).toEqual([]); // la vacación sin pareja NO está en la hoja que se reimporta
  });
});

describe("export: no es un volcado técnico", () => {
  it("no exporta saldos, detalle FIFO ni IDs internos: solo las 8 columnas del historial", () => {
    const { filas } = muestra();
    for (const f of filas) expect(Object.keys(f).sort()).toEqual([...COLUMNAS_EXPORT].sort());
    const cab = construirCsvHistorial(filas).split("\r\n")[0];
    expect(cab).not.toMatch(/(^|,)(id|id_empleado|empresa_id|incidencia_id|saldo|saldo_id)(,|$)/i);
  });

  it("el orden es determinista (nombre, fecha) y no depende del orden de entrada", () => {
    const a = muestra().filas;
    const v = [vac(2, "2025-02-03", "2025-02-07", 4.5), vac(1, "2024-12-02", "2024-12-13", 10), vac(1, "2024-06-03", "2024-06-14", 11)];
    const i = [inc(2, "Vacaciones", "2025-02-03", "2025-02-07", 4.5), inc(1, "A cuenta de Vacaciones", "2024-12-02", "2024-12-13", 10), inc(1, "Vacaciones", "2024-06-03", "2024-06-14", 11)];
    const r1 = armarHistorialExportable(v, i, EMPS).filas;
    const r2 = armarHistorialExportable([...v].reverse(), [...i].reverse(), EMPS).filas;
    expect(r1).toEqual(r2);
    expect(a[0].nombre).toBe("Ana Pérez");
  });
});
