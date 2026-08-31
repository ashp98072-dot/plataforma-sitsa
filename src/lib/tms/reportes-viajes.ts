import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { listarParadasDePlanes, type PlanParada } from "@/lib/tms/paradas";
import {
  estadoFinancieroDe,
  type EstadoAdminFactura,
  type EstadoFinancieroFactura,
} from "@/lib/facturacion/facturas";

/**
 * TMS-REPORTES-1 — Fase A (auditoría de fuentes de datos, ver reporte
 * final del ticket): datos operativos reales (km_salida/km_llegada/
 * hora_salida/hora_llegada/estado técnico) viven en `flota_viajes`, NUNCA
 * en `tms_planes_viaje` — el plan administrativo no tiene esas columnas.
 * Un plan corresponde a lo sumo a UN flota_viajes vinculado
 * (`flota_viajes.plan_id`, exclusividad ya garantizada por
 * src/lib/tms/vincular-viaje-plan.ts para vínculos nuevos). Para datos
 * HISTÓRICOS previos a esa exclusividad, esta consulta elige un único
 * candidato de forma determinística (preferir 'cerrado', si no el más
 * reciente) — nunca duplica filas del reporte por eso.
 */

export const ESTADOS_PLAN = [
  "Programado",
  "Cargado",
  "En ruta",
  "Descargado",
  "Cerrado",
  "Cancelado",
] as const;
export type EstadoPlan = (typeof ESTADOS_PLAN)[number];

export type PlanReporte = {
  id: number;
  codigo: string;
  fechaPlan: string;
  horaCarga: string | null;
  estado: string;
  /** Derivado — nunca un valor persistido. Ver SQL_PENDIENTE_CIERRE (mismo criterio que tms/planes/route.ts). */
  pendienteCierre: boolean;
  cerradoPor: string | null;
  cerradoEn: string | null;
  clienteId: number | null;
  cliente: string | null;
  rutaCodigo: string | null;
  lugarDescargaHistorico: string | null;
  referenciaCliente: string | null;
  tipoTraslado: string | null;
  regresoEstimado: string | null;
  tarifaComercial: number | null;
  placa: string | null;
  unidadTipo: string | null;
  unidadCapacidad: string | null;
  pilotoId: number | null;
  piloto: string | null;
  auxiliares: string[];
  paradas: PlanParada[];
  evidencias: number;
  /** Del ÚNICO flota_viajes vinculado (si existe). */
  horaSalida: string | null;
  horaLlegada: string | null;
  kmSalida: number | null;
  kmLlegada: number | null;
  kmRecorridos: number | null;
  diasRuta: number | null;

  // FACT-1-TMS-REPORTES — información REAL de facturación (fact_facturas/
  // fact_factura_viajes/fact_pagos), lectura pura vía LEFT JOIN 1:1
  // (UNIQUE(plan_id) en fact_factura_viajes garantiza que este JOIN nunca
  // duplica filas de viaje). `estadoFacturacion` es SIEMPRE derivado
  // (ver `derivarEstadoFacturacion`), nunca un valor persistido.
  estadoFacturacion: EstadoFacturacionViaje;
  facturaId: number | null;
  numeroFactura: string | null;
  /** `estado_admin` de la factura activa vinculada (nunca 'Anulada' — ver comentario en JOIN_FACTURACION). */
  estadoAdminFactura: EstadoAdminFactura | null;
  /** Solo no-null cuando estadoAdminFactura === 'Emitida'. */
  estadoFinancieroFactura: EstadoFinancieroFactura | null;
  /** = fact_factura_viajes.monto_asignado, SOLO si la factura está Emitida — nunca de un Borrador. */
  montoFacturadoViaje: number | null;
  /** = fact_factura_viajes.monto_asignado cuando la factura está en Borrador — NUNCA se llama "facturado". */
  montoBorradorViaje: number | null;
  /** Monto total DE LA FACTURA COMPLETA (no de este viaje) — se repite en cada viaje de una factura multiviaje. */
  totalFactura: number | null;
  /** Total pagado DE LA FACTURA COMPLETA — NUNCA prorrateado por viaje. */
  totalPagadoFactura: number | null;
  /** Saldo DE LA FACTURA COMPLETA — NUNCA prorrateado por viaje. */
  saldoFactura: number | null;
};

export type EstadoFacturacionViaje =
  | "No aplica"
  | "Pendiente de facturación"
  | "En borrador de factura"
  | "Facturado";

/**
 * Fase B — semántica ÚNICA de estadoFacturacion, derivada nunca
 * persistida:
 *   A) plan no Cerrado y sin factura activa           → "No aplica"
 *   B) plan Cerrado y sin factura activa               → "Pendiente de facturación"
 *   C) factura vinculada con estado_admin='Borrador'   → "En borrador de factura"
 *   D) factura vinculada con estado_admin='Emitida'    → "Facturado"
 * `estadoAdminFactura` llega SIEMPRE null cuando la única factura
 * vinculada está Anulada (JOIN_FACTURACION la excluye a propósito) — por
 * eso una relación inconsistente a una Anulada NUNCA se etiqueta
 * "Facturado", cae a A o B según corresponda (defensivo, documentado).
 */
