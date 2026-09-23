import { describe, expect, it } from "vitest";
import {
  ALTO_FILA,
  ALTO_FILA_CABECERA,
  ALTO_MAXIMO_LIENZO,
  ANCHO_IMAGEN,
  COLUMNAS_IMAGEN,
  anchosColumnasImagen,
  celdasFila,
  construirLayoutImagen,
  filasPorPagina,
  lineasEncabezado,
  mesDia,
  paginar,
  type EncabezadoProgramacionImagen,
  type FilaProgramacionImagen,
} from "./programacion-imagen";

const FILA: FilaProgramacionImagen = {
  mes: "SEP",
  dia: "22",
  placa: "C-801BXY",
  tc: "TC-045",
  piloto: "Juan Pérez",
  auxiliar1: "Ana López",
  auxiliar2: "Beto Ruiz",
  cliente: "Distribuidora Ejemplo",
  lugarCarga: "BODEGAS CALSA, ZONA 12",
  hora: "08:00",
  lugarDescarga: "DOLLAR CITY",
};

const ENCABEZADO: EncabezadoProgramacionImagen = {
  empresa: "Kuiqtrans / Logiservicios Mónaco",
  rango: "2026-09-22 a 2026-09-28",
  filtros: "Estado: Programado · Piloto: Juan Pérez",
  generado: "22/9/2026, 10:00:00",
};

describe("COLUMNAS_IMAGEN — MISMAS columnas que el reporte tradicional Excel/PDF de Programación", () => {
  it("11 columnas, en el orden EXACTO del reporte tradicional (reporte/route.ts): Mes, Día, Placa, TC, Piloto, Auxiliar 1, Auxiliar 2, Cliente, Lugar de Carga, Hora, Lugar de Descarga", () => {
    // PROGRAMACION-TC-CAJA-REMOLQUE-1: "TC" va compacta, justo después de Placa (igual que en Excel/PDF).
    expect(COLUMNAS_IMAGEN.map((c) => c.titulo)).toEqual([
      "Mes", "Día", "Placa", "TC", "Piloto", "Auxiliar 1", "Auxiliar 2", "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga",
    ]);
  });

  it("nunca incluye Código, Estado, Regreso estimado, Tarifa ni una columna de Ruta combinada", () => {
    const titulos = COLUMNAS_IMAGEN.map((c) => c.titulo.toLowerCase());
    for (const prohibido of ["código", "codigo", "estado", "regreso", "tarifa", "ruta"]) {
      expect(titulos.some((t) => t.includes(prohibido))).toBe(false);
    }
  });

  it("nunca combina los auxiliares en una sola columna", () => {
    expect(COLUMNAS_IMAGEN.map((c) => c.titulo)).not.toContain("Auxiliares");
  });
});

describe("mesDia — misma tabla de abreviaturas que el reporte tradicional (ENE..DIC)", () => {
  it("2026-09-22 -> SEP / 22", () => {
    expect(mesDia("2026-09-22")).toEqual({ mes: "SEP", dia: "22" });
  });

  it("cubre los 12 meses con abreviatura de 3 letras", () => {
    expect(mesDia("2026-01-05").mes).toBe("ENE");
    expect(mesDia("2026-12-31").mes).toBe("DIC");
    expect(mesDia("2026-08-01").mes).toBe("AGO"); // no "Agosto" — mismo criterio que el reporte tradicional
  });

  it("fecha vacía o inválida no revienta (mismo fallback ?? 1 que ya usa el reporte tradicional: mes indefinido cae a ENE, día queda vacío)", () => {
    expect(mesDia("")).toEqual({ mes: "ENE", dia: "" });
  });
});

describe("anchosColumnasImagen", () => {
  it("suma exactamente el ancho disponible", () => {
    const anchos = anchosColumnasImagen(2000);
    expect(anchos).toHaveLength(11);
    expect(anchos.reduce((s, a) => s + a, 0)).toBeCloseTo(2000, 5);
  });

  it("usa ANCHO_IMAGEN por defecto", () => {
    expect(anchosColumnasImagen().reduce((s, a) => s + a, 0)).toBeCloseTo(ANCHO_IMAGEN, 5);
  });
});

describe("celdasFila", () => {
  it("arma el arreglo en el MISMO orden que COLUMNAS_IMAGEN", () => {
    expect(celdasFila(FILA)).toEqual([
      "SEP", "22", "C-801BXY", "TC-045", "Juan Pérez", "Ana López", "Beto Ruiz", "Distribuidora Ejemplo",
      "BODEGAS CALSA, ZONA 12", "08:00", "DOLLAR CITY",
    ]);
  });

  it("PROGRAMACION-TC-CAJA-REMOLQUE-1: viaje sin TC deja la celda TC vacía (nunca inventa un valor)", () => {
    expect(celdasFila({ ...FILA, tc: "" })[3]).toBe("");
  });

  it("auxiliar2 vacío queda como celda vacía (nunca inventa un valor)", () => {
    expect(celdasFila({ ...FILA, auxiliar2: "" })[6]).toBe("");
  });
});

