import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cotizacionPdf } from "./cotizacion-pdf";
import { construirDocumentoComercial, formatoMoneda, textoCombustibleReferencia } from "./cotizacion-documento";
import { COTIZACION_DOC } from "./cotizacion-documento.fixture";
import { anchosColumnas, dibujarTabla, MARGENES } from "./cotizacion-pdf-layout";
import type { Cotizacion } from "./cotizaciones";

/**
 * PDF COMERCIAL (KuiqTrans y Mónaco): (1) el combustible de referencia es SOLO de control interno y no sale en ningún bloque del PDF;
 * (2) los datos de la tabla «Propuesta comercial» (y sus encabezados) van centrados, horizontal y verticalmente.
 *
 * pdfkit comprime los streams: se inspecciona lo que cada plantilla pide dibujar (espía sobre PDFDocument.prototype.text, con x/y/opciones).
 */
const MARCAS = [["KUIQTRANS", "KuiqTrans"], ["MONACO", "Mónaco"]] as const;
const base = (emisor: "KUIQTRANS" | "MONACO", over: Partial<Cotizacion> = {}): Cotizacion => ({ ...COTIZACION_DOC, documentoEmisor: emisor, incluyeIva: false, ...over });

type Llamada = { texto: string; x: number; y: number; opciones: { align?: string; width?: number } };
afterEach(() => vi.restoreAllMocks());

async function generar(c: Cotizacion) {
  const espia = vi.spyOn(PDFDocument.prototype, "text");
  const buffer = await cotizacionPdf(c);
  const llamadas: Llamada[] = espia.mock.calls.map((a) => ({ texto: String(a[0]), x: a[1] as number, y: a[2] as number, opciones: (a[3] ?? {}) as Llamada["opciones"] }));
  espia.mockRestore();
  return { buffer, llamadas, todo: llamadas.map((l) => l.texto).join("\n") };
}

const COMBUSTIBLE = { combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 48 } as const;
const ANCHO_TABLA = 612 - MARGENES.left - MARGENES.right; // LETTER
const PESOS = [2.8, 2.8, 2.1, 2.3];
const PAD = 7, TAMANO = 9.5;
/** Altura real que ocupa un texto en una celda (misma medición que usa la tabla). */
function altoCelda(texto: string, columna: number, negrita = false) {
  const doc = new PDFDocument({ size: "LETTER" });
  const anchos = anchosColumnas(PESOS.map((peso) => ({ titulo: "", peso })), ANCHO_TABLA);
  return doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(TAMANO).heightOfString(texto, { width: anchos[columna] - PAD * 2 });
}

describe.each(MARCAS)("1. Combustible de referencia fuera del PDF — %s / %s", (emisor) => {
  const conTodo = base(emisor, {
    ...COMBUSTIBLE, condicionesCredito: "Crédito 30 días", observaciones: "Entrega en bodega.", condicionesAdicionales: "Pago contra entrega.",
    kmIncluidos: 100, tarifaKmAdicional: 8.5,
  });

  it("el PDF NO contiene «Combustible de referencia» ni el tipo/valor del combustible en ningún bloque (tabla, condiciones, observaciones, pie)", async () => {
    const { todo, buffer } = await generar(conTodo);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(todo).not.toContain("Combustible de referencia");
    expect(todo).not.toMatch(/combustible/i);
    expect(todo).not.toMatch(/Di[eé]sel|Gasolina/);
    expect(todo).not.toMatch(/48\.00|Q\s?48(?!\d)|\/\s?galón|por galón/i);
  });
  it("tampoco con tipo «gasolina»/«otro» ni con otro precio", async () => {
    for (const [tipo, precio] of [["gasolina", 32.1], ["otro", 55]] as const) {
      const { todo } = await generar(base(emisor, { combustibleReferenciaTipo: tipo, combustibleReferenciaPrecio: precio }));
      expect(todo).not.toMatch(/combustible|Gasolina|32\.10|55\.00|galón/i);
    }
  });
  it("lo demás SÍ sigue saliendo: condiciones del servicio, crédito, adicionales y observaciones", async () => {
    const { todo } = await generar(conTodo);
    for (const t of ["Piloto incluido", "100 km incluidos", "Condiciones de crédito: Crédito 30 días", "Pago contra entrega.", "Entrega en bodega."]) expect(todo).toContain(t);
  });
  it("el documento comercial no tiene condición automática de combustible y no lleva el dato", () => {
    const doc = construirDocumentoComercial(conTodo);
    expect(doc.condiciones.filter((l) => /combustible|galón/i.test(l))).toEqual([]);
    expect(doc.observaciones.filter((l) => /combustible/i.test(l))).toEqual([]);
    expect(JSON.stringify(doc)).not.toMatch(/combustible|Di[eé]sel|48/i);
    expect(doc).not.toHaveProperty("combustibleReferencia");
  });
  it("un PDF idéntico con y sin combustible guardado: las líneas de texto son las mismas", async () => {
    const con = await generar(conTodo);
    const sin = await generar({ ...conTodo, combustibleReferenciaTipo: null, combustibleReferenciaPrecio: null });
    expect(con.llamadas.map((l) => l.texto)).toEqual(sin.llamadas.map((l) => l.texto));
  });
});

