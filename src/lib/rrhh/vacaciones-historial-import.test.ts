import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  MAX_FILAS_ARCHIVO,
  detectarColumnas,
  llaveLogica,
  normalizarFilas,
  normalizarTipo,
  parsearCsv,
  parsearDias,
  parsearFecha,
} from "./vacaciones-historial-import";
import { leerXlsx } from "./vacaciones-historial-xlsx";

describe("fechas del archivo", () => {
  it("acepta YYYY-MM-DD y DD/MM/YYYY (nunca MM/DD), Date y serial de Excel", () => {
    expect(parsearFecha("2024-06-03")).toBe("2024-06-03");
    expect(parsearFecha("03/06/2024")).toBe("2024-06-03");
    expect(parsearFecha("3-6-2024")).toBe("2024-06-03");
    expect(parsearFecha("13/04/2023")).toBe("2023-04-13");
    expect(parsearFecha(new Date(Date.UTC(2024, 5, 3)))).toBe("2024-06-03");
    expect(parsearFecha(45446)).toBe("2024-06-03"); // serial de Excel
  });
  it("rechaza fechas imposibles o ambiguas", () => {
    expect(parsearFecha("31/02/2024")).toBeNull();
    expect(parsearFecha("2024-13-01")).toBeNull();
    expect(parsearFecha("06/13/2024")).toBeNull(); // MM/DD no se interpreta
    expect(parsearFecha("hola")).toBeNull();
    expect(parsearFecha("")).toBeNull();
    expect(parsearFecha(12)).toBeNull();
  });
  it("días hábiles: coma o punto decimal, > 0", () => {
    expect(parsearDias("10")).toBe(10);
    expect(parsearDias("10,5")).toBe(10.5);
    expect(parsearDias(7.25)).toBe(7.25);
    expect(parsearDias("0")).toBeNull();
    expect(parsearDias("-3")).toBeNull();
    expect(parsearDias("abc")).toBeNull();
    expect(parsearDias(400)).toBeNull();
  });
  it("tipo: solo Vacaciones / A cuenta de Vacaciones son reconstruibles", () => {
    expect(normalizarTipo("")).toBe("Vacaciones");
    expect(normalizarTipo("vacaciones")).toBe("Vacaciones");
    expect(normalizarTipo("A CUENTA de Vacaciones")).toBe("A cuenta de Vacaciones");
    expect(normalizarTipo("Permiso con goce")).toBeNull();
    expect(normalizarTipo("IGSS")).toBeNull();
  });
});

describe("columnas del archivo", () => {
  it("mapea alias sin acentos ni mayúsculas, ignora y REPORTA las columnas no mapeadas", () => {
    const c = detectarColumnas(["Código Empleado", "Fecha Inicio", "FECHA FIN", "Días Hábiles", "Observaciones", "Color favorito"]);
    expect(c.mapeadas).toEqual({ codigo: "Código Empleado", fecha_inicio: "Fecha Inicio", fecha_fin: "FECHA FIN", dias_habiles: "Días Hábiles", observacion: "Observaciones" });
    expect(c.ignoradas).toEqual(["Color favorito"]);
    expect(c.faltantes).toEqual([]);
  });
  it("sin identificador del empleado o sin columnas obligatorias: lo señala", () => {
    const c = detectarColumnas(["fecha_inicio", "fecha_fin"]);
    expect(c.faltantes).toEqual(["identificador (codigo, dpi o nombre)", "dias_habiles"]);
  });
});

describe("CSV", () => {
  it("lee delimitador ; o , con comillas, BOM y filas vacías, conservando el número de fila del archivo", () => {
    const csv = "﻿codigo;fecha_inicio;fecha_fin;dias_habiles;observacion\r\nE-1;03/06/2024;14/06/2024;10;\"con; punto y coma\"\r\n\r\nE-2;2024-07-01;2024-07-05;5;\r\n";
    const { encabezados, filas } = parsearCsv(csv);
    expect(encabezados).toEqual(["codigo", "fecha_inicio", "fecha_fin", "dias_habiles", "observacion"]);
    expect(filas.map((f) => f.fila)).toEqual([2, 4]);
    expect(filas[0].valores.observacion).toBe("con; punto y coma");
    const norm = normalizarFilas(filas, detectarColumnas(encabezados));
    expect(norm.invalidas).toEqual([]);
    expect(norm.validas.map((v) => [v.codigo, v.inicio, v.fin, v.dias, v.tipo])).toEqual([
      ["E-1", "2024-06-03", "2024-06-14", 10, "Vacaciones"], ["E-2", "2024-07-01", "2024-07-05", 5, "Vacaciones"],
    ]);
  });
});

