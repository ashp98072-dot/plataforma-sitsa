import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { dibujarTablaEnDoc, tablaAPdf, wrapText } from "@/lib/rrhh/export-files";
import { ANCHO_UTIL_PDF, anchosPdfProgramacion, configuracionPdfProgramacion } from "./programacion-pdf-anchos";

/**
 * PROGRAMACION-PDF-ANCHOS-1 — el ancho del PDF de Programación se reparte
 * como CONJUNTO. Todas las comprobaciones usan las métricas REALES de
 * PDFKit (Helvetica 7.5, el tamaño que usa el motor con >8 columnas), no
 * estimaciones por número de caracteres.
 */
const CON_CODIGO = ["Mes", "Día", "Placa", "TC", "Piloto", "Auxiliar 1", "Auxiliar 2", "Código", "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga"];
const SIN_CODIGO = CON_CODIGO.filter((h) => h !== "Código");
const FONT = 7.5;
const PAD = 8; // padX 4 a cada lado, igual que dibujarTablaEnDoc

function nuevoDoc() {
  return new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 36, bottom: 40, left: 32, right: 32 }, bufferPages: true });
}
const ancho = (headers: string[], h: string) => anchosPdfProgramacion(headers)[h];
const anchoTexto = (headers: string[], h: string) => ancho(headers, h) - PAD;
const medir = (doc: InstanceType<typeof PDFDocument>, t: string, bold = false) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(FONT).widthOfString(t);

describe("configuración de anchos — el conjunto suma el ancho útil de la página", () => {
  it.each([["con Código", CON_CODIGO], ["sin Código", SIN_CODIGO]])("%s: los pesos suman exactamente el ancho útil (%s pt) — el peso ES el ancho real", (_n, headers) => {
    const total = Object.values(anchosPdfProgramacion(headers)).reduce((a, b) => a + b, 0);
    expect(total).toBe(ANCHO_UTIL_PDF);
    const doc = nuevoDoc();
    expect(doc.page.width - doc.page.margins.left - doc.page.margins.right).toBe(ANCHO_UTIL_PDF);
  });

  it("todas las columnas del reporte tienen ancho definido (ninguna queda al cálculo automático)", () => {
    for (const headers of [CON_CODIGO, SIN_CODIGO]) {
      const cfg = configuracionPdfProgramacion(headers);
      expect(Object.keys(cfg.weight)).toHaveLength(headers.length);
    }
  });

  it("solo las 5 compactas van en una sola línea; Cliente, Piloto, Auxiliares, Código y Lugares NUNCA (hacen wrap)", () => {
    const cfg = configuracionPdfProgramacion(CON_CODIGO);
    expect(cfg.preserveSingleLine.map((i) => CON_CODIGO[i])).toEqual(["Mes", "Día", "Placa", "TC", "Hora"]);
    for (const h of ["Cliente", "Piloto", "Auxiliar 1", "Auxiliar 2", "Código", "Lugar de Carga", "Lugar de Descarga"]) {
      expect(cfg.preserveSingleLine).not.toContain(CON_CODIGO.indexOf(h));
    }
  });

  it("tope de líneas: Cliente/Código 2; Piloto/Auxiliares/Lugares 3 (los anchos apuntan a 2 para nombres típicos; 3 evita '…' en nombres reales largos)", () => {
    const cfg = configuracionPdfProgramacion(CON_CODIGO);
    const tope = (h: string) => cfg.maxLinesPorColumna[CON_CODIGO.indexOf(h)];
    expect(["Cliente", "Código"].map(tope)).toEqual([2, 2]);
    expect(["Piloto", "Auxiliar 1", "Auxiliar 2", "Lugar de Carga", "Lugar de Descarga"].map(tope)).toEqual([3, 3, 3, 3, 3]);
  });

  it("los índices se calculan por nombre: con Código oculto todo se corre y sigue apuntando a la columna correcta", () => {
    const cfg = configuracionPdfProgramacion(SIN_CODIGO);
    expect(cfg.weight[SIN_CODIGO.indexOf("Hora")]).toBe(46);
    expect(cfg.weight[SIN_CODIGO.indexOf("Cliente")]).toBe(78);
  });

  it("las columnas compactas conservan el MISMO ancho con o sin Código (el Código se lo quita a las de texto, nunca a Mes/Día/Placa/TC/Hora)", () => {
    for (const h of ["Mes", "Día", "Placa", "TC", "Hora"]) {
      expect(ancho(CON_CODIGO, h)).toBe(ancho(SIN_CODIGO, h));
    }
  });
});

