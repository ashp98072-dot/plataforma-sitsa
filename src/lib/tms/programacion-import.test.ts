import { describe, expect, it } from "vitest";
import type { FilaProgramacionExcel } from "./programacion-import-excel";
import {
  claveDuplicadoFila,
  detectarFilasDuplicadas,
  detectarTraslapesEnLote,
} from "./programacion-import";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 3 de 6) — validaciones puras
 * entre filas del mismo Excel. Mismo criterio de prueba que el resto de
 * este módulo (ver personal-resolucion.test.ts / rutas-import.test.ts):
 * se construyen objetos `FilaProgramacionExcel` directamente (los
 * mismos que ya devuelve `parsearExcelProgramacion` del PR 2), sin pasar
 * por Excel — el parser ya se prueba aparte en su propio archivo.
 */
function filaFixture(overrides: Partial<FilaProgramacionExcel> = {}): FilaProgramacionExcel {
  return {
    filaExcel: 4,
    fechaSalidaExcel: "2026-09-20",
    horaSalidaExcel: "08:00",
    codigoRutaExcel: "1001",
    clienteExcel: "Acme S.A.",
    pilotoCodigoExcel: "P-1",
    placaExcel: "P-123ABC",
    auxiliar1CodigoExcel: "",
    auxiliar2CodigoExcel: "",
    tipoTrasladoExcel: "Carga completa",
    tarifaExcel: 1500,
    fechaRegresoExcel: "2026-09-20",
    horaRegresoExcel: "17:00",
    observacionesExcel: "",
    erroresSintacticos: [],
    ...overrides,
  };
}

describe("claveDuplicadoFila", () => {
  it("combina fecha+hora+ruta+piloto+unidad, normalizado (case-insensitive, sin espacios extremos)", () => {
    const a = claveDuplicadoFila(filaFixture({ pilotoCodigoExcel: "p-1 " }));
    const b = claveDuplicadoFila(filaFixture({ pilotoCodigoExcel: "P-1" }));
    expect(a).toBe(b);
  });

  it("cambia si cambia cualquiera de los 5 componentes", () => {
    const base = claveDuplicadoFila(filaFixture());
    expect(claveDuplicadoFila(filaFixture({ fechaSalidaExcel: "2026-09-21" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ horaSalidaExcel: "09:00" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ codigoRutaExcel: "1002" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ pilotoCodigoExcel: "P-2" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ placaExcel: "Q-999XYZ" }))).not.toBe(base);
  });
});

