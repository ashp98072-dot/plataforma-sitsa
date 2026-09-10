import { deflateSync, inflateSync } from "node:zlib";
import { esPngValido } from "@/lib/firmas/imagen-firma";

/**
 * FIRMAS-PDF-TINTA-1 — refuerzo VISUAL de la imagen de la firma manuscrita
 * SOLO al momento de renderizar/exportar un PDF.
 *
 *  - NO toca el archivo histórico en disco.
 *  - NO escribe usuario_firmas ni firmas_electronicas.
 *  - NO altera la LÓGICA de firmas (hash, snapshot, auditoría) — el
 *    `imagenSha256` del payload sigue apuntando a los bytes originales.
 *
 * El procesamiento conserva EXACTAMENTE la forma de la firma (nunca la
 * deforma, reescala ni reposiciona: ancho/alto en píxeles se mantienen):
 *   1. lleva el trazo a escala de grises / tinta oscura;
 *   2. sube el contraste y oscurece el trazo (curva sobre la "fuerza de
 *      tinta" de cada píxel);
 *   3. engrosa LEVEMENTE (dilatación morfológica de 1 px, mezclada al
 *      55 % para que sea un borde suave, no de marcador);
 *   4. preserva el fondo tal como venía (transparente si la firma trae
 *      canal alfa; blanco si viene opaca);
 *   5. devuelve un PNG RGBA de 8 bits, sin entrelazar, listo para pdfkit.
 *
 * Si la imagen no es un PNG que este helper sepa procesar con seguridad
 * (entrelazado, 16 bits, paleta, tRNS, decodificación fallida, etc.) se
 * devuelven los BYTES ORIGINALES sin tocar — nunca se rompe el PDF.
 */

/**
 * Curva de tinta: `min(1, base^EXP · GANANCIA)`. EXP<1 sube los medios
 * (contraste) y GANANCIA lleva el núcleo del trazo a tinta sólida, dejando
 * el halo anti-alias apenas reforzado — "más visible" sin parecer marcador.
 */
const CURVA_TINTA_EXP = 0.55;
const CURVA_TINTA_GANANCIA = 1.3;
/** Radio de la dilatación morfológica, en píxeles. "Engrosamiento leve" = 1. */
export const DILATACION_PX = 1;
/** Peso con el que se mezcla el halo de la dilatación (borde suave, no sólido). */
const FUERZA_DILATACION = 0.5;
/** Factor al que se lleva el color del trazo: 0.2 = "negro / azul muy oscuro" conservando un matiz del original. */
const OSCURECER_RGB = 0.2;

function curvaTinta(base: number): number {
  return Math.min(1, Math.pow(base, CURVA_TINTA_EXP) * CURVA_TINTA_GANANCIA);
}

const FIRMA_PNG = [137, 80, 78, 71, 13, 10, 26, 10];

// --- CRC-32 (polinomio estándar PNG) -------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type PngRgba = {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** El PNG traía canal alfa (tipos de color 4 o 6). */
  tieneAlfa: boolean;
  /**
   * El FONDO real es transparente (se detecta muestreando el borde, no
   * solo por el tipo de color: un PNG RGBA con alfa 255 en todo el borde
   * es en realidad fondo blanco/opaco).
   */
  fondoTransparente: boolean;
};

function leerU32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

/** Deshace el filtro de scanline PNG (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth). */
function desfiltrar(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filtro = raw[pos++]!;
    const filaOut = y * stride;
    const filaPrev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const valor = raw[pos++]!;
      const a = x >= bpp ? out[filaOut + x - bpp]! : 0;
      const b = y > 0 ? out[filaPrev + x]! : 0;
      const c = y > 0 && x >= bpp ? out[filaPrev + x - bpp]! : 0;
      let r: number;
      switch (filtro) {
        case 0: r = valor; break;
        case 1: r = valor + a; break;
        case 2: r = valor + b; break;
        case 3: r = valor + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          r = valor + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`filtro PNG no soportado: ${filtro}`);
      }
      out[filaOut + x] = r & 0xff;
    }
  }
  return out;
}

/**
 * Decodifica un PNG de 8 bits, sin entrelazar, tipos de color 0/2/4/6 y
 * SIN tRNS, a RGBA plano. Cualquier otra cosa lanza (el caller la trata
 * como "no procesable" y usa los bytes originales).
 */
export function decodificarPng(bytes: Uint8Array): PngRgba {
  for (let i = 0; i < 8; i++) if (bytes[i] !== FIRMA_PNG[i]) throw new Error("no es PNG");
  let o = 8;
  let width = 0, height = 0, colorType = -1;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = leerU32(bytes, o);
    const tipo = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const datos = bytes.subarray(o + 8, o + 8 + len);
    if (tipo === "IHDR") {
      width = leerU32(datos, 0);
      height = leerU32(datos, 4);
      const bitDepth = datos[8]!;
      colorType = datos[9]!;
      const interlace = datos[12]!;
      if (bitDepth !== 8) throw new Error("solo 8 bits");
      if (interlace !== 0) throw new Error("entrelazado no soportado");
      if (![0, 2, 4, 6].includes(colorType)) throw new Error(`tipo de color ${colorType} no soportado`);
    } else if (tipo === "tRNS" || tipo === "PLTE") {
      throw new Error(`chunk ${tipo} no soportado`);
    } else if (tipo === "IDAT") {
      idat.push(new Uint8Array(datos));
    } else if (tipo === "IEND") {
      break;
    }
    o += 12 + len;
  }
  if (!width || !height || colorType < 0 || !idat.length) throw new Error("PNG incompleto");

  const canales = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))));
  if (raw.length < (width * canales + 1) * height) throw new Error("datos PNG truncados");
  const plano = desfiltrar(raw, width, height, canales);

  const tieneAlfa = colorType === 4 || colorType === 6;
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * canales, d = p * 4;
    if (colorType === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = plano[s]!; rgba[d + 3] = 255; }
    else if (colorType === 2) { rgba[d] = plano[s]!; rgba[d + 1] = plano[s + 1]!; rgba[d + 2] = plano[s + 2]!; rgba[d + 3] = 255; }
    else if (colorType === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = plano[s]!; rgba[d + 3] = plano[s + 1]!; }
    else { rgba[d] = plano[s]!; rgba[d + 1] = plano[s + 1]!; rgba[d + 2] = plano[s + 2]!; rgba[d + 3] = plano[s + 3]!; }
  }
  return { width, height, rgba, tieneAlfa, fondoTransparente: tieneAlfa && bordeEsTransparente(width, height, rgba) };
}

