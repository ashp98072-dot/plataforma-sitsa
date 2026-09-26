import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/documentos", () => ({ listarDocumentos: vi.fn() }));

import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { listarDocumentos } from "@/lib/rrhh/documentos";
import { GET } from "../../app/api/empresas/[slug]/empleados/[id]/expediente-pdf/route";
import { construirExpedientePdf, detectarFormato, nombreArchivoExpediente, ordenarDocumentosExpediente, ORDEN_TIPOS_EXPEDIENTE } from "./expediente-pdf";
import { TIPOS_DOCUMENTO } from "./documentos-tipos";

// --- fixtures generados en memoria (sin binarios en el repo) ---
async function pdfDe(paginas: number, ancho = 300, alto = 400): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage([ancho, alto]).drawText(`pagina ${i + 1}`, { x: 20, y: 20 });
  return d.save();
}
function crc32(b: Buffer): number {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    c = (crc ^ b[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngDe(w: number, h: number): Uint8Array {
  const chunk = (tipo: string, datos: Buffer) => {
    const t = Buffer.from(tipo, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
    return Buffer.concat([len, t, datos, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]);
  const crudo = Buffer.concat(Array.from({ length: h }, () => fila));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(crudo)), chunk("IEND", Buffer.alloc(0))]));
}
// JPEG 1x1 mínimo (baseline)
const JPG = new Uint8Array(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
    "base64",
  ),
);

const doc = (id: number, tipo: string, nombre: string | null, subidoEn = "2026-01-01 10:00:00") => ({ id, tipoDocumento: tipo, nombreOriginal: nombre, subidoEn });
const fila = (id: number, tipo: string, ruta: string, subidoEn = "2026-01-01") => ({ id, empresaId: 1, idEmpleado: 42, tipoDocumento: tipo, rutaArchivo: ruta, nombreOriginal: `n${id}`, subidoEn, subidoPor: null });
const emp = { codigo: "265899771220", nombre: "Abel Natanael Ambrocio López", dpi: "2658 99771 2201", puesto: "Piloto", categoriaOps: "Operaciones", estado: "Activo", fechaAlta: "2024-03-05" };
const ahora = "26/09/2026 09:00";
const paginasDe = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();

describe("orden y nombre de archivo", () => {
  it("8) orden estable: catálogo real primero, mismo tipo por fecha/id, desconocidos al final", () => {
    const docs = [doc(5, "Rareza", "z"), doc(4, "Otro", "o"), doc(3, "Contrato", "c2", "2026-02-01"), doc(2, "Contrato", "c1", "2026-01-01"), doc(1, "DPI", "d"), doc(6, "Licencia", "l")];
    expect(ordenarDocumentosExpediente(docs).map((d) => d.id)).toEqual([1, 6, 2, 3, 4, 5]);
    expect(ordenarDocumentosExpediente([...docs].reverse()).map((d) => d.id)).toEqual([1, 6, 2, 3, 4, 5]);
  });
  it("todos los tipos del catálogo real están en el orden (no hay categorías ficticias)", () => {
    for (const t of ORDEN_TIPOS_EXPEDIENTE) expect(TIPOS_DOCUMENTO as readonly string[]).toContain(t);
    for (const t of TIPOS_DOCUMENTO) expect(ORDEN_TIPOS_EXPEDIENTE as readonly string[]).toContain(t);
  });
  it("16) filename sanitizado (tildes, espacios, caracteres de ruta/cabecera)", () => {
    expect(nombreArchivoExpediente("265899771220", "Abel Natanael Ambrocio López")).toBe("Expediente-265899771220-Abel-Natanael-Ambrocio-Lopez.pdf");
    const raro = nombreArchivoExpediente('../x"\r\n', "A/B\\C;é");
    expect(raro).toMatch(/^Expediente-[A-Za-z0-9-]+\.pdf$/);
    expect(nombreArchivoExpediente("", "")).toBe("Expediente-empleado.pdf");
  });
  it("detecta formato por firma, no por extensión", async () => {
    expect(detectarFormato(await pdfDe(1))).toBe("pdf");
    expect(detectarFormato(JPG)).toBe("jpg");
    expect(detectarFormato(pngDe(2, 2))).toBe("png");
    expect(detectarFormato(new Uint8Array([1, 2, 3]))).toBe("otro");
  });
});

