import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * OPS-1 — cierre administrativo del viaje: Descargado -> Cerrado.
 *
 * Flujo real confirmado:
 *   Programado -> En ruta -> Descargado -> Cerrado (o Cancelado en
 *   cualquier punto anterior). "Descargado" ya significa "operación
 *   finalizada por el piloto, pendiente de cierre por Operaciones" (lo
 *   pone marcarPlanDescargado en src/lib/tms/planes-salida.ts). Este
 *   módulo agrega la transición final, exclusiva de
 *   Jefe/GerenteOperaciones vía el permiso `viajes_cerrar` — el piloto
 *   NUNCA puede llegar a "Cerrado": su acción en Portal solo produce
 *   "Descargado".
 *
 * Mismo patrón de transición atómica y verificada que
 * src/lib/tms/viaticos.ts (autorizarViatico/registrarEntregaViatico/
 * liquidarViatico): UPDATE condicional por estado + affectedRows, para
 * que dos clics concurrentes (o un doble cierre) nunca produzcan un
 * estado inconsistente.
 *
 * Transición permitida en OPS-1: ÚNICAMENTE Descargado -> Cerrado.
 * Programado/En ruta -> Cerrado directo NO está permitido (debe pasar
 * por la finalización operativa del piloto primero) — el propio UPDATE
 * condicional (`WHERE estado = 'Descargado'`) ya lo garantiza sin lógica
 * adicional.
 *
 * Esquema: NO se crea/altera desde este módulo. `cerrado_por`/
 * `cerrado_en` deben existir por haberse aplicado manualmente
 * sql/migrate-2026-08-ops-1-roles-cierre.sql (mismo criterio que el
 * resto de SITSA: migraciones SQL explícitas antes de desplegar, nunca
 * DDL automático en runtime).
 */

export type ResultadoCierreViaje =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Cierra administrativamente un plan/viaje. Requiere que el permiso
 * `viajes_cerrar:editar` ya se haya verificado en el endpoint (este
 * módulo no vuelve a chequear permisos — solo aplica la transición).
 */
export async function cerrarViaje(
  empresaId: number,
  planId: number,
  usuario: string,
): Promise<ResultadoCierreViaje> {
  const r = await execute(
    `UPDATE tms_planes_viaje
     SET estado = 'Cerrado', cerrado_por = ?, cerrado_en = NOW()
     WHERE id = ? AND empresa_id = ? AND estado = 'Descargado'`,
    [usuario, planId, empresaId],
  );
  if (r.affectedRows !== 1) {
    const existe = await query<RowDataPacket[]>(
      `SELECT estado FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [planId, empresaId],
    );
    if (!existe[0]) {
      return { ok: false, error: "Viaje no encontrado." };
    }
    const estadoActual = String(existe[0].estado ?? "");
    if (estadoActual === "Cerrado") {
      return { ok: false, error: "Este viaje ya fue cerrado." };
    }
    return {
      ok: false,
      error: `Este viaje está "${estadoActual}"; solo se puede cerrar cuando la operación ya fue finalizada (estado "Descargado").`,
    };
  }

  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "cerrar_viaje",
    modulo: "tms",
    detalle: `Plan #${planId} · Descargado → Cerrado`,
  });

  return { ok: true };
}
