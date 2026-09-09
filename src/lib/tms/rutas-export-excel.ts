import ExcelJS from "exceljs";
import type { ClienteRuta } from "@/lib/tms/cliente-rutas";

export async function exportarRutasExcel(rutas: ClienteRuta[], empresaNombre: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  wb.subject = `Catálogo de rutas - ${empresaNombre}`;
  const ws = wb.addWorksheet("RUTAS", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  // TMS-SIN-COSTO-OPERATIVO-1: "Costo operativo" ya no se exporta — el
  // negocio confirmó que este dato ya no se utiliza (ver ruta.costoOperativo
  // en cliente-rutas.ts, que se conserva sin usar por compatibilidad
  // histórica, sin DROP de columna).
  // RUTAS-TARIFARIO-HISTORIAL-1 (§6 del ticket) — se AMPLÍA el export
  // existente (nunca se duplica) con 3 columnas nuevas al final
  // (Vigente desde / Último cambio / Modificado por), derivadas del
  // historial de tarifas (tms_cliente_ruta_tarifas) — así ningún índice
  // de columna existente se corre y el resto del archivo queda intacto.
  const headers = [
    "Código", "Cliente", "Nombre / descripción", "Lugar de carga", "Hora habitual", "Contacto",
    "Destino", "Tarifario (Q)", "Piloto código", "Piloto nombre",
    "Viático piloto (Q)", "Auxiliares códigos", "Auxiliares nombres", "Viáticos auxiliares (Q)",
    "Paradas estructuradas", "Estado", "Observaciones",
    "Vigente desde", "Último cambio de tarifa", "Modificado por",
  ];
  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = `CATÁLOGO DE RUTAS - ${empresaNombre}`;
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getCell(1, 1).alignment = { horizontal: "center" };
  ws.addRow([]);
  ws.addRow(headers);
  const header = ws.getRow(3);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  for (const ruta of rutas) {
    const piloto = ruta.personalPredeterminado.find((persona) => persona.rol === "Piloto");
    const auxiliares = ruta.personalPredeterminado.filter((persona) => persona.rol === "Auxiliar");
    ws.addRow([
      ruta.codigo, ruta.clienteNombre, ruta.nombre ?? "", ruta.lugarCargaTexto ?? "", ruta.horaHabitual ?? "",
      ruta.contactoNombre ?? "", ruta.destinoDescripcion ?? "", ruta.tarifaReferencia,
      piloto?.empleadoCodigo ?? "", piloto?.empleadoNombre ?? "", piloto?.viaticoMonto ?? null,
      auxiliares.map((persona) => persona.empleadoCodigo).join(";"),
      auxiliares.map((persona) => persona.empleadoNombre).join(";"),
      auxiliares.map((persona) => persona.viaticoMonto ?? "").join(";"),
      ruta.paradas.map((parada) => `${parada.tipo}: ${parada.lugarNombre}`).join(" → "),
      ruta.activo ? "Activa" : "Inactiva", ruta.observaciones ?? "",
      ruta.tarifaVigenteDesde ?? "", ruta.tarifaUltimoCambioEn ?? "", ruta.tarifaModificadoPor ?? "",
    ]);
  }
  ws.autoFilter = { from: "A3", to: `T${Math.max(3, rutas.length + 3)}` };
  ws.columns = [14, 26, 25, 35, 14, 24, 40, 18, 18, 26, 19, 28, 35, 28, 40, 12, 35, 14, 22, 22].map((width) => ({ width }));
  [8, 11].forEach((column) => { ws.getColumn(column).numFmt = "Q#,##0.00"; });
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 3) row.alignment = { vertical: "top", wrapText: true };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
