import { tablaAExcel } from "@/lib/rrhh/export-files";
import type { FilaAgregadaGasto, FilaRentabilidadViaje, FilaViaticoReporte } from "@/lib/tms/reportes-gastos";
import type { SolicitudFondo } from "@/lib/tms/fondos";

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — reutiliza el exportador genérico
 * tablaAExcel (src/lib/rrhh/export-files.ts), ya usado por otros módulos
 * de la app — no se escribe un generador de Excel nuevo por reporte.
 */

const money = (n: number) => n.toFixed(2);

export async function exportarAgregadoGastosExcel(
  titulo: string,
  columnaEtiqueta: string,
  filas: FilaAgregadaGasto[],
): Promise<Buffer> {
  return tablaAExcel({
    sheetName: titulo,
    headers: [columnaEtiqueta, "Registros", "Total (Q)"],
    rows: filas.map((f) => [f.etiqueta, String(f.registros), money(f.totalMonto)]),
  });
}

export async function exportarViaticosReporteExcel(filas: FilaViaticoReporte[]): Promise<Buffer> {
  return tablaAExcel({
    sheetName: "Viaticos por viaje",
    headers: ["Viaje", "Fecha", "Persona", "Rol", "Monto sugerido (Q)", "Monto asignado (Q)", "Estado"],
    rows: filas.map((f) => [
      f.planCodigo, f.fechaPlan, f.personalNombre, f.rol, money(f.montoSugerido), money(f.montoAsignado), f.estado,
    ]),
  });
}

export async function exportarRentabilidadExcel(filas: FilaRentabilidadViaje[]): Promise<Buffer> {
  return tablaAExcel({
    sheetName: "Rentabilidad por viaje",
    headers: ["Viaje", "Fecha", "Cliente", "Tarifario (Q)", "Costo operativo (Q)", "Gastos (Q)", "Viaticos (Q)", "Utilidad (Q)"],
    rows: filas.map((f) => [
      f.planCodigo, f.fechaPlan, f.clienteNombre ?? "—",
      money(f.tarifaComercial), f.costoOperativo != null ? money(f.costoOperativo) : "—",
      money(f.gastos), money(f.viaticos), money(f.utilidad),
    ]),
  });
}

export async function exportarSolicitudFondoExcel(solicitud: SolicitudFondo): Promise<Buffer> {
  return tablaAExcel({
    sheetName: `Solicitud ${solicitud.codigo}`.slice(0, 31),
    headers: ["Categoria", "Descripcion", "Cantidad", "Monto (Q)", "Subtotal (Q)"],
    rows: [
      ...solicitud.lineas.map((l) => [
        l.categoria, l.descripcion ?? "", String(l.cantidad), money(l.monto), money(l.cantidad * l.monto),
      ]),
      ["", "", "", "TOTAL", money(solicitud.total)],
    ],
  });
}
