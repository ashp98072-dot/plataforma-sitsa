// PRICESMART KPI — capa de CONSULTA y EXPORTACIÓN, SEPARADA de la integración operativa (la minuta del 30/10/2026 define KPI como un proyecto distinto). Funciones PURAS: sin base de datos, sin reloj,
// sin red. NO usa los contratos de la API (`OrderView`, `proposedStatus`…) ni los publica: expone los hechos de SITSA tal como están, con su disponibilidad. NO infiere horarios, cantidades ni cumplimiento
// y NO declara entregas confirmadas (D13): `entregaEvidenciadaEn` es la hora de la evidencia registrada por el piloto, no una entrega aceptada por PriceSmart.
import { assessDeliveryEvidence, type ConfirmationFact, type StopFact } from '../delivery-evidence';

export type KpiAvailability = 'DISPONIBLE' | 'SIN_DATO' | 'NO_DISPONIBLE';   // NO_DISPONIBLE: SITSA no tiene ese dato en ninguna fuente · SIN_DATO: existe la fuente pero aún no hay valor para esta orden
export const KPI_FIELDS = ['numeroOrden', 'club', 'fechaPlanificada', 'ventanaEntrega', 'salidaEn', 'entregaEvidenciadaEn', 'estadoServicio', 'cantidadItems', 'cumplimientoEntrega'] as const;
export type KpiField = typeof KPI_FIELDS[number];

/** Hechos crudos de SITSA para UNA orden (los entrega `kpi-source.ts`). Las fechas y horas son texto `AAAA-MM-DD` / `AAAA-MM-DD HH:MM:SS` en la hora local del TMS (D07 pendiente). */
export type KpiFacts = {
  solicitudId: number; referenciaCliente: string | null; observaciones: string | null; estadoSolicitud: string; fechaSolicitada: string | null; horaSolicitada: string | null;
  planId: number | null; planCodigo: string | null; estadoPlan: string | null; fechaPlan: string | null; horaCarga: string | null;
  salidaEn: string | null;                                   // MIN(flota_viajes.hora_salida) de los viajes del plan (registro del piloto), o null
  paradas: readonly StopFact[]; confirmaciones: readonly (ConfirmationFact & { confirmadoEn: string | null })[] | 'UNAVAILABLE';   // 'UNAVAILABLE': la tabla de confirmaciones aún no existe en este entorno
};
export type KpiOnTime = 'A_TIEMPO' | 'TARDE' | 'NO_CALCULABLE';
export type KpiRow = {
  numeroOrden: string | null; solicitudId: number; club: string | null; fechaPlanificada: string | null; fechaSolicitada: string | null;
  ventanaEntrega: null; salidaEn: string | null; entregaEvidenciadaEn: string | null; entregaNivelEvidencia: string;
  estadoServicio: string; cantidadItems: null; cumplimientoEntrega: KpiOnTime; cumplimientoMotivo: string | null; cumplimientoBase: 'FECHA_DIA' | null;
  confirmaEntrega: false;   // SIEMPRE false: D13 sin ratificar
  disponibilidad: Record<KpiField, KpiAvailability>;
};

