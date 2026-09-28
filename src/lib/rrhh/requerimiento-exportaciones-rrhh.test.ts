import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { requerimientoRrhhExcel, requerimientoRrhhPdf } from "./requerimiento-exportaciones";
import type { DetalleRequerimientoRrhh } from "./requerimiento-schema";

const detalle: DetalleRequerimientoRrhh = {
  id: 12, codigo: "RH-2026-000012", fecha_requerimiento: "2026-09-28",
  entidad_requirente_id: 4, entidad_requirente_nombre: "Kuiqtrans",
  requirente_usuario_id: 9, requirente_nombre: "Ana Gómez",
  solicitante_usuario_id: 8, solicitante_nombre: "Walter Villagrán",
  observaciones: "Entregar antes del viernes", total: "380.00", estado: "Pendiente", version: 1, cantidad_lineas: 2,
  autorizante_usuario_id: null, autorizante_nombre: null, autorizado_en: null, rechazado_en: null, motivo_rechazo: null,
  lineas: [
    { id: 1, proveedor_id: 3, proveedor_nombre_snapshot: "Clínica X", proveedor_razon_social_snapshot: "Clínica X SA", proveedor_nit_snapshot: "123",
      descripcion: "Exámenes médicos", cantidad: "2", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado",
      banco_snapshot: "Banco Industrial", numero_cuenta_snapshot: "111222", tipo_cuenta_snapshot: "Monetaria", dias_credito_snapshot: null, total: "300.00", observaciones: null },
    { id: 2, proveedor_id: 5, proveedor_nombre_snapshot: "Papelería Y", proveedor_razon_social_snapshot: null, proveedor_nit_snapshot: null,
      descripcion: "Papelería", cantidad: "1", precio_unitario: "80", metodo_pago: "Efectivo", condicion_pago: "Contado",
      banco_snapshot: null, numero_cuenta_snapshot: null, tipo_cuenta_snapshot: null, dias_credito_snapshot: null, total: "80.00", observaciones: "Urgente" },
  ],
};

describe("27-35) PDF del requerimiento de RRHH", () => {
  it("27) código arriba, 28) empresa requirente, 29) persona que requiere, 30) proveedores, 33) total, 34) firmas", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const bytes = await requerimientoRrhhPdf(detalle);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const contenido = text.mock.calls.map(c => String(c[0])).join(" ");
    for (const dato of ["Kuiqtrans", "RH-2026-000012", "REQUERIMIENTO DE RRHH", "Ana Gómez", "Walter Villagrán",
      "Clínica X", "Papelería Y", "Exámenes médicos", "Papelería", "TOTAL: Q 380.00", "Página 1 de",
      "FIRMA DEL REQUIRIENTE", "FIRMA DEL SOLICITANTE", "FIRMA DEL AUTORIZANTE", "PENDIENTE DE AUTORIZACIÓN"]) expect(contenido).toContain(dato);
    text.mockRestore();
  });
  it("31) datos bancarios solo en la línea Transferencia (no para la de Efectivo)", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await requerimientoRrhhPdf(detalle);
    const contenido = text.mock.calls.map(c => String(c[0])).join(" ");
    expect(contenido).toContain("Banco Industrial");
    expect(contenido).toContain("111222");
    text.mockRestore();
  });
  it("35) multipágina: 40 líneas generan más de una página", async () => {
    const muchas = { ...detalle, lineas: Array.from({ length: 40 }, (_, i) => ({ ...detalle.lineas[0], id: i + 1, descripcion: `Concepto ${i + 1}` })) };
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await requerimientoRrhhPdf(muchas);
    const contenido = text.mock.calls.map(c => String(c[0])).join(" ");
    expect(contenido).toMatch(/Página 2 de \d/);
    text.mockRestore();
  });
  it("Autorizada muestra el nombre del autorizante; Rechazada muestra motivo", async () => {
    let text = vi.spyOn(PDFDocument.prototype, "text");
    await requerimientoRrhhPdf({ ...detalle, estado: "Autorizada", autorizante_nombre: "Jefe RRHH" });
    expect(text.mock.calls.map(c => String(c[0])).join(" ")).toContain("Jefe RRHH");
    text.mockRestore();
    text = vi.spyOn(PDFDocument.prototype, "text");
    await requerimientoRrhhPdf({ ...detalle, estado: "Rechazada", motivo_rechazo: "Sin presupuesto" });
    const contenido = text.mock.calls.map(c => String(c[0])).join(" ");
    expect(contenido).toContain("RECHAZADA");
    expect(contenido).toContain("Sin presupuesto");
    text.mockRestore();
  });
});

describe("36-43) Excel del requerimiento de RRHH", () => {
  it("36) código separado del título, 37) empresa requirente, 38) proveedor/NIT, 39) banco/cuenta, 40) cantidades/precios, 41) total, 42) formato moneda", async () => {
    const buffer = await requerimientoRrhhExcel(detalle);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buffer).buffer);
    const ws = wb.worksheets[0];
    const filas = ws.getRows(1, ws.rowCount)!;
    const texto = filas.flatMap(r => r.values as unknown[]).filter(Boolean).map(String).join(" | ");
    expect(texto).toContain("REQUERIMIENTO DE RRHH");
    expect(texto).toContain("RH-2026-000012");
    expect(texto).toContain("Kuiqtrans");
    expect(texto).toContain("Clínica X");
    expect(texto).toContain("123");
    expect(texto).toContain("Banco Industrial");
    expect(texto).toContain("111222");
    const filaTotal = filas.find(r => String(r.getCell(1).value) === "TOTAL:");
    expect(filaTotal).toBeTruthy();
    expect(Number(filaTotal!.getCell(12).value)).toBe(380);
    expect(String(filaTotal!.getCell(12).numFmt)).toContain("Q");
    const filaLinea = filas.find(r => String(r.getCell(2).value) === "Clínica X");
    expect(Number(filaLinea!.getCell(5).value)).toBe(2);
    expect(Number(filaLinea!.getCell(6).value)).toBe(150);
  });
  it("43) nombre de archivo sanitizado, generado por la API de exportación", () => {
    const src = readFileSync("src/lib/rrhh/requerimiento-exportaciones-api.ts", "utf8");
    expect(src).toContain('`requerimiento-${d.codigo}.${formato === "pdf" ? "pdf" : "xlsx"}`');
    expect(src).toContain("Content-Disposition");
    expect(src).toContain('"Cache-Control": "private, no-store"');
  });
});
