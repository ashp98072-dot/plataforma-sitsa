import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { celdaPdf, dibujarTablaEnDoc } from "./export-files";

/**
 * Regresión del bug real encontrado en VIATICOS-COMPROBANTE-PDF: una
 * celda con `fecha_hora_servidor` tal como lo serializa
 * firmas-lectura.ts (`String(Date)` de mysql2 -> formato `Date.toString()`
 * del motor JS, ej. "Thu Sep 03 2026 18:47:26 GMT+0000 (Coordinated
 * Universal Time)") se mostraba SIN reformatear en la tabla del
 * comprobante, porque dibujarTablaEnDoc() (extraída de pdfTabla() en
 * PR #184) no llamaba a celdaPdf() — solo tablaAPdf() lo hacía antes de
 * invocar a pdfTabla(). Un caller que use dibujarTablaEnDoc()
 * directamente (como viaticos-comprobante-pdf.ts) se saltaba esa
 * normalización por completo.
 */
describe("celdaPdf", () => {
  it("normaliza Date.toString() del motor JS a DD/MM/YYYY HH:mm:ss", () => {
    const s = "Thu Sep 03 2026 18:47:26 GMT+0000 (Coordinated Universal Time)";
    expect(celdaPdf(s)).toMatch(/^03\/09\/2026 \d{2}:47:26$/);
  });

  it("normaliza fecha/hora ISO ('YYYY-MM-DDTHH:mm:ss')", () => {
    expect(celdaPdf("2026-09-03T18:47:26")).toBe("03/09/2026 18:47:26");
  });

  it("normaliza fecha DATETIME de MySQL ('YYYY-MM-DD HH:mm:ss')", () => {
    expect(celdaPdf("2026-09-03 18:47:26")).toBe("03/09/2026 18:47:26");
  });

  it("una fecha solo-día ('YYYY-MM-DD') se normaliza sin hora", () => {
    expect(celdaPdf("2026-09-01")).toBe("01/09/2026");
  });

  it("un texto que no es fecha se devuelve sin cambios", () => {
    expect(celdaPdf("PLAN-20260901-005")).toBe("PLAN-20260901-005");
  });

  it("null/undefined -> cadena vacía", () => {
    expect(celdaPdf(null)).toBe("");
    expect(celdaPdf(undefined)).toBe("");
  });
});

describe("dibujarTablaEnDoc", () => {
  it("dibuja sin errores una celda con Date.toString() (el mismo valor real que produce firmas-lectura.ts) y deja doc.y avanzado tras la tabla", async () => {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "LETTER", margins: { top: 40, bottom: 40, left: 40, right: 40 }, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const yAntes = doc.y;
      dibujarTablaEnDoc(doc, {
        headers: ["Viaje", "Fecha autorización"],
        rows: [["PLAN-20260901-005", "Thu Sep 03 2026 18:47:26 GMT+0000 (Coordinated Universal Time)"]],
      });
      // doc.y queda posicionado después de la tabla (mayor que antes de
      // dibujarla) — así el caller puede seguir agregando contenido
      // propio en el mismo documento (ver viaticos-comprobante-pdf.ts).
      expect(doc.y).toBeGreaterThan(yAntes);
      doc.end();
    });
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
