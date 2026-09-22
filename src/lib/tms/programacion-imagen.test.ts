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
  paginar,
  type EncabezadoProgramacionImagen,
  type FilaProgramacionImagen,
} from "./programacion-imagen";

const FILA: FilaProgramacionImagen = {
  codigo: "PLAN-000123",
  fechaHora: "2026-09-22 · 08:00 AM",
  cliente: "Distribuidora Ejemplo",
  ruta: "Bodega Zona 12 → Puerto Barrios",
  piloto: "Juan Pérez",
  auxiliares: "Ana López, Beto Ruiz",
  unidad: "P-123ABC",
  estado: "Programado",
  regresoEstimado: "2026-09-22 · 05:00 PM",
  tarifaComercial: "Q1,400.00",
};

const ENCABEZADO: EncabezadoProgramacionImagen = {
  empresa: "Kuiqtrans / Logiservicios Mónaco",
  rango: "2026-09-22 a 2026-09-28",
  filtros: "Estado: Programado · Piloto: Juan Pérez",
  generado: "22/9/2026, 10:00:00",
};

describe("COLUMNAS_IMAGEN — mínimo del ticket", () => {
  it("10 columnas, en el orden pedido: código, fecha/hora, cliente, ruta, piloto, auxiliares, unidad, estado, regreso, tarifa", () => {
    expect(COLUMNAS_IMAGEN.map((c) => c.titulo)).toEqual([
      "Código", "Fecha / Hora", "Cliente", "Ruta", "Piloto", "Auxiliares", "Unidad", "Estado", "Regreso est.", "Tarifa",
    ]);
  });
});

describe("anchosColumnasImagen", () => {
  it("suma exactamente el ancho disponible (reutiliza anchosColumnas de cotizacion-pdf-layout.ts)", () => {
    const anchos = anchosColumnasImagen(1700);
    expect(anchos).toHaveLength(10);
    expect(anchos.reduce((s, a) => s + a, 0)).toBeCloseTo(1700, 5);
  });

  it("usa ANCHO_IMAGEN por defecto", () => {
    expect(anchosColumnasImagen().reduce((s, a) => s + a, 0)).toBeCloseTo(ANCHO_IMAGEN, 5);
  });
});

describe("celdasFila", () => {
  it("arma el arreglo en el MISMO orden que COLUMNAS_IMAGEN", () => {
    expect(celdasFila(FILA)).toEqual([
      "PLAN-000123", "2026-09-22 · 08:00 AM", "Distribuidora Ejemplo", "Bodega Zona 12 → Puerto Barrios",
      "Juan Pérez", "Ana López, Beto Ruiz", "P-123ABC", "Programado", "2026-09-22 · 05:00 PM", "Q1,400.00",
    ]);
  });
});

describe("lineasEncabezado", () => {
  it("título = empresa + PROGRAMACIÓN; subtítulo une rango, filtros y generado con « · »", () => {
    const l = lineasEncabezado(ENCABEZADO);
    expect(l.titulo).toBe("Kuiqtrans / Logiservicios Mónaco — PROGRAMACIÓN");
    expect(l.subtitulo).toBe("2026-09-22 a 2026-09-28 · Estado: Programado · Piloto: Juan Pérez · Generado 22/9/2026, 10:00:00");
  });

  it("sin filtros activos, el subtítulo no deja un « · » colgando", () => {
    const l = lineasEncabezado({ ...ENCABEZADO, filtros: "" });
    expect(l.subtitulo).toBe("2026-09-22 a 2026-09-28 · Generado 22/9/2026, 10:00:00");
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
  it("pocas filas (caso normal): una sola página con todas las filas", () => {
    const filas = Array.from({ length: 5 }, (_, i) => ({ ...FILA, codigo: `PLAN-00000${i}` }));
    const layout = construirLayoutImagen(ENCABEZADO, filas);
    expect(layout.totalPaginas).toBe(1);
    expect(layout.paginas).toHaveLength(1);
    expect(layout.paginas[0]).toHaveLength(5);
    expect(layout.anchoColumnas).toHaveLength(10);
  });

  it("sin viajes (lista vacía): una página vacía, nunca revienta", () => {
    const layout = construirLayoutImagen(ENCABEZADO, []);
    expect(layout.totalPaginas).toBe(1);
    expect(layout.paginas).toEqual([[]]);
  });

  it("contenido muy largo: se divide en varias páginas, ninguna fila se pierde ni se repite", () => {
    const filas = Array.from({ length: 250 }, (_, i) => ({ ...FILA, codigo: `PLAN-${String(i).padStart(6, "0")}` }));
    // Fuerza un lienzo chico para forzar la división sin depender de miles de filas reales.
    const layout = construirLayoutImagen(ENCABEZADO, filas, { altoMaximoLienzo: 1000, altoEncabezado: 90 });
    expect(layout.totalPaginas).toBeGreaterThan(1);
    const totalFilasReconstruidas = layout.paginas.reduce((s, p) => s + p.length, 0);
    expect(totalFilasReconstruidas).toBe(250);
    // Cada código aparece exactamente una vez en todo el conjunto de páginas.
    const codigos = layout.paginas.flat().map((celdas) => celdas[0]);
    expect(new Set(codigos).size).toBe(250);
  });

  it("cada fila mantiene el orden de columnas de COLUMNAS_IMAGEN dentro del layout", () => {
    const layout = construirLayoutImagen(ENCABEZADO, [FILA]);
    expect(layout.paginas[0][0]).toEqual(celdasFila(FILA));
  });
});