export function derivarEstadoFacturacion(
  estadoPlan: string,
  estadoAdminFactura: EstadoAdminFactura | null,
): EstadoFacturacionViaje {
  if (estadoAdminFactura === "Emitida") return "Facturado";
  if (estadoAdminFactura === "Borrador") return "En borrador de factura";
  return estadoPlan === "Cerrado" ? "Pendiente de facturación" : "No aplica";
}

/**
 * "Estado de cobro" (columna de tabla/Excel) — SOLO tiene sentido para
 * una factura Emitida; en cualquier otro caso se muestra "—" (nunca se
 * inventa un estado de cobro para un Borrador o una factura inexistente).
 * Reutiliza `estadoFinancieroDe` (src/lib/facturacion/facturas.ts) — la
 * MISMA regla que ya usa la pantalla de Facturación, nunca una copia.
 */
export function derivarEstadoCobro(
  estadoAdminFactura: EstadoAdminFactura | null,
  totalFactura: number | null,
  totalPagadoFactura: number | null,
): EstadoFinancieroFactura | null {
  if (estadoAdminFactura !== "Emitida" || totalFactura == null) return null;
  return estadoFinancieroDe(totalFactura, totalPagadoFactura ?? 0);
}

export type FiltrosReporteViajes = {
  id?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: number;
  pilotoId?: number;
  unidadId?: number;
  estado?: string;
  soloPendientesCierre?: boolean;
  soloCerrados?: boolean;
  soloSinCerrar?: boolean;
  /** Fase F — distinto de "pendiente de cierre" (operativo): esto es sobre FACT-1. */
  estadoFacturacion?: EstadoFacturacionViaje;
  /** Fase F — solo tiene efecto real combinado con facturas Emitidas. */
  estadoCobro?: EstadoFinancieroFactura;
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compartido por el listado (route.ts) y el exportador (export/route.ts)
 * para que ambos apliquen EXACTAMENTE el mismo criterio de filtros —
 * nunca dos parseos que puedan divergir.
 */
const ESTADOS_FACTURACION_VIAJE: EstadoFacturacionViaje[] = [
  "No aplica", "Pendiente de facturación", "En borrador de factura", "Facturado",
];
const ESTADOS_COBRO: EstadoFinancieroFactura[] = ["Sin pagos", "Pago parcial", "Cobrado"];

export function filtrosReporteDesdeUrl(url: URL): FiltrosReporteViajes {
  const p = url.searchParams;
  const fechaDesde = p.get("fechaDesde");
  const fechaHasta = p.get("fechaHasta");
  const clienteId = Number(p.get("clienteId"));
  const pilotoId = Number(p.get("pilotoId"));
  const unidadId = Number(p.get("unidadId"));
  const estadoFacturacion = p.get("estadoFacturacion");
  const estadoCobro = p.get("estadoCobro");
  return {
    fechaDesde: fechaDesde && FECHA_RE.test(fechaDesde) ? fechaDesde : undefined,
    fechaHasta: fechaHasta && FECHA_RE.test(fechaHasta) ? fechaHasta : undefined,
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    pilotoId: Number.isInteger(pilotoId) && pilotoId > 0 ? pilotoId : undefined,
    unidadId: Number.isInteger(unidadId) && unidadId > 0 ? unidadId : undefined,
    estado: p.get("estado")?.trim() || undefined,
    soloPendientesCierre: p.get("soloPendientesCierre") === "1",
    soloCerrados: p.get("soloCerrados") === "1",
    soloSinCerrar: p.get("soloSinCerrar") === "1",
    estadoFacturacion: estadoFacturacion && (ESTADOS_FACTURACION_VIAJE as string[]).includes(estadoFacturacion)
      ? (estadoFacturacion as EstadoFacturacionViaje) : undefined,
    estadoCobro: estadoCobro && (ESTADOS_COBRO as string[]).includes(estadoCobro)
      ? (estadoCobro as EstadoFinancieroFactura) : undefined,
  };
}

/**
 * Km recorridos = km_llegada - km_salida, solo si ambos están presentes y
 * el resultado es coherente (>= 0 — un negativo indicaría datos corruptos,
 * nunca se muestra un número inventado/negativo).
 */
export function calcularKmRecorridos(
  kmSalida: number | null,
  kmLlegada: number | null,
): number | null {
  if (kmSalida == null || kmLlegada == null) return null;
  const diff = kmLlegada - kmSalida;
  return diff >= 0 ? diff : null;
}

/**
 * "Días de ruta" — documentado explícitamente porque no hay una columna
 * para esto: diferencia de días CALENDARIO entre la fecha de salida y la
 * fecha de llegada reales (flota_viajes.hora_salida/hora_llegada), mínimo
 * 1 (un viaje que sale y llega el mismo día calendario cuenta como 1 día
 * de ruta, no 0). Si falta salida o llegada real, no se inventa — null.
 */
export function calcularDiasRuta(
  horaSalida: string | null,
  horaLlegada: string | null,
): number | null {
  if (!horaSalida || !horaLlegada) return null;
  const salida = new Date(`${String(horaSalida).slice(0, 10)}T00:00:00`);
  const llegada = new Date(`${String(horaLlegada).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(salida.getTime()) || Number.isNaN(llegada.getTime())) return null;
  const dias = Math.round((llegada.getTime() - salida.getTime()) / 86_400_000) + 1;
  return dias >= 1 ? dias : 1;
}

export type KpiReporteViajes = {
  totalViajes: number;
  cerrados: number;
  pendientesCierre: number;
  enRuta: number;
  cancelados: number;
  totalEvidencias: number;
  totalKmRecorridos: number;
  /**
   * REGLA ECONÓMICA (ver reporte final del ticket): la fuente es
   * ÚNICAMENTE tms_planes_viaje.tarifa_comercial. Nunca Facturación
   * (FACT-1 no existe todavía), nunca viáticos, nunca multas, nunca
   * gastos TMS. Solo se suman tarifas NO NULAS — un viaje sin tarifa
   * capturada no cuenta como Q0 en el KPI (aunque en la tabla se muestre
   * "Pendiente"), para no distorsionar el promedio ni el total hacia
   * abajo por datos simplemente no capturados todavía.
   */
  valorProgramado: number; // suma tarifa_comercial de TODOS los filtrados, excepto Cancelado
  valorCerrado: number; // suma tarifa_comercial SOLO de estado real "Cerrado"
  promedioIngresoPorViaje: number; // valorProgramado / cantidad de viajes con tarifa capturada (no cancelados)

  // FACT-1-TMS-REPORTES (Fase E) — KPI financieros REALES de FACT-1.
  /** COUNT de viajes con estadoFacturacion = "Pendiente de facturación" — seguro por fila (1 viaje = 1 fila). */
  viajesPendientesFacturacion: number;
  /** SUM(tarifa_comercial) de esos mismos viajes — seguro por fila. */
  valorPendienteFacturacion: number;
  /** COUNT de viajes con estadoFacturacion = "Facturado". */
  viajesFacturados: number;
  /** SUM(monto_asignado) de esos viajes — cada fila es SU PROPIO monto_asignado, nunca el total de la factura: seguro por fila incluso en facturas multiviaje. */
  valorFacturado: number;
  /**
   * COUNT DISTINCT de FACTURAS Emitidas con saldo > 0 tocadas por el
   * filtro actual — seguro por fila (COUNT DISTINCT dedupe multiviaje).
   */
  facturasPendientesCobro: number;
  /**
   * SUM(monto_total - pagos) por FACTURA (una sola vez por factura, NUNCA
   * por fila de viaje) — ver `obtenerKpisReporte`/`calcularKpisReporte`
   * para la protección explícita contra doble conteo en multiviaje.
   */
  valorPendienteCobro: number;
  /** SUM(fact_pagos.monto) por FACTURA — misma protección contra doble conteo. */
  cobrado: number;
};

/**
 * CORRECCIÓN PR #112 (HALLAZGO 3): calcularKpisReporte(planes) — sobre un
 * arreglo en memoria — solo debe usarse con un arreglo YA COMPLETO (p.ej.
 * el resultado de obtenerReporteViajesParaExportar, o en pruebas). Para
 * la pantalla, el KPI real se calcula en SQL sobre TODO el filtro
 * (obtenerKpisReporte) — nunca sobre una página — porque el listado
 * paginado nunca trae todas las filas a memoria.
 */
export function calcularKpisReporte(planes: PlanReporte[]): KpiReporteViajes {
  const noCancelados = planes.filter((p) => p.estado !== "Cancelado");
  const conTarifa = noCancelados.filter((p) => p.tarifaComercial != null);
  const cerrados = planes.filter((p) => p.estado === "Cerrado");
  const cerradosConTarifa = cerrados.filter((p) => p.tarifaComercial != null);

  const valorProgramado = conTarifa.reduce((s, p) => s + Number(p.tarifaComercial), 0);
  const valorCerrado = cerradosConTarifa.reduce((s, p) => s + Number(p.tarifaComercial), 0);

  const pendientesFacturacion = planes.filter((p) => p.estadoFacturacion === "Pendiente de facturación");
  const facturados = planes.filter((p) => p.estadoFacturacion === "Facturado");
  // Fase E "evitar doble conteo": valorFacturado suma monto_asignado POR
  // VIAJE (cada fila es su propio monto, nunca el total de la factura) —
  // seguro incluso si varios viajes comparten factura.
  const valorFacturado = facturados.reduce((s, p) => s + (p.montoFacturadoViaje ?? 0), 0);

  // Para "por FACTURA" (cobrado/pendiente de cobro/facturas pendientes),
  // se deduplica por facturaId ANTES de sumar — nunca se suma
  // totalFactura/totalPagadoFactura una vez por CADA viaje.
  const facturasUnicasEmitidas = new Map<number, PlanReporte>();
  for (const p of planes) {
    if (p.facturaId != null && p.estadoAdminFactura === "Emitida" && !facturasUnicasEmitidas.has(p.facturaId)) {
      facturasUnicasEmitidas.set(p.facturaId, p);
    }
  }
  const facturasUnicas = [...facturasUnicasEmitidas.values()];
  const cobrado = facturasUnicas.reduce((s, p) => s + (p.totalPagadoFactura ?? 0), 0);
  const valorPendienteCobro = facturasUnicas.reduce(
    (s, p) => s + ((p.totalFactura ?? 0) - (p.totalPagadoFactura ?? 0)), 0,
  );
  const facturasPendientesCobro = facturasUnicas.filter(
    (p) => (p.totalFactura ?? 0) - (p.totalPagadoFactura ?? 0) > 0,
  ).length;

  return {
    totalViajes: planes.length,
    cerrados: cerrados.length,
    pendientesCierre: planes.filter((p) => p.pendienteCierre).length,
    enRuta: planes.filter((p) => p.estado === "En ruta" || p.estado === "Cargado").length,
    cancelados: planes.filter((p) => p.estado === "Cancelado").length,
    totalEvidencias: planes.reduce((s, p) => s + p.evidencias, 0),
    totalKmRecorridos: planes.reduce((s, p) => s + (p.kmRecorridos ?? 0), 0),
    valorProgramado,
    valorCerrado,
    promedioIngresoPorViaje: conTarifa.length ? valorProgramado / conTarifa.length : 0,
    viajesPendientesFacturacion: pendientesFacturacion.length,
    valorPendienteFacturacion: pendientesFacturacion.reduce((s, p) => s + (p.tarifaComercial ?? 0), 0),
    viajesFacturados: facturados.length,
    valorFacturado,
    facturasPendientesCobro,
    valorPendienteCobro,
    cobrado,
  };
}

const SQL_PENDIENTE_CIERRE = `(
  p.estado NOT IN ('Cerrado', 'Cancelado')
  AND EXISTS (
    SELECT 1 FROM flota_viajes fv
    WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
  )
)`;

/**
 * FACT-1-TMS-REPORTES — JOIN 1:1 con FACT-1 (UNIQUE(plan_id) en
 * fact_factura_viajes garantiza que esto NUNCA duplica una fila de
 * viaje). `f.estado_admin <> 'Anulada'` es DELIBERADO (Fase B): anular
 * BORRA la fila de fact_factura_viajes en el flujo normal, así que esto
 * es una defensa extra — si por inconsistencia apareciera una relación
 * viva apuntando a una factura Anulada, este JOIN la trata como "sin
 * factura" (f queda NULL), nunca como "Facturado". Compartido por TODAS
 * las consultas (listado/COUNT/KPI) para que el filtro por
 * estadoFacturacion/estadoCobro sea válido en cualquiera de ellas.
 */
const JOIN_FACTURACION = `
  LEFT JOIN fact_factura_viajes ffv ON ffv.plan_id = p.id
  LEFT JOIN fact_facturas f ON f.id = ffv.factura_id AND f.empresa_id = p.empresa_id AND f.estado_admin <> 'Anulada'
  LEFT JOIN (
    SELECT factura_id, SUM(monto) AS total_pagado FROM fact_pagos GROUP BY factura_id
  ) pg ON pg.factura_id = f.id
`;

/**
 * CORRECCIÓN PR #112 (HALLAZGO 3, ítem 5): constructor ÚNICO de
 * condiciones/params — usado por obtenerReporteViajes, contarReporteViajes
 * y obtenerKpisReporte, para que listado, conteo, KPI y exportador
 * apliquen SIEMPRE el mismo criterio (nunca dos WHERE que puedan divergir).
 */
function construirCondiciones(
  empresaId: number,
  filtros: FiltrosReporteViajes,
): { condiciones: string[]; params: (string | number)[] } {
  const condiciones = ["p.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];

  if (filtros.id) {
    condiciones.push("p.id = ?");
    params.push(filtros.id);
  }
  // "Solo pendientes de cierre" ignora el rango de fechas a propósito —
  // mismo criterio ya establecido en tms/planes?pendienteCierre=1 (OPS-2.1):
  // un pendiente antiguo nunca debe desaparecer por quedar fuera de rango.
  if (filtros.soloPendientesCierre) {
    condiciones.push(SQL_PENDIENTE_CIERRE);
  } else {
    if (filtros.fechaDesde) {
      condiciones.push("p.fecha_plan >= ?");
      params.push(filtros.fechaDesde);
    }
    if (filtros.fechaHasta) {
      condiciones.push("p.fecha_plan <= ?");
      params.push(filtros.fechaHasta);
    }
  }
  if (filtros.clienteId) {
    condiciones.push("p.cliente_id = ?");
    params.push(filtros.clienteId);
  }
  if (filtros.pilotoId) {
    condiciones.push("p.piloto_id = ?");
    params.push(filtros.pilotoId);
  }
  if (filtros.unidadId) {
    condiciones.push("p.unidad_id = ?");
    params.push(filtros.unidadId);
  }
  if (filtros.estado) {
    condiciones.push("p.estado = ?");
    params.push(filtros.estado);
  }
  if (filtros.soloCerrados) {
    condiciones.push("p.estado = 'Cerrado'");
  }
  if (filtros.soloSinCerrar) {
    condiciones.push("p.estado <> 'Cerrado'");
  }
  // Fase F — DISTINTO de soloPendientesCierre (operativo, arriba): esto
  // filtra por el estado de FACT-1, nunca se mezclan ambos criterios.
  // Requiere JOIN_FACTURACION (alias f/ffv/pg) presente en el FROM del
  // caller.
  if (filtros.estadoFacturacion === "Pendiente de facturación") {
    condiciones.push("p.estado = 'Cerrado'", "f.id IS NULL");
  } else if (filtros.estadoFacturacion === "En borrador de factura") {
    condiciones.push("f.estado_admin = 'Borrador'");
  } else if (filtros.estadoFacturacion === "Facturado") {
    condiciones.push("f.estado_admin = 'Emitida'");
  } else if (filtros.estadoFacturacion === "No aplica") {
    condiciones.push("p.estado <> 'Cerrado'", "f.id IS NULL");
  }
  if (filtros.estadoCobro) {
    // El estado de cobro solo existe para una factura Emitida.
    condiciones.push("f.estado_admin = 'Emitida'");
    if (filtros.estadoCobro === "Sin pagos") {
      condiciones.push("COALESCE(pg.total_pagado, 0) <= 0");
    } else if (filtros.estadoCobro === "Pago parcial") {
      condiciones.push("COALESCE(pg.total_pagado, 0) > 0 AND COALESCE(pg.total_pagado, 0) < f.monto_total");
    } else if (filtros.estadoCobro === "Cobrado") {
      condiciones.push("COALESCE(pg.total_pagado, 0) >= f.monto_total");
    }
  }
  return { condiciones, params };
}

/** true si el filtro reduce razonablemente el volumen (nunca "todo el histórico sin acotar"). */
function tieneRangoAcotado(filtros: FiltrosReporteViajes): boolean {
  return Boolean(filtros.id || filtros.fechaDesde || filtros.fechaHasta || filtros.soloPendientesCierre);
}

export const LIMITE_PAGINA_DEFECTO = 200;
export const LIMITE_PAGINA_MAXIMO = 500;
/** CORRECCIÓN PR #112 (HALLAZGO 3): topes de exportación — nunca truncar en silencio. */
export const LIMITE_EXPORTACION_SIN_RANGO = 5000;
export const LIMITE_EXPORTACION_MAXIMO = 20000;

/** COUNT(*) con el MISMO criterio que el listado — para KPI, paginación y validación de exportación. */
export async function contarReporteViajes(
  empresaId: number,
  filtros: FiltrosReporteViajes,
): Promise<number> {
  const { condiciones, params } = construirCondiciones(empresaId, filtros);
  const rows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM tms_planes_viaje p ${JOIN_FACTURACION} WHERE ${condiciones.join(" AND ")}`,
    params,
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * CORRECCIÓN PR #112 (HALLAZGO 3): KPI calculado en SQL sobre TODO el
 * filtro (nunca sobre una página) — mismos JOINs que el listado para
 * evidencias/km, mismas condiciones (construirCondiciones).
 */
export async function obtenerKpisReporte(
  empresaId: number,
  filtros: FiltrosReporteViajes,
): Promise<KpiReporteViajes> {
  const { condiciones, params } = construirCondiciones(empresaId, filtros);
  const where = condiciones.join(" AND ");
  const [rows, rowsFactura] = await Promise.all([
    // Agregados SEGUROS por FILA de viaje (1 fila = 1 viaje, JOIN_FACTURACION
    // es 1:1 vía UNIQUE(plan_id)) — incluye viajesPendientesFacturacion/
    // valorPendienteFacturacion/viajesFacturados/valorFacturado (cada uno
    // es SU PROPIO monto_asignado, nunca el total de la factura) y
    // facturasPendientesCobro (COUNT DISTINCT dedupe multiviaje).
    query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_viajes,
         SUM(p.estado = 'Cerrado') AS cerrados,
         SUM(${SQL_PENDIENTE_CIERRE}) AS pendientes_cierre,
         SUM(p.estado IN ('En ruta', 'Cargado')) AS en_ruta,
         SUM(p.estado = 'Cancelado') AS cancelados,
         COALESCE(SUM(ev.cnt), 0) AS total_evidencias,
         COALESCE(SUM(
           CASE WHEN fviaje.km_salida IS NOT NULL AND fviaje.km_llegada IS NOT NULL
                     AND fviaje.km_llegada >= fviaje.km_salida
                THEN fviaje.km_llegada - fviaje.km_salida ELSE 0 END
         ), 0) AS total_km_recorridos,
         COALESCE(SUM(CASE WHEN p.estado <> 'Cancelado' THEN p.tarifa_comercial ELSE NULL END), 0) AS valor_programado,
         COALESCE(SUM(CASE WHEN p.estado = 'Cerrado' THEN p.tarifa_comercial ELSE NULL END), 0) AS valor_cerrado,
         SUM(CASE WHEN p.estado <> 'Cancelado' AND p.tarifa_comercial IS NOT NULL THEN 1 ELSE 0 END) AS viajes_con_tarifa,
         SUM(CASE WHEN p.estado = 'Cerrado' AND f.id IS NULL THEN 1 ELSE 0 END) AS viajes_pend_facturacion,
         COALESCE(SUM(CASE WHEN p.estado = 'Cerrado' AND f.id IS NULL THEN p.tarifa_comercial ELSE NULL END), 0) AS valor_pend_facturacion,
         SUM(CASE WHEN f.estado_admin = 'Emitida' THEN 1 ELSE 0 END) AS viajes_facturados,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' THEN ffv.monto_asignado ELSE NULL END), 0) AS valor_facturado,
         COUNT(DISTINCT CASE WHEN f.estado_admin = 'Emitida' AND (f.monto_total - COALESCE(pg.total_pagado, 0)) > 0 THEN f.id END) AS facturas_pend_cobro
       FROM tms_planes_viaje p
       LEFT JOIN (
         SELECT plan_id, COUNT(*) AS cnt FROM tms_evidencias GROUP BY plan_id
       ) ev ON ev.plan_id = p.id
       LEFT JOIN (
         SELECT fv.plan_id, fv.km_salida, fv.km_llegada
         FROM flota_viajes fv
         WHERE fv.id = (
           SELECT fv2.id FROM flota_viajes fv2
           WHERE fv2.plan_id = fv.plan_id AND fv2.empresa_id = fv.empresa_id
           ORDER BY (fv2.estado = 'cerrado') DESC, fv2.id DESC
           LIMIT 1
         )
       ) fviaje ON fviaje.plan_id = p.id
       ${JOIN_FACTURACION}
       WHERE ${where}`,
      params,
    ),
    // Fase E "evitar doble conteo" (CRÍTICO): valorPendienteCobro/cobrado
    // son valores DE LA FACTURA COMPLETA — se agregan aquí sobre
    // fact_facturas directamente (una fila por factura), restringidos a
    // las facturas efectivamente tocadas por el filtro actual (reutiliza
    // EXACTAMENTE `where`/`params` en la subconsulta, mismos alias
    // p/ffv/f/pg — nunca un JOIN por viaje que multiplicaría el saldo de
    // una factura multiviaje N veces.
    query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(fx.monto_total - COALESCE(pgx.total_pagado, 0)), 0) AS pendiente_cobro,
              COALESCE(SUM(pgx.total_pagado), 0) AS cobrado
       FROM fact_facturas fx
       LEFT JOIN (
         SELECT factura_id, SUM(monto) AS total_pagado FROM fact_pagos GROUP BY factura_id
       ) pgx ON pgx.factura_id = fx.id
       WHERE fx.empresa_id = ? AND fx.estado_admin = 'Emitida' AND fx.id IN (
         SELECT f.id FROM tms_planes_viaje p
         ${JOIN_FACTURACION}
         WHERE ${where} AND f.id IS NOT NULL
       )`,
      [empresaId, ...params],
    ),
  ]);
  const r = rows[0];
  const viajesConTarifa = Number(r?.viajes_con_tarifa ?? 0);
  const valorProgramado = Number(r?.valor_programado ?? 0);
  const rf = rowsFactura[0];
  return {
    totalViajes: Number(r?.total_viajes ?? 0),
    cerrados: Number(r?.cerrados ?? 0),
    pendientesCierre: Number(r?.pendientes_cierre ?? 0),
    enRuta: Number(r?.en_ruta ?? 0),
    cancelados: Number(r?.cancelados ?? 0),
    totalEvidencias: Number(r?.total_evidencias ?? 0),
    totalKmRecorridos: Number(r?.total_km_recorridos ?? 0),
    valorProgramado,
    valorCerrado: Number(r?.valor_cerrado ?? 0),
    promedioIngresoPorViaje: viajesConTarifa ? valorProgramado / viajesConTarifa : 0,
    viajesPendientesFacturacion: Number(r?.viajes_pend_facturacion ?? 0),
    valorPendienteFacturacion: Number(r?.valor_pend_facturacion ?? 0),
    viajesFacturados: Number(r?.viajes_facturados ?? 0),
    valorFacturado: Number(r?.valor_facturado ?? 0),
    facturasPendientesCobro: Number(r?.facturas_pend_cobro ?? 0),
    valorPendienteCobro: Number(rf?.pendiente_cobro ?? 0),
    cobrado: Number(rf?.cobrado ?? 0),
  };
}

export type PaginacionReporte = { limit: number; offset: number };

/** Mismo mapeo que src/app/e/[slug]/tms/page.tsx (ESTADO_LABEL) — reutilizado aquí solo como referencia de estados válidos, sin importar ese archivo "use client". */
export async function obtenerReporteViajes(
  empresaId: number,
  filtros: FiltrosReporteViajes,
  paginacion?: PaginacionReporte,
): Promise<PlanReporte[]> {
  const { condiciones, params } = construirCondiciones(empresaId, filtros);
  const limit = paginacion ? Math.min(Math.max(paginacion.limit, 1), LIMITE_EXPORTACION_MAXIMO) : LIMITE_PAGINA_DEFECTO;
  const offset = paginacion ? Math.max(paginacion.offset, 0) : 0;

  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
            p.hora_carga, p.estado, p.cerrado_por,
            DATE_FORMAT(p.cerrado_en, '%Y-%m-%dT%H:%i') AS cerrado_en,
            ${SQL_PENDIENTE_CIERRE} AS pendiente_cierre,
            p.cliente_id, c.nombre AS cliente,
            p.ruta_codigo_historico AS ruta_codigo,
            p.lugar_descarga_historico, p.referencia_cliente, p.tipo_traslado,
            DATE_FORMAT(p.regreso_estimado, '%Y-%m-%dT%H:%i') AS regreso_estimado,
            p.tarifa_comercial,
            u.placa, u.tipo AS unidad_tipo, ve.capacidad AS unidad_capacidad,
            p.piloto_id, pil.nombre AS piloto,
            COALESCE(ev.cnt, 0) AS evidencias,
            fviaje.km_salida, fviaje.km_llegada,
            DATE_FORMAT(fviaje.hora_salida, '%Y-%m-%dT%H:%i') AS hora_salida,
            DATE_FORMAT(fviaje.hora_llegada, '%Y-%m-%dT%H:%i') AS hora_llegada,
            f.id AS factura_id, f.numero_factura, f.estado_admin AS estado_admin_factura,
            f.monto_total AS total_factura, COALESCE(pg.total_pagado, 0) AS total_pagado_factura,
            ffv.monto_asignado AS monto_asignado_viaje
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN flota_vehiculos ve ON ve.id = u.flota_vehiculo_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN (
       SELECT plan_id, COUNT(*) AS cnt FROM tms_evidencias GROUP BY plan_id
     ) ev ON ev.plan_id = p.id
     LEFT JOIN (
       SELECT fv.plan_id, fv.km_salida, fv.km_llegada, fv.hora_salida, fv.hora_llegada
       FROM flota_viajes fv
       WHERE fv.id = (
         SELECT fv2.id FROM flota_viajes fv2
         WHERE fv2.plan_id = fv.plan_id AND fv2.empresa_id = fv.empresa_id
         ORDER BY (fv2.estado = 'cerrado') DESC, fv2.id DESC
         LIMIT 1
       )
     ) fviaje ON fviaje.plan_id = p.id
     ${JOIN_FACTURACION}
     WHERE ${condiciones.join(" AND ")}
     ORDER BY p.fecha_plan DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const planIds = rows.map((r) => Number(r.id));
  const [paradasMap, auxMap] = await Promise.all([
    listarParadasDePlanes(planIds),
    auxiliaresDePlanesReporte(planIds),
  ]);

  return rows.map((r) => {
    const id = Number(r.id);
    const kmSalida = r.km_salida != null ? Number(r.km_salida) : null;
    const kmLlegada = r.km_llegada != null ? Number(r.km_llegada) : null;
    const horaSalida = r.hora_salida ? String(r.hora_salida) : null;
    const horaLlegada = r.hora_llegada ? String(r.hora_llegada) : null;
    return {
      id,
      codigo: String(r.codigo),
      fechaPlan: String(r.fecha_plan),
      horaCarga: r.hora_carga ? String(r.hora_carga).slice(0, 8) : null,
      estado: String(r.estado),
      pendienteCierre: Number(r.pendiente_cierre) === 1,
      cerradoPor: r.cerrado_por ? String(r.cerrado_por) : null,
      cerradoEn: r.cerrado_en ? String(r.cerrado_en) : null,
      clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
      cliente: r.cliente ? String(r.cliente) : null,
      rutaCodigo: r.ruta_codigo ? String(r.ruta_codigo) : null,
      lugarDescargaHistorico: r.lugar_descarga_historico ? String(r.lugar_descarga_historico) : null,
      referenciaCliente: r.referencia_cliente ? String(r.referencia_cliente) : null,
      tipoTraslado: r.tipo_traslado ? String(r.tipo_traslado) : null,
      regresoEstimado: r.regreso_estimado ? String(r.regreso_estimado) : null,
      tarifaComercial: r.tarifa_comercial != null ? Number(r.tarifa_comercial) : null,
      placa: r.placa ? String(r.placa) : null,
      unidadTipo: r.unidad_tipo ? String(r.unidad_tipo) : null,
      unidadCapacidad: r.unidad_capacidad ? String(r.unidad_capacidad) : null,
      pilotoId: r.piloto_id != null ? Number(r.piloto_id) : null,
      piloto: r.piloto ? String(r.piloto) : null,
      auxiliares: auxMap.get(id) ?? [],
      paradas: paradasMap.get(id) ?? [],
      evidencias: Number(r.evidencias ?? 0),
      horaSalida,
      horaLlegada,
      kmSalida,
      kmLlegada,
      kmRecorridos: calcularKmRecorridos(kmSalida, kmLlegada),
      diasRuta: calcularDiasRuta(horaSalida, horaLlegada),
      ...mapearFacturacionFila(r, String(r.estado)),
    };
  });
}

/**
 * FACT-1-TMS-REPORTES — mapea las columnas de JOIN_FACTURACION (nunca
 * null si no hay factura vinculada, o si la única vinculada está
 * Anulada — JOIN_FACTURACION ya la excluyó) a los campos derivados de
 * PlanReporte. Extraído para reutilizar el mismo mapeo en
 * obtenerReporteViajes sin duplicar la lógica de derivación.
 */
function mapearFacturacionFila(
  r: RowDataPacket,
  estadoPlan: string,
): Pick<
  PlanReporte,
  | "estadoFacturacion" | "facturaId" | "numeroFactura" | "estadoAdminFactura"
  | "estadoFinancieroFactura" | "montoFacturadoViaje" | "montoBorradorViaje"
  | "totalFactura" | "totalPagadoFactura" | "saldoFactura"
> {
  const estadoAdminFactura = r.estado_admin_factura != null ? (String(r.estado_admin_factura) as EstadoAdminFactura) : null;
  const totalFactura = r.total_factura != null ? Number(r.total_factura) : null;
  const totalPagadoFactura = r.total_pagado_factura != null ? Number(r.total_pagado_factura) : null;
  const montoAsignado = r.monto_asignado_viaje != null ? Number(r.monto_asignado_viaje) : null;
  return {
    estadoFacturacion: derivarEstadoFacturacion(estadoPlan, estadoAdminFactura),
    facturaId: r.factura_id != null ? Number(r.factura_id) : null,
    numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null,
    estadoAdminFactura,
    estadoFinancieroFactura: derivarEstadoCobro(estadoAdminFactura, totalFactura, totalPagadoFactura),
    // (Fase C) montoFacturadoViaje SOLO si Emitida; montoBorradorViaje SOLO
    // si Borrador — NUNCA se llama "facturado" a un monto todavía en Borrador.
    montoFacturadoViaje: estadoAdminFactura === "Emitida" ? montoAsignado : null,
    montoBorradorViaje: estadoAdminFactura === "Borrador" ? montoAsignado : null,
    totalFactura: estadoAdminFactura != null ? totalFactura : null,
    totalPagadoFactura: estadoAdminFactura != null ? totalPagadoFactura : null,
    saldoFactura: estadoAdminFactura != null && totalFactura != null
      ? totalFactura - (totalPagadoFactura ?? 0) : null,
  };
}

/** Detalle de un único plan — mismos datos que la tabla, un solo registro. */
export async function obtenerReporteViajePorId(
  empresaId: number,
  planId: number,
): Promise<PlanReporte | null> {
  const rows = await obtenerReporteViajes(empresaId, { id: planId });
  return rows[0] ?? null;
}

export type ResultadoExportacionReporte =
  | { ok: true; planes: PlanReporte[] }
  | { ok: false; error: string };

/**
 * CORRECCIÓN PR #112 (HALLAZGO 3): la exportación (Excel/PDF) debe cubrir
 * TODO el rango filtrado — nunca el LIMIT 2000 silencioso que traía
 * obtenerReporteViajes por defecto. Antes de traer filas, cuenta con el
 * MISMO criterio (contarReporteViajes) y rechaza explícitamente (nunca
 * trunca en silencio) si:
 *   - no hay un filtro que acote razonablemente el volumen (fecha/
 *     pendientes) Y el total supera LIMITE_EXPORTACION_SIN_RANGO, o
 *   - el total supera LIMITE_EXPORTACION_MAXIMO incluso con filtro.
 */
export async function obtenerReporteViajesParaExportar(
  empresaId: number,
  filtros: FiltrosReporteViajes,
): Promise<ResultadoExportacionReporte> {
  const total = await contarReporteViajes(empresaId, filtros);
  if (!tieneRangoAcotado(filtros) && total > LIMITE_EXPORTACION_SIN_RANGO) {
    return {
      ok: false,
      error: `Hay ${total} viaje(s) sin un filtro que acote el volumen (fecha o "solo pendientes de cierre"). Acota el rango de fechas para exportar (máximo ${LIMITE_EXPORTACION_SIN_RANGO} sin acotar).`,
    };
  }
  if (total > LIMITE_EXPORTACION_MAXIMO) {
    return {
      ok: false,
      error: `El filtro actual incluye ${total} viaje(s), por encima del máximo exportable (${LIMITE_EXPORTACION_MAXIMO}). Acota el rango de fechas u otros filtros.`,
    };
  }
  const planes = await obtenerReporteViajes(empresaId, filtros, { limit: Math.max(total, 1), offset: 0 });
  return { ok: true, planes };
}

/**
 * Mismo JOIN que el `auxiliaresDePlanes` privado de tms/planes/route.ts
 * (no se importa de ahí para no acoplar este módulo de solo-lectura a un
 * archivo de 2000+ líneas con lógica transaccional de escritura) —
 * devuelve solo nombres, que es todo lo que necesita este reporte.
 */
async function auxiliaresDePlanesReporte(planIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  const ids = [...new Set(planIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  // CORRECCIÓN PR #112 (último detalle): sin catch genérico. tms_plan_auxiliares
  // ya es parte del esquema real usado en producción — si esta consulta
  // falla (error SQL, conexión, timeout, columna incorrecta, permisos,
  // regresión futura), NO se debe devolver silenciosamente un reporte con
  // "Auxiliares: []" como si fuera información válida. El error se
  // propaga y el reporte falla explícitamente (el caller, obtenerReporteViajes,
  // no atrapa este Promise.all — se relanza tal cual).
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT a.plan_id, per.nombre
     FROM tms_plan_auxiliares a
     INNER JOIN tms_personal per ON per.id = a.personal_id
     WHERE a.plan_id IN (${placeholders})
     ORDER BY a.plan_id, a.orden, a.id`,
    ids,
  );
  for (const r of rows) {
    const pid = Number(r.plan_id);
    const list = map.get(pid) ?? [];
    list.push(String(r.nombre));
    map.set(pid, list);
  }
  return map;
}
