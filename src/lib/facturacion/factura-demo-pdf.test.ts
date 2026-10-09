import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/facturacion/facturas", () => ({ obtenerFactura: vi.fn() }));
vi.mock("@/lib/facturacion/repository", () => ({ obtenerPerfilEmpresa: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));

import { existsSync, readFileSync as readFileMock } from "fs";
import { obtenerFactura } from "@/lib/facturacion/facturas";
import { obtenerPerfilEmpresa } from "@/lib/facturacion/repository";
// `fs` está mockeado más arriba (para el logo); las pruebas que leen archivos reales usan el módulo verdadero.
const { readFileSync, mkdirSync, writeFileSync } = await vi.importActual<typeof import("fs")>("fs");
import {
  generarPdfFacturaDemo,
  LEYENDA_NO_FISCAL,
  prepararFacturaDemo,
  renderizarFacturaDemo,
  TEXTO_PENDIENTE_FEL,
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
const paginas = (buf: Buffer): number => (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;

type Detalle = NonNullable<Awaited<ReturnType<typeof obtenerFactura>>>;

const EMISOR: EmisorDemo = { razonSocial: "Empresa Demo, S.A.", nombreComercial: "Demo Logística", nit: "9999999-9", direccion: "Zona 10, Ciudad de Guatemala", logo: null };

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
  } as Detalle;
}

const INCLUIDO = (n: number) => linea(n);
const AGREGADO = (n: number) => linea(n, { precioIncluyeIva: false, base: 100, iva: 12, total: 112 });

beforeEach(() => {
  vi.mocked(obtenerPerfilEmpresa).mockResolvedValue({
    respuestas: { razon_social_factura: "Empresa Demo, S.A.", nit_emisor: "9999999-9", direccion_fiscal: "Zona 10, Ciudad de Guatemala", nombre_comercial: "Demo Logística" },
    completadoPct: 100, actualizadoAt: null, actualizadoPor: null,
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(existsSync).mockReturnValue(false); });

async function renderizar(d: Detalle | null, emisor: EmisorDemo = EMISOR) {
  const m = prepararFacturaDemo(d, emisor, "2026-10-09");
  if (!m.ok) throw new Error(m.error);
  const spy = espiarTexto();
  const buffer = await renderizarFacturaDemo(m.factura);
  return { spy, buffer, factura: m.factura };
}

describe("PDF demo — IVA por línea, exactamente como quedó congelado", () => {
  it("1) factura SOLO con IVA incluido: cada línea con su desglose y totales congelados", async () => {
    const { spy, buffer } = await renderizar(detalle([INCLUIDO(1), INCLUIDO(2)]));
    const t = todo(spy);
    expect(t).toContain("Q89.29");
    expect(t).toContain("Q10.71");
    expect(t).toContain("Subtotal");
    expect(t).toContain("Q178.58");
    expect(t).toContain("Q21.42");
    expect(t).toContain("Q200.00");
    expect(t).toContain("Tratamiento de IVA: IVA incluido en la tarifa");
    expect(t).toContain("IVA incluido"); // por línea (en la descripción)
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("2) factura SOLO con IVA agregado", async () => {
    const { spy } = await renderizar(detalle([AGREGADO(1), AGREGADO(2)]));
    const t = todo(spy);
    expect(t).toContain("Q100.00");
    expect(t).toContain("Q12.00");
    expect(t).toContain("Q112.00");
    expect(t).toContain("Q200.00");
    expect(t).toContain("Q24.00");
    expect(t).toContain("Q224.00");
    expect(t).toContain("Tratamiento de IVA: IVA agregado a la tarifa");
  });

  it("3) factura MIXTA Q100 incluido + Q100 agregado: 89.29+10.71=100.00 y 100.00+12.00=112.00; subtotal 189.29, IVA 22.71, TOTAL 212.00", async () => {
    const { spy, factura } = await renderizar(detalle([INCLUIDO(1), AGREGADO(2)]));
    const t = todo(spy);
    for (const v of ["Q89.29", "Q10.71", "Q100.00", "Q12.00", "Q112.00", "Q189.29", "Q22.71", "Q212.00"]) expect(t, v).toContain(v);
    expect(t).toContain("Tratamiento de IVA: Mixto: varía por viaje");
    expect(t).toContain("Tarifa Q100.00 · IVA incluido");
    expect(t).toContain("Tarifa Q100.00 · IVA agregado");
    // Cada línea conserva SU política: no se recalcula con una global.
    expect(factura.lineas.map((l) => [l.precioIncluyeIva, l.base, l.iva, l.total])).toEqual([[true, 89.29, 10.71, 100], [false, 100, 12, 112]]);
    expect([factura.subtotal, factura.iva, factura.total]).toEqual([189.29, 22.71, 212]);
  });

  it("4) varios viajes: se dibujan TODOS", async () => {
    const lineas = [1, 2, 3, 4, 5].map((n) => (n % 2 ? INCLUIDO(n) : AGREGADO(n)));
    const { spy, factura } = await renderizar(detalle(lineas));
    expect(factura.lineas).toHaveLength(5);
    const t = todo(spy);
    for (let n = 1; n <= 5; n++) expect(t).toContain(`DEMO-${n}`);
  });

  it("muchas líneas pasan a otra página y TODAS las páginas llevan la leyenda NO FISCAL en el pie", async () => {
    const lineas = Array.from({ length: 60 }, (_, i) => linea((i % 9) + 1, { id: i, codigo: `DEMO-${i}` }));
    const { spy, buffer } = await renderizar(detalle(lineas));
    const n = paginas(buffer);
    expect(n).toBeGreaterThan(1);
    const pies = textos(spy).filter((x) => x.startsWith(`${LEYENDA_NO_FISCAL} · Página`));
    expect(pies).toHaveLength(n);
    expect(pies.map((p) => p.match(/Página (\d+) de (\d+)/)?.slice(1).join("/"))).toEqual(Array.from({ length: n }, (_, i) => `${i + 1}/${n}`));
  });
});

describe("PDF demo — snapshots y validaciones", () => {
  it("5) el cliente sale del snapshot (nombre fiscal, NIT, dirección), no de un dato vivo", async () => {
    const { spy } = await renderizar(detalle([INCLUIDO(1)], { cliente: "Razón Social CONGELADA, S.A.", clienteNit: "5555555-5", clienteDireccion: "Dirección CONGELADA" }));
    const t = todo(spy);
    expect(t).toContain("Razón Social CONGELADA, S.A.");
    expect(t).toContain("NIT: 5555555-5");
    expect(t).toContain("Dirección: Dirección CONGELADA");
  });

  it("6) la línea sale de su snapshot (código, fecha, descripción), y «→» se escribe «->» (PDFKit estándar no lo dibuja)", async () => {
    const { spy } = await renderizar(detalle([linea(1, { codigo: "DEMO-X", fechaPlan: "2026-08-27", descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026" })]));
    const t = todo(spy);
    expect(t).toContain("DEMO-X");
    expect(t).toContain("27/08/2026");
    // la celda se parte en renglones: se compara el texto corrido
    expect(t.replace(/\s+/g, " ")).toContain("Servicio de transporte – Guatemala -> Xela – 27/08/2026");
    expect(t).not.toContain("→");
  });

  it("7) subtotal + IVA = total: los totales congelados se VALIDAN contra la suma de las líneas y nunca se recalculan", () => {
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

  it("Anulada → 409; inexistente → 404; sin viajes → 409", () => {
    expect(prepararFacturaDemo(detalle([INCLUIDO(1)], { estadoAdmin: "Anulada" }), EMISOR, "2026-10-09")).toMatchObject({ ok: false, status: 409 });
    expect(prepararFacturaDemo(null, EMISOR, "2026-10-09")).toMatchObject({ ok: false, status: 404 });
    expect(prepararFacturaDemo(detalle([], { subtotal: 0, iva: 0 }), EMISOR, "2026-10-09")).toMatchObject({ ok: false, status: 409 });
  });

  it("Borrador: «BORRADOR #id (sin número)» y la fecha mostrada es la de generación; Emitida: su número y su fecha de emisión", async () => {
    const b = await renderizar(detalle([INCLUIDO(1)]));
    expect(b.factura).toMatchObject({ numero: "BORRADOR #12 (sin número)", estado: "Borrador", fecha: "2026-10-09" });
    expect(textos(b.spy)).toContain("Fecha (borrador):");
    vi.restoreAllMocks();
    const e = await renderizar(detalle([INCLUIDO(1)], { estadoAdmin: "Emitida", numeroFactura: "F-0001", fechaEmision: "2026-08-27" }));
    expect(e.factura).toMatchObject({ numero: "F-0001", estado: "Emitida", fecha: "2026-08-27" });
    const t = todo(e.spy);
    expect(t).toContain("F-0001");
    expect(t).toContain("27/08/2026");
  });

  it("emisor: sin NIT o dirección definidos dice «pendiente de definir» (nunca los inventa); con nombre comercial distinto lo muestra", async () => {
    const sin = await renderizar(detalle([INCLUIDO(1)]), { razonSocial: "Empresa X", nombreComercial: null, nit: null, direccion: null, logo: null });
    const t = todo(sin.spy);
    expect(t).toContain("NIT: pendiente de definir");
    expect(t).toContain("Dirección: pendiente de definir");
    expect(t).not.toContain("Nombre comercial");
    vi.restoreAllMocks();
    const con = await renderizar(detalle([INCLUIDO(1)]));
    expect(todo(con.spy)).toContain("Nombre comercial: Demo Logística");
  });
});

describe("PDF demo — NO FISCAL y sin datos de certificación", () => {
  it("9) lleva la leyenda «DEMO — DOCUMENTO NO FISCAL» y el título «FACTURA DEMO»", async () => {
    const { spy } = await renderizar(detalle([INCLUIDO(1)]));
    const ts = textos(spy);
    expect(ts).toContain(LEYENDA_NO_FISCAL);
    expect(ts).toContain("FACTURA DEMO");
    expect(LEYENDA_NO_FISCAL).toBe("DEMO — DOCUMENTO NO FISCAL");
    expect(todo(spy)).toContain("No tiene validez fiscal");
  });

  it("10) NO contiene ningún dato fiscal simulado: solo el recuadro «PENDIENTE FEL»", async () => {
    for (const d of [detalle([INCLUIDO(1), AGREGADO(2)]), detalle([INCLUIDO(1)], { estadoAdmin: "Emitida", numeroFactura: "F-0001", fechaEmision: "2026-08-27" })]) {
      vi.restoreAllMocks();
      const { spy, buffer } = await renderizar(d);
      const t = todo(spy);
      expect(t).toContain(`Certificación electrónica: ${TEXTO_PENDIENTE_FEL}`);
      const sinPermitido = t.split(TEXTO_PENDIENTE_FEL).join("");
      expect(sinPermitido).not.toMatch(/uuid|infile|\bsat\b|autoriza|\bserie\b|\bxml\b|\bqr\b|certificador|\bdte\b|\bfel\b/i);
      expect(sinPermitido).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      // nada de imágenes embebidas (un QR sería una imagen): el PDF no contiene objetos de imagen
      expect(buffer.toString("latin1")).not.toMatch(/\/Subtype\s*\/Image/);
    }
  });

  it("el código fuente del módulo y de la ruta no importa ni llama a ningún proveedor fiscal, red ni credenciales", () => {
    const raiz = process.cwd();
    const fuentes = [
      "src/lib/facturacion/factura-demo-pdf.ts",
      "src/app/api/empresas/[slug]/facturacion/facturas/[id]/pdf-demo/route.ts",
    ].map((r) => readFileSync(join(raiz, r), "utf8"));
    // (con `fs` mockeado en este archivo, se lee con el real)
    for (const src of fuentes) {
      const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      const imports = [...codigo.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) expect(spec, spec).not.toMatch(/infile|(^|[/_-])fel([/_.-]|$)|certific|(^|[/_-])sat([/_.-]|$)|dte/i);
      expect(codigo).not.toMatch(/https?:\/\/|\bfetch\(|axios|process\.env|XMLHttpRequest|WebSocket/);
      expect(codigo).not.toMatch(/infile|uuid|\bsat\b|\bxml\b|certificador/i);
      // la única mención permitida a «FEL» es el texto reservado
      const sinReservado = codigo.split("PENDIENTE FEL").join("");
      expect(sinReservado).not.toMatch(/\bfel\b/i);
    }
  });
});

describe("generarPdfFacturaDemo — empresa, permisos y aislamiento", () => {
  const empresa7 = { id: 7, nombre: "Empresa 7", logoUrl: null };
  const empresa8 = { id: 8, nombre: "Empresa 8", logoUrl: null };

  it("8) multiempresa: la factura se busca SIEMPRE con la empresa del guard; la de otra empresa es un 404 y no se genera nada", async () => {
    const propia = detalle([INCLUIDO(1)]);
    vi.mocked(obtenerFactura).mockImplementation(async (empresaId: number) => (empresaId === 7 ? propia : null));
    const ok = await generarPdfFacturaDemo(empresa7, 12);
    expect(ok.ok).toBe(true);
    const ajena = await generarPdfFacturaDemo(empresa8, 12);
    expect(ajena).toEqual({ ok: false, status: 404, error: "Factura no encontrada." });
    expect(vi.mocked(obtenerFactura).mock.calls.map((c) => c[0])).toEqual([7, 8]);
    expect(vi.mocked(obtenerPerfilEmpresa).mock.calls.map((c) => c[0])).toEqual([7, 8]); // el emisor también es el de la empresa del guard
  });

  it("devuelve un PDF real con nombre de archivo y usa los datos del emisor del perfil de la empresa", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1), AGREGADO(2)]));
    const spy = espiarTexto();
    const r = await generarPdfFacturaDemo(empresa7, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nombreArchivo).toBe("factura-demo-12.pdf");
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const t = todo(spy);
    expect(t).toContain("Empresa Demo, S.A.");
    expect(t).toContain("NIT: 9999999-9");
  });

  it("sin perfil de Facturación usa el nombre de la empresa como razón social y marca NIT/dirección como pendientes", async () => {
    vi.mocked(obtenerPerfilEmpresa).mockResolvedValue({ respuestas: {}, completadoPct: 0, actualizadoAt: null, actualizadoPor: null } as never);
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)]));
    const spy = espiarTexto();
    await generarPdfFacturaDemo(empresa7, 12);
    const t = todo(spy);
    expect(t).toContain("Empresa 7");
    expect(t).toContain("NIT: pendiente de definir");
  });

  it("logo: se dibuja si existe y se puede leer; si no, el PDF sale igual solo con texto", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)]));
    const sinLogo = await generarPdfFacturaDemo({ ...empresa7, logoUrl: "uploads/no-existe.png" }, 12);
    expect(sinLogo.ok).toBe(true);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileMock).mockReturnValue(Buffer.from("no-es-una-imagen"));
    const logoIlegible = await generarPdfFacturaDemo({ ...empresa7, logoUrl: "uploads/roto.png" }, 12);
    expect(logoIlegible.ok).toBe(true); // imagen inválida: respaldo de texto, sin romper
  });

  it("solo lee: nunca modifica nada (solo se invocan funciones de lectura)", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(detalle([INCLUIDO(1)]));
    await generarPdfFacturaDemo(empresa7, 12);
    expect(vi.mocked(obtenerFactura)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(obtenerPerfilEmpresa)).toHaveBeenCalledTimes(1);
  });
});