describe("3. El dato sigue existiendo internamente: no se borra del modelo, de la BD ni del formulario", () => {
  const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  it("la cotización conserva tipo y precio, y el texto interno se sigue formando", () => {
    const c = base("KUIQTRANS", { ...COMBUSTIBLE });
    expect(c.combustibleReferenciaTipo).toBe("diesel"); expect(c.combustibleReferenciaPrecio).toBe(48);
    expect(textoCombustibleReferencia("diesel", 48)).toMatch(/Di[eé]sel.*48/);
  });
  it("persistencia, esquema y pantalla interna intactos (no se tocan columnas ni lógica de guardado)", () => {
    expect(leer("src/lib/tms/cotizaciones.ts")).toContain("combustible_referencia_tipo");
    expect(leer("src/lib/tms/cotizaciones.ts")).toContain("combustible_referencia_precio");
    expect(leer("sql/schema.sql")).toContain("combustible_referencia_tipo VARCHAR(20) NULL");
    const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
    expect(page).toContain("textoCombustibleReferencia(c.combustibleReferenciaTipo, c.combustibleReferenciaPrecio)");
    expect(page).toMatch(/combustibleReferenciaTipo/);
  });
  it("el PDF no importa ni usa el texto de combustible", () => {
    for (const f of ["cotizacion-pdf.ts", "cotizacion-pdf-kuiqtrans.ts", "cotizacion-pdf-monaco.ts", "cotizacion-pdf-layout.ts"]) {
      expect(leer(`src/lib/tms/${f}`)).not.toMatch(/combustible/i);
    }
    expect(leer("src/lib/tms/cotizacion-documento.ts")).not.toContain("`Combustible de referencia");
  });
});