describe("generador", () => {
  it("1) 0 documentos: solo portada; sin índice", async () => {
    const { bytes, resumen } = await construirExpedientePdf({ empleado: emp, documentos: [], generado: ahora });
    expect(await paginasDe(bytes)).toBe(1);
    expect(resumen).toEqual({ incluidos: 0, omitidos: 0, paginas: 1 });
  });
  it("2) 1 PDF: portada + sus páginas, sin índice", async () => {
    const { bytes } = await construirExpedientePdf({ empleado: emp, documentos: [{ doc: doc(1, "DPI", "dpi.pdf"), bytes: await pdfDe(1) }], generado: ahora });
    expect(await paginasDe(bytes)).toBe(2);
  });
  it("3) PDF multipágina conserva todas sus páginas", async () => {
    const { bytes } = await construirExpedientePdf({ empleado: emp, documentos: [{ doc: doc(1, "Contrato", "c.pdf"), bytes: await pdfDe(4) }], generado: ahora });
    expect(await paginasDe(bytes)).toBe(1 + 4);
  });
  it("4-5) JPG y PNG: una página cada uno, proporcional y centrada (apaisada → página apaisada)", async () => {
    const { bytes } = await construirExpedientePdf({
      empleado: emp,
      documentos: [
        { doc: doc(1, "DPI", "a.jpg"), bytes: JPG },
        { doc: doc(2, "Licencia", "b.png"), bytes: pngDe(40, 20) },
      ],
      generado: ahora,
    });
    const d = await PDFDocument.load(bytes);
    expect(d.getPageCount()).toBe(1 + 1 + 2); // portada + índice + 2 imágenes
    const png = d.getPage(3).getSize();
    expect(png.width).toBeGreaterThan(png.height); // 40x20 → apaisada
    const jpg = d.getPage(2).getSize();
    expect(jpg.width).toBeLessThanOrEqual(jpg.height + 0.01); // 1x1 → no apaisada
  });
  it("6-7) mezcla PDF + JPG + PNG con varios del mismo tipo: total exacto de páginas", async () => {
    const { bytes, resumen } = await construirExpedientePdf({
      empleado: emp,
      documentos: [
        { doc: doc(1, "DPI", "frente.jpg"), bytes: JPG },
        { doc: doc(2, "DPI", "reverso.png"), bytes: pngDe(10, 10) },
        { doc: doc(3, "Contrato", "contrato.pdf"), bytes: await pdfDe(3) },
      ],
      generado: ahora,
    });
    expect(resumen).toEqual({ incluidos: 3, omitidos: 0, paginas: 1 + 1 + 1 + 1 + 3 });
    expect(await paginasDe(bytes)).toBe(7);
  });
  it("9-10) faltante (bytes null) o corrupto: una página informativa y el resto sigue", async () => {
    const { bytes, resumen } = await construirExpedientePdf({
      empleado: emp,
      documentos: [
        { doc: doc(1, "DPI", "falta.pdf"), bytes: null },
        { doc: doc(2, "Licencia", "roto.pdf"), bytes: new Uint8Array(Buffer.from("%PDF-1.4 basura que no es un pdf")) },
        { doc: doc(3, "Contrato", "ok.pdf"), bytes: await pdfDe(2) },
      ],
      generado: ahora,
    });
    expect(resumen.omitidos).toBe(2);
    expect(resumen.incluidos).toBe(1);
    expect(await paginasDe(bytes)).toBe(1 + 1 + 1 + 1 + 2);
  });
  it("jpg corrupto (firma válida, contenido roto) se degrada sin romper", async () => {
    const roto = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
    const { resumen } = await construirExpedientePdf({
      empleado: emp,
      documentos: [
        { doc: doc(1, "DPI", "x.jpg"), bytes: roto },
        { doc: doc(2, "Otro", "y.pdf"), bytes: await pdfDe(1) },
      ],
      generado: ahora,
    });
    expect(resumen.omitidos).toBe(1);
    expect(resumen.incluidos).toBe(1);
  });
  it("24) formato no soportado (WebP/BMP): página informativa, sin romper", async () => {
    const webp = new Uint8Array(Buffer.from("RIFF0000WEBPVP8 ", "ascii"));
    const { bytes, resumen } = await construirExpedientePdf({
      empleado: emp,
      documentos: [
        { doc: doc(1, "Otro", "f.webp"), bytes: webp },
        { doc: doc(2, "Otro", "g.bmp"), bytes: new Uint8Array([0x42, 0x4d, 0, 0]) },
      ],
      generado: ahora,
    });
    expect(resumen.omitidos).toBe(2);
    expect(await paginasDe(bytes)).toBe(1 + 1 + 2);
  });
  it("17) portada con datos vacíos (—) no rompe y es una sola página", async () => {
    const { bytes } = await construirExpedientePdf({ empleado: { codigo: "C-9", nombre: "Ana", dpi: "", puesto: null }, documentos: [], generado: ahora });
    expect(await paginasDe(bytes)).toBe(1);
  });
  it("17) la portada dibuja título, nombre y código (código fuente del generador)", () => {
    const g = readFileSync("src/lib/rrhh/expediente-pdf.ts", "utf8");
    expect(g).toContain('"EXPEDIENTE DEL EMPLEADO"');
    for (const etiqueta of ['["Nombre"', '["Código"', '["DPI"', '["Puesto"', '["Área"', '["Estado"', '["Fecha de contratación"', '["Generado el"']) expect(g).toContain(etiqueta);
  });
  it("23) foto de portada opcional: ausente, corrupta o válida no rompen", async () => {
    for (const foto of [null, new Uint8Array([1, 2, 3]), new Uint8Array([0xff, 0xd8, 0xff, 0, 0]), pngDe(30, 40)]) {
      const { bytes } = await construirExpedientePdf({ empleado: emp, documentos: [], fotoPortada: foto, generado: ahora });
      expect(await paginasDe(bytes)).toBe(1);
    }
  });
  it("caracteres fuera de WinAnsi en nombres no rompen el dibujo", async () => {
    const { resumen } = await construirExpedientePdf({
      empleado: { ...emp, nombre: "Zoë 王 😀" },
      documentos: [{ doc: doc(1, "DPI", "名前😀.pdf"), bytes: await pdfDe(1) }],
      generado: ahora,
    });
    expect(resumen.incluidos).toBe(1);
  });
  it("índice largo ocupa varias páginas y los documentos siguen completos", async () => {
    const base = await pdfDe(1);
    const docs = Array.from({ length: 40 }, (_, i) => ({ doc: doc(i + 1, "Otro", `d${i}.pdf`), bytes: base }));
    const { resumen } = await construirExpedientePdf({ empleado: emp, documentos: docs, generado: ahora });
    expect(resumen.paginas).toBe(1 + 2 + 40);
  });
});

