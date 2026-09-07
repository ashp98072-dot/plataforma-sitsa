import type { RowDataPacket } from "mysql2";
import type { ResultSetHeader } from "mysql2/promise";
import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { ESTADOS_CIERRE_MANUAL } from "@/lib/tms/cierre-viaje-shared";

export { puedeCerrarManualmente } from "@/lib/tms/cierre-viaje-shared";

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
 * OPS-5.2d: "Cargado" (definición aprobada del negocio: el vehículo ya
 * fue cargado/preparado pero TODAVÍA no ha salido) sigue exactamente el
 * mismo criterio que "En ruta" — también puede cerrarse SI ya existe
 * llegada técnica registrada. Esto es compatibilidad/reparación de
 * casos históricos o anómalos (en el flujo normal, "Cargado" avanza a
 * "En ruta" en cuanto el piloto registra salida — ver marcarPlanEnRuta
 * en planes-salida.ts — así que el cierre normalmente llegará desde
 * "En ruta"); pero si un plan quedó en "Cargado" con llegada ya
 * registrada, no se obliga a editarlo artificialmente a "En ruta" solo
 * para poder cerrarlo. "Cargado" SIN llegada sigue sin poder cerrarse,
 * igual que "En ruta" sin llegada.
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
           p.estado IN ('En ruta', 'Cargado')
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
    // OPS-5.2d: "Cargado" sigue el mismo criterio que "En ruta" — si
    // llegó hasta aquí (no hizo match en el UPDATE de arriba) es porque
    // TODAVÍA no tiene llegada técnica registrada; nunca porque estar
    // "Cargado" en sí mismo sea insuficiente. Mismo mensaje para ambos
    // estados — evita el mensaje engañoso anterior ("solo se puede
    // cerrar cuando el piloto ya registró la llegada") que un plan
    // "Cargado" CON llegada ya registrada habría recibido antes de esta
    // corrección (ese caso ahora cierra directamente en el UPDATE, sin
    // llegar a este bloque).
    if ((estadoActual === "En ruta" || estadoActual === "Cargado") && !llegadaRegistrada) {
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

/**
 * TMS-CIERRE-OPERACIONES-1 — cierre MANUAL/forzado del plan por
 * Operaciones, sin depender de que el piloto haya completado el flujo del
 * portal (evidencia, marcajes, llegada). Decisiones de negocio ya
 * confirmadas (ver docs/TMS-CIERRE-OPERACIONES-1-DISCOVERY.md):
 *
 * - Mismo permiso `viajes_cerrar:editar` que el cierre normal — este
 *   módulo NO vuelve a verificarlo (responsabilidad del endpoint, igual
 *   que `cerrarViaje()`).
 * - Solo permitido desde "Programado" | "Cargado" | "En ruta" — nunca
 *   desde "Cerrado" ni "Cancelado".
 * - Si NO existe ningún `flota_viajes` para este plan: se cierra
 *   ÚNICAMENTE el plan. Nunca se crea una fila sintética en
 *   `flota_viajes` — sus columnas NOT NULL (`vehiculo_id`, `hora_salida`)
 *   representan un hecho físico real que aquí no existe, y fabricarlo
 *   corrompería km/lecturas/mantenimiento reales del vehículo.
 * - Si SÍ existe un `flota_viajes` "abierto" para este plan (el piloto
 *   salió pero nunca registró llegada): se fuerza también a "cerrado",
 *   para no dejar esa unidad bloqueada para su próxima salida — pero
 *   `km_llegada`/`hora_llegada` quedan EXACTAMENTE como estaban (NULL o
 *   lo último grabado, nunca inventados); solo se anota en
 *   `observaciones` que fue un cierre administrativo sin llegada real.
 * - Todo dentro de UNA transacción (a diferencia de `cerrarViaje()`, que
 *   es un único UPDATE atómico): aquí hay hasta 2 escrituras dependientes
 *   (flota_viajes + tms_planes_viaje) más la auditoría, y deben
 *   comprometerse juntas o no comprometerse ninguna.
 */

export type ResultadoCierreManual =
  | { ok: true; flotaViajeCerrado: boolean }
  | { ok: false; error: string };

/**
 * Estados canónicos ya existentes en el modelo (tms_planes_viaje.estado)
 * desde los que se admite cierre manual. Exportado para que la UI
 * (src/app/e/[slug]/tms/page.tsx y .../tms/reportes/page.tsx) use
 * EXACTAMENTE el mismo criterio que el backend al decidir si mostrar el
 * botón — nunca una lista duplicada que pueda divergir.
 */
export async function cerrarViajeManual(opts: {
  empresaId: number;
  planId: number;
  usuario: string;
  motivo: string;
  comentario?: string | null;
}): Promise<ResultadoCierreManual> {
  const motivo = (opts.motivo ?? "").trim();
  if (motivo.length < 5) {
    return { ok: false, error: "El motivo debe tener al menos 5 caracteres." };
  }
  if (motivo.length > 500) {
    return { ok: false, error: "El motivo no puede superar 500 caracteres." };
  }
  const comentario = (opts.comentario ?? "")?.trim() || null;
  if (comentario && comentario.length > 1000) {
    return { ok: false, error: "El comentario no puede superar 1000 caracteres." };
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [planRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [opts.planId, opts.empresaId],
    );
    const plan = planRows[0];
    if (!plan) {
      await conn.rollback();
      return { ok: false, error: "Viaje no encontrado." };
    }
    const estadoAnterior = String(plan.estado);
    if (!ESTADOS_CIERRE_MANUAL.includes(estadoAnterior as (typeof ESTADOS_CIERRE_MANUAL)[number])) {
      await conn.rollback();
      if (estadoAnterior === "Cerrado") {
        return { ok: false, error: "Este viaje ya fue cerrado." };
      }
      if (estadoAnterior === "Cancelado") {
        return { ok: false, error: "Este viaje está cancelado; no admite cierre manual." };
      }
      return { ok: false, error: `Este viaje está "${estadoAnterior}"; no admite cierre manual.` };
    }

    // Buscar flota_viajes asociado — puede no existir (caso crítico del
    // ticket) o existir ya cerrado (llegada real ya registrada, aunque el
    // plan por alguna razón no se cerró todavía) o existir "abierto".
    const [flotaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado FROM flota_viajes WHERE plan_id = ? AND empresa_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [opts.planId, opts.empresaId],
    );
    const flotaViaje = flotaRows[0];
    let flotaViajeCerrado = false;
    if (flotaViaje && String(flotaViaje.estado) === "abierto") {
      // Transición MÍNIMA: solo el estado + una anotación de texto. Nunca
      // se tocan km_llegada/hora_llegada — quedan NULL, exactamente como
      // ya estaban, para no fabricar un dato físico que nunca ocurrió.
      await conn.execute<ResultSetHeader>(
        `UPDATE flota_viajes
         SET estado = 'cerrado',
             observaciones = TRIM(CONCAT_WS(' ', observaciones, '[Cierre manual por Operaciones — sin llegada física registrada.]'))
         WHERE id = ? AND empresa_id = ? AND estado = 'abierto'`,
        [flotaViaje.id, opts.empresaId],
      );
      flotaViajeCerrado = true;
    }

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE tms_planes_viaje
       SET estado = 'Cerrado', cerrado_por = ?, cerrado_en = NOW(),
           cierre_manual = 1, cierre_manual_motivo = ?, cierre_manual_comentario = ?
       WHERE id = ? AND empresa_id = ? AND estado IN ('Programado', 'Cargado', 'En ruta')`,
      [opts.usuario, motivo, comentario, opts.planId, opts.empresaId],
    );
    if (upd.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false, error: "El viaje cambió de estado durante la operación. Vuelve a intentarlo." };
    }

    await registrarAuditoriaTx(conn, {
      empresaId: opts.empresaId,
      usuario: opts.usuario,
      accion: "cerrar_viaje_manual",
      modulo: "tms",
      detalle: `Plan #${opts.planId} → Cerrado (CIERRE MANUAL POR OPERACIONES`
        + `${flotaViaje ? "" : " — SIN VIAJE FÍSICO REGISTRADO"}). `
        + `Estado anterior: ${estadoAnterior}. Motivo: ${motivo}.`
        + `${comentario ? ` Comentario: ${comentario}.` : ""}`
        + `${flotaViaje ? ` flota_viajes #${flotaViaje.id} ${flotaViajeCerrado ? "cerrado también (sin datos físicos)" : "ya estaba cerrado"}.` : ""}`,
    });

    await conn.commit();
    return { ok: true, flotaViajeCerrado };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
