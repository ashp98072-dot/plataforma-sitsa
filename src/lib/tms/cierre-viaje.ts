import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * OPS-1 (corregido) — cierre administrativo del viaje.
 *
 * Regla de negocio corregida por la empresa: el piloto NUNCA finaliza ni
 * cierra la operación. Registrar llegada/evidencias (desde el Portal, o
 * desde Flota cuando lo hace un staff en su nombre) es solo respaldo
 * operativo — ya NO dispara ningún cambio en tms_planes_viaje.estado
 * (ver marcarPlanDescargado en src/lib/tms/planes-salida.ts: sigue
 * existiendo, pero ningún endpoint la invoca automáticamente). El ÚNICO
 * que cierra la operación es un usuario con el permiso explícito
 * `viajes_cerrar:editar` (JefeOperaciones/GerenteOperaciones por
 * defecto) — nunca el rol por sí solo.
 *
 * Transición para viajes NUEVOS: "En ruta" -> "Cerrado", y solo si ya
 * existe un registro de llegada real en flota_viajes para ese mismo
 * plan (fv.plan_id = p.id, fv.estado = 'cerrado') — si el piloto
 * todavía no ha regresado, no hay nada que cerrar.
 *
 * Compatibilidad: los planes que ya quedaron en "Descargado" por el
 * flujo anterior (antes de esta corrección) también se pueden cerrar
 * directamente, sin exigir la subconsulta a flota_viajes.
 *
 * Mismo patrón de transición atómica y verificada que
 * src/lib/tms/viaticos.ts (autorizarViatico/registrarEntregaViatico/
 * liquidarViatico): UPDATE condicional + affectedRows, para que dos
 * clics concurrentes (o un doble cierre) nunca produzcan un estado
 * inconsistente.
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
    `UPDATE tms_planes_viaje p
     SET p.estado = 'Cerrado', p.cerrado_por = ?, p.cerrado_en = NOW()
     WHERE p.id = ? AND p.empresa_id = ?
       AND (
         p.estado = 'Descargado'
         OR (
           p.estado = 'En ruta'
           AND EXISTS (
             SELECT 1 FROM flota_viajes fv
             WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
           )
         )
       )`,
    [usuario, planId, empresaId],
  );
  if (r.affectedRows !== 1) {
    const existe = await query<RowDataPacket[]>(
      `SELECT p.estado,
              EXISTS (
                SELECT 1 FROM flota_viajes fv
                WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
              ) AS llegada_registrada
       FROM tms_planes_viaje p WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
      [planId, empresaId],
    );
    if (!existe[0]) {
      return { ok: false, error: "Viaje no encontrado." };
    }
    const estadoActual = String(existe[0].estado ?? "");
    const llegadaRegistrada = Number(existe[0].llegada_registrada ?? 0) === 1;
    if (estadoActual === "Cerrado") {
      return { ok: false, error: "Este viaje ya fue cerrado." };
    }
    if (estadoActual === "En ruta" && !llegadaRegistrada) {
      return {
        ok: false,
        error: "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía.",
      };
    }
    return {
      ok: false,
      error: `Este viaje está "${estadoActual}"; solo se puede cerrar cuando el piloto ya registró la llegada.`,
    };
  }

  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "cerrar_viaje",
    modulo: "tms",
    detalle: `Plan #${planId} → Cerrado`,
  });

  return { ok: true };
}