describe.each(MARCAS)("2. Tabla «Propuesta comercial» centrada — %s / %s", (emisor) => {
  const lineas = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, empresaId: 7, cotizacionId: 123, orden: i + 1,
    origenTexto: i % 2 === 0 ? `Origen ${i + 1}` : `Centro de distribución regional número ${i + 1}, Zona Industrial, Villa Nueva, Guatemala, bodega de carga norte`,
    destinoTexto: i % 3 === 0 ? `Destino ${i + 1}` : `Puerto Santo Tomás de Castilla, Izabal, muelle de contenedores número ${i + 1}, zona franca`,
    unidadDescripcion: i % 2 === 0 ? `Cabezal ${i + 1}` : `Camión de 10 toneladas con furgón refrigerado, modelo ${i + 1}`,
    tarifaCotizada: 1000 + i * 111.11,
  })) as Cotizacion["lineasAdicionales"];
  const PRINCIPAL = { origenTexto: "Bodega Zona 12", destinoTexto: "Puerto Barrios, Izabal", unidadDescripcion: "Camión 5 toneladas", tarifaCotizada: 1400 };

  it("los cuatro encabezados van centrados (también «Precio sin IVA» e «Precio IVA incluido»)", async () => {
    for (const [incluyeIva, titulo] of [[false, "Precio sin IVA"], [true, "Precio IVA incluido"]] as const) {
      const { llamadas } = await generar(base(emisor, { incluyeIva }));
      for (const t of ["Punto de carga", "Punto de descarga", "Unidad", titulo]) {
        const l = llamadas.find((x) => x.texto === t);
        expect(l, t).toBeDefined(); expect(l!.opciones.align, t).toBe("center");
      }
    }
  });
  it("origen, destino, unidad y precio de la línea principal van centrados", async () => {
    const { llamadas } = await generar(base(emisor, PRINCIPAL));
    for (const t of ["Bodega Zona 12", "Puerto Barrios, Izabal", "Camión 5 toneladas", formatoMoneda(1400, "GTQ")]) {
      expect(llamadas.find((x) => x.texto === t)?.opciones.align, t).toBe("center");
    }
  });
  it("el precio sigue con formato monetario (Q1,400.00) y centrado", async () => {
    const { llamadas } = await generar(base(emisor, PRINCIPAL));
    expect(formatoMoneda(1400, "GTQ")).toMatch(/1,400\.00/);
    expect(llamadas.some((x) => x.texto === formatoMoneda(1400, "GTQ") && x.opciones.align === "center")).toBe(true);
  });
  it("centrado VERTICAL: con un origen de varias líneas, la unidad de una línea queda en el mismo centro que el origen", async () => {
    const origen = "Centro de distribución regional del norte, Zona Industrial, Villa Nueva, Guatemala, bodega de carga";
    const { llamadas } = await generar(base(emisor, { ...PRINCIPAL, origenTexto: origen }));
    const o = llamadas.find((x) => x.texto === origen)!, u = llamadas.find((x) => x.texto === "Camión 5 toneladas")!;
    const hO = altoCelda(origen, 0), hU = altoCelda("Camión 5 toneladas", 2);
    expect(hO).toBeGreaterThan(hU * 2); // el origen realmente ocupa varias líneas
    expect(u.y).toBeGreaterThan(o.y);
    expect(u.y + hU / 2).toBeCloseTo(o.y + hO / 2, 5); // mismo centro vertical
    expect(u.y - o.y).toBeCloseTo((hO - hU) / 2, 5);
    expect(o.opciones.align).toBe("center"); expect(u.opciones.align).toBe("center");
  });
  it("varias rutas con nombres largos: cada fila tiene todas sus celdas centradas horizontal y verticalmente (mismo centro por fila)", async () => {
    const adicionales = lineas(5);
    const { llamadas, buffer } = await generar(base(emisor, { ...PRINCIPAL, lineasAdicionales: adicionales }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const filas = [
      [PRINCIPAL.origenTexto, PRINCIPAL.destinoTexto, PRINCIPAL.unidadDescripcion, formatoMoneda(PRINCIPAL.tarifaCotizada, "GTQ")],
      ...adicionales.map((l) => [l.origenTexto!, l.destinoTexto!, l.unidadDescripcion!, formatoMoneda(l.tarifaCotizada, "GTQ")]),
    ];
    let yAnterior = -1;
    filas.forEach((celdas) => {
      const ls = celdas.map((t) => llamadas.find((x) => x.texto === t)!);
      ls.forEach((l, i) => { expect(l, celdas[i]).toBeDefined(); expect(l.opciones.align, celdas[i]).toBe("center"); });
      const centros = ls.map((l, i) => l.y + altoCelda(celdas[i], i) / 2);
      for (const c of centros) expect(c).toBeCloseTo(centros[0], 5); // las cuatro celdas comparten el centro vertical de la fila
      expect(Math.min(...ls.map((l) => l.y))).toBeGreaterThan(yAnterior); // las filas avanzan sin superponerse
      yAnterior = Math.max(...ls.map((l) => l.y));
    });
  });
  it("PDF de varias páginas: el encabezado se repite centrado y todas las filas siguen centradas", async () => {
    const adicionales = lineas(26);
    const { llamadas, buffer } = await generar(base(emisor, { ...PRINCIPAL, lineasAdicionales: adicionales }));
    expect((buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
    const encabezados = llamadas.filter((x) => x.texto === "Punto de carga");
    expect(encabezados.length).toBeGreaterThan(1); // repetido en cada página
    expect(encabezados.every((x) => x.opciones.align === "center")).toBe(true);
    for (const l of adicionales) {
      for (const t of [l.origenTexto!, l.destinoTexto!, l.unidadDescripcion!, formatoMoneda(l.tarifaCotizada, "GTQ")]) {
        expect(llamadas.find((x) => x.texto === t)?.opciones.align, t).toBe("center");
      }
    }
  });
  it("anchos, ajuste de altura y bordes no cambian: las celdas siguen ajustándose al ancho de su columna", async () => {
    const { llamadas } = await generar(base(emisor, PRINCIPAL));
    const anchos = anchosColumnas(PESOS.map((peso) => ({ titulo: "", peso })), ANCHO_TABLA);
    [["Bodega Zona 12", 0], ["Puerto Barrios, Izabal", 1], ["Camión 5 toneladas", 2], [formatoMoneda(1400, "GTQ"), 3]].forEach(([t, i]) => {
      expect(llamadas.find((x) => x.texto === t)?.opciones.width).toBeCloseTo(anchos[i as number] - PAD * 2, 5);
    });
    const fuente = readFileSync("src/lib/tms/cotizacion-pdf-layout.ts", "utf8");
    for (const peso of ["peso: 2.8", "peso: 2.1", "peso: 2.3"]) expect(fuente).toContain(peso);
    expect(fuente).not.toContain('alinear: "right"');
  });
});

describe("dibujarTabla: el centrado vertical es opcional y no cambia a otros usos", () => {
  function dibujar(centradoVertical: boolean | undefined) {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    const doc = new PDFDocument({ size: "LETTER", margins: { ...MARGENES } });
    doc.y = 100;
    const largo = "texto largo ".repeat(12).trim();
    dibujarTabla(doc, 46, 520, [{ titulo: "A", peso: 1 }, { titulo: "B", peso: 1 }], [[largo, "corto"]], {
      fondoEncabezado: "#000", textoEncabezado: "#fff", colorBorde: "#999", colorTexto: "#000", centradoVertical,
    });
    const llamadas = espia.mock.calls.map((a) => ({ texto: String(a[0]), y: a[2] as number, align: (a[3] as { align?: string }).align }));
    espia.mockRestore();
    return { llamadas, largo };
  }
  it("sin la opción: texto arriba (y + relleno) y alineación izquierda (comportamiento anterior)", () => {
    const { llamadas, largo } = dibujar(undefined);
    const l = llamadas.find((x) => x.texto === largo)!, c = llamadas.find((x) => x.texto === "corto")!;
    expect(c.y).toBe(l.y); expect(l.align).toBe("left");
  });
  it("con centradoVertical: la celda corta baja hasta el centro de la fila", () => {
    const { llamadas, largo } = dibujar(true);
    const l = llamadas.find((x) => x.texto === largo)!, c = llamadas.find((x) => x.texto === "corto")!;
    expect(c.y).toBeGreaterThan(l.y);
  });
});
