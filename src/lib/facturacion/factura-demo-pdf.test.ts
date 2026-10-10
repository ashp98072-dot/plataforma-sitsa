import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { deflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/facturacion/facturas", () => ({ obtenerFactura: vi.fn() }));
vi.mock("@/lib/facturacion/repository", () => ({ obtenerPerfilEmpresa: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { obtenerFactura } from "@/lib/facturacion/facturas";
import { obtenerPerfilEmpresa } from "@/lib/facturacion/repository";
import {
  cargarLogoEmpresa,
  descripcionVisible,
  generarPdfFacturaDemo,
  LEYENDA_NO_FISCAL,
  MARCA_ANULADA,
  MENSAJE_ANULADA_SIN_DETALLE,
  MENSAJE_SIN_LOGO,
  prepararFacturaDemo,
  renderizarFacturaDemo,
  TEXTO_PENDIENTE_DEFINIR,
  TEXTO_PENDIENTE_FEL,
  type ComplementosDemo,
  type EmisorDemo,
} from "./factura-demo-pdf";

/**
 * Mismo criterio que gastos-individual-pdf.test.ts: PDFKit comprime el contenido, así que se espía
 * PDFDocument.prototype.text (delegando a la implementación real) para verificar EXACTAMENTE qué texto se dibuja, y se
 * cuentan las páginas con el marcador estructural `/Type /Page`.
 */
function espiarTexto() {
  return vi.spyOn(PDFDocument.prototype, "text");
}
const textos = (spy: ReturnType<typeof espiarTexto>): string[] => spy.mock.calls.map((c) => String(c[0]));
const todo = (spy: ReturnType<typeof espiarTexto>): string => textos(spy).join("\n");
const cuenta = (spy: ReturnType<typeof espiarTexto>, exacto: string): number => textos(spy).filter((t) => t === exacto).length;
const paginas = (buf: Buffer): number => (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;

type Detalle = NonNullable<Awaited<ReturnType<typeof obtenerFactura>>>;

const EMISOR: EmisorDemo = { razonSocial: "Empresa Demo, S.A.", nombreComercial: "Demo Logística", nit: "9999999-9", direccion: "Zona 10, Ciudad de Guatemala", telefono: null };

// ── Logos de prueba: archivos REALES en un directorio temporal que hace de `uploads` (se usa el resolvedor real) ──────────
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunkPng(tipo: string, datos: Buffer): Buffer {
  const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([len, cuerpo, crc]);
}
/** PNG RGB de un solo color: válido y decodificable, de cualquier tamaño. */
function pngSolido(ancho: number, alto: number, [r, g, b]: [number, number, number]): Buffer {
  const fila = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: ancho }, () => [r, g, b]).flat())]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", ihdr), chunkPng("IDAT", deflateSync(Buffer.concat(Array.from({ length: alto }, () => fila)))), chunkPng("IEND", Buffer.alloc(0)),
  ]);
}
const JPEG_48X24 = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYADADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDma7zRfAaeWJdZkbflSIYW4A7hjj8OPTrzxzXhJIH8T2AuSoQSZG5sfMASv/j2OO9eu16mMryg1GOhz0oJ6s56fwXoUsTIlq8LHo6SsSP++iR+lcX4l8Mz6G3nrIstnJJsjbPzLxkBh+fI9O3SvVay/EyQP4b1AXJUIIWI3Nj5hyv/AI9jjvXLQxNSM0m7o0nTi0eP0UUV7JyDo3eKRZI3ZHQhlZTggjoQa9I0XxtYXkYTUStnPlVHUo+e+cfLz69OOTzRRWNajGqveLhNxehsT+INGgiaV9TtSq9Qkgc/kuSa4fxZ4qGrRmxskZbVZMmQsQZcdOOwzzg56A8UUVz4bDwXv9S6lR7HK0UUV3GJ/9k=", "base64");
const LOGO_7 = pngSolido(120, 120, [200, 30, 30]); // cuadrado — empresa 7
const LOGO_8 = pngSolido(120, 120, [30, 30, 200]); // cuadrado — empresa 8
const LOGO_ANCHO = pngSolido(600, 120, [20, 120, 60]); // apaisado (lockup horizontal)
let TMP_UPLOADS = "";
let TMP_FUERA = "";
let UPLOAD_DIR_ORIGINAL: string | undefined;

