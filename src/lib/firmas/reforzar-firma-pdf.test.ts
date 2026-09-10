import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import {
  DILATACION_PX,
  codificarPngRgba,
  decodificarPng,
  reforzarFirmaParaPdf,
  reforzarRgba,
} from "./reforzar-firma-pdf";
import { esPngValido } from "./imagen-firma";

/**
 * FIRMAS-PDF-TINTA-1 — refuerzo VISUAL de la firma SOLO al exportar el PDF.
 * NUNCA toca el archivo histórico ni la lógica de firmas.
 */

/**
 * Firma transparente sintética: trazo con núcleo apenas medio (poco
 * contraste, "fino y claro") y bordes anti-alias, sobre fondo transparente
 * — como una firma de canvas mal contrastada.
 */
function firmaTransparente(alphaNucleo = 150): Buffer {
  const w = 180, h = 70;
  const rgba = new Uint8Array(w * h * 4); // todo transparente
  const brocha = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const a = Math.max(0, Math.round(alphaNucleo * (1 - Math.hypot(dx, dy) / 2.4)));
        const i = (y * w + x) * 4;
        if (a > rgba[i + 3]!) { rgba[i] = 8; rgba[i + 1] = 10; rgba[i + 2] = 44; rgba[i + 3] = a; }
      }
    }
  };
  for (let x = 12; x < w - 12; x++) brocha(x, 35 + 18 * Math.sin(x / 16));
  return codificarPngRgba(w, h, rgba);
}

/** Firma OPACA sintética: trazo gris claro sobre fondo blanco (sin canal alfa útil). */
function firmaFondoBlanco(): Buffer {
  const w = 180, h = 70;
  const rgba = new Uint8Array(w * h * 4).fill(255); // fondo blanco opaco
  for (let x = 12; x < w - 12; x++) {
    const y = Math.round(35 + 18 * Math.sin(x / 16));
    const i = (y * w + x) * 4;
    // gris medio-claro (poco contraste)
    rgba[i] = 150; rgba[i + 1] = 150; rgba[i + 2] = 165; rgba[i + 3] = 255;
  }
  return codificarPngRgba(w, h, rgba);
}

function resumen(png: Buffer) {
  const img = decodificarPng(png);
  let sumaAlfa = 0, maxAlfa = 0, pixelesConTinta = 0, sumaLum = 0, pixelesFondo = 0;
  for (let p = 0; p < img.width * img.height; p++) {
    const d = p * 4;
    const a = img.rgba[d + 3]!;
    const lum = 0.299 * img.rgba[d]! + 0.587 * img.rgba[d + 1]! + 0.114 * img.rgba[d + 2]!;
    sumaAlfa += a; maxAlfa = Math.max(maxAlfa, a);
    if (a > 0) pixelesConTinta++;
    sumaLum += lum;
    if (a === 0 || (img.rgba[d]! > 250 && img.rgba[d + 1]! > 250 && img.rgba[d + 2]! > 250 && a === 255)) pixelesFondo++;
  }
  return { ...img, sumaAlfa, maxAlfa, pixelesConTinta, sumaLum, pixelesFondo };
}

describe("reforzarFirmaParaPdf — no toca la imagen original", () => {
  it("NO modifica el Buffer de entrada (mismos bytes antes y después)", () => {
    const orig = firmaTransparente();
    const copia = Buffer.from(orig);
    reforzarFirmaParaPdf(orig);
    expect(orig.equals(copia)).toBe(true);
  });

  it("devuelve un Buffer NUEVO (distinto objeto), nunca el mismo", () => {
    const orig = firmaTransparente();
    const out = reforzarFirmaParaPdf(orig);
    expect(out).not.toBe(orig);
    expect(out.equals(orig)).toBe(false);
  });
});

describe("reforzarFirmaParaPdf — genera una imagen PNG válida", () => {
  it("el resultado es un PNG real, 8 bits, RGBA, sin entrelazar", () => {
    const out = reforzarFirmaParaPdf(firmaTransparente());
    expect(esPngValido(out)).toBe(true);
    const img = decodificarPng(out); // no lanza -> estructura válida
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
  });

  it("conserva EXACTAMENTE las dimensiones (nunca reescala ni recorta ni reposiciona)", () => {
    const orig = firmaTransparente();
    const a = decodificarPng(orig);
    const b = decodificarPng(reforzarFirmaParaPdf(orig));
    expect([b.width, b.height]).toEqual([a.width, a.height]);
  });
});

