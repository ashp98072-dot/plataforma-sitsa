import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import {
  confirmarReporteRecibido,
  ErrorLiquidacionViaje,
  leerLiquidacionPlan,
  type ActorLiquidacion,
  type ResultadoTransicionLiquidacion,
} from "./liquidacion-viaje";
import {
  ADVERTENCIAS_REPORTE,
  ESTADOS_PLAN_SIN_LIQUIDACION,
  type AdvertenciaReporte,
} from "./liquidacion-viaje-shared";

/**
 * LIQUIDACIÓN DE VIAJES, FASE 2 — «Confirmar reporte recibido» desde Planes/Viajes.
 *
 * Capa de OPERACIÓN sobre el dominio de Fase 1: evalúa advertencias (SOLO LECTURA de la llegada/salida del piloto en
 * `flota_viajes`) y confirma. Es una confirmación HUMANA: no equivale a llegada, no cambia el estado del viaje ni toca el
 * cierre. Las advertencias NO bloquean (D02): el usuario debe reconocerlas explícitamente y quedan en el evento.
 *
 * El permiso (`viajes_confirmar_reporte:editar`) lo verifica el endpoint; la empresa SIEMPRE viene de la sesión.
 */

interface FilaEstadoPlan extends RowDataPacket {
  estado: string;
  hay_viaje: number;
  hay_llegada: number;
}

/**
 * Advertencias vigentes del viaje. Lanza NO_ENCONTRADO (otra empresa) o PLAN_NO_ADMITE (Cerrado/Cancelado) para no mostrar
 * advertencias de algo que de todos modos no se puede confirmar.
 */
export async function evaluarAdvertenciasReporte(empresaId: number, planId: number): Promise<AdvertenciaReporte[]> {
  const [r] = await getPool().query<FilaEstadoPlan[]>(
    `SELECT p.estado,
            EXISTS (SELECT 1 FROM flota_viajes fv WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id) AS hay_viaje,
            EXISTS (SELECT 1 FROM flota_viajes fv WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado') AS hay_llegada
       FROM tms_planes_viaje p WHERE p.id = ? AND p.empresa_id = ?`,
    [planId, empresaId],
  );
  const fila = r[0];
  if (!fila) throw new ErrorLiquidacionViaje("NO_ENCONTRADO", "Viaje no encontrado.", 404);
  if ((ESTADOS_PLAN_SIN_LIQUIDACION as readonly string[]).includes(fila.estado)) {
    throw new ErrorLiquidacionViaje("PLAN_NO_ADMITE", `Un viaje "${fila.estado}" ya no admite cambios de liquidación.`);
  }
  if (Number(fila.hay_viaje) !== 1) {
    return [{ codigo: "SIN_SALIDA_REGISTRADA", mensaje: ADVERTENCIAS_REPORTE.SIN_SALIDA_REGISTRADA }];
  }
  if (Number(fila.hay_llegada) !== 1) {
    return [{ codigo: "SIN_LLEGADA_REGISTRADA", mensaje: ADVERTENCIAS_REPORTE.SIN_LLEGADA_REGISTRADA }];
  }
  return [];
}

export type ResultadoConfirmarReporteOperativo =
  | { ok: true; resultado: ResultadoTransicionLiquidacion }
  | { ok: false; advertencias: AdvertenciaReporte[] };

/**
 * Confirma el reporte recibido. Sin `reconocerAdvertencias` y con advertencias vigentes devuelve `{ ok: false, advertencias }`
 * SIN escribir nada; con el reconocimiento confirma y deja los códigos en el evento. Si el viaje ya tiene liquidación no se
 * evalúan advertencias (réplica idempotente o error de estado del dominio).
 */
export async function confirmarReporteOperativo(
  actor: ActorLiquidacion,
  entrada: { planId: number; observacion?: string | null; reconocerAdvertencias?: boolean },
): Promise<ResultadoConfirmarReporteOperativo> {
  if (await leerLiquidacionPlan(actor.empresaId, entrada.planId)) {
    return { ok: true, resultado: await confirmarReporteRecibido(actor, { planId: entrada.planId, observacion: entrada.observacion }) };
  }
  const advertencias = await evaluarAdvertenciasReporte(actor.empresaId, entrada.planId);
  if (advertencias.length && !entrada.reconocerAdvertencias) return { ok: false, advertencias };
  const resultado = await confirmarReporteRecibido(actor, {
    planId: entrada.planId,
    observacion: entrada.observacion,
    advertenciasReconocidas: advertencias.map((a) => a.codigo),
  });
  return { ok: true, resultado };
}