describe("columnas compactas: siempre completas, con las métricas reales de PDFKit", () => {
  const doc = nuevoDoc();
  const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const DIAS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

  it.each([["con Código", CON_CODIGO], ["sin Código", SIN_CODIGO]])("Mes: los 12 meses caben completos (%s)", (_n, headers) => {
    for (const m of MESES) expect(medir(doc, m)).toBeLessThanOrEqual(anchoTexto(headers, "Mes"));
    expect(medir(doc, "Mes", true)).toBeLessThanOrEqual(anchoTexto(headers, "Mes"));
  });

  it("Día: 01..31 caben con sus 2 dígitos, y su encabezado también", () => {
    for (const d of DIAS) expect(medir(doc, d)).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, "Día"));
    expect(medir(doc, "Día", true)).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, "Día"));
  });

  it("Placa: C-801BXY, C-584BSQ, C-147CCD y placas de 6-8 caracteres caben completas", () => {
    for (const p of ["C-801BXY", "C-584BSQ", "C-147CCD", "776BYV", "C-382BYX"]) {
      expect(medir(doc, p)).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, "Placa"));
    }
  });

  it("TC: TC-045 y TC-118 (interno) y TC-778 (externo) caben completos", () => {
    for (const t of ["TC-045", "TC-118", "TC-778"]) expect(medir(doc, t)).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, "TC"));
  });

  it("Hora: 03:00 AM, 04:00 PM, 11:30 AM y el peor caso 12:59 PM caben completas", () => {
    for (const h of ["03:00 AM", "04:00 PM", "11:30 AM", "12:59 PM", "12:00 AM"]) {
      expect(medir(doc, h)).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, "Hora"));
    }
  });

  it("los encabezados de las compactas también caben (el encabezado no se parte)", () => {
    for (const h of ["Placa", "TC", "Hora"]) expect(medir(doc, h, true)).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, h));
  });
});

describe("columnas de texto: wrap controlado, sin '…' cuando cabe", () => {
  const doc = nuevoDoc();
  const lineas = (headers: string[], h: string, texto: string) => wrapText(doc, texto, anchoTexto(headers, h), FONT);

  it.each([["con Código", CON_CODIGO], ["sin Código", SIN_CODIGO]])("Cliente: SAUZALITO se ve COMPLETO en una línea (%s) — ya no 'SAUZALIT…'", (_n, headers) => {
    expect(lineas(headers, "Cliente", "SAUZALITO")).toEqual(["SAUZALITO"]);
    expect(lineas(headers, "Cliente", "Distelsa")).toEqual(["Distelsa"]);
    expect(lineas(headers, "Cliente", "Pricesmart")).toEqual(["Pricesmart"]);
  });

  it("Cliente largo: hace wrap a 2 líneas, sin '…'", () => {
    const l = lineas(CON_CODIGO, "Cliente", "ALIMENTOS MARRAVILLA");
    expect(l).toEqual(["ALIMENTOS", "MARRAVILLA"]);
    expect(l.join("")).not.toContain("…");
  });

  it.each([["con Código", CON_CODIGO], ["sin Código", SIN_CODIGO]])("Piloto largo 'Anthony Brian García-Aguirre Ávila' cabe en 2 líneas, sin '…' (%s)", (_n, headers) => {
    const l = lineas(headers, "Piloto", "Anthony Brian García-Aguirre Ávila");
    expect(l.length).toBeLessThanOrEqual(2);
    expect(l.join(" ")).toBe("Anthony Brian García-Aguirre Ávila");
  });

  it("Auxiliares: un nombre típico largo cabe en 2 líneas; uno de 6 palabras usa 3 — ambos completos, sin '…'", () => {
    const tipico = lineas(CON_CODIGO, "Auxiliar 1", "Jonathan Guillermo Alexander Pineda");
    expect(tipico).toHaveLength(2);
    expect(tipico.join(" ")).toBe("Jonathan Guillermo Alexander Pineda");
    const largo = lineas(CON_CODIGO, "Auxiliar 1", "Bayron Eduardo Constanza de la Cruz");
    expect(largo.length).toBeLessThanOrEqual(3);
    expect(largo.join(" ")).toBe("Bayron Eduardo Constanza de la Cruz");
  });

  it.each([["con Código", CON_CODIGO], ["sin Código", SIN_CODIGO]])("Lugares: 'AGENCIA CHIMALTENANGO' y 'RUTEOS CLIENTES VARIOS' hacen wrap (máx. 3 líneas) sin '…' (%s)", (_n, headers) => {
    for (const h of ["Lugar de Carga", "Lugar de Descarga"]) {
      for (const t of ["AGENCIA CHIMALTENANGO", "RUTEOS CLIENTES VARIOS", "MAZATENANGO Y RETALHULEU", "PRICE SMART, MIRAFLORES"]) {
        const l = lineas(headers, h, t);
        expect(l.length).toBeLessThanOrEqual(3);
        expect(l.join(" ")).toBe(t);
      }
    }
  });
});