beforeAll(() => {
  UPLOAD_DIR_ORIGINAL = process.env.UPLOAD_DIR;
  TMP_UPLOADS = mkdtempSync(join(tmpdir(), "fact-uploads-"));
  TMP_FUERA = mkdtempSync(join(tmpdir(), "fact-fuera-"));
  process.env.UPLOAD_DIR = TMP_UPLOADS;
  for (const [ruta, datos] of [
    ["empresas/7/logo.png", LOGO_7], ["empresas/8/logo.png", LOGO_8], ["empresas/7/logo.jpg", JPEG_48X24], ["empresas/7/logo-ancho.png", LOGO_ANCHO],
    ["empresas/7/roto.png", Buffer.concat([LOGO_7.subarray(0, 40), Buffer.from("esto no es un png valido")])],
    ["empresas/7/texto.png", Buffer.from("no soy una imagen")], ["empresas/7/vacio.png", Buffer.alloc(0)],
    ["empresas/7/logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')],
    ["empresas/7/logo.gif", Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1")],
  ] as [string, Buffer][]) {
    mkdirSync(dirname(join(TMP_UPLOADS, ruta)), { recursive: true });
    writeFileSync(join(TMP_UPLOADS, ruta), datos);
  }
  mkdirSync(join(TMP_UPLOADS, "empresas/7/carpeta.png"), { recursive: true }); // un directorio, no un archivo
  writeFileSync(join(TMP_FUERA, "logo-ajeno.png"), LOGO_8);
});
afterAll(() => {
  if (UPLOAD_DIR_ORIGINAL === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = UPLOAD_DIR_ORIGINAL;
  rmSync(TMP_UPLOADS, { recursive: true, force: true });
  rmSync(TMP_FUERA, { recursive: true, force: true });
});
const COMPLETOS: ComplementosDemo = { clienteCodigo: "0000066", condiciones: null, leyendaTributaria: null };

function linea(n: number, over: Partial<Detalle["viajes"][number]> = {}): Detalle["viajes"][number] {
  return {
    id: n, planId: n, codigo: `DEMO-${n}`, fechaPlan: `2026-09-0${n}`, montoAsignado: 100,
    descripcion: `Servicio de transporte – Bodega Central → Destino ${n} – 0${n}/09/2026`, rutaCodigo: `RUTA-${n}`,
    origen: "Bodega Central", destino: `Destino ${n}`, cantidad: 1, precioIncluyeIva: true, porcentajeIva: 12,
    base: 89.29, iva: 10.71, total: 100, ...over,
  };
}

/** Arma un detalle cuyos totales de cabecera salen de sus líneas (a menos que se sobreescriban). */
function detalle(lineas: Detalle["viajes"], over: Partial<Detalle["factura"]> = {}): Detalle {
  const c = (k: "base" | "iva" | "total") => Number(lineas.reduce((s, l) => s + Math.round((l[k] ?? 0) * 100), 0) / 100);
  const subtotal = c("base"), iva = c("iva"), total = c("total");
  const incl = lineas.map((l) => l.precioIncluyeIva);
  return {
    factura: {
      id: 12, clienteId: 20, cliente: "Cliente Congelado, S.A.", numeroFactura: null, fechaEmision: null, montoTotal: total,
      estadoAdmin: "Borrador", observaciones: null, creadoPor: 3, creadoEn: "x", actualizadoPor: null, actualizadoEn: null,
      totalPagado: 0, saldo: total, estadoFinanciero: null, moneda: "GTQ", subtotal, iva, porcentajeIva: 12,
      precioIncluyeIva: incl.every((x) => x === incl[0]) ? incl[0] : null, clienteNit: "1234567-8", clienteDireccion: "Zona 1, Ciudad de Guatemala",
      ...over,
    },
    viajes: lineas,
    pagos: [],
    anulacion: null,
  } as Detalle;
}

const INCLUIDO = (n: number) => linea(n);
const AGREGADO = (n: number) => linea(n, { precioIncluyeIva: false, base: 100, iva: 12, total: 112 });

beforeEach(() => {
  vi.mocked(obtenerPerfilEmpresa).mockResolvedValue({
    respuestas: { razon_social_factura: "Empresa Demo, S.A.", nit_emisor: "9999999-9", direccion_fiscal: "Zona 10, Ciudad de Guatemala", nombre_comercial: "Demo Logística" },
    completadoPct: 100, actualizadoAt: null, actualizadoPor: null,
  } as never);
  vi.mocked(query).mockResolvedValue([{ codigo: "0000066" }] as never);
});
afterEach(() => { vi.restoreAllMocks(); });

async function renderizar(d: Detalle | null, emisor: EmisorDemo = EMISOR, complementos: ComplementosDemo = COMPLETOS, logo: Buffer = LOGO_7) {
  const m = prepararFacturaDemo(d, emisor, "2026-10-09", complementos);
  if (!m.ok) throw new Error(m.error);
  const spy = espiarTexto();
  const buffer = await renderizarFacturaDemo(m.factura, logo);
  return { spy, buffer, factura: m.factura };
}

describe("PDF demo — formato de la factura actual: Código / Descripción / Total", () => {
  it("1) el detalle es una tabla CÓDIGO | DESCRIPCIÓN | TOTAL (en ese orden), con una fila por viaje", async () => {
    const { spy } = await renderizar(detalle([INCLUIDO(1), AGREGADO(2)]));
    const ts = textos(spy);
    const i = (t: string) => ts.indexOf(t);
    expect(i("CÓDIGO")).toBeGreaterThan(-1);
    expect(i("DESCRIPCIÓN")).toBeGreaterThan(i("CÓDIGO"));
    expect(i("TOTAL")).toBeGreaterThan(i("DESCRIPCIÓN"));
    // fila: código → descripción → total de la línea
    const f1 = i("DEMO-1");
    expect(ts.slice(f1, f1 + 3)).toEqual(["DEMO-1", "SERVICIO DE TRANSPORTE - BODEGA CENTRAL A DESTINO 1 - 01/09/2026", "Q100.00"]);
    const f2 = i("DEMO-2");
    expect(ts.slice(f2, f2 + 3)).toEqual(["DEMO-2", "SERVICIO DE TRANSPORTE - BODEGA CENTRAL A DESTINO 2 - 02/09/2026", "Q112.00"]);
  });

  it("2) NO se muestran Base ni IVA como columnas ni por línea: solo el TOTAL de cada línea y el TOTAL de la factura", async () => {
    for (const d of [detalle([INCLUIDO(1), INCLUIDO(2)]), detalle([AGREGADO(1), AGREGADO(2)]), detalle([INCLUIDO(1), AGREGADO(2)])]) {
      vi.restoreAllMocks();
      vi.mocked(query).mockResolvedValue([{ codigo: "0000066" }] as never);
      const { spy } = await renderizar(d);
      const ts = textos(spy);
      expect(ts.filter((t) => /^(base|iva|subtotal|tarifa)\b/i.test(t.trim()))).toEqual([]);
      const t = todo(spy);
      expect(t).not.toMatch(/IVA|SUBTOTAL|BASE\b|tarifa/i);
      // ni los importes internos de base / IVA: 89.29, 10.71 y 12.00 no aparecen
      for (const interno of ["Q89.29", "Q10.71", "Q12.00", "Q178.58", "Q21.42", "Q22.71", "Q189.29", "Q24.00"]) expect(t, interno).not.toContain(interno);
    }
  });

  it("3) TOTAL EN LETRAS en quetzales y centavos, y el TOTAL Q. de la factura (ejemplo: Q1,239.44)", async () => {
    const { spy } = await renderizar(detalle([linea(1, { montoAsignado: 1239.44, base: 1106.64, iva: 132.8, total: 1239.44 })]));
    const ts = textos(spy);
    expect(ts).toContain("TOTAL EN LETRAS:");
    expect(ts).toContain("UN MIL DOSCIENTOS TREINTA Y NUEVE CON 44/100");
    expect(ts).toContain("TOTAL Q.:");
    expect(ts.filter((t) => t === "Q1,239.44")).toHaveLength(2); // la línea y el TOTAL Q.
    const mixta = await (async () => { vi.restoreAllMocks(); return renderizar(detalle([INCLUIDO(1), AGREGADO(2)])); })();
    expect(textos(mixta.spy)).toContain("DOSCIENTOS DOCE CON 00/100");
    expect(textos(mixta.spy)).toContain("Q212.00");
  });

  it("4) los espacios de FEL (serie, número, autorización, certificador, NIT, recuadro) dicen SOLO «PENDIENTE FEL»; nada simulado", async () => {
    const { spy, buffer } = await renderizar(detalle([INCLUIDO(1), AGREGADO(2)]));
    const ts = textos(spy);
    const sig = (etiqueta: string) => ts[ts.indexOf(etiqueta) + 1];
    expect(sig("SERIE:")).toBe(TEXTO_PENDIENTE_FEL);
    expect(sig("NO.:")).toBe(TEXTO_PENDIENTE_FEL);
    expect(sig("NÚMERO DE AUTORIZACIÓN")).toBe(TEXTO_PENDIENTE_FEL);
    expect(sig("NÚMERO DE AUTORIZACIÓN:")).toBe(TEXTO_PENDIENTE_FEL);
    expect(sig("CERTIFICADOR:")).toBe(TEXTO_PENDIENTE_FEL);
    expect(sig("NIT CERTIFICADOR:")).toBe(TEXTO_PENDIENTE_FEL);
    expect(ts.some((t) => t.includes(`certificación electrónica: ${TEXTO_PENDIENTE_FEL}`))).toBe(true);
    // el correlativo interno es el número interno de la plataforma, no uno de FEL
    expect(sig("CORRELATIVO INTERNO:")).toBe("BORRADOR #12 (sin número)");
    // fuera de las etiquetas y de «PENDIENTE FEL» no hay nada que parezca un identificador fiscal
    const resto = ts.join("\n").split(TEXTO_PENDIENTE_FEL).join("");
    expect(resto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(resto).not.toMatch(/infile|\bsat\b|\bxml\b|\bqr\b|uuid/i);
    // El único objeto de imagen del PDF es el LOGO de la empresa (un QR sería una segunda imagen)
    expect(buffer.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).toHaveLength(1);
  });

  it("5) la marca «DEMO — DOCUMENTO NO FISCAL» es visible: franja superior, marca de agua y pie", async () => {
    const { spy } = await renderizar(detalle([INCLUIDO(1)]));
    const ts = textos(spy);
    expect(LEYENDA_NO_FISCAL).toBe("DEMO — DOCUMENTO NO FISCAL");
    expect(ts).toContain(LEYENDA_NO_FISCAL); // franja
    expect(ts).toContain("DEMO - NO FISCAL"); // marca de agua
    expect(ts.some((t) => t.startsWith(`${LEYENDA_NO_FISCAL} · Página 1 de 1`))).toBe(true); // pie
    expect(ts).toContain("FACTURA DEMO");
    expect(ts).toContain("DOCUMENTO TRIBUTARIO ELECTRÓNICO");
  });

  it("6) factura MIXTA: se imprime solo el total de cada línea y el modelo conserva internamente base, IVA y tratamiento por línea", async () => {
    const { spy, factura } = await renderizar(detalle([INCLUIDO(1), AGREGADO(2)]));
    const t = todo(spy);
    expect(t).toContain("Q100.00"); // línea 1 (IVA incluido)
    expect(t).toContain("Q112.00"); // línea 2 (IVA agregado)
    expect(t).toContain("Q212.00"); // total
    expect(factura.lineas.map((l) => [l.precioIncluyeIva, l.base, l.iva, l.total])).toEqual([[true, 89.29, 10.71, 100], [false, 100, 12, 112]]);
    expect([factura.subtotal, factura.iva, factura.total]).toEqual([189.29, 22.71, 212]);
  });

  it("7) varias líneas: se dibujan TODAS, con su código y su total", async () => {
    const lineas = [1, 2, 3, 4, 5].map((n) => (n % 2 ? INCLUIDO(n) : AGREGADO(n)));
    const { spy, factura } = await renderizar(detalle(lineas));
    expect(factura.lineas).toHaveLength(5);
    const t = todo(spy);
    for (let n = 1; n <= 5; n++) expect(t).toContain(`DEMO-${n}`);
    expect(cuenta(spy, "Q112.00")).toBe(2);
    expect(cuenta(spy, "Q100.00")).toBe(3);
    expect(t).toContain("Q524.00"); // 3×100 + 2×112
    expect(textos(spy)).toContain("QUINIENTOS VEINTICUATRO CON 00/100");
  });

  it("8) OBSERVACIONES: se imprimen si existen y dicen «—» si no hay", async () => {
    const con = await renderizar(detalle([INCLUIDO(1)], { observaciones: "  Entregas cercanas al club  " }));
    const ts = textos(con.spy);
    expect(ts).toContain("OBSERVACIONES:");
    expect(ts[ts.indexOf("OBSERVACIONES:") + 1]).toBe("Entregas cercanas al club");
    vi.restoreAllMocks();
    const sin = await renderizar(detalle([INCLUIDO(1)], { observaciones: "   " }));
    const t2 = textos(sin.spy);
    expect(t2[t2.indexOf("OBSERVACIONES:") + 1]).toBe("—");
    // una observación muy larga no rompe el PDF (se recorta con «…» dentro de su recuadro)
    vi.restoreAllMocks();
    const larga = await renderizar(detalle([INCLUIDO(1)], { observaciones: "texto largo ".repeat(200) }));
    expect(paginas(larga.buffer)).toBe(1);
  });

  it("9) los datos que la plataforma aún no tiene salen «Pendiente de definir» y nunca se inventan", async () => {
    const { spy } = await renderizar(
      detalle([INCLUIDO(1)], { clienteNit: null, clienteDireccion: null }),
      { razonSocial: "Empresa X", nombreComercial: null, nit: null, direccion: null, telefono: null },
      { clienteCodigo: null, condiciones: null, leyendaTributaria: null },
    );
    const ts = textos(spy);
    const sig = (etiqueta: string) => ts[ts.indexOf(etiqueta) + 1];
    expect(TEXTO_PENDIENTE_DEFINIR).toBe("Pendiente de definir");
    expect(ts).toContain("Teléfono: pendiente de definir");
    expect(ts).toContain("NIT: pendiente de definir");
    expect(ts).toContain("Dirección: pendiente de definir");
    expect(sig("CONDICIONES:")).toBe("Pendiente de definir");
    expect(sig("CÓDIGO CLIENTE:")).toBe("Pendiente de definir");
    expect(ts).toContain("Leyenda tributaria: pendiente de definir");
    expect(sig("NIT:")).toBe("—"); // NIT del cliente sin dato
    expect(sig("DIRECCIÓN:")).toBe("—");
    expect(ts).not.toContain("Nombre comercial");
  });

  it("los datos que SÍ existen se usan: código de cliente, observaciones, teléfono y leyenda cuando llegan", async () => {
    const { spy } = await renderizar(
      detalle([INCLUIDO(1)]),
      { ...EMISOR, telefono: "2222-3333" },
      { clienteCodigo: "0000066", condiciones: "CONTADO", leyendaTributaria: "SUJETO A PAGOS TRIMESTRALES" },
    );
    const ts = textos(spy);
    const sig = (etiqueta: string) => ts[ts.indexOf(etiqueta) + 1];
    expect(ts).toContain("Teléfono: 2222-3333");
    expect(sig("CÓDIGO CLIENTE:")).toBe("0000066");
    expect(sig("CONDICIONES:")).toBe("CONTADO");
    expect(ts).toContain("SUJETO A PAGOS TRIMESTRALES");
    expect(ts).toContain("Nombre comercial: Demo Logística");
  });

  it("10) multipágina: el encabezado, el cliente, el recuadro FEL y el pie se repiten en CADA página; el total y las letras solo en la última", async () => {
    const lineas = Array.from({ length: 70 }, (_, i) => linea((i % 9) + 1, { id: i, codigo: `DEMO-${i}` }));
    const { spy, buffer, factura } = await renderizar(detalle(lineas, { observaciones: "Obs final" }));
    const n = paginas(buffer);
    expect(n).toBeGreaterThan(2);
    for (const fijo of ["DOCUMENTO TRIBUTARIO ELECTRÓNICO", "FACTURA DEMO", "NOMBRE:", "CÓDIGO", "DESCRIPCIÓN", "NÚMERO DE AUTORIZACIÓN:", "CORRELATIVO INTERNO:", LEYENDA_NO_FISCAL, "DEMO - NO FISCAL"]) {
      expect(cuenta(spy, fijo), fijo).toBe(n);
    }
    expect(textos(spy).filter((t) => t === "Cliente Congelado, S.A.")).toHaveLength(n);
    // pie «Página i de n» en todas, bien numerado
    const pies = textos(spy).filter((x) => x.startsWith(`${LEYENDA_NO_FISCAL} · Página`));
    expect(pies.map((p) => p.match(/Página (\d+) de (\d+)/)?.slice(1).join("/"))).toEqual(Array.from({ length: n }, (_, i) => `${i + 1}/${n}`));
    // total, letras y observaciones SOLO en la última; las demás dicen «Continúa…»
    expect(cuenta(spy, "TOTAL Q.:")).toBe(1);
    expect(cuenta(spy, "OBSERVACIONES:")).toBe(1);
    expect(textos(spy).filter((t) => /^[A-ZÁÉÍÓÚ ]+ CON \d\d\/100$/.test(t))).toHaveLength(1);
    expect(textos(spy).filter((t) => t.startsWith("Continúa en la página"))).toHaveLength(n - 1);
    // ninguna línea se pierde ni se repite
    const codigos = textos(spy).filter((t) => /^DEMO-\d+$/.test(t));
    expect(new Set(codigos).size).toBe(factura.lineas.length);
    expect(codigos).toHaveLength(factura.lineas.length);
  });
});

describe("descripcionVisible — «SERVICIO DE TRANSPORTE - ORIGEN A DESTINO - FECHA»", () => {
  it("usa la descripción congelada: mayúsculas, «→» como «A» y guiones normales", () => {
    expect(descripcionVisible("Servicio de transporte – Guatemala → Xela – 27/08/2026")).toBe("SERVICIO DE TRANSPORTE - GUATEMALA A XELA - 27/08/2026");
    expect(descripcionVisible("Servicio de transporte – — → — – 01/09/2026")).toBe("SERVICIO DE TRANSPORTE - — A — - 01/09/2026"); // «—» = desconocido, se conserva
    expect(descripcionVisible("Servicio – Cobán → Petén – 02/09/2026")).toBe("SERVICIO - COBÁN A PETÉN - 02/09/2026");
  });
});

describe("PDF demo — snapshots y validaciones", () => {
  it("el cliente sale del snapshot (nombre fiscal, NIT, dirección), no de un dato vivo", async () => {
    const { spy } = await renderizar(detalle([INCLUIDO(1)], { cliente: "Razón Social CONGELADA, S.A.", clienteNit: "5555555-5", clienteDireccion: "Dirección CONGELADA" }));
    const ts = textos(spy);
    expect(ts).toContain("Razón Social CONGELADA, S.A.");
    expect(ts[ts.indexOf("NIT:") + 1]).toBe("5555555-5");
    expect(ts[ts.indexOf("DIRECCIÓN:") + 1]).toBe("Dirección CONGELADA");
  });

  it("la línea sale de su snapshot (código y descripción congelados); «→» nunca llega al PDF", async () => {
    const { spy } = await renderizar(detalle([linea(1, { codigo: "DEMO-X", fechaPlan: "2026-08-27", descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026" })]));
    const ts = textos(spy);
    expect(ts).toContain("DEMO-X");
    expect(ts).toContain("SERVICIO DE TRANSPORTE - GUATEMALA A XELA - 27/08/2026");
    expect(todo(spy)).not.toContain("→");
  });

  it("subtotal + IVA = total: los totales congelados se VALIDAN contra la suma de las líneas y nunca se recalculan", () => {
    const base = detalle([INCLUIDO(1), AGREGADO(2)]);
    expect(prepararFacturaDemo(base, EMISOR, "2026-10-09").ok).toBe(true);
    for (const over of [{ subtotal: 189.3 }, { iva: 22.7 }, { montoTotal: 212.01 }]) {
      const r = prepararFacturaDemo(detalle([INCLUIDO(1), AGREGADO(2)], over), EMISOR, "2026-10-09");
      expect(r, JSON.stringify(over)).toMatchObject({ ok: false, status: 409 });
      if (!r.ok) expect(r.error).toContain("no coinciden con la suma de sus líneas");
    }
    const rota = prepararFacturaDemo(detalle([linea(1, { base: 90, iva: 10.71, total: 100 })]), EMISOR, "2026-10-09");
    expect(rota).toMatchObject({ ok: false, status: 409 });
  });

  it("una factura anterior al desglose por línea (sin snapshot fiscal) NO se genera: no se inventan importes", () => {
    const legado = detalle([linea(1, { descripcion: null, base: null, iva: null, total: null, precioIncluyeIva: null, porcentajeIva: null })], { subtotal: null, iva: null, porcentajeIva: null, precioIncluyeIva: null });
    const r = prepararFacturaDemo(legado, EMISOR, "2026-10-09");
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toContain("anterior al desglose de IVA por línea");
  });

  it("inexistente → 404; sin viajes → 409; una Anulada SIN líneas conservadas (anulada antes de FACT-3) → 409 con su motivo", () => {
    expect(prepararFacturaDemo(null, EMISOR, "2026-10-09")).toMatchObject({ ok: false, status: 404 });
    const sin = prepararFacturaDemo(detalle([], { subtotal: 0, iva: 0 }), EMISOR, "2026-10-09");
    expect(sin).toMatchObject({ ok: false, status: 409, error: "La factura no tiene viajes." });
    const anuladaSinDetalle = prepararFacturaDemo(detalle([], { estadoAdmin: "Anulada", subtotal: 189.29, iva: 22.71, montoTotal: 212 }), EMISOR, "2026-10-09");
    expect(anuladaSinDetalle).toEqual({ ok: false, status: 409, error: MENSAJE_ANULADA_SIN_DETALLE });
  });

  it("Borrador: «BORRADOR #id (sin número)» y la fecha mostrada es la de generación; Emitida: su número y su fecha de emisión (DÍA / MES / AÑO)", async () => {
    const b = await renderizar(detalle([INCLUIDO(1)]));
    expect(b.factura).toMatchObject({ numero: "BORRADOR #12 (sin número)", estado: "Borrador", fecha: "2026-10-09", etiquetaFecha: "Fecha del borrador (sin emitir)" });
    const tb = textos(b.spy);
    expect(tb.slice(tb.indexOf("DÍA"), tb.indexOf("DÍA") + 6)).toEqual(["DÍA", "MES", "AÑO", "09", "10", "2026"]);
    expect(tb[tb.indexOf("No. INTERNO:") + 1]).toBe("BORRADOR #12 (sin número)");
    vi.restoreAllMocks();
    const e = await renderizar(detalle([INCLUIDO(1)], { estadoAdmin: "Emitida", numeroFactura: "F-0001", fechaEmision: "2026-08-27" }));
    expect(e.factura).toMatchObject({ numero: "F-0001", estado: "Emitida", fecha: "2026-08-27", etiquetaFecha: "Fecha de emisión" });
    const te = textos(e.spy);
    expect(te.slice(te.indexOf("DÍA"), te.indexOf("DÍA") + 6)).toEqual(["DÍA", "MES", "AÑO", "27", "08", "2026"]);
    expect(te[te.indexOf("No. INTERNO:") + 1]).toBe("F-0001");
    expect(te[te.indexOf("CORRELATIVO INTERNO:") + 1]).toBe("F-0001");
  });
});

describe("PDF demo — factura ANULADA (FACT-3): desde su histórico, con la marca ANULADA", () => {
  const ANULACION = { fecha: "2026-10-09 14:05", usuario: "facturador-a" };
  const anulada = (lineas: Detalle["viajes"], over: Partial<Detalle["factura"]> = {}): Detalle =>
    ({ ...detalle(lineas, { estadoAdmin: "Anulada", ...over }), anulacion: ANULACION }) as Detalle;

  it("7) el PDF de una Anulada muestra TODAS las líneas originales y su total, tal como se congelaron", async () => {
    const { spy, factura } = await renderizar(anulada([INCLUIDO(1), AGREGADO(2), INCLUIDO(3)]));
    const ts = textos(spy);
    for (const n of [1, 2, 3]) expect(ts).toContain(`DEMO-${n}`);
    expect(ts).toContain("SERVICIO DE TRANSPORTE - BODEGA CENTRAL A DESTINO 2 - 02/09/2026");
    expect(ts).toContain("Q312.00"); // 100 + 112 + 100
    expect(ts).toContain("TRESCIENTOS DOCE CON 00/100");
    // cálculos internos intactos (no se recalcula con datos vivos)
    expect(factura.lineas.map((l) => [l.base, l.iva, l.total])).toEqual([[89.29, 10.71, 100], [100, 12, 112], [89.29, 10.71, 100]]);
    expect([factura.subtotal, factura.iva, factura.total]).toEqual([278.58, 33.42, 312]);
    expect(factura.estado).toBe("Anulada");
  });

  it("8) lleva la marca ANULADA muy visible (franja roja, banda del documento, marca de agua y pie) además de DEMO — NO FISCAL", async () => {
    const { spy } = await renderizar(anulada([INCLUIDO(1)]));
    const ts = textos(spy);
    expect(MARCA_ANULADA).toBe("ANULADA");
    expect(ts).toContain(`ANULADA — ${LEYENDA_NO_FISCAL}`); // franja superior
    expect(ts).toContain("FACTURA DEMO — ANULADA"); // banda del bloque tributario
    expect(ts).toContain("ANULADA"); // marca de agua
    expect(ts).toContain("DEMO - NO FISCAL"); // sigue la marca de agua DEMO
    expect(ts.some((t) => t.startsWith(`ANULADA · ${LEYENDA_NO_FISCAL} · Página 1 de 1`))).toBe(true);
  });

  it("una factura NO anulada nunca lleva la marca ANULADA", async () => {
    for (const d of [detalle([INCLUIDO(1)]), detalle([INCLUIDO(1)], { estadoAdmin: "Emitida", numeroFactura: "F-1", fechaEmision: "2026-08-27" })]) {
      vi.restoreAllMocks();
      const { spy } = await renderizar(d);
      expect(todo(spy)).not.toMatch(/ANULADA/);
    }
  });

  it("conserva su número y fecha de emisión si los tenía; si nunca los tuvo, muestra la fecha de anulación", async () => {
    const conNumero = await renderizar(anulada([INCLUIDO(1)], { numeroFactura: "F-0007", fechaEmision: "2026-08-27" }));
    expect(conNumero.factura).toMatchObject({ numero: "F-0007", fecha: "2026-08-27", estado: "Anulada" });
    expect(conNumero.factura.etiquetaFecha).toBe("Fecha de emisión · anulada el 09/10/2026");
    vi.restoreAllMocks();
    const borrador = await renderizar(anulada([INCLUIDO(1)]));
    expect(borrador.factura).toMatchObject({ numero: "ANULADA #12 (sin número)", fecha: "2026-10-09", etiquetaFecha: "Fecha de anulación" });
    const ts = textos(borrador.spy);
    expect(ts[ts.indexOf("No. INTERNO:") + 1]).toBe("ANULADA #12 (sin número)");
    expect(ts).toContain("Fecha de anulación");
  });

  it("se valida igual que cualquier factura: totales que no cuadran con sus líneas conservadas → 409", () => {
    const r = prepararFacturaDemo(anulada([INCLUIDO(1), AGREGADO(2)], { montoTotal: 999 }), EMISOR, "2026-10-09");
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toContain("no coinciden con la suma de sus líneas");
  });

  it("generarPdfFacturaDemo devuelve el PDF de una Anulada (ya no 409), con la empresa del guard y su logo", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(anulada([INCLUIDO(1), AGREGADO(2)]));
    const spy = espiarTexto();
    const r = await generarPdfFacturaDemo({ id: 7, nombre: "Empresa 7", logoUrl: "empresas/7/logo.png" }, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nombreArchivo).toBe("factura-demo-12.pdf");
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(textos(spy)).toContain("FACTURA DEMO — ANULADA");
    expect(vi.mocked(obtenerFactura).mock.calls[0]).toEqual([7, 12]);
  });
});

describe("PDF demo — código fuente sin FEL, red ni credenciales", () => {
  it("el módulo y la ruta no importan ni llaman a ningún proveedor fiscal, red ni credenciales", () => {
    const raiz = process.cwd();
    const fuentes = [
      "src/lib/facturacion/factura-demo-pdf.ts",
      "src/lib/facturacion/numero-letras.ts",
      "src/app/api/empresas/[slug]/facturacion/facturas/[id]/pdf-demo/route.ts",
    ].map((r) => readFileSync(join(raiz, r), "utf8"));
    // (con `fs` mockeado en este archivo, se lee con el real)
    for (const src of fuentes) {
      const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      const imports = [...codigo.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) expect(spec, spec).not.toMatch(/infile|(^|[/_-])fel([/_.-]|$)|certific|(^|[/_-])sat([/_.-]|$)|dte/i);
      expect(codigo).not.toMatch(/https?:\/\/|\bfetch\(|axios|process\.env|XMLHttpRequest|WebSocket/);
      expect(codigo).not.toMatch(/infile|uuid|\bsat\b|\bxml\b/i);
      // la única mención permitida a «FEL» es el texto reservado
      const sinReservado = codigo.split("PENDIENTE FEL").join("");
      expect(sinReservado).not.toMatch(/\bfel\b/i);
    }
  });
});

describe("generarPdfFacturaDemo — empresa, permisos y aislamiento", () => {
  const empresa7 = { id: 7, nombre: "Empresa 7", logoUrl: "empresas/7/logo.png" };
  const empresa8 = { id: 8, nombre: "Empresa 8", logoUrl: "empresas/8/logo.png" };

  it("multiempresa: la factura se busca SIEMPRE con la empresa del guard; la de otra empresa es un 404 y no se genera nada", async () => {
    const propia = detalle([INCLUIDO(1)]);
    vi.mocked(obtenerFactura).mockImplementation(async (empresaId: number) => (empresaId === 7 ? propia : null));
    const ok = await generarPdfFacturaDemo(empresa7, 12);
    expect(ok.ok).toBe(true);
    const ajena = await generarPdfFacturaDemo(empresa8, 12);
    expect(ajena).toEqual({ ok: false, status: 404, error: "Factura no encontrada." });
    expect(vi.mocked(obtenerFactura).mock.calls.map((c) => c[0])).toEqual([7, 8]);
    expect(vi.mocked(obtenerPerfilEmpresa).mock.calls.map((c) => c[0])).toEqual([7, 8]); // el emisor también es el de la empresa del guard
  });

  it("el código de cliente se lee filtrando por la empresa del guard; de una factura ajena (404) no se consulta nada", async () => {
    vi.mocked(obtenerFactura).mockImplementation(async (empresaId: number) => (empresaId === 7 ? detalle([INCLUIDO(1)]) : null));
    await generarPdfFacturaDemo(empresa7, 12);
    const [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.replace(/\s+/g, " ")).toBe("SELECT codigo FROM clientes WHERE id = ? AND empresa_id = ? LIMIT 1");
    expect(params).toEqual([20, 7]); // cliente de la factura, empresa del guard
    vi.mocked(query).mockClear();
    await generarPdfFacturaDemo(empresa8, 12);
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });

  it("si el cliente no tiene código (o es de otra empresa y no aparece), el PDF dice «Pendiente de definir»", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)]));
    vi.mocked(query).mockResolvedValue([] as never);
    const spy = espiarTexto();
    const r = await generarPdfFacturaDemo(empresa7, 12);
    expect(r.ok).toBe(true);
    const ts = textos(spy);
    expect(ts[ts.indexOf("CÓDIGO CLIENTE:") + 1]).toBe("Pendiente de definir");
  });

  it("devuelve un PDF real con nombre de archivo y usa los datos del emisor del perfil de la empresa", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1), AGREGADO(2)]));
    const spy = espiarTexto();
    const r = await generarPdfFacturaDemo(empresa7, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nombreArchivo).toBe("factura-demo-12.pdf");
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const ts = textos(spy);
    expect(ts).toContain("Empresa Demo, S.A.");
    expect(ts).toContain("NIT: 9999999-9");
    expect(ts).toContain("Teléfono: pendiente de definir"); // la plataforma aún no tiene teléfono del emisor
    expect(ts[ts.indexOf("CÓDIGO CLIENTE:") + 1]).toBe("0000066");
  });

  it("sin perfil de Facturación usa el nombre de la empresa como razón social y marca NIT/dirección como pendientes", async () => {
    vi.mocked(obtenerPerfilEmpresa).mockResolvedValue({ respuestas: {}, completadoPct: 0, actualizadoAt: null, actualizadoPor: null } as never);
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)]));
    const spy = espiarTexto();
    await generarPdfFacturaDemo(empresa7, 12);
    const ts = textos(spy);
    expect(ts).toContain("Empresa 7");
    expect(ts).toContain("NIT: pendiente de definir");
    expect(ts).toContain("Dirección: pendiente de definir");
  });

  it("solo lee: nunca modifica nada (solo se invocan funciones de lectura y un SELECT)", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)]));
    await generarPdfFacturaDemo(empresa7, 12);
    expect(vi.mocked(obtenerFactura)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(obtenerPerfilEmpresa)).toHaveBeenCalledTimes(1);
    const sqls = vi.mocked(query).mock.calls.map((c) => String(c[0]).trim().toUpperCase());
    expect(sqls.every((s) => s.startsWith("SELECT"))).toBe(true);
  });
});

