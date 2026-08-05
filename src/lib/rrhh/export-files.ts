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
  ws.columns = opts.headers.map(() => ({ width: 16 }));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function tablaAPdf(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 36,
      size: "LETTER",
      layout: opts.headers.length > 6 ? "landscape" : "portrait",
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).text(opts.title);
    if (opts.subtitle) {
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor("#444").text(opts.subtitle);
    }
    doc.moveDown(0.6).fillColor("#000");

    const pageWidth =
      (doc.page.width as number) -
      doc.page.margins.left -
      doc.page.margins.right;
    const colW = Math.max(40, pageWidth / Math.max(opts.headers.length, 1));
    let y = doc.y;

    const drawRow = (cells: string[], bold = false) => {
      if (y > doc.page.height - 50) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7);
      cells.forEach((cell, i) => {
        doc.text(String(cell ?? ""), doc.page.margins.left + i * colW, y, {
          width: colW - 4,
          ellipsis: true,
        });
      });
      y += 11;
    };

    drawRow(opts.headers, true);
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.margins.left + pageWidth, y)
      .stroke();
    y += 4;
    for (const row of opts.rows) drawRow(row);
    doc.end();
  });
}