/**
 * Genera el PDF de EJEMPLO con datos sintéticos para revisión visual. Solo corre si se define FACT_DEMO_PDF_SALIDA
 * (ruta del archivo). No forma parte de la suite normal.
 */
describe.skipIf(!process.env.FACT_DEMO_PDF_SALIDA)("PDF demo de ejemplo (datos sintéticos)", () => {
  it("escribe el archivo", async () => {
    const logo = readFileSync(join(process.cwd(), "public", "branding", "novalvion-icon.png"));
    const d = detalle(
      [
        linea(1, { fechaPlan: "2026-09-01", codigo: "DEMO-A", descripcion: "Servicio de transporte – Bodega Central Guatemala → Quetzaltenango – 01/09/2026" }),
        linea(2, { fechaPlan: "2026-09-02", codigo: "DEMO-B", precioIncluyeIva: false, base: 100, iva: 12, total: 112, descripcion: "Servicio de transporte – Bodega Central Guatemala → Cobán – 02/09/2026" }),
        linea(3, { fechaPlan: "2026-09-03", codigo: "DEMO-C", montoAsignado: 250, base: 223.21, iva: 26.79, total: 250, descripcion: "Servicio de transporte – Bodega Central Guatemala → Escuintla – 03/09/2026" }),
      ],
      { cliente: "Cliente Demo Uno, S.A.", clienteNit: "1234567-8", clienteDireccion: "Zona 1, Ciudad de Guatemala" },
    );
    const m = prepararFacturaDemo(d, { ...EMISOR, logo }, "2026-10-09");
    if (!m.ok) throw new Error(m.error);
    const buf = await renderizarFacturaDemo(m.factura);
    const salida = String(process.env.FACT_DEMO_PDF_SALIDA);
    mkdirSync(dirname(salida), { recursive: true });
    writeFileSync(salida, buf);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it.skipIf(!process.env.FACT_DEMO_PDF_SALIDA_LARGO)("escribe también una versión LARGA (varias páginas) para revisar los saltos de página", async () => {
    const lineas = Array.from({ length: 34 }, (_, i) => (i % 3 === 1
      ? linea(i % 9 + 1, { id: i, codigo: `DEMO-${100 + i}`, precioIncluyeIva: false, base: 100, iva: 12, total: 112 })
      : linea(i % 9 + 1, { id: i, codigo: `DEMO-${100 + i}` })));
    const m = prepararFacturaDemo(detalle(lineas, { estadoAdmin: "Emitida", numeroFactura: "F-DEV-0001", fechaEmision: "2026-10-09" }), EMISOR, "2026-10-09");
    if (!m.ok) throw new Error(m.error);
    const salida = String(process.env.FACT_DEMO_PDF_SALIDA_LARGO);
    mkdirSync(dirname(salida), { recursive: true });
    writeFileSync(salida, await renderizarFacturaDemo(m.factura));
  });
});