describe("PDF demo — LOGO OBLIGATORIO de la empresa emisora", () => {
  const empresa7 = { id: 7, nombre: "Empresa 7", logoUrl: "empresas/7/logo.png" };
  const empresa8 = { id: 8, nombre: "Empresa 8", logoUrl: "empresas/8/logo.png" };
  const sinLogo = { ok: false, status: 409, error: MENSAJE_SIN_LOGO } as const;
  type Op = { fit?: number[]; width?: number; height?: number };
  const imagenes = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => ({ datos: c[0] as Buffer, opciones: (c[3] ?? {}) as Op }));
  beforeEach(() => { vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1), AGREGADO(2)])); });

  it("1) empresa con logo PNG válido → el PDF contiene la imagen (una sola: la del logo)", async () => {
    const r = await generarPdfFacturaDemo(empresa7, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buffer.toString("latin1").match(/\/Subtype\s*\/Image/g)).toHaveLength(1);
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("6) con un logo JPG válido el PDF también se genera normalmente (imagen JPEG embebida)", async () => {
    const r = await generarPdfFacturaDemo({ ...empresa7, logoUrl: "empresas/7/logo.jpg" }, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pdf = r.buffer.toString("latin1");
    expect(pdf.match(/\/Subtype\s*\/Image/g)).toHaveLength(1);
    expect(pdf).toContain("/DCTDecode");
  });

  it("2) empresa SIN logo_url (null, vacío o en blanco) → 409 con mensaje claro, sin PDF y sin respaldo a solo texto", async () => {
    for (const logoUrl of [null, "", "   "]) {
      expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl }, 12), String(logoUrl)).toEqual(sinLogo);
    }
    expect(MENSAJE_SIN_LOGO).toBe("Esta empresa no tiene un logo válido configurado para la factura.");
  });

  it("3) archivo inexistente → 409", async () => {
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: "empresas/7/no-existe.png" }, 12)).toEqual(sinLogo);
  });

  it("4) archivo ilegible o de formato no soportado (PNG corrupto, texto, vacío, SVG, GIF, una carpeta) → 409", async () => {
    for (const ruta of ["roto.png", "texto.png", "vacio.png", "logo.svg", "logo.gif", "carpeta.png"]) {
      expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: `empresas/7/${ruta}` }, 12), ruta).toEqual(sinLogo);
    }
  });

  it("rutas peligrosas del propio logo_url (traversal, absolutas, NUL) → 409; nunca se lee fuera de uploads", async () => {
    const fuera = relative(TMP_UPLOADS, join(TMP_FUERA, "logo-ajeno.png")).replaceAll("\\", "/");
    expect(fuera.startsWith("..")).toBe(true);
    for (const logoUrl of [fuera, "../../etc/passwd", join(TMP_FUERA, "logo-ajeno.png"), "empresas/7/../../../x.png", "empresas/7/logo.png\0.txt"]) {
      expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl }, 12), logoUrl).toEqual(sinLogo);
    }
  });

  it("5) el logo de la empresa A NUNCA aparece en la factura de la empresa B: cada empresa dibuja SOLO el suyo", async () => {
    const espiaA = vi.spyOn(PDFDocument.prototype, "image");
    await generarPdfFacturaDemo(empresa7, 12);
    const deA = imagenes(espiaA);
    espiaA.mockRestore();
    const espiaB = vi.spyOn(PDFDocument.prototype, "image");
    await generarPdfFacturaDemo(empresa8, 12);
    const deB = imagenes(espiaB);
    expect(deA.length).toBeGreaterThan(0);
    expect(deB.length).toBeGreaterThan(0);
    for (const i of deA) expect(i.datos.equals(LOGO_7), "empresa 7").toBe(true);
    for (const i of deB) expect(i.datos.equals(LOGO_8), "empresa 8").toBe(true);
  });

  it("5b) una empresa sin logo propio no toma el de otra; y un logo_url que apunta al directorio de OTRA empresa se rechaza (409)", async () => {
    expect(await generarPdfFacturaDemo({ ...empresa8, logoUrl: null }, 12)).toEqual(sinLogo);
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: "empresas/8/logo.png" }, 12)).toEqual(sinLogo); // existe, pero es de la 8
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: "./empresas/8/logo.png" }, 12)).toEqual(sinLogo);
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: "empresas\\8\\logo.png" }, 12)).toEqual(sinLogo);
    expect(await cargarLogoEmpresa({ id: 8, logoUrl: "empresas/8/logo.png" })).toEqual(LOGO_8);
    expect(await cargarLogoEmpresa({ id: 7, logoUrl: "empresas/8/logo.png" })).toBeNull();
  });

  it("el logo se dibuja con `fit` (proporcional): nunca con width/height, así que no se deforma; el apaisado usa todo el ancho del bloque", async () => {
    const esp = vi.spyOn(PDFDocument.prototype, "image");
    await generarPdfFacturaDemo(empresa7, 12);
    await generarPdfFacturaDemo({ ...empresa7, logoUrl: "empresas/7/logo-ancho.png" }, 12);
    const todas = imagenes(esp);
    expect(todas.length).toBeGreaterThanOrEqual(4); // (validación + dibujo) × 2 logos
    for (const i of todas) {
      expect(i.opciones.fit, "fit").toBeDefined();
      expect(i.opciones.width).toBeUndefined();
      expect(i.opciones.height).toBeUndefined();
    }
    const dibujos = todas.filter((i) => (i.opciones.fit?.[0] ?? 0) > 10);
    expect(dibujos.map((i) => i.opciones.fit)).toEqual([[132, 100], [288, 58]]); // cuadrado / apaisado
  });

  it("el orden de los errores no revela el estado del logo: inexistente → 404 y una factura inválida → su 409, aunque falte el logo", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(null);
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: null }, 12)).toEqual({ ok: false, status: 404, error: "Factura no encontrada." });
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([], { estadoAdmin: "Anulada", subtotal: 100, iva: 12, montoTotal: 112 }));
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: null }, 12)).toEqual({ ok: false, status: 409, error: MENSAJE_ANULADA_SIN_DETALLE });
    // una Anulada VÁLIDA sí exige logo, como cualquier otra
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)], { estadoAdmin: "Anulada" }));
    expect(await generarPdfFacturaDemo({ ...empresa7, logoUrl: null }, 12)).toEqual(sinLogo);
  });

  it("renderizar con un logo que PDFKit no puede leer FALLA (nunca cae a encabezado solo de texto)", async () => {
    const m = prepararFacturaDemo(detalle([INCLUIDO(1)]), EMISOR, "2026-10-09", COMPLETOS);
    if (!m.ok) throw new Error(m.error);
    await expect(renderizarFacturaDemo(m.factura, Buffer.from("no-es-una-imagen"))).rejects.toThrow();
  });
});

