import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { listarParadasDePlanes, type PlanParada } from "@/lib/tms/paradas";

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
};

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
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compartido por el listado (route.ts) y el exportador (export/route.ts)
 * para que ambos apliquen EXACTAMENTE el mismo criterio de filtros —
 * nunca dos parseos que puedan divergir.
 */
export function filtrosReporteDesdeUrl(url: URL): FiltrosReporteViajes {
  const p = url.searchParams;
  const fechaDesde = p.get("fechaDesde");
  const fechaHasta = p.get("fechaHasta");
  const clienteId = Number(p.get("clienteId"));
  const pilotoId = Number(p.get("pilotoId"));
  const unidadId = Number(p.get("unidadId"));
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
};

export function calcularKpisReporte(planes: PlanReporte[]): KpiReporteViajes {
  const noCancelados = planes.filter((p) => p.estado !== "Cancelado");
  const conTarifa = noCancelados.filter((p) => p.tarifaComercial != null);
  const cerrados = planes.filter((p) => p.estado === "Cerrado");
  const cerradosConTarifa = cerrados.filter((p) => p.tarifaComercial != null);

  const valorProgramado = conTarifa.reduce((s, p) => s + Number(p.tarifaComercial), 0);
  const valorCerrado = cerradosConTarifa.reduce((s, p) => s + Number(p.tarifaComercial), 0);

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
  };
}

const SQL_PENDIENTE_CIERRE = `(
  p.estado NOT IN ('Cerrado', 'Cancelado')
  AND EXISTS (
    SELECT 1 FROM flota_viajes fv
    WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
  )
)`;

/** Mismo mapeo que src/app/e/[slug]/tms/page.tsx (ESTADO_LABEL) — reutilizado aquí solo como referencia de estados válidos, sin importar ese archivo "use client". */
export async function obtenerReporteViajes(
  empresaId: number,
  filtros: FiltrosReporteViajes,
): Promise<PlanReporte[]> {
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
            DATE_FORMAT(fviaje.hora_llegada, '%Y-%m-%dT%H:%i') AS hora_llegada
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
     WHERE ${condiciones.join(" AND ")}
     ORDER BY p.fecha_plan DESC, p.id DESC
     LIMIT 2000`,
    params,
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
    };
  });
}

/** Detalle de un único plan — mismos datos que la tabla, un solo registro. */
export async function obtenerReporteViajePorId(
  empresaId: number,
  planId: number,
): Promise<PlanReporte | null> {
  const rows = await obtenerReporteViajes(empresaId, { id: planId });
  return rows[0] ?? null;
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
  try {
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
  } catch {
    /* tabla aún no existe en este entorno */
  }
  return map;
}