describe("detectarFilasDuplicadas", () => {
  it("sin duplicados: devuelve []", () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "1001" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "1002" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("2 filas con clave idéntica: ambas se reportan, cada una apuntando a la otra", () => {
    const filas = [
      filaFixture({ filaExcel: 4 }),
      filaFixture({ filaExcel: 7 }),
    ];
    const resultado = detectarFilasDuplicadas(filas);
    expect(resultado).toEqual([
      { filaExcel: 4, duplicadaCon: [7] },
      { filaExcel: 7, duplicadaCon: [4] },
    ]);
  });

  it("3 filas con la misma clave: las 3 se reportan, cada una con las otras 2", () => {
    const filas = [4, 5, 6].map((filaExcel) => filaFixture({ filaExcel }));
    const resultado = detectarFilasDuplicadas(filas);
    expect(resultado).toEqual([
      { filaExcel: 4, duplicadaCon: [5, 6] },
      { filaExcel: 5, duplicadaCon: [4, 6] },
      { filaExcel: 6, duplicadaCon: [4, 5] },
    ]);
  });

  it("misma ruta repetida con piloto distinto: NO es duplicado (regla explícita del negocio)", () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "2", pilotoCodigoExcel: "P-1" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "2", pilotoCodigoExcel: "P-2" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("misma ruta y piloto pero unidad distinta: NO es duplicado", () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "2", placaExcel: "AAA111" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "2", placaExcel: "BBB222" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("misma clave salvo la hora de salida: NO es duplicado", () => {
    const filas = [
      filaFixture({ filaExcel: 4, horaSalidaExcel: "08:00" }),
      filaFixture({ filaExcel: 5, horaSalidaExcel: "09:00" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("filas con campos obligatorios vacíos (rotas): se excluyen de la comparación, sin falsos positivos entre sí", () => {
    const filas = [
      filaFixture({ filaExcel: 4, placaExcel: "" }),
      filaFixture({ filaExcel: 5, placaExcel: "" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });
});

describe("detectarTraslapesEnLote", () => {
  it("sin conflictos: devuelve []", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "BBB222" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("mismo piloto (unidad distinta), intervalos que se solapan: conflicto reportado en ambos lados", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "12:00", horaRegresoExcel: "18:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toMatchObject({ filaExcel: 4, filaExcelConflicto: 5, categoria: "persona", rolEnFila: "piloto", rolEnFilaConflicto: "piloto" });
    expect(resultado[1]).toMatchObject({ filaExcel: 5, filaExcelConflicto: 4, categoria: "persona" });
  });

  it("mismo piloto (unidad distinta), intervalos que solo se TOCAN en el límite (fin de A = inicio de B): NO es conflicto", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "12:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "12:00", horaRegresoExcel: "18:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("mismo piloto (unidad distinta), mismo día, horarios que NO se solapan: sin conflicto (no se bloquea por 'misma fecha')", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "12:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "13:00", horaRegresoExcel: "18:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("el piloto de una fila es el auxiliar de otra (misma persona, roles distintos): SÍ es conflicto — mismo criterio que disponibilidad-traslapes.ts", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", auxiliar1CodigoExcel: "", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-9", auxiliar1CodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    const deLaFila4 = resultado.find((r) => r.filaExcel === 4);
    expect(deLaFila4).toMatchObject({ categoria: "persona", rolEnFila: "piloto", rolEnFilaConflicto: "auxiliar" });
  });

  it("mismo auxiliar en dos filas (aux1 de una vs aux2 de otra), con solape: conflicto", () => {
    const filas = [
      filaFixture({ filaExcel: 4, auxiliar1CodigoExcel: "A-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, auxiliar2CodigoExcel: "A-1", pilotoCodigoExcel: "P-9", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado.some((r) => r.filaExcel === 4 && r.rolEnFila === "auxiliar" && r.rolEnFilaConflicto === "auxiliar")).toBe(true);
  });

  it("misma unidad (placa) en dos filas, con solape: conflicto de categoría 'unidad'", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "aaa111", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado.some((r) => r.categoria === "unidad" && r.filaExcel === 4 && r.filaExcelConflicto === 5)).toBe(true);
  });

  it("piloto y unidad distintos, aunque los horarios se solapen: sin conflicto", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("fila sin regreso estimado (ninguna de las dos mitades): se excluye de la comparación, sin error", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", fechaRegresoExcel: null, horaRegresoExcel: null }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", horaSalidaExcel: "09:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("fila sin fecha de salida válida: se excluye de la comparación, sin lanzar excepción", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", fechaSalidaExcel: null }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1" }),
    ];
    expect(() => detectarTraslapesEnLote(filas)).not.toThrow();
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("3 filas: A-B conflictúan, B-C conflictúan, A-C no: se reportan exactamente los 2 pares (4 entradas)", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "12:00" }), // A
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "15:00" }), // B (solapa con A)
      filaFixture({ filaExcel: 6, pilotoCodigoExcel: "P-1", placaExcel: "CCC333", horaSalidaExcel: "14:00", horaRegresoExcel: "18:00" }), // C (solapa con B, no con A)
    ];
    const resultado = detectarTraslapesEnLote(filas);
    const pares = resultado.map((r) => [r.filaExcel, r.filaExcelConflicto].sort((a, b) => a - b).join("-"));
    expect(new Set(pares)).toEqual(new Set(["4-5", "5-6"]));
    expect(resultado).toHaveLength(4);
  });
});