describe("reforzarFirmaParaPdf — oscurece y engrosa levemente", () => {
  it("firma transparente fina/clara -> más oscura (más tinta total y mucho mayor opacidad de pico)", () => {
    const orig = firmaTransparente(140);
    const a = resumen(orig);
    const b = resumen(reforzarFirmaParaPdf(orig));
    expect(b.sumaAlfa).toBeGreaterThan(a.sumaAlfa * 1.25);
    expect(b.maxAlfa).toBeGreaterThan(a.maxAlfa * 1.4);
    expect(b.maxAlfa).toBeGreaterThanOrEqual(235); // el núcleo del trazo llega casi a tinta sólida
  });

  it("firma con fondo BLANCO opaca fina/clara -> el trazo se oscurece (baja la luminancia media)", () => {
    const orig = firmaFondoBlanco();
    const a = resumen(orig);
    const b = resumen(reforzarFirmaParaPdf(orig));
    expect(b.sumaLum).toBeLessThan(a.sumaLum);
  });

  it("engrosamiento LEVE: crecen los píxeles con tinta pero mucho menos que si se duplicara el trazo", () => {
    const orig = firmaTransparente(70);
    const a = resumen(orig);
    const b = resumen(reforzarFirmaParaPdf(orig));
    expect(b.pixelesConTinta).toBeGreaterThan(a.pixelesConTinta);
    // Dilatación de 1 px sobre un trazo de ~1 px: a lo sumo ~x9 en el peor
    // caso teórico de una ventana 3x3, en la práctica mucho menos. Nunca
    // debe "inundar" la imagen.
    expect(b.pixelesConTinta).toBeLessThan(a.pixelesConTinta * 6);
    expect(DILATACION_PX).toBe(1);
  });
});

describe("reforzarFirmaParaPdf — preserva el fondo", () => {
  it("fondo TRANSPARENTE: los píxeles que estaban 100% transparentes siguen 100% transparentes", () => {
    const orig = firmaTransparente();
    const a = decodificarPng(orig);
    const b = decodificarPng(reforzarFirmaParaPdf(orig));
    let revisados = 0;
    for (let p = 0; p < a.width * a.height; p++) {
      // un píxel lejos de cualquier trazo (esquina) debe seguir transparente
      if (a.rgba[p * 4 + 3] === 0) {
        const x = p % a.width, y = Math.floor(p / a.width);
        const cercaBorde = x < 3 || y < 3 || x > a.width - 4 || y > a.height - 4;
        if (cercaBorde) { expect(b.rgba[p * 4 + 3]).toBe(0); revisados++; }
      }
    }
    expect(revisados).toBeGreaterThan(0);
    expect(b.fondoTransparente).toBe(true);
  });

  it("fondo BLANCO opaco: sigue blanco y opaco donde no hay trazo", () => {
    const orig = firmaFondoBlanco();
    const b = decodificarPng(reforzarFirmaParaPdf(orig));
    // esquina (0,0) — sin trazo
    expect([b.rgba[0], b.rgba[1], b.rgba[2], b.rgba[3]]).toEqual([255, 255, 255, 255]);
    expect(b.fondoTransparente).toBe(false);
  });
});

describe("reforzarFirmaParaPdf — nunca rompe la generación del PDF", () => {
  it("un buffer que NO es PNG se devuelve tal cual (sin lanzar)", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
    expect(reforzarFirmaParaPdf(jpeg)).toBe(jpeg);
  });

  it("un PNG corrupto/truncado se devuelve tal cual (sin lanzar)", () => {
    const roto = Buffer.concat([firmaTransparente().subarray(0, 40), Buffer.from([9, 9, 9, 9])]);
    expect(() => reforzarFirmaParaPdf(roto)).not.toThrow();
    expect(reforzarFirmaParaPdf(roto).equals(roto)).toBe(true);
  });

  it("un PNG entrelazado (no soportado) se devuelve tal cual", () => {
    const png = firmaTransparente();
    png[28] = 1; // byte de interlace del IHDR
    expect(reforzarFirmaParaPdf(png).equals(png)).toBe(true);
  });

  it("un PNG de 16 bits (no soportado) se devuelve tal cual", () => {
    const png = firmaTransparente();
    png[24] = 16; // bit depth del IHDR
    expect(reforzarFirmaParaPdf(png).equals(png)).toBe(true);
  });
});

describe("reforzarFirmaParaPdf — la firma reforzada se incrusta en un PDF sin romperlo", () => {
  it("pdfkit acepta el PNG reforzado y el documento se genera (%PDF)", async () => {
    const reforzada = reforzarFirmaParaPdf(firmaTransparente());
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "LETTER" });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.image(reforzada, 40, 40, { fit: [160, 60] }); // no lanza
      doc.end();
    });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("reforzarRgba — función pura, no muta la entrada", () => {
  it("no modifica el arreglo rgba original", () => {
    const img = decodificarPng(firmaTransparente());
    const copia = Uint8Array.from(img.rgba);
    reforzarRgba(img);
    expect(img.rgba).toEqual(copia);
  });
});
