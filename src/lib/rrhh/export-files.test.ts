import { describe, expect, it, vi } from "vitest";
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

  /**
   * VIATICOS-PDF-PRESENTACION-1 — `align`/`minWeight` son parámetros
   * OPT-IN nuevos (para centrar/ensanchar una columna de montos sin
   * truncarla, ver viaticos-comprobante-pdf.ts). Estas pruebas confirman
   * que (a) funcionan cuando se pasan y (b) un caller que NO los pasa
   * (todos los demás reportes existentes) conserva EXACTAMENTE el mismo
   * comportamiento de siempre — alineado a la izquierda, mismo ancho.
   */
  describe("align/minWeight (opt-in, VIATICOS-PDF-PRESENTACION-1)", () => {
    function doc() {
      return new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 36, bottom: 40, left: 32, right: 32 }, bufferPages: true });
    }
    function espiarTexto(d: InstanceType<typeof PDFDocument>) {
      const llamadas: { texto: string; opciones: Record<string, unknown> | undefined }[] = [];
      const original = d.text.bind(d);
      vi.spyOn(d, "text").mockImplementation((texto: unknown, ...args: unknown[]) => {
        const opciones = args.find((a): a is Record<string, unknown> => typeof a === "object" && a !== null && !Array.isArray(a));
        llamadas.push({ texto: String(texto), opciones });
        return original(texto as string, ...(args as []));
      });
      return llamadas;
    }

    it("una columna sin align se sigue dibujando a la izquierda (comportamiento por defecto, sin cambios)", () => {
      const d = doc();
      const llamadas = espiarTexto(d);
      dibujarTablaEnDoc(d, { headers: ["Monto"], rows: [["Q50.00"]] });
      d.end();
      const celda = llamadas.find((l) => l.texto === "Q50.00");
      expect(celda?.opciones?.align).toBe("left");
    });

    it("align:{i:'center'} centra encabezado y valores de esa columna, sin afectar las demás", () => {
      const d = doc();
      const llamadas = espiarTexto(d);
      dibujarTablaEnDoc(d, {
        headers: ["Viaje", "Monto"],
        rows: [["VJ-001", "Q50.00"]],
        align: { 1: "center" },
      });
      d.end();
      expect(llamadas.find((l) => l.texto === "Monto")?.opciones?.align).toBe("center");
      expect(llamadas.find((l) => l.texto === "Q50.00")?.opciones?.align).toBe("center");
      expect(llamadas.find((l) => l.texto === "VJ-001")?.opciones?.align).toBe("left");
    });

    it("minWeight evita que una columna corta quede tan angosta que trunque su contenido con '…'", () => {
      // Mismo escenario (9 columnas, igual que viaticos-comprobante-pdf.ts)
      // que reprodujo el bug real: con muchas columnas de texto largo,
      // "Monto" (índice 5) quedaba tan angosta que "Q50.00" se truncaba a
      // "Q50.0…" — un monto CORTO es el caso que más fácil se rompe,
      // porque su propio peso (por longitud de texto) es el más pequeño.
      const headers = ["Viaje", "Fecha", "Cliente", "Empleado", "Rol", "Monto", "Autorizado por", "Fecha autorización", "Código de firma"];
      const filaBase = (monto: string) => [
        "VJ-20260901-00123456",
        "01/09/2026",
        "Distribuidora Guatemalteca de Alimentos S.A.",
        "Juan Carlos Perez Lopez Gonzalez",
        "Piloto",
        monto,
        "Heber Alexander Sitan Ramirez",
        "09/09/2026 14:12:33",
        "SIG-20260909-a1b2c3d4",
      ];

      const sinMinWeight = doc();
      const llamadasSinFix = espiarTexto(sinMinWeight);
      dibujarTablaEnDoc(sinMinWeight, { headers, rows: [filaBase("Q50.00")] });
      sinMinWeight.end();
      expect(llamadasSinFix.some((l) => l.texto.includes("…"))).toBe(true); // reproduce el bug real sin el fix

      const conMinWeight = doc();
      const llamadasConFix = espiarTexto(conMinWeight);
      // Además, con el fix, un monto con miles ("Q1,250.00") en la MISMA
      // tabla también debe caber completo — no solo el caso corto.
      dibujarTablaEnDoc(conMinWeight, {
        headers,
        rows: [filaBase("Q50.00"), filaBase("Q1,250.00")],
        align: { 5: "center" },
        minWeight: { 5: 14 },
      });
      conMinWeight.end();
      expect(llamadasConFix.find((l) => l.texto === "Q50.00")).toBeDefined();
      expect(llamadasConFix.find((l) => l.texto === "Q1,250.00")).toBeDefined();
      expect(llamadasConFix.some((l) => l.texto.includes("…"))).toBe(false);
    });
  });
});
