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

function truncar(s: string, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** Anchos relativos según encabezado / contenido (suma ≈ 1). */
function anchosColumnas(
  headers: string[],
  rows: string[][],
  pageWidth: number,
): number[] {
  const n = headers.length;
  if (!n) return [];
  const weights = headers.map((h, i) => {
    let w = Math.max(3, String(h).length);
    for (const r of rows.slice(0, 80)) {
      w = Math.max(w, Math.min(28, String(r[i] ?? "").length));
    }
    // Placa / códigos cortos; descripción más ancha
    const hl = String(h).toLowerCase();
    if (hl.includes("descrip")) w = Math.max(w, 16);
    if (hl.includes("placa")) w = Math.max(w, 10);
    if (hl === "km" || hl.includes("taller") || hl === "rin") {
      w = Math.min(w, 8);
    }
    return w;
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const minW = n > 10 ? 28 : 36;
  let widths = weights.map((w) => Math.max(minW, (w / sum) * pageWidth));
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > pageWidth) {
    widths = widths.map((w) => (w / total) * pageWidth);
  } else if (total < pageWidth) {
    const extra = (pageWidth - total) / n;
    widths = widths.map((w) => w + extra);
  }
  return widths;
}

export async function tablaAPdf(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  /** Forzar orientación; por defecto landscape si hay muchas columnas. */
  layout?: "portrait" | "landscape" | "auto";
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cols = opts.headers.length;
    const layout =
      opts.layout === "portrait" || opts.layout === "landscape"
        ? opts.layout
        : cols > 6
          ? "landscape"
          : "portrait";

    const doc = new PDFDocument({
      margin: layout === "landscape" ? 28 : 36,
      size: "LETTER",
      layout,
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
    const pageBottom = doc.page.height - marginB;

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(opts.title, {
      width: pageWidth,
    });
    if (opts.subtitle) {
      doc
        .moveDown(0.25)
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#475569")
        .text(opts.subtitle, { width: pageWidth });
    }
    doc.moveDown(0.45);

    const widths = anchosColumnas(opts.headers, opts.rows, pageWidth);
    const fontSize = cols > 12 ? 6.5 : cols > 8 ? 7 : 8;
    const padX = 3;
    const padY = 3;
    const maxChars = widths.map((w) =>
      Math.max(4, Math.floor((w - padX * 2) / (fontSize * 0.48))),
    );

    const cellLines = (text: string, col: number): string[] => {
      const raw = truncar(String(text ?? ""), maxChars[col] * 2);
      // Una sola línea corta para tablas densas; evita solapes
      return [truncar(raw, maxChars[col])];
    };

    const rowHeight = (cells: string[]): number => {
      let lines = 1;
      cells.forEach((c, i) => {
        lines = Math.max(lines, cellLines(c, i).length);
      });
      return Math.max(14, lines * (fontSize + 2) + padY * 2);
    };

    const drawHeader = (y: number): number => {
      const h = rowHeight(opts.headers);
      doc.save();
      doc.rect(marginL, y, pageWidth, h).fill("#1e3a5f");
      doc.restore();

      let x = marginL;
      opts.headers.forEach((hCell, i) => {
        const lines = cellLines(hCell, i);
        doc
          .font("Helvetica-Bold")
          .fontSize(fontSize)
          .fillColor("#ffffff");
        lines.forEach((line, li) => {
          doc.text(line, x + padX, y + padY + li * (fontSize + 2), {
            width: widths[i] - padX * 2,
            lineBreak: false,
            ellipsis: true,
          });
        });
        x += widths[i];
      });

      doc
        .strokeColor("#0f172a")
        .lineWidth(0.4)
        .rect(marginL, y, pageWidth, h)
        .stroke();
      return y + h;
    };

    const drawDataRow = (cells: string[], y: number, zebra: boolean): number => {
      const h = rowHeight(cells);
      if (zebra) {
        doc.save();
        doc.rect(marginL, y, pageWidth, h).fill("#f1f5f9");
        doc.restore();
      }

      let x = marginL;
      cells.forEach((cell, i) => {
        const lines = cellLines(cell, i);
        doc
          .font("Helvetica")
          .fontSize(fontSize)
          .fillColor("#0f172a");
        lines.forEach((line, li) => {
          doc.text(line, x + padX, y + padY + li * (fontSize + 2), {
            width: widths[i] - padX * 2,
            lineBreak: false,
            ellipsis: true,
          });
        });
        // Separador vertical sutil
        doc
          .strokeColor("#cbd5e1")
          .lineWidth(0.3)
          .moveTo(x + widths[i], y)
          .lineTo(x + widths[i], y + h)
          .stroke();
        x += widths[i];
      });

      doc
        .strokeColor("#94a3b8")
        .lineWidth(0.35)
        .rect(marginL, y, pageWidth, h)
        .stroke();
      return y + h;
    };

    let y = doc.y;
    y = drawHeader(y);

    opts.rows.forEach((row, idx) => {
      const cells = opts.headers.map((_, i) => String(row[i] ?? ""));
      const h = rowHeight(cells);
      if (y + h > pageBottom) {
        doc.addPage({
          size: "LETTER",
          layout,
          margins: {
            top: marginT,
            bottom: marginB,
            left: marginL,
            right: marginR,
          },
        });
        y = marginT;
        y = drawHeader(y);
      }
      y = drawDataRow(cells, y, idx % 2 === 1);
    });

    // Pie con número de página
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#64748b")
        .text(
          `Página ${i + 1} de ${range.count} · ${opts.rows.length} registro(s)`,
          marginL,
          doc.page.height - marginB + 8,
          { width: pageWidth, align: "center", lineBreak: false },
        );
    }

    doc.end();
  });
}