/** Dibuja con el motor REAL y devuelve lo que se pintó (doc.text) + la altura ocupada. */
function dibujar(headers: string[], rows: string[][]) {
  const doc = nuevoDoc();
  const pintado: string[] = [];
  const original = doc.text.bind(doc);
  vi.spyOn(doc, "text").mockImplementation(((t: string, ...a: unknown[]) => { pintado.push(String(t)); return (original as (...x: unknown[]) => unknown)(t, ...a); }) as never);
  doc.y = 36;
  const y0 = doc.y;
  dibujarTablaEnDoc(doc, { headers, rows, ...configuracionPdfProgramacion(headers), maxLines: 3 });
  return { doc, pintado, alto: doc.y - y0, paginas: doc.bufferedPageRange().count };
}
const fila = (over: Partial<Record<string, string>> = {}, headers = CON_CODIGO) => {
  const base: Record<string, string> = {
    Mes: "SEP", "Día": "23", Placa: "C-801BXY", TC: "TC-045", Piloto: "Juan Pérez", "Auxiliar 1": "", "Auxiliar 2": "", "Código": "",
    Cliente: "SAUZALITO", "Lugar de Carga": "AGENCIA", Hora: "03:00 AM", "Lugar de Descarga": "CLIENTES", ...over,
  };
  return headers.map((h) => base[h]);
};