/** Club del contrato de laboratorio `lab-demo-1`: lo escribe la integración en las observaciones («… · club X · destinatario …»). PROVISIONAL (D06): con otro contrato → null, nunca se adivina. */
export function parseClub(observaciones: string | null): string | null {
  const m = /(?:^|\s·\s)club ([A-Za-z0-9][A-Za-z0-9._:-]{0,63})(?:\s·\s|$)/.exec(observaciones ?? '');
  return m ? m[1] : null;
}
const dateOnly = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function buildKpiRow(f: KpiFacts): KpiRow {
  const club = parseClub(f.observaciones);
  const fechaPlanificada = dateOnly(f.fechaPlan);
  // Entrega: SOLO si el TMS tiene la evidencia suficiente por parada (todas las entregas confirmadas por el piloto, con evidencia vinculada y sin revisión pendiente). Hora = la del ÚLTIMO evento.
  let nivel = 'UNAVAILABLE'; let entregaEvidenciadaEn: string | null = null;
  if (f.confirmaciones !== 'UNAVAILABLE' && f.planId != null) {
    const ev = assessDeliveryEvidence(f.paradas, f.confirmaciones);
    nivel = ev.level;
    if (ev.level === 'PILOT_CONFIRMED_ALL') {
      const entregas = new Set(f.paradas.filter((p) => p.type === 'Entrega').map((p) => p.id));
      const horas = f.confirmaciones.filter((c) => entregas.has(c.stopId) && c.result === 'ENTREGADA_POR_PILOTO' && c.revision === 'NO_REQUERIDA').map((c) => c.confirmadoEn);
      entregaEvidenciadaEn = horas.length && horas.every((h) => h != null && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(h)) ? [...horas as string[]].sort().at(-1)! : null;   // sin hora fiable → no se inventa
    }
  } else if (f.planId == null) nivel = 'NO_PROGRAMADA';
  // Cumplimiento: SOLO con hora de entrega evidenciada Y fecha comprometida (la fecha de entrega que pidió PriceSmart). Comparación por DÍA (no hay ventana horaria ni zona horaria ratificadas: D07).
  const compromiso = dateOnly(f.fechaSolicitada); let cumplimientoEntrega: KpiOnTime = 'NO_CALCULABLE'; let cumplimientoMotivo: string | null = null; let cumplimientoBase: KpiRow['cumplimientoBase'] = null;
  if (entregaEvidenciadaEn && compromiso) { cumplimientoEntrega = entregaEvidenciadaEn.slice(0, 10) <= compromiso ? 'A_TIEMPO' : 'TARDE'; cumplimientoBase = 'FECHA_DIA'; }
  else cumplimientoMotivo = !compromiso ? 'SIN_FECHA_COMPROMETIDA' : nivel === 'UNAVAILABLE' ? 'CONFIRMACIONES_NO_DISPONIBLES' : nivel === 'NO_PROGRAMADA' ? 'SIN_PROGRAMAR' : nivel === 'PILOT_CONFIRMED_ALL' ? 'SIN_HORA_DE_EVIDENCIA' : `EVIDENCIA_${nivel}`;
  const has = (v: unknown): KpiAvailability => (v == null ? 'SIN_DATO' : 'DISPONIBLE');
  return {
    numeroOrden: f.referenciaCliente, solicitudId: f.solicitudId, club, fechaPlanificada, fechaSolicitada: compromiso,
    ventanaEntrega: null, salidaEn: f.salidaEn, entregaEvidenciadaEn, entregaNivelEvidencia: nivel,
    estadoServicio: f.estadoPlan ?? f.estadoSolicitud, cantidadItems: null, cumplimientoEntrega, cumplimientoMotivo, cumplimientoBase, confirmaEntrega: false,
    disponibilidad: {
      numeroOrden: has(f.referenciaCliente), club: has(club), fechaPlanificada: has(fechaPlanificada), ventanaEntrega: 'NO_DISPONIBLE', salidaEn: has(f.salidaEn),
      entregaEvidenciadaEn: nivel === 'UNAVAILABLE' ? 'NO_DISPONIBLE' : has(entregaEvidenciadaEn), estadoServicio: 'DISPONIBLE', cantidadItems: 'NO_DISPONIBLE',
      cumplimientoEntrega: cumplimientoEntrega === 'NO_CALCULABLE' ? 'SIN_DATO' : 'DISPONIBLE',
    },
  };
}

export const KPI_CSV_COLUMNS = ['numero_orden', 'club', 'fecha_planificada', 'ventana_entrega', 'salida_en', 'entrega_evidenciada_en', 'estado_servicio', 'cantidad_items', 'cumplimiento_entrega', 'cumplimiento_motivo', 'nivel_evidencia_entrega', 'confirma_entrega'] as const;
/** Celda CSV segura: comillas dobles, y los valores que una hoja de cálculo interpretaría como fórmula (= + - @, tab, CR) se neutralizan con un apóstrofo. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
/** Exportación CSV (UTF-8, `\n`). Dato inexistente en SITSA → `NO_DISPONIBLE`; dato existente pero sin valor → vacío. `confirma_entrega` es siempre `false` (D13). */
export function kpiToCsv(rows: readonly KpiRow[]): string {
  const cell = (r: KpiRow, f: KpiField, v: string | null) => (r.disponibilidad[f] === 'NO_DISPONIBLE' ? 'NO_DISPONIBLE' : csvCell(v));
  const lines = rows.map((r) => [csvCell(r.numeroOrden), cell(r, 'club', r.club), cell(r, 'fechaPlanificada', r.fechaPlanificada), cell(r, 'ventanaEntrega', null), cell(r, 'salidaEn', r.salidaEn),
    cell(r, 'entregaEvidenciadaEn', r.entregaEvidenciadaEn), csvCell(r.estadoServicio), cell(r, 'cantidadItems', null), csvCell(r.cumplimientoEntrega), csvCell(r.cumplimientoMotivo), csvCell(r.entregaNivelEvidencia), 'false'].join(','));
  return [KPI_CSV_COLUMNS.join(','), ...lines].join('\n') + '\n';
}
