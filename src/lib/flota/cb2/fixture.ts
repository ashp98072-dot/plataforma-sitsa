import ExcelJS from "exceljs";
export async function libro(values: unknown[][] = [], edit?: (w: ExcelJS.Workbook) => void) {
    const w = new ExcelJS.Workbook(), s = w.addWorksheet("DEMO");
    s.addRow(["FECHA", "VALE", "PLACAS", "GALONES", "PRECIO", "MONTO", "SERIE", "FACTURA", "PILOTO", "PRODUCTO", "KM"]);
    for (const v of values)
        s.addRow(v);
    edit?.(w);
    return Buffer.from(await w.xlsx.writeBuffer());
}
export const row = (vale = "0001", more: unknown[] = []) => [new Date("2026-10-01T00:00:00Z"), vale, "C-001ABC", 10, 20, 200, "", "", "DEMO", "DIESEL", null, ...more];