/** ¿El borde de la imagen es mayormente transparente? (fondo real = transparente). */
function bordeEsTransparente(width: number, height: number, rgba: Uint8Array): boolean {
  const muestras: number[] = [];
  const puntos: [number, number][] = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
    [(width / 2) | 0, 0], [(width / 2) | 0, height - 1], [0, (height / 2) | 0], [width - 1, (height / 2) | 0],
  ];
  for (const [x, y] of puntos) muestras.push(rgba[(y * width + x) * 4 + 3]!);
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;
  return media < 24;
}

function chunk(tipo: string, datos: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length, 0);
  const tipoBytes = Buffer.from(tipo, "ascii");
  const cuerpo = Buffer.concat([tipoBytes, Buffer.from(datos)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([len, cuerpo, crc]);
}

/** Codifica RGBA de 8 bits a PNG (tipo de color 6, filtro 0, sin entrelazar). */
export function codificarPngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const conFiltro = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    conFiltro[y * (stride + 1)] = 0;
    conFiltro.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from(FIRMA_PNG),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(conFiltro), { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Fuerza de tinta [0,1] de un píxel: el canal alfa manda si la firma es transparente; si es opaca, cuánto se aparta del blanco. */
function fuerzaTinta(img: PngRgba, idx: number): number {
  const r = img.rgba[idx]!, g = img.rgba[idx + 1]!, b = img.rgba[idx + 2]!, a = img.rgba[idx + 3]!;
  if (img.fondoTransparente) return a / 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return Math.max(0, Math.min(1, 1 - lum));
}

/**
 * Aplica el refuerzo sobre una imagen RGBA ya decodificada. Función pura
 * (no muta la entrada): devuelve un nuevo RGBA con el trazo más oscuro y
 * levemente engrosado, conservando dimensiones y tipo de fondo.
 */
export function reforzarRgba(img: PngRgba): PngRgba {
  const { width, height } = img;
  const n = width * height;

  const tinta = new Float32Array(n);
  for (let p = 0; p < n; p++) tinta[p] = fuerzaTinta(img, p * 4);

  // Dilatación morfológica: máximo en una ventana (2·DILATACION_PX+1)².
  const dilatada = new Float32Array(n);
  const rad = DILATACION_PX;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const v = tinta[yy * width + xx]!;
          if (v > m) m = v;
        }
      }
      dilatada[y * width + x] = m;
    }
  }

  const out = new Uint8Array(img.rgba.length);
  for (let p = 0; p < n; p++) {
    const base = tinta[p]!;
    const curva = curvaTinta(base);                         // más contraste + oscurece
    const halo = dilatada[p]! * FUERZA_DILATACION;          // engrosamiento leve, feathered
    const f = Math.max(curva, halo);                        // [0,1]
    const d = p * 4;
    const r = img.rgba[d]!, g = img.rgba[d + 1]!, b = img.rgba[d + 2]!;
    const rr = Math.round(r * OSCURECER_RGB);
    const gg = Math.round(g * OSCURECER_RGB);
    const bb = Math.round(b * OSCURECER_RGB);
    if (img.fondoTransparente) {
      out[d] = rr; out[d + 1] = gg; out[d + 2] = bb;
      out[d + 3] = Math.round(255 * f);
    } else {
      // Fondo blanco opaco: mezcla blanco (255) con tinta oscura según f.
      out[d] = Math.round(255 * (1 - f) + rr * f);
      out[d + 1] = Math.round(255 * (1 - f) + gg * f);
      out[d + 2] = Math.round(255 * (1 - f) + bb * f);
      out[d + 3] = 255;
    }
  }
  return { width, height, rgba: out, tieneAlfa: img.tieneAlfa, fondoTransparente: img.fondoTransparente };
}

/**
 * Punto de entrada: recibe los BYTES ORIGINALES del PNG de la firma y
 * devuelve un NUEVO Buffer PNG reforzado para incrustar en el PDF. Ante
 * cualquier problema devuelve los bytes originales SIN modificar (nunca
 * lanza, nunca rompe la generación del documento).
 */
export function reforzarFirmaParaPdf(bytes: Buffer): Buffer {
  try {
    if (!esPngValido(bytes)) return bytes;
    const img = decodificarPng(bytes);
    if (img.width < 2 || img.height < 2 || img.width * img.height > 4_000_000) return bytes;
    const reforzada = reforzarRgba(img);
    return codificarPngRgba(reforzada.width, reforzada.height, reforzada.rgba);
  } catch {
    return bytes;
  }
}