/**
 * Genera el PDF de EJEMPLO con datos sintéticos para revisión visual. Solo corre si se define FACT_DEMO_PDF_SALIDA
 * (ruta del archivo). No forma parte de la suite normal.
 */
describe.skipIf(!process.env.FACT_DEMO_PDF_SALIDA)("PDF demo de ejemplo (datos sintéticos)", () => {
  it("escribe el archivo", async () => {
    // Logo sintético de prueba (o el que se indique en FACT_DEMO_PDF_LOGO para revisar otras proporciones).
    const logo = readFileSync(process.env.FACT_DEMO_PDF_LOGO || join(process.cwd(), "docs", "ejemplos", "logo-demo-empresa.png"));
    const d = detalle(
      [
        linea(1, { fechaPlan: "2026-09-01", codigo: "DEMO-A", descripcion: "Servicio de transporte – Bodega Central Guatemala → Quetzaltenango – 01/09/2026" }),
        linea(2, { fechaPlan: "2026-09-02", codigo: "DEMO-B", precioIncluyeIva: false, base: 100, iva: 12, total: 112, descripcion: "Servicio de transporte – Bodega Central Guatemala → Cobán – 02/09/2026" }),
        linea(3, { fechaPlan: "2026-09-03", codigo: "DEMO-C", montoAsignado: 250, base: 223.21, iva: 26.79, total: 250, descripcion: "Servicio de transporte – Bodega Central Guatemala → Escuintla – 03/09/2026" }),
      ],
      { cliente: "Cliente Demo Uno, S.A.", clienteNit: "1234567-8", clienteDireccion: "Zona 1, Ciudad de Guatemala", observaciones: "Entregas de prueba (datos sintéticos)" },
    );
    const m = prepararFacturaDemo(d, EMISOR, "2026-10-09", COMPLETOS);
    if (!m.ok) throw new Error(m.error);
    const buf = await renderizarFacturaDemo(m.factura, logo);
    const salida = String(process.env.FACT_DEMO_PDF_SALIDA);
    mkdirSync(dirname(salida), { recursive: true });
    writeFileSync(salida, buf);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it.skipIf(!process.env.FACT_DEMO_PDF_SALIDA_ANULADA)("escribe también el ejemplo de una factura ANULADA (con su detalle y la marca ANULADA)", async () => {
    const logo = readFileSync(join(process.cwd(), "docs", "ejemplos", "logo-demo-empresa.png"));
    const d = {
      ...detalle(
        [
          linea(1, { fechaPlan: "2026-09-01", codigo: "DEMO-A", descripcion: "Servicio de transporte – Bodega Central Guatemala → Quetzaltenango – 01/09/2026" }),
          linea(2, { fechaPlan: "2026-09-02", codigo: "DEMO-B", precioIncluyeIva: false, base: 100, iva: 12, total: 112, descripcion: "Servicio de transporte – Bodega Central Guatemala → Cobán – 02/09/2026" }),
        ],
        { estadoAdmin: "Anulada", cliente: "Cliente Demo Uno, S.A.", clienteNit: "1234567-8", clienteDireccion: "Zona 1, Ciudad de Guatemala", observaciones: "Factura anulada de prueba (datos sintéticos)" },
      ),
      anulacion: { fecha: "2026-10-09 14:05", usuario: "facturador-demo" },
    } as Detalle;
    const m = prepararFacturaDemo(d, EMISOR, "2026-10-09", COMPLETOS);
    if (!m.ok) throw new Error(m.error);
    const salida = String(process.env.FACT_DEMO_PDF_SALIDA_ANULADA);
    mkdirSync(dirname(salida), { recursive: true });
    writeFileSync(salida, await renderizarFacturaDemo(m.factura, logo));
  });

  it.skipIf(!process.env.FACT_DEMO_PDF_SALIDA_LARGO)("escribe también una versión LARGA (varias páginas) para revisar los saltos de página", async () => {
    const lineas = Array.from({ length: 70 }, (_, i) => (i % 3 === 1
      ? linea(i % 9 + 1, { id: i, codigo: `DEMO-${100 + i}`, precioIncluyeIva: false, base: 100, iva: 12, total: 112 })
      : linea(i % 9 + 1, { id: i, codigo: `DEMO-${100 + i}` })));
    const m = prepararFacturaDemo(detalle(lineas, { estadoAdmin: "Emitida", numeroFactura: "F-DEV-0001", fechaEmision: "2026-10-09", observaciones: "Factura larga de prueba" }), EMISOR, "2026-10-09", COMPLETOS);
    if (!m.ok) throw new Error(m.error);
    const salida = String(process.env.FACT_DEMO_PDF_SALIDA_LARGO);
    mkdirSync(dirname(salida), { recursive: true });
    writeFileSync(salida, await renderizarFacturaDemo(m.factura, LOGO_7));
  });
});
