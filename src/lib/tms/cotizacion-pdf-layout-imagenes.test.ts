import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { LOGO_KUIQTRANS_HEADER, LOGO_KUIQTRANS_WATERMARK, LOGO_MONACO } from "./cotizacion-pdf-assets";
import { dibujarImagen, dibujarMarcaDeAgua, dimensionesPng, MARGENES } from "./cotizacion-pdf-layout";

/** PDF Letter (mismo tamaño que usa generarPdf): 612 x 792 puntos. */
const PAGINA = { width: 612, height: 792 };

function docDeMentiras() {
  return new PDFDocument({ size: "LETTER", layout: "portrait", margins: { ...MARGENES } });
}

describe("dimensionesPng — lee el ancho/alto real del PNG (chunk IHDR)", () => {
  it.each([
    ["monaco/logo.png", LOGO_MONACO],
    ["kuiqtrans/logo-header.png", LOGO_KUIQTRANS_HEADER],
    ["kuiqtrans/logo-watermark.png", LOGO_KUIQTRANS_WATERMARK],
  ])("%s tiene dimensiones válidas y coherentes con el tamaño del archivo", (_nombre, buffer) => {
    const { width, height } = dimensionesPng(buffer);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // Un PNG sin comprimir de este tamaño no puede pesar menos que unos pocos bytes por fila.
    expect(buffer.length).toBeGreaterThan(200);
  });

  it("rechaza un buffer que no es un PNG (sin inventar un tamaño)", () => {
    expect(() => dimensionesPng(Buffer.from("no es un png"))).toThrow(/PNG/);
  });
});

describe("dibujarImagen — ancho fijo, alto proporcional (nunca deforma el logo)", () => {
  it("dibuja con el ancho pedido y devuelve el alto en la MISMA proporción que el PNG real", () => {
    const doc = docDeMentiras();
    const espia = vi.spyOn(doc, "image");
    const { width: wPx, height: hPx } = dimensionesPng(LOGO_MONACO);
    const resultado = dibujarImagen(doc, LOGO_MONACO, 10, 20, 190);
    expect(resultado.width).toBe(190);
    expect(resultado.height).toBeCloseTo(190 * (hPx / wPx), 5);
    expect(espia).toHaveBeenCalledWith(LOGO_MONACO, 10, 20, { width: 190 });
  });
});

describe("dibujarMarcaDeAgua — centrada en el CENTRO FÍSICO de la página", () => {
  it("Mónaco: el centro de la imagen coincide con page.width/2 y page.height/2, calculado desde el tamaño real del PNG (nunca a ojo)", () => {
    const doc = docDeMentiras();
    const espia = vi.spyOn(doc, "image");
    const anchoDestino = 420;
    const { width: wPx, height: hPx } = dimensionesPng(LOGO_MONACO);
    const altoDestino = anchoDestino * (hPx / wPx);
    dibujarMarcaDeAgua(doc, LOGO_MONACO, { anchoDestino, opacidad: 0.06 });
    expect(espia).toHaveBeenCalledTimes(1);
    const [buffer, x, y, opts] = espia.mock.calls[0] as unknown as [Buffer, number, number, { width: number }];
    expect(buffer).toBe(LOGO_MONACO);
    expect(opts).toEqual({ width: anchoDestino });
    // Centro de la imagen dibujada == centro físico de la hoja (612x792), no del área de contenido.
    expect(x + anchoDestino / 2).toBeCloseTo(PAGINA.width / 2, 5);
    expect(y + altoDestino / 2).toBeCloseTo(PAGINA.height / 2, 5);
    // Explícitamente NO calculado desde doc.y / los márgenes de contenido.
    expect(x).not.toBe(doc.page.margins.left);
    expect(y).not.toBe(doc.y);
  });

  it("KuiqTrans: mismo centrado exacto, con un ancho de destino distinto", () => {
    const doc = docDeMentiras();
    const espia = vi.spyOn(doc, "image");
    const anchoDestino = 260;
    const { width: wPx, height: hPx } = dimensionesPng(LOGO_KUIQTRANS_WATERMARK);
    const altoDestino = anchoDestino * (hPx / wPx);
    dibujarMarcaDeAgua(doc, LOGO_KUIQTRANS_WATERMARK, { anchoDestino });
    const [, x, y] = espia.mock.calls[0] as unknown as [Buffer, number, number, { width: number }];
    expect(x + anchoDestino / 2).toBeCloseTo(PAGINA.width / 2, 5);
    expect(y + altoDestino / 2).toBeCloseTo(PAGINA.height / 2, 5);
  });

  it("con `opacidad` envuelve el dibujo en doc.opacity(valor) y lo restaura a 1 después", () => {
    const doc = docDeMentiras();
    const llamadas: number[] = [];
    vi.spyOn(doc, "opacity").mockImplementation(function (this: PDFKit.PDFDocument, v: number) { llamadas.push(v); return this; });
    vi.spyOn(doc, "image").mockReturnThis();
    dibujarMarcaDeAgua(doc, LOGO_MONACO, { anchoDestino: 300, opacidad: 0.06 });
    expect(llamadas).toEqual([0.06, 1]);
  });

  it("sin `opacidad` (alfa ya horneado en el PNG, caso KuiqTrans) no toca doc.opacity()", () => {
    const doc = docDeMentiras();
    const espia = vi.spyOn(doc, "opacity");
    vi.spyOn(doc, "image").mockReturnThis();
    dibujarMarcaDeAgua(doc, LOGO_KUIQTRANS_WATERMARK, { anchoDestino: 260 });
    expect(espia).not.toHaveBeenCalled();
  });

  it("el centrado es independiente del contenido ya dibujado (doc.y no influye)", () => {
    const doc = docDeMentiras();
    doc.moveDown(20); // simula bastante contenido ya escrito arriba
    const espia = vi.spyOn(doc, "image");
    const anchoDestino = 300;
    const { width: wPx, height: hPx } = dimensionesPng(LOGO_MONACO);
    const altoDestino = anchoDestino * (hPx / wPx);
    dibujarMarcaDeAgua(doc, LOGO_MONACO, { anchoDestino, opacidad: 0.06 });
    const [, x, y] = espia.mock.calls[0] as unknown as [Buffer, number, number, { width: number }];
    expect(x + anchoDestino / 2).toBeCloseTo(PAGINA.width / 2, 5);
    expect(y + altoDestino / 2).toBeCloseTo(PAGINA.height / 2, 5);
  });
});