describe("filas inválidas (cada una con su motivo y su número de fila)", () => {
  const archivo = [
    "codigo,fecha_inicio,fecha_fin,dias_habiles,tipo",
    ",2024-06-03,2024-06-14,10,",                 // 2 sin identificador
    "E-1,31/02/2024,2024-06-14,10,",              // 3 fecha inicio inválida
    "E-1,2024-06-03,hola,10,",                    // 4 fecha fin inválida
    "E-1,2024-06-14,2024-06-03,10,",              // 5 fin < inicio
    "E-1,2024-06-03,2024-06-14,0,",               // 6 días inválidos
    "E-1,2024-06-03,2024-06-14,10,Permiso con goce", // 7 tipo no reconstruible
    "E-1,2024-06-03,2024-06-14,10,",              // 8 válida
  ].join("\n");
  it("las clasifica y deja pasar solo la válida", () => {
    const { encabezados, filas } = parsearCsv(archivo);
    const { validas, invalidas } = normalizarFilas(filas, detectarColumnas(encabezados));
    expect(invalidas.map((i) => [i.fila, i.codigo])).toEqual([
      [2, "SIN_IDENTIFICADOR"], [3, "FECHA_INICIO_INVALIDA"], [4, "FECHA_FIN_INVALIDA"], [5, "FECHA_FIN_ANTERIOR_A_INICIO"], [6, "DIAS_INVALIDOS"], [7, "TIPO_NO_RECONSTRUIBLE"],
    ]);
    expect(validas.map((v) => v.fila)).toEqual([8]);
  });
  it("faltan columnas obligatorias → ninguna fila se procesa", () => {
    const { encabezados, filas } = parsearCsv("codigo,fecha_inicio\nE-1,2024-06-03");
    const r = normalizarFilas(filas, detectarColumnas(encabezados));
    expect(r.validas).toEqual([]);
    expect(r.invalidas[0].codigo).toBe("COLUMNAS_FALTANTES");
  });
  it("exceso de filas se rechaza", () => {
    const filas = Array.from({ length: MAX_FILAS_ARCHIVO + 1 }, (_, i) => ({ fila: i + 2, valores: { codigo: "E", fecha_inicio: "2024-06-03", fecha_fin: "2024-06-04", dias_habiles: "1" } }));
    const r = normalizarFilas(filas, detectarColumnas(["codigo", "fecha_inicio", "fecha_fin", "dias_habiles"]));
    expect(r.invalidas[0].codigo).toBe("EXCESO_DE_FILAS");
  });
});

describe("llave lógica de importación", () => {
  it("empleado + fecha_inicio + fecha_fin + días + tipo", () => {
    const a = llaveLogica(7, { inicio: "2024-06-03", fin: "2024-06-14", dias: 10, tipo: "Vacaciones" });
    expect(a).toBe("7|2024-06-03|2024-06-14|10.00|Vacaciones");
    expect(llaveLogica(7, { inicio: "2024-06-03", fin: "2024-06-14", dias: 10, tipo: "A cuenta de Vacaciones" })).not.toBe(a);
    expect(llaveLogica(8, { inicio: "2024-06-03", fin: "2024-06-14", dias: 10, tipo: "Vacaciones" })).not.toBe(a);
  });
});

describe("XLSX", () => {
  it("lee la primera hoja: fechas reales de Excel, números, fórmulas y filas vacías", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Historial");
    ws.addRow(["Código", "Fecha inicio", "Fecha fin", "Días hábiles", "Tipo", "Referencia"]);
    ws.addRow(["E-1", new Date(Date.UTC(2024, 5, 3)), new Date(Date.UTC(2024, 5, 14)), 10, "Vacaciones", "Boleta 15"]);
    ws.addRow([]);
    ws.addRow(["E-2", "03/07/2024", "05/07/2024", { formula: "2+1", result: 3 }, "", ""]);
    const buffer = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
    const { encabezados, filas } = await leerXlsx(buffer);
    expect(encabezados).toEqual(["Código", "Fecha inicio", "Fecha fin", "Días hábiles", "Tipo", "Referencia"]);
    expect(filas.map((f) => f.fila)).toEqual([2, 4]);
    const { validas, invalidas } = normalizarFilas(filas, detectarColumnas(encabezados));
    expect(invalidas).toEqual([]);
    expect(validas.map((v) => [v.codigo, v.inicio, v.fin, v.dias, v.observacion])).toEqual([
      ["E-1", "2024-06-03", "2024-06-14", 10, "Boleta 15"], ["E-2", "2024-07-03", "2024-07-05", 3, null],
    ]);
  });
});