describe("lineasEncabezado", () => {
  it("título fijo «PROGRAMACIÓN»; subtítulo empieza con la empresa, luego rango, filtros y generado", () => {
    const l = lineasEncabezado(ENCABEZADO);
    expect(l.titulo).toBe("PROGRAMACIÓN");
    expect(l.subtitulo).toBe(
      "Kuiqtrans / Logiservicios Mónaco · 2026-09-22 a 2026-09-28 · Estado: Programado · Piloto: Juan Pérez · Generado 22/9/2026, 10:00:00",
    );
  });

  it("sin filtros activos, el subtítulo no deja un « · » colgando", () => {
    const l = lineasEncabezado({ ...ENCABEZADO, filtros: "" });
    expect(l.subtitulo).toBe("Kuiqtrans / Logiservicios Mónaco · 2026-09-22 a 2026-09-28 · Generado 22/9/2026, 10:00:00");
    expect(l.subtitulo).not.toContain("·  ·");
  });
});

describe("paginar", () => {
  it("arreglo vacío -> []", () => {
    expect(paginar([], 10)).toEqual([]);
  });

  it("divide en trozos exactos del tamaño pedido", () => {
    expect(paginar([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("última página más corta cuando no es múltiplo exacto", () => {
    expect(paginar([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("porPagina <= 0: todo en una sola página (nunca revienta ni produce un [] falso)", () => {
    expect(paginar([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(paginar([1, 2, 3], -5)).toEqual([[1, 2, 3]]);
  });

  it("porPagina mayor que el total: una sola página con todo", () => {
    expect(paginar([1, 2], 100)).toEqual([[1, 2]]);
  });
});

describe("filasPorPagina", () => {
  it("nunca menos de 1, aunque el encabezado sea enorme", () => {
    expect(filasPorPagina(999999999)).toBe(1);
  });

  it("con el alto máximo por defecto, caben decenas de filas (una semana normal de Programación cabe en una sola imagen)", () => {
    const n = filasPorPagina(90);
    expect(n).toBeGreaterThan(50);
  });

  it("es coherente con la aritmética: altoEncabezado + cabeceraTabla + n*ALTO_FILA <= altoMaximo", () => {
    const altoEncabezado = 90;
    const n = filasPorPagina(altoEncabezado, ALTO_MAXIMO_LIENZO);
    expect(altoEncabezado + ALTO_FILA_CABECERA + n * ALTO_FILA).toBeLessThanOrEqual(ALTO_MAXIMO_LIENZO);
    expect(altoEncabezado + ALTO_FILA_CABECERA + (n + 1) * ALTO_FILA).toBeGreaterThan(ALTO_MAXIMO_LIENZO);
  });
});

describe("construirLayoutImagen", () => {
  it("pocas filas (caso normal): una sola página con todas las filas, encabezado y encabezados de tabla presentes en cada página", () => {
    const filas = Array.from({ length: 5 }, (_, i) => ({ ...FILA, placa: `C-00${i}ABC` }));
    const layout = construirLayoutImagen(ENCABEZADO, filas);
    expect(layout.totalPaginas).toBe(1);
    expect(layout.paginas).toHaveLength(1);
    expect(layout.paginas[0]).toHaveLength(5);
    expect(layout.anchoColumnas).toHaveLength(11);
    expect(layout.encabezado.titulo).toBe("PROGRAMACIÓN");
  });

  it("sin viajes (lista vacía): una página vacía, nunca revienta", () => {
    const layout = construirLayoutImagen(ENCABEZADO, []);
    expect(layout.totalPaginas).toBe(1);
    expect(layout.paginas).toEqual([[]]);
  });

  it("contenido muy largo: se divide en varias páginas, ninguna fila se pierde ni se repite", () => {
    const filas = Array.from({ length: 250 }, (_, i) => ({ ...FILA, placa: `C-${String(i).padStart(3, "0")}ABC` }));
    // Fuerza un lienzo chico para forzar la división sin depender de miles de filas reales.
    const layout = construirLayoutImagen(ENCABEZADO, filas, { altoMaximoLienzo: 1000, altoEncabezado: 90 });
    expect(layout.totalPaginas).toBeGreaterThan(1);
    const totalFilasReconstruidas = layout.paginas.reduce((s, p) => s + p.length, 0);
    expect(totalFilasReconstruidas).toBe(250);
    const placas = layout.paginas.flat().map((celdas) => celdas[2]); // placa es la columna índice 2
    expect(new Set(placas).size).toBe(250);
  });

  it("cada fila mantiene el orden de columnas de COLUMNAS_IMAGEN dentro del layout", () => {
    const layout = construirLayoutImagen(ENCABEZADO, [FILA]);
    expect(layout.paginas[0][0]).toEqual(celdasFila(FILA));
  });
});
