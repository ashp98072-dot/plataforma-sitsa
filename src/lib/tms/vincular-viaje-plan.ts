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
 * ÚLTIMA CORRECCIÓN P1 (unificación de autoridad de vínculo): de dónde
 * viene la solicitud de vínculo — usado SOLO para que la auditoría y los
 * mensajes sean correctos (nunca decir "vinculado manualmente" para algo
 * que decidió el sistema, ni al revés). La regla de integridad
 * (exclusividad plan↔viaje, transacción, backfill) es LA MISMA para
 * ambos orígenes — nunca dos implementaciones de concurrencia distintas.
 * - "AUTO_PORTAL": lo dispara el propio Portal del piloto al subir
 *   evidencia con un candidato único y seguro — solo escribe
 *   flota_viajes.plan_id, nunca estado administrativo, así que no viola
 *   "el piloto nunca cierra/cancela/modifica estado".
 * - "MANUAL_OPERACIONES": lo dispara un usuario administrativo desde
 *   Programación/TMS (POST /tms/planes/[id]/vincular-viaje).
 */
export type OrigenVinculo = "AUTO_PORTAL" | "MANUAL_OPERACIONES";

/**
 * true SOLO si el error es específicamente "columna desconocida"
 * (ER_BAD_FIELD_ERROR / errno 1054) — mismo criterio ya usado en
 * src/lib/rrhh/empleados.ts (esColumnaDesconocida) para decidir cuándo es
 * seguro degradar a un INSERT sin una columna aditiva que quizá no se
 * haya migrado en este entorno todavía (p.ej. tms_evidencias.parada_id,
 * que sql/schema.sql no define — ver comentario en el INSERT de abajo).
 * Cualquier OTRO error (FK, constraint, conexión, dato inválido, etc.)
 * NO debe camuflarse como "hay que degradar" — debe abortar toda la
 * transacción (se relanza y el catch exterior hace rollback).
 */
function esColumnaDesconocida(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_BAD_FIELD_ERROR" || err?.errno === 1054;
}

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
    `SELECT p.estado, p.fecha_plan, pil.id_empleado AS piloto_empleado_id, u.flota_vehiculo_id
     FROM tms_planes_viaje p
     INNER JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [planId, empresaId],
  );
  const plan = planRows[0];
  if (!plan || plan.piloto_empleado_id == null || plan.flota_vehiculo_id == null) return [];
  // P2 (revisión de integridad PR #107): no ofrecer en la UI un vínculo
  // que POST rechazaría de inmediato — mismo criterio de estado que
  // vincularViajeAPlan (Cerrado/Cancelado/cualquier otro nunca son
  // candidatos vinculables).
  if (!ESTADOS_COMPATIBLES.includes(String(plan.estado))) return [];
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

/**
 * ÚLTIMA CORRECCIÓN P1 (unificación de autoridad de vínculo): mismo
 * criterio estricto que listarViajesCandidatosParaPlan, pero en la
 * dirección inversa (dado un viaje técnico sin plan_id, busca el ÚNICO
 * plan candidato) — es la búsqueda que antes vivía embebida en
 * api/portal/viajes/[id]/evidencias/route.ts. Es una lectura NO
 * transaccional (best-effort): la autoridad real de "sigue siendo válido
 * y sigue siendo el único" la revalida vincularViajeAPlan bajo FOR UPDATE
 * dentro de su propia transacción — así que una carrera aquí es inocua,
 * nunca produce un vínculo incorrecto.
 */
export async function buscarPlanCandidatoUnicoParaViaje(
  empresaId: number,
  viajeId: number,
): Promise<number | null> {
  const viajeRows = await query<RowDataPacket[]>(
    `SELECT v.empleado_id, v.vehiculo_id, v.hora_salida
     FROM flota_viajes v WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
    [viajeId, empresaId],
  );
  const viaje = viajeRows[0];
  if (!viaje || viaje.empleado_id == null || viaje.vehiculo_id == null || !viaje.hora_salida) return null;
  const fechaViaje = String(viaje.hora_salida).slice(0, 10);
  const candidatos = await query<RowDataPacket[]>(
    `SELECT p.id FROM tms_planes_viaje p
     INNER JOIN tms_personal pil ON pil.id = p.piloto_id
     INNER JOIN tms_unidades u ON u.id = p.unidad_id
     WHERE p.empresa_id = ?
       AND pil.id_empleado = ?
       AND u.flota_vehiculo_id = ?
       AND p.fecha_plan = ?
       AND p.estado IN (${ESTADOS_COMPATIBLES.map(() => "?").join(",")})
     LIMIT 2`,
    [empresaId, Number(viaje.empleado_id), Number(viaje.vehiculo_id), fechaViaje, ...ESTADOS_COMPATIBLES],
  );
  return candidatos.length === 1 ? Number(candidatos[0].id) : null;
}

