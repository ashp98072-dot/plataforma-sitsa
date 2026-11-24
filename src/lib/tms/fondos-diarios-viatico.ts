import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { fondosDiariosInstalado, sincronizarFondosDePlanes, type ActorFondosDiarios } from "@/lib/tms/fondos-diarios";

/** Texto para la persona usuaria cuando el viático SÍ quedó guardado pero la solicitud de fondos no se pudo actualizar. */
export const ADVERTENCIA_VIATICO_FONDOS =
  "El viático se guardó, pero la solicitud de fondos necesita resincronización: usa «Resincronizar» en Solicitudes de fondo o vuelve a guardar el viaje.";

/**
 * Tras guardar (monto) o rechazar un viático ya CONFIRMADO, refleja el cambio en la solicitud de fondos del viaje reutilizando `sincronizarFondosDePlanes` (diferencial: retira la línea
 * AUTO_VIATICO de una solicitud PENDIENTE; una AUTORIZADA/LIQUIDADA nunca se toca y lo nuevo iría a la complementaria). NUNCA lanza ni revierte el viático: devuelve `advertenciaFondos`
 * cuando la solicitud pudo quedar desactualizada (error en la búsqueda del viaje, en la detección del esquema, en la sincronización o excepción), para que la pantalla no muestre un éxito silencioso.
 * Sin la migración de fondos diarios no hay solicitudes que actualizar: no hay advertencia.
 */
export async function sincronizarFondosTrasViatico(empresaId: number, viaticoId: number, actor: ActorFondosDiarios): Promise<{ advertenciaFondos?: string }> {
  try {
    if (!(await fondosDiariosInstalado())) return {};
    const filas = await query<RowDataPacket[]>("SELECT plan_id FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1", [viaticoId, empresaId]);
    const planId = filas[0]?.plan_id;
    if (planId == null) return { advertenciaFondos: ADVERTENCIA_VIATICO_FONDOS };   // el viático existe (acaba de guardarse): no poder ubicar su viaje es un fallo, no un «nada que hacer»
    const r = await sincronizarFondosDePlanes(empresaId, [Number(planId)], actor);
    return r.advertencia ? { advertenciaFondos: ADVERTENCIA_VIATICO_FONDOS } : {};
  } catch (e) {
    console.error("sincronizarFondosTrasViatico", e);
    return { advertenciaFondos: ADVERTENCIA_VIATICO_FONDOS };
  }
}
