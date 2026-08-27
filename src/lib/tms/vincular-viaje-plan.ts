import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * PORTAL-HARDENING-2 (corrección final PR #107 — último hallazgo de
 * integridad): el auto-vínculo estricto del Portal
 * (api/portal/viajes/[id]/evidencias/route.ts) solo vincula
 * flota_viajes.plan_id cuando encuentra una coincidencia segura y
 * verificable. Cuando NO la encuentra, hasta ahora el aviso al piloto
 * prometía "Operaciones lo vincula manualmente" sin que existiera ninguna
 * herramienta real para hacerlo. Este archivo es esa herramienta —
 * SIEMPRE administrativa (Operaciones/Programación/TMS), NUNCA invocable
 * por el piloto — con el MISMO criterio estricto ya usado en el
 * auto-vínculo (nunca una heurística de texto):
 *   - misma empresa (siempre de la sesión del servidor, nunca del cliente)
 *   - mismo piloto por identidad real (tms_personal.id_empleado =
 *     flota_viajes.empleado_id)
 *   - misma unidad exacta (tms_unidades.flota_vehiculo_id =
 *     flota_viajes.vehiculo_id)
 *   - misma fecha (tms_planes_viaje.fecha_plan = fecha real de
 *     flota_viajes.hora_salida)
 *   - estado operativo compatible (Programado/Cargado/En ruta)
 *   - el viaje aún no tiene plan_id, y el plan no está ya en uso por OTRO
 *     viaje técnico abierto
 * NUNCA cambia tms_planes_viaje.estado ni flota_viajes.estado — solo
 * escribe flota_viajes.plan_id (condicionalmente) y, de forma
 * idempotente, sincroniza a tms_evidencias la evidencia que el piloto ya
 * hubiera subido ANTES del vínculo y que nunca llegó a TMS (la causa raíz
 * original reportada).
 */

const ESTADOS_COMPATIBLES = ["Programado", "Cargado", "En ruta"];

export type ResultadoVincularViaje =
  | { ok: true; planCodigo: string; evidenciasSincronizadas: number }
  | { ok: false; error: string; status: number };

/**
 * Mapea el tipo de evidencia de flota_viaje_evidencias al vocabulario ya
 * usado en tms_evidencias.tipo (mismo mapeo que
 * api/portal/viajes/[id]/evidencias/route.ts) — incluye los tipos
 * históricos ("salida"/"llegada", del flujo de kilometraje de carga
 * retirado en la Fase B de este mismo ticket) para que el backfill
 * también cubra evidencia subida antes de ese cambio.
 */
function mapearSyncTmsTipo(tipo: string): "Carga" | "Descarga" | "Producto" | "Otro" {
  if (tipo === "producto") return "Producto";
  if (tipo === "otro") return "Otro";
  if (tipo === "tablero_salida" || tipo === "salida") return "Carga";
  return "Descarga"; // tablero_llegada, llegada, o cualquier tipo histórico no reconocido
}

export type ViajeCandidatoVinculo = {
  viajeId: number;
  horaSalida: string;
  placa: string;
};

/**
 * Candidatos reales para vincular a este plan — mismo criterio estricto
 * que usa vincularViajeAPlan, para que la UI nunca ofrezca texto libre de
 * IDs: solo viajes técnicos sin plan_id que YA coinciden en piloto, unidad
 * y fecha con este plan específico.
 */