export async function vincularViajeAPlan(
  empresaId: number,
  planId: number,
  viajeId: number,
  usuario: string,
  origen: OrigenVinculo,
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

    // P1 (revisión de integridad PR #107): un plan administrativo
    // corresponde a UN viaje técnico — sin filtrar por estado. Antes esto
    // solo bloqueaba si el otro viaje seguía "abierto", lo que permitía
    // que un plan ya vinculado a un viaje YA CERRADO se volviera a
    // vincular a un viaje técnico distinto (dos flota_viajes apuntando al
    // mismo plan a la vez, uno cerrado y otro nuevo). La fila del plan ya
    // está bloqueada (FOR UPDATE, arriba) desde el inicio de esta
    // transacción — dos solicitudes de vínculo concurrentes para el MISMO
    // plan se serializan en ese lock, así que este SELECT siempre ve el
    // estado real y consistente, sin necesitar su propio FOR UPDATE.
    const [otroViajeRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes
       WHERE plan_id = ? AND empresa_id = ? AND id <> ? LIMIT 1`,
      [planId, empresaId, viajeId],
    );
    if (otroViajeRows[0]) {
      await conn.rollback();
      return { ok: false, error: "Este plan ya está vinculado a otro viaje técnico.", status: 409 };
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
    //
    // P0 (revisión de integridad PR #107): esta lectura YA NO atrapa su
    // propio error. El vínculo de plan_id y el backfill son UNA sola
    // operación administrativa coherente — si esta consulta falla por
    // cualquier motivo, NO se asume "cero evidencias" ni se continúa: el
    // error se propaga al catch exterior, que hace rollback de TODA la
    // transacción (incluido el UPDATE de plan_id ya ejecutado arriba).
    const [evidencias] = await conn.query<RowDataPacket[]>(
      `SELECT id, tipo, ruta_relativa, nombre_original, latitud, longitud,
              capturado_en, subido_por, parada_id
       FROM flota_viaje_evidencias WHERE viaje_id = ? AND empresa_id = ?`,
      [viajeId, empresaId],
    );

    let sincronizadas = 0;
    for (const ev of evidencias) {
      const [yaExiste] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM tms_evidencias WHERE empresa_id = ? AND plan_id = ? AND ruta_archivo = ? LIMIT 1`,
        [empresaId, planId, String(ev.ruta_relativa)],
      );
      if (yaExiste[0]) continue; // ya sincronizada — no duplicar
      const tmsTipo = mapearSyncTmsTipo(String(ev.tipo));
      // P0/P1 (revisión de integridad PR #107): el INSERT completo ya no
      // tiene un catch genérico que oculte cualquier error SQL (FK,
      // constraint, conexión, dato inválido...) detrás de un segundo
      // INSERT "reducido". Solo se degrada ante el error ESPECÍFICO y
      // demostrable de columna inexistente (esColumnaDesconocida) —
      // relevante porque sql/schema.sql no define tms_evidencias.parada_id
      // (columna aditiva que puede no existir todavía en algún entorno,
      // igual que otras columnas aditivas de este proyecto). Cualquier
      // otro error se relanza tal cual, sin intentar un segundo INSERT.
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
      } catch (err) {
        if (!esColumnaDesconocida(err)) throw err;
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

    // ÚLTIMA CORRECCIÓN P1: la auditoría distingue el origen real — nunca
    // "vinculado manualmente" para algo que decidió el propio sistema al
    // subir evidencia, ni al revés.
    const accion = origen === "AUTO_PORTAL" ? "vincular_viaje_plan_auto" : "vincular_viaje_plan";
    const comoTexto = origen === "AUTO_PORTAL"
      ? `vinculado automáticamente por el sistema al subir evidencia (colaborador: ${usuario})`
      : `vinculado manualmente por ${usuario}`;
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      modulo: "tms",
      accion,
      detalle: `Plan #${planId} ${plan.codigo} · viaje técnico #${viajeId} ${comoTexto} · piloto empleado #${viaje.empleado_id} · unidad vehículo #${viaje.vehiculo_id} · fecha ${fechaPlan} · ${sincronizadas} evidencia(s) sincronizada(s) a TMS`,
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
