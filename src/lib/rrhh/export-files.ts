import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export async function tablaAExcel(opts: {
  sheetName: string;
  headers: string[];
  rows: string[][];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName.slice(0, 31) || "Datos");
  ws.addRow(opts.headers);
  ws.getRow(1).font = { bold: true };
  for (const row of opts.rows) ws.addRow(row);
  ws.columns = opts.headers.map((h, i) => {
    let max = String(h).length;
    for (const r of opts.rows) {
      max = Math.max(max, String(r[i] ?? "").length);
    }
    return { width: Math.min(42, Math.max(10, max + 2)) };
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Normaliza fechas/hora para PDF (evita "Wed Aug 05 2026…"). */
export function celdaPdf(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return formatearFechaHora(v);
  }
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return "";
  // ISO / MySQL datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatearFechaHora(d);
    return s.replace("T", " ").slice(0, 16);
  }
  // Date.toString() del motor JS
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/i.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatearFechaHora(d);
  }
  return s;
}

function formatearFechaHora(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  // Si es medianoche exacta y viene de DATE, mostrar solo fecha
  if (hh === "00" && mi === "00" && d.getSeconds() === 0) {
    return `${dd}/${mm}/${yyyy}`;
  }
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function truncar(s: string, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

type PdfDoc = InstanceType<typeof PDFDocument>;

function wrapText(
  doc: PdfDoc,
  text: string,
  width: number,
  fontSize: number,
  bold = false,
): string[] {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
  const words = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  if (!words[0]) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (doc.widthOfString(trial) <= width) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      // palabra más ancha que la celda
      while (doc.widthOfString(cur) > width && cur.length > 1) {
        lines.push(cur.slice(0, -1) + "…");
        cur = "";
        break;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function tablaAPdf(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  layout?: "portrait" | "landscape" | "auto";
  /** Forzar fichas (recomendado en reportes anchos). */
  modo?: "auto" | "tabla" | "fichas";
}): Promise<Buffer> {
  const headers = opts.headers.map((h) => String(h ?? ""));
  const rows = opts.rows.map((r) =>
    headers.map((_, i) => celdaPdf(r[i])),
  );
  const cols = headers.length;
  const modo =
    opts.modo === "tabla" || opts.modo === "fichas"
      ? opts.modo
      : cols > 7
        ? "fichas"
        : "tabla";

  if (modo === "fichas") {
    return pdfFichas({ ...opts, headers, rows });
  }
  return pdfTabla({ ...opts, headers, rows });
}

async function pdfTabla(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  layout?: "portrait" | "landscape" | "auto";
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cols = opts.headers.length;
    const layout =
      opts.layout === "portrait" || opts.layout === "landscape"
        ? opts.layout
        : cols > 5
          ? "landscape"
          : "portrait";

    const doc = new PDFDocument({
      size: "LETTER",
      layout,
      margins: { top: 36, bottom: 40, left: 32, right: 32 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const marginR = doc.page.margins.right;
    const marginT = doc.page.margins.top;
    const marginB = doc.page.margins.bottom;
    const pageWidth = doc.page.width - marginL - marginR;
    const pageBottom = doc.page.height - marginB - 12;

    dibujarTitulo(doc, opts.title, opts.subtitle, pageWidth);

    const fontSize = cols > 8 ? 7.5 : 8.5;
    const padX = 4;
    const padY = 5;
    const lineH = fontSize + 2.5;
    const maxLines = 3;

    const weights = opts.headers.map((h, i) => {
      let w = Math.max(4, h.length);
      for (const r of opts.rows.slice(0, 60)) {
        w = Math.max(w, Math.min(22, String(r[i] ?? "").length));
      }
      const hl = h.toLowerCase();
      if (hl.includes("nombre") || hl.includes("descrip") || hl.includes("obs") || hl.includes("destino")) {
        w += 6;
      }
      if (hl.includes("placa") || hl === "km" || hl.includes("estado")) {
        w = Math.max(w, 7);
      }
      return w;
    });
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    const widths = weights.map((w) => (w / sumW) * pageWidth);

    const linesOf = (text: string, col: number, bold = false) => {
      const lines = wrapText(
        doc,
        text,
        Math.max(12, widths[col] - padX * 2),
        fontSize,
        bold,
      );
      return lines.slice(0, maxLines);
    };

    const heightOf = (cells: string[], bold = false) => {
      let n = 1;
      cells.forEach((c, i) => {
        n = Math.max(n, linesOf(c, i, bold).length);
      });
      return Math.max(18, n * lineH + padY * 2);
    };

    const drawHeader = (y: number) => {
      const h = heightOf(opts.headers, true);
      doc.save();
      doc.rect(marginL, y, pageWidth, h).fill("#1e3a5f");
      doc.restore();
      let x = marginL;
      opts.headers.forEach((cell, i) => {
        const lines = linesOf(cell, i, true);
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(fontSize);
        lines.forEach((line, li) => {
          doc.text(line, x + padX, y + padY + li * lineH, {
            width: widths[i] - padX * 2,
            lineBreak: false,
          });
        });
        x += widths[i];
      });
      doc.strokeColor("#0f172a").lineWidth(0.5).rect(marginL, y, pageWidth, h).stroke();
      return y + h;
    };

    const drawRow = (cells: string[], y: number, zebra: boolean) => {
      const h = heightOf(cells);
      if (zebra) {
        doc.save();
        doc.rect(marginL, y, pageWidth, h).fill("#f1f5f9");
        doc.restore();
      }
      let x = marginL;
      cells.forEach((cell, i) => {
        const lines = linesOf(cell, i);
        doc.fillColor("#0f172a").font("Helvetica").fontSize(fontSize);
        lines.forEach((line, li) => {
          doc.text(line, x + padX, y + padY + li * lineH, {
            width: widths[i] - padX * 2,
            lineBreak: false,
          });
        });
        doc
          .strokeColor("#e2e8f0")
          .lineWidth(0.3)
          .moveTo(x + widths[i], y)
          .lineTo(x + widths[i], y + h)
          .stroke();
        x += widths[i];
      });
      doc.strokeColor("#94a3b8").lineWidth(0.4).rect(marginL, y, pageWidth, h).stroke();
      return y + h;
    };

    let y = doc.y + 4;
    y = drawHeader(y);

    opts.rows.forEach((row, idx) => {
      const cells = opts.headers.map((_, i) => String(row[i] ?? ""));
      const h = heightOf(cells);
      if (y + h > pageBottom) {
        doc.addPage({
          size: "LETTER",
          layout,
          margins: { top: marginT, bottom: marginB, left: marginL, right: marginR },
        });
        y = marginT;
        y = drawHeader(y);
      }
      y = drawRow(cells, y, idx % 2 === 1);
    });

    piePaginas(doc, opts.rows.length, marginL, marginB, pageWidth);
    doc.end();
  });
}

/** Reportes anchos: una ficha por registro (se lee como informe). */
async function pdfFichas(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "portrait",
      margins: { top: 40, bottom: 44, left: 40, right: 40 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const marginR = doc.page.margins.right;
    const marginT = doc.page.margins.top;
    const marginB = doc.page.margins.bottom;
    const pageWidth = doc.page.width - marginL - marginR;
    const pageBottom = doc.page.height - marginB - 10;
    const colGap = 14;
    const colW = (pageWidth - colGap) / 2;

    dibujarTitulo(doc, opts.title, opts.subtitle, pageWidth);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        `${opts.rows.length} registro(s) · formato ficha para lectura clara`,
        { width: pageWidth },
      );
    doc.moveDown(0.5);

    let y = doc.y;

    const medirFicha = (cells: string[]) => {
      let h = 30;
      for (let i = 0; i < opts.headers.length; i += 2) {
        const v1 = truncar(cells[i] ?? "", 140);
        const v2 = truncar(cells[i + 1] ?? "", 140);
        const l1 = wrapText(doc, v1, colW - 8, 9).slice(0, 3).length;
        const l2 =
          i + 1 < opts.headers.length
            ? wrapText(doc, v2, colW - 8, 9).slice(0, 3).length
            : 0;
        h += Math.max(l1, l2) * 11 + 20;
      }
      return h + 8;
    };

    const dibujarFicha = (cells: string[], index: number, y0: number) => {
      const h = medirFicha(cells);
      doc.save();
      doc.roundedRect(marginL, y0, pageWidth, h, 4).fill("#f8fafc");
      doc.restore();
      doc
        .strokeColor("#cbd5e1")
        .lineWidth(0.8)
        .roundedRect(marginL, y0, pageWidth, h, 4)
        .stroke();

      // Cabecera de ficha: primer campo “clave” (placa / código / salida)
      const tituloFicha =
        cells[0] && cells[2]
          ? `${cells[2] || cells[0]} · #${index + 1}`
          : `Registro ${index + 1}`;
      // Preferir placa si existe en headers
      const idxPlaca = opts.headers.findIndex((h) =>
        h.toLowerCase().includes("placa"),
      );
      const idxPiloto = opts.headers.findIndex((h) =>
        h.toLowerCase().includes("piloto"),
      );
      const head =
        idxPlaca >= 0
          ? `${cells[idxPlaca]}${
              idxPiloto >= 0 && cells[idxPiloto] ? ` · ${cells[idxPiloto]}` : ""
            }`
          : tituloFicha;

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#0f172a")
        .text(truncar(head, 70), marginL + 10, y0 + 8, {
          width: pageWidth - 20,
          lineBreak: false,
        });

      let yy = y0 + 26;
      for (let i = 0; i < opts.headers.length; i += 2) {
        const drawField = (col: number, x: number, width: number) => {
          if (col >= opts.headers.length) return 0;
          const label = opts.headers[col];
          const val = cells[col] || "—";
          doc
            .font("Helvetica-Bold")
            .fontSize(7.5)
            .fillColor("#64748b")
            .text(label.toUpperCase(), x, yy, {
              width,
              lineBreak: false,
            });
          const lines = wrapText(doc, truncar(val, 140), width, 9);
          doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
          lines.slice(0, 3).forEach((line, li) => {
            doc.text(line, x, yy + 11 + li * 11, {
              width,
              lineBreak: false,
            });
          });
          return Math.min(3, lines.length) * 11 + 18;
        };
        const h1 = drawField(i, marginL + 10, colW - 8);
        const h2 = drawField(i + 1, marginL + 10 + colW + colGap, colW - 8);
        yy += Math.max(h1, h2);
      }
      return y0 + h + 10;
    };

    opts.rows.forEach((row, idx) => {
      const cells = opts.headers.map((_, i) => String(row[i] ?? ""));
      const h = medirFicha(cells);
      if (y + h > pageBottom) {
        doc.addPage({
          size: "LETTER",
          layout: "portrait",
          margins: {
            top: marginT,
            bottom: marginB,
            left: marginL,
            right: marginR,
          },
        });
        y = marginT;
      }
      y = dibujarFicha(cells, idx, y);
    });

    if (!opts.rows.length) {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#64748b")
        .text("Sin registros para este reporte.", marginL, y);
    }

    piePaginas(doc, opts.rows.length, marginL, marginB, pageWidth);
    doc.end();
  });
}

function dibujarTitulo(
  doc: PdfDoc,
  title: string,
  subtitle: string | undefined,
  pageWidth: number,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#0f172a")
    .text(title, { width: pageWidth });
  if (subtitle) {
    doc
      .moveDown(0.2)
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#475569")
      .text(subtitle, { width: pageWidth });
  }
  doc.moveDown(0.35);
}

function piePaginas(
  doc: PdfDoc,
  total: number,
  marginL: number,
  marginB: number,
  pageWidth: number,
) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#64748b")
      .text(
        `Página ${i + 1} de ${range.count} · ${total} registro(s) · SITSA`,
        marginL,
        doc.page.height - marginB + 10,
        { width: pageWidth, align: "center", lineBreak: false },
      );
  }
}