describe("endpoint GET /empleados/[id]/expediente-pdf (archivos reales en un UPLOAD_DIR temporal)", () => {
  let raiz: string;
  const previo = process.env.UPLOAD_DIR;
  const ctx = (id = "42") => ({ params: Promise.resolve({ slug: "sitsa", id }) });
  const escribir = (rel: string, datos: Uint8Array) => {
    const abs = join(raiz, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, datos);
  };
  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), "exp-"));
    process.env.UPLOAD_DIR = raiz;
  });
  afterAll(() => {
    rmSync(raiz, { recursive: true, force: true });
    if (previo === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previo;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireTenantRrhh).mockResolvedValue({ session: { username: "u" }, empresa: { id: 1 } } as never);
    vi.mocked(obtenerEmpleado).mockResolvedValue({ id: 42, ...emp } as never);
  });

  it("14-15) application/pdf, attachment con nombre sanitizado, private no-store; portada + todo; originales intactos", async () => {
    const original = await pdfDe(2);
    escribir("empresas/1/documentos/a.pdf", original);
    escribir("empresas/1/documentos/b.jpg", JPG);
    escribir("empresas/1/documentos/c.png", pngDe(8, 8));
    vi.mocked(listarDocumentos).mockResolvedValue([
      fila(3, "Otro", "empresas/1/documentos/c.png", "2026-01-03"),
      fila(1, "DPI", "empresas/1/documentos/a.pdf", "2026-01-01"),
      fila(2, "Licencia", "empresas/1/documentos/b.jpg", "2026-01-02"),
    ]);
    const res = await GET(new Request("http://x"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Expediente-265899771220-Abel-Natanael-Ambrocio-Lopez.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const out = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(await paginasDe(out)).toBe(1 + 1 + 2 + 1 + 1); // portada + índice + PDF(2) + JPG + PNG
    expect(readFileSync(join(raiz, "empresas/1/documentos/a.pdf")).equals(Buffer.from(original))).toBe(true);
  });
  it("foto de portada: el documento tipo Foto se usa en la portada y no se repite en el cuerpo", async () => {
    escribir("empresas/1/documentos/foto.png", pngDe(30, 40));
    escribir("empresas/1/documentos/d.pdf", await pdfDe(1));
    vi.mocked(listarDocumentos).mockResolvedValue([fila(1, "Foto", "empresas/1/documentos/foto.png"), fila(2, "DPI", "empresas/1/documentos/d.pdf")]);
    const res = await GET(new Request("http://x"), ctx());
    expect(await paginasDe(new Uint8Array(await res.arrayBuffer()))).toBe(2); // portada + DPI (sin índice: 1 documento)
  });
  it("18) sin N+1: una sola consulta de documentos por expediente", async () => {
    escribir("empresas/1/documentos/x.pdf", await pdfDe(1));
    vi.mocked(listarDocumentos).mockResolvedValue(Array.from({ length: 5 }, (_, i) => fila(i + 1, "Otro", "empresas/1/documentos/x.pdf")));
    await GET(new Request("http://x"), ctx());
    expect(listarDocumentos).toHaveBeenCalledTimes(1);
    expect(listarDocumentos).toHaveBeenCalledWith(1, 42);
    expect(obtenerEmpleado).toHaveBeenCalledTimes(1);
    expect(obtenerEmpleado).toHaveBeenCalledWith(1, 42);
  });
  it("9) archivo faltante en disco: sigue con 200 y página informativa", async () => {
    vi.mocked(listarDocumentos).mockResolvedValue([fila(1, "DPI", "empresas/1/documentos/no-existe.pdf")]);
    const res = await GET(new Request("http://x"), ctx());
    expect(res.status).toBe(200);
    expect(await paginasDe(new Uint8Array(await res.arrayBuffer()))).toBe(2);
  });
  it("19-20) path traversal / ruta de otra empresa persistida: no se lee nada fuera de uploads/empresas/<empresa>; el endpoint no acepta rutas", async () => {
    escribir("empresas/2/documentos/otra.pdf", await pdfDe(3));
    escribir("secreto.pdf", await pdfDe(5));
    const malas = ["../secreto.pdf", "empresas/1/../../secreto.pdf", "empresas/2/documentos/otra.pdf", "/etc/passwd", "C:\\Windows\\win.ini"];
    vi.mocked(listarDocumentos).mockResolvedValue(malas.map((r, i) => fila(i + 1, "Otro", r)));
    const res = await GET(new Request("http://x/?ruta=../secreto.pdf&docId=1"), ctx());
    expect(res.status).toBe(200);
    // portada + índice + 5 páginas informativas: ningún contenido ajeno entró
    expect(await paginasDe(new Uint8Array(await res.arrayBuffer()))).toBe(1 + 1 + 5);
    const src = readFileSync("src/app/api/empresas/[slug]/empleados/[id]/expediente-pdf/route.ts", "utf8");
    expect(src).not.toMatch(/searchParams|formData|req\.json|new URL\(/);
    expect(src).toContain("async function GET(_req: Request");
  });
  it("0 documentos: 200 con solo portada", async () => {
    vi.mocked(listarDocumentos).mockResolvedValue([]);
    const res = await GET(new Request("http://x"), ctx());
    expect(res.status).toBe(200);
    expect(await paginasDe(new Uint8Array(await res.arrayBuffer()))).toBe(1);
  });
  it("12) empleado inexistente (o de otra empresa: obtenerEmpleado filtra por empresa) → 404 sin listar documentos", async () => {
    vi.mocked(obtenerEmpleado).mockResolvedValue(null);
    const res = await GET(new Request("http://x"), ctx());
    expect(res.status).toBe(404);
    expect(obtenerEmpleado).toHaveBeenCalledWith(1, 42);
    expect(listarDocumentos).not.toHaveBeenCalled();
  });
  it("11) tenant: la empresa sale de la sesión del servidor, nunca del cliente", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ session: { username: "u" }, empresa: { id: 9 } } as never);
    vi.mocked(obtenerEmpleado).mockResolvedValue(null);
    await GET(new Request("http://x"), ctx());
    expect(obtenerEmpleado).toHaveBeenCalledWith(9, 42);
  });
  it("13) sin permiso / sin tenant: se bloquea antes de tocar BD", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) } as never);
    const res = await GET(new Request("http://x"), ctx());
    expect(res.status).toBe(403);
    expect(requireTenantRrhh).toHaveBeenCalledWith("sitsa", "empleados", "ver");
    expect(obtenerEmpleado).not.toHaveBeenCalled();
    expect(listarDocumentos).not.toHaveBeenCalled();
  });
  it("id inválido → 400", async () => {
    expect((await GET(new Request("http://x"), ctx("abc"))).status).toBe(400);
  });
  it("error inesperado → 500 con mensaje amigable, sin stack ni rutas", async () => {
    vi.mocked(listarDocumentos).mockRejectedValue(new Error("ECONNREFUSED /var/secret/path"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET(new Request("http://x"), ctx());
    expect(res.status).toBe(500);
    const cuerpo = await res.text();
    expect(cuerpo).not.toContain("ECONNREFUSED");
    expect(cuerpo).not.toContain("/var/");
  });
});

describe("22) UI y exportaciones existentes", () => {
  const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  it("el modal del expediente tiene el botón, se deshabilita y muestra 'Generando…'", () => {
    const m = leer("src/components/rrhh/documentos-modal.tsx");
    expect(m).toContain("Descargar expediente completo");
    expect(m).toContain('{generando ? "Generando…" : "Descargar expediente completo"}');
    expect(m).toContain("disabled={generando}");
    expect(m).toContain("/expediente-pdf");
    expect(m).toContain("Subir archivo");
    expect(m).toContain("eliminar(");
  });
  it("el generador nuevo no toca los PDF/Excel existentes", () => {
    for (const p of ["src/lib/rrhh/empleados-export.ts", "src/app/api/empresas/[slug]/empleados/export/route.ts"]) {
      expect(leer(p)).not.toContain("expediente-pdf");
    }
  });
});