export async function listarViajesCandidatosParaPlan(
  empresaId: number,
  planId: number,
): Promise<ViajeCandidatoVinculo[]> {
  const planRows = await query<RowDataPacket[]>(
    `SELECT p.fecha_plan, pil.id_empleado AS piloto_empleado_id, u.flota_vehiculo_id
     FROM tms_planes_viaje p
     INNER JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [planId, empresaId],
  );
  const plan = planRows[0];
  if (!plan || plan.piloto_empleado_id == null || plan.flota_vehiculo_id == null) return [];
  const fechaPlan = String(plan.fecha_plan).slice(0, 10);
  const rows = await query<RowDataPacket[]>(
    `SELECT v.id, v.hora_salida, ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.empresa_id = ? AND v.plan_id IS NULL
       AND v.empleado_id = ? AND v.vehiculo_id = ?
       AND DATE(v.hora_salida) = ?
     ORDER BY v.hora_salida DESC
     LIMIT 10`,
    [empresaId, Number(plan.piloto_empleado_id), Number(plan.flota_vehiculo_id), fechaPlan],
  );
  return rows.map((r) => ({
    viajeId: Number(r.id),
    horaSalida: String(r.hora_salida),
    placa: String(r.placa),
  }));
}

export async function vincularViajeAPlan(
  empresaId: number,
  planId: number,
  viajeId: number,
  usuario: string,
): Promise<ResultadoVincularViaje> {
  const conn: PoolConnection = await getPool().getConnection();
  let descartada = false;
  try {
    await conn.beginTransaction();

    const [planRows] = await conn.query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, p.estado, p.fecha_plan, p.piloto_id, p.unidad_id,
              pil.id_empleado AS piloto_empleado_id, u.flota_vehiculo_id
       FROM tms_planes_viaje p
       INNER JOIN tms_personal pil ON pil.id = p.piloto_id
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
       WHERE p.id = ? AND p.empresa_id = ? LIMIT 1 FOR UPDATE`,
      [planId, empresaId],
    );
    const plan = planRows[0];
    if (!plan) {
      await conn.rollback();
      return { ok: false, error: "Plan no encontrado.", status: 404 };
    }

    const [viajeRows] = await conn.query<RowDataPacket[]>(
      `SELECT v.id, v.empleado_id, v.vehiculo_id, v.hora_salida, v.plan_id
       FROM flota_viajes v WHERE v.id = ? AND v.empresa_id = ? LIMIT 1 FOR UPDATE`,
      [viajeId, empresaId],
    );
    const viaje = viajeRows[0];
    if (!viaje) {
      await conn.rollback();
      return { ok: false, error: "Viaje técnico no encontrado.", status: 404 };
    }

    if (viaje.plan_id != null) {
      await conn.rollback();
      return { ok: false, error: "Este viaje ya está vinculado a un plan.", status: 409 };
    }
    if (!ESTADOS_COMPATIBLES.includes(String(plan.estado))) {
      await conn.rollback();
      return {
        ok: false,
        error: `El plan está en estado "${plan.estado}", no compatible para vincular.`,
        status: 409,
      };
    }
    if (plan.piloto_empleado_id == null || Number(plan.piloto_empleado_id) !== Number(viaje.empleado_id)) {
      await conn.rollback();
      return { ok: false, error: "El piloto del plan no coincide con el piloto del viaje.", status: 409 };
    }
    if (plan.flota_vehiculo_id == null || Number(plan.flota_vehiculo_id) !== Number(viaje.vehiculo_id)) {
      await conn.rollback();
      return { ok: false, error: "La unidad del plan no coincide con la unidad del viaje.", status: 409 };
    }
    const fechaPlan = String(plan.fecha_plan).slice(0, 10);
    const fechaViaje = String(viaje.hora_salida).slice(0, 10);
    if (fechaPlan !== fechaViaje) {
      await conn.rollback();
      return { ok: false, error: "La fecha del plan no coincide con la fecha del viaje.", status: 409 };
    }

    // Un mismo plan no puede quedar "en ruta" simultáneamente vía dos
    // viajes técnicos distintos.
    const [otroViajeRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes
       WHERE plan_id = ? AND empresa_id = ? AND id <> ? AND estado = 'abierto' LIMIT 1`,
      [planId, empresaId, viajeId],
    );
    if (otroViajeRows[0]) {
      await conn.rollback();
      return { ok: false, error: "Este plan ya está vinculado a otro viaje en curso.", status: 409 };
    }

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE flota_viajes SET plan_id = ?
       WHERE id = ? AND empresa_id = ? AND plan_id IS NULL`,
      [planId, viajeId, empresaId],
    );
    if (!upd.affectedRows) {
      await conn.rollback();
      return {
        ok: false,
        error: "Este viaje ya fue vinculado por otra solicitud. Actualiza la pantalla.",
        status: 409,
      };
    }

    // Backfill idempotente: evidencia que el piloto ya había subido ANTES
    // de este vínculo y que nunca llegó a tms_evidencias (la causa raíz
    // original). Se reconoce "ya sincronizada" por ruta_relativa/
    // ruta_archivo — mismo criterio que ya usan
    // eliminarEvidenciaViaje/eliminarEvidenciaTms para saber que dos filas
    // son "la misma evidencia" entre ambas tablas — así que ejecutar esto
    // dos veces nunca duplica.
    const [evidencias] = await conn.query<RowDataPacket[]>(
      `SELECT id, tipo, ruta_relativa, nombre_original, latitud, longitud,
              capturado_en, subido_por, parada_id
       FROM flota_viaje_evidencias WHERE viaje_id = ? AND empresa_id = ?`,
      [viajeId, empresaId],
    ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);

    let sincronizadas = 0;
    for (const ev of evidencias) {
      const [yaExiste] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM tms_evidencias WHERE empresa_id = ? AND plan_id = ? AND ruta_archivo = ? LIMIT 1`,
        [empresaId, planId, String(ev.ruta_relativa)],
      );
      if (yaExiste[0]) continue; // ya sincronizada — no duplicar
      const tmsTipo = mapearSyncTmsTipo(String(ev.tipo));
      try {
        await conn.execute(
          `INSERT INTO tms_evidencias
            (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud,
             subido_por, parada_id, capturado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            empresaId, planId, tmsTipo, ev.ruta_relativa, ev.nombre_original,
            ev.latitud ?? null, ev.longitud ?? null, ev.subido_por ?? null,
            ev.parada_id ?? null, ev.capturado_en ?? null,
          ],
        );
      } catch {
        await conn.execute(
          `INSERT INTO tms_evidencias
            (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud, subido_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            empresaId, planId, tmsTipo, ev.ruta_relativa, ev.nombre_original,
            ev.latitud ?? null, ev.longitud ?? null, ev.subido_por ?? null,
          ],
        );
      }
      sincronizadas++;
    }

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      modulo: "tms",
      accion: "vincular_viaje_plan",
      detalle: `Plan #${planId} ${plan.codigo} · viaje técnico #${viajeId} vinculado manualmente por ${usuario} · piloto empleado #${viaje.empleado_id} · unidad vehículo #${viaje.vehiculo_id} · fecha ${fechaPlan} · ${sincronizadas} evidencia(s) sincronizada(s) a TMS`,
    });

    await conn.commit();
    return { ok: true, planCodigo: String(plan.codigo), evidenciasSincronizadas: sincronizadas };
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      descartada = true;
      conn.destroy();
      console.error("Rollback vincularViajeAPlan", rollbackError);
    }
    throw error;
  } finally {
    if (!descartada) conn.release();
  }
}