describe("motor de tabla real: lo que se pinta", () => {
  it("el caso del ticket se pinta COMPLETO: SEP, 23, C-801BXY, TC-045, SAUZALITO, 03:00 AM, piloto en 2 líneas, lugares — ningún '…' en los datos", () => {
    const rows = [fila({ Piloto: "Anthony Brian García-Aguirre Ávila", "Lugar de Carga": "AGENCIA CHIMALTENANGO", "Lugar de Descarga": "RUTEOS CLIENTES VARIOS" })];
    const { pintado } = dibujar(CON_CODIGO, rows);
    for (const esperado of ["SEP", "23", "C-801BXY", "TC-045", "SAUZALITO", "03:00 AM"]) expect(pintado).toContain(esperado);
    expect(pintado).toContain("Anthony Brian");
    expect(pintado).toContain("García-Aguirre Ávila");
    expect(pintado.filter((t) => t.includes("…"))).toEqual([]);
  });

  it("sin Código, mismo resultado", () => {
    const { pintado } = dibujar(SIN_CODIGO, [fila({}, SIN_CODIGO)]);
    for (const esperado of ["SEP", "23", "C-801BXY", "TC-045", "SAUZALITO", "03:00 AM"]) expect(pintado).toContain(esperado);
    expect(pintado.filter((t) => t.includes("…"))).toEqual([]);
  });

  it("TC vacío deja la celda vacía y NO le quita ancho a Mes/Día/Cliente (mismos anchos que con TC)", () => {
    const { pintado } = dibujar(CON_CODIGO, [fila({ TC: "" })]);
    expect(pintado).toContain("SEP");
    expect(pintado).toContain("SAUZALITO");
    expect(pintado.filter((t) => t.includes("…"))).toEqual([]);
  });

  it("Propio y Tercerizado se pintan igual: TC externo y placa externa bajo las mismas columnas, marca (Tercerizado) en Piloto con wrap", () => {
    const { pintado } = dibujar(CON_CODIGO, [
      fila({ Placa: "C-123ABC", TC: "TC-045", Piloto: "Juan Pérez" }),
      fila({ Placa: "EXT-999", TC: "TC-778", Piloto: "Juan Externo (Tercerizado)" }),
    ]);
    for (const esperado of ["C-123ABC", "TC-045", "EXT-999", "TC-778", "Juan Externo", "(Tercerizado)"]) expect(pintado).toContain(esperado);
    expect(pintado.filter((t) => t.includes("…"))).toEqual([]);
  });

  it("la fila CRECE cuando Cliente/Piloto/Lugares ocupan 2-3 líneas (más alta que una fila de 1 línea), sin superponer", () => {
    const una = dibujar(CON_CODIGO, [fila()]).alto;
    const dos = dibujar(CON_CODIGO, [fila({ Cliente: "ALIMENTOS MARRAVILLA", Piloto: "Anthony Brian García-Aguirre Ávila" })]).alto;
    const tres = dibujar(CON_CODIGO, [fila({ "Lugar de Carga": "PRICE SMART MIRAFLORES ZONA DIECISIETE CIUDAD" })]).alto;
    expect(dos).toBeGreaterThan(una);
    expect(tres).toBeGreaterThan(dos);
  });

  it("varias filas largas => MÁS páginas en vez de cortar información (PDF multipágina)", () => {
    const filas = Array.from({ length: 60 }, (_, i) => fila({ "Día": String((i % 28) + 1).padStart(2, "0"), Cliente: "ALIMENTOS MARRAVILLA", Piloto: "Anthony Brian García-Aguirre Ávila" }));
    const { paginas, pintado } = dibujar(CON_CODIGO, filas);
    expect(paginas).toBeGreaterThan(1);
    // El encabezado se repite en cada página y ningún dato compacto se recorta.
    expect(pintado.filter((t) => t === "SEP")).toHaveLength(60);
    expect(pintado.filter((t) => t === "TC-045")).toHaveLength(60);
    expect(pintado.filter((t) => t.includes("…"))).toEqual([]);
  });

  it("último recurso: un nombre demasiado largo para su tope de líneas termina en '…' (nunca se descarta texto en silencio) y solo en columnas de texto", () => {
    const largo = "Anthony Brian García-Aguirre Ávila de la Torre y Montenegro Quiñónez Hernández López Castillo Morales";
    const { pintado, doc } = dibujar(CON_CODIGO, [fila({ Piloto: largo })]);
    const cortados = pintado.filter((t) => t.includes("…"));
    expect(cortados).toHaveLength(1);
    expect(cortados[0].endsWith("…")).toBe(true);
    expect(medir(doc, cortados[0])).toBeLessThanOrEqual(anchoTexto(CON_CODIGO, "Piloto"));
    expect(pintado).toContain("SEP");
    expect(pintado).toContain("SAUZALITO");
  });
});

describe("tablaAPdf real (PDF completo) con la configuración del reporte", () => {
  it("genera un PDF válido de una página para el caso del ticket y de varias para muchas filas, sin exceder el motor", async () => {
    const cfg = configuracionPdfProgramacion(CON_CODIGO);
    const una = await tablaAPdf({ title: "PROGRAMACIÓN", headers: CON_CODIGO, rows: [fila()], layout: "landscape", modo: "tabla", ...cfg });
    expect(una.subarray(0, 4).toString()).toBe("%PDF");
    const paginas = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(paginas(una)).toBe(1);
    const muchas = await tablaAPdf({ title: "PROGRAMACIÓN", headers: CON_CODIGO, rows: Array.from({ length: 80 }, () => fila({ Cliente: "ALIMENTOS MARRAVILLA" })), layout: "landscape", modo: "tabla", ...cfg });
    expect(paginas(muchas)).toBeGreaterThan(1);
  });
});

describe("regresión del motor compartido", () => {
  it("sin maxLinesPorColumna el comportamiento es el de siempre (corta a maxLines sin marcar), para el resto de reportes", () => {
    const doc = nuevoDoc();
    const pintado: string[] = [];
    const original = doc.text.bind(doc);
    vi.spyOn(doc, "text").mockImplementation(((t: string, ...a: unknown[]) => { pintado.push(String(t)); return (original as (...x: unknown[]) => unknown)(t, ...a); }) as never);
    doc.y = 36;
    dibujarTablaEnDoc(doc, { headers: ["A"], rows: [["uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte veintiuno veintidos veintitres"]], maxLines: 2 });
    expect(pintado.filter((t) => t.includes("…"))).toEqual([]);
  });
});
