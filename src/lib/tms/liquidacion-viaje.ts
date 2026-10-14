import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorDominioFormulario, type EstadoDominio } from "@/lib/validacion-formulario";
import {
  ESTADOS_PLAN_SIN_LIQUIDACION,
  ESTADOS_PLAN_SIN_REAPERTURA,
  motivoPlanNoLiquidable,
  MOTIVO_REAPERTURA_MAX,
  MOTIVO_REAPERTURA_MIN,
  OBSERVACION_LIQUIDACION_MAX,
  OBSERVACION_REPORTE_MAX,
  normalizarFechaIso,
  type SnapshotEventoLiquidacion,
  type CodigoAdvertenciaReporte,
  type ResumenLiquidacionFila,
  type EstadoLiquidacionViaje,
  type TipoEventoLiquidacion,
} from "./liquidacion-viaje-shared";
import { construirSnapshotOperativo } from "./liquidacion-viaje-snapshot";

/**
 * TMS — LIQUIDACIÓN DE VIAJES, FASE 1: modelo persistente mínimo, eventos auditables y activación por empresa.
 *
 * ALCANCE (Fase 1): solo transiciones del estado de liquidación y su historia. NO hay rutas ni UI que lo expongan, NO se
 * modifica el cierre (`cierre-viaje*`), facturación, fondos, gastos, cuadrilla, FEL ni contabilidad, y NO se escribe nada
 * en `tms_planes_viaje` (este módulo solo LEE `estado`, `fecha_plan` y `tarifa_comercial` del plan, bajo lock).
 *
 * Permisos: NO se verifican aquí (responsabilidad del endpoint de fases posteriores, igual que `cerrarViaje`); en Fase 1 no
 * hay endpoint, por lo que no se declara ni concede ningún permiso nuevo.
 *
 *   (sin fila) ──confirmarReporteRecibido──▶ REPORTE_RECIBIDO ──liquidarViaje──▶ LIQUIDADO
 *   LIQUIDADO ──reabrirLiquidacion(motivo)──▶ EN_AJUSTE ──liquidarViaje (RELIQUIDADO)──▶ LIQUIDADO
 *
 * Concurrencia: todas las transiciones bloquean primero la fila del PLAN (`FOR UPDATE`, mismo orden que tomará el cierre en
 * la Fase 5: plan → liquidación) y luego la liquidación; la fila se actualiza con `WHERE version = ? AND estado = ?`.
 * `UNIQUE (empresa_id, plan_id)` y `UNIQUE (empresa_id, plan_id, version)` de eventos son la garantía final.
 */

export type CodigoErrorLiquidacion =
  | "NO_ENCONTRADO"
  | "PLAN_NO_ADMITE"
  | "PLAN_NO_CERRADO"
  | "ESTADO_NO_PERMITE"
  | "CONFLICTO_VERSION"
  | "SOLICITUD_INVALIDA";

/** Error de dominio seguro de mostrar (mensaje redactado para el usuario). */
export class ErrorLiquidacionViaje extends ErrorDominioFormulario {
  readonly codigoLiquidacion: CodigoErrorLiquidacion;
  constructor(codigo: CodigoErrorLiquidacion, message: string, status: EstadoDominio = 409) {
    super(message, status);
    this.name = "ErrorLiquidacionViaje";
    this.codigoLiquidacion = codigo;
  }
}

export type ActorLiquidacion = { empresaId: number; usuarioId: number; usuario: string };

export type LiquidacionViaje = {
  id: number;
  empresaId: number;
  planId: number;
  estado: EstadoLiquidacionViaje;
  version: number;
  reporteRecibidoEn: string;
  reporteRecibidoPor: number;
  liquidadoEn: string | null;
  liquidadoPor: number | null;
  reabiertoEn: string | null;
  reabiertoPor: number | null;
};

export type EventoLiquidacionViaje = {
  id: number;
  planId: number;
  version: number;
  tipo: TipoEventoLiquidacion;
  estadoAntes: EstadoLiquidacionViaje | null;
  estadoDespues: EstadoLiquidacionViaje;
  actorId: number;
  detalle: string | null;
  snapshot: SnapshotEventoLiquidacion | null;
  creadoEn: string;
};

export type ResultadoTransicionLiquidacion = {
  liquidacion: LiquidacionViaje;
  /** Evento creado por ESTA llamada; null si fue una réplica idempotente (no se escribió nada). */
  evento: TipoEventoLiquidacion | null;
  idempotente: boolean;
};

const FMT_DT = "%Y-%m-%d %H:%i:%s";
const COLS_LIQ = `id, empresa_id, plan_id, estado, version,
  DATE_FORMAT(reporte_recibido_en, '${FMT_DT}') AS reporte_recibido_en, reporte_recibido_por,
  DATE_FORMAT(liquidado_en, '${FMT_DT}') AS liquidado_en, liquidado_por,
  DATE_FORMAT(reabierto_en, '${FMT_DT}') AS reabierto_en, reabierto_por`;

interface FilaLiq extends RowDataPacket {
  id: number; empresa_id: number; plan_id: number; estado: EstadoLiquidacionViaje; version: number;
  reporte_recibido_en: string; reporte_recibido_por: number; liquidado_en: string | null; liquidado_por: number | null;
  reabierto_en: string | null; reabierto_por: number | null;
}
interface FilaPlan extends RowDataPacket { estado: string; fecha_plan: string | null; tarifa_comercial: string | null }

const aLiquidacion = (r: FilaLiq): LiquidacionViaje => ({
  id: Number(r.id),
  empresaId: Number(r.empresa_id),
  planId: Number(r.plan_id),
  estado: r.estado,
  version: Number(r.version),
  reporteRecibidoEn: r.reporte_recibido_en,
  reporteRecibidoPor: Number(r.reporte_recibido_por),
  liquidadoEn: r.liquidado_en,
  liquidadoPor: r.liquidado_por == null ? null : Number(r.liquidado_por),
  reabiertoEn: r.reabierto_en,
  reabiertoPor: r.reabierto_por == null ? null : Number(r.reabierto_por),
});

async function transaccion<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await getPool().getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    try {
      await c.rollback();
    } catch {
      c.destroy();
    }
    throw e;
  } finally {
    c.release();
  }
}

/** Primer lock de TODA transición: el plan, acotado por empresa (otra empresa = «no encontrado»). Solo lectura. */
async function bloquearPlan(c: PoolConnection, empresaId: number, planId: number): Promise<FilaPlan> {
  const [r] = await c.query<FilaPlan[]>(
    `SELECT estado, DATE_FORMAT(fecha_plan, '%Y-%m-%d') AS fecha_plan, tarifa_comercial
       FROM tms_planes_viaje WHERE empresa_id = ? AND id = ? FOR UPDATE`,
    [empresaId, planId],
  );
  if (!r[0]) throw new ErrorLiquidacionViaje("NO_ENCONTRADO", "Viaje no encontrado.", 404);
  return r[0];
}

function exigirPlanAdmite(plan: FilaPlan): void {
  if ((ESTADOS_PLAN_SIN_LIQUIDACION as readonly string[]).includes(plan.estado)) {
    throw new ErrorLiquidacionViaje("PLAN_NO_ADMITE", `Un viaje "${plan.estado}" ya no admite cambios de liquidación.`);
  }
}

/**
 * LIQUIDAR / RE-LIQUIDAR exige el viaje CERRADO (secuencia real: reporte → ajustes/cargos → cerrar → liquidar). Validación
 * definitiva del servidor, bajo el lock del plan; ocultar el botón en la UI no basta.
 */
function exigirPlanCerrado(plan: FilaPlan): void {
  const motivo = motivoPlanNoLiquidable(plan.estado);
  if (!motivo) return;
  if (plan.estado === "Cancelado") throw new ErrorLiquidacionViaje("PLAN_NO_ADMITE", motivo);
  throw new ErrorLiquidacionViaje("PLAN_NO_CERRADO", motivo);
}

/** Reabrir: permitido con el viaje Cerrado (la liquidación ocurre ya cerrado) o abierto (datos previos a esta regla); no Cancelado. */
function exigirPlanReabrible(plan: FilaPlan): void {
  if ((ESTADOS_PLAN_SIN_REAPERTURA as readonly string[]).includes(plan.estado)) {
    throw new ErrorLiquidacionViaje("PLAN_NO_ADMITE", `Un viaje "${plan.estado}" ya no admite cambios de liquidación.`);
  }
}

async function leerLiquidacionTx(c: PoolConnection, empresaId: number, planId: number): Promise<LiquidacionViaje | null> {
  const [r] = await c.query<FilaLiq[]>(
    `SELECT ${COLS_LIQ} FROM tms_viaje_liquidaciones WHERE empresa_id = ? AND plan_id = ? FOR UPDATE`,
    [empresaId, planId],
  );
  return r[0] ? aLiquidacion(r[0]) : null;
}

async function insertarEvento(
  c: PoolConnection,
  actor: ActorLiquidacion,
  plan: FilaPlan,
  e: {
    planId: number; version: number; tipo: TipoEventoLiquidacion; antes: EstadoLiquidacionViaje | null;
    despues: EstadoLiquidacionViaje; detalle: string | null;
    /** Fotografía operativa y datos de la liquidación (solo LIQUIDADO/RELIQUIDADO). Se agregan al snapshot mínimo de siempre. */
    snapshotExtra?: Pick<SnapshotEventoLiquidacion, "operativo" | "liquidacion">;
  },
): Promise<void> {
  const base: SnapshotEventoLiquidacion = { planEstado: plan.estado, fechaPlan: plan.fecha_plan, tarifaComercial: plan.tarifa_comercial };
  const snapshot = JSON.stringify({ ...base, ...(e.snapshotExtra ?? {}) });
  await c.execute(
    `INSERT INTO tms_viaje_liquidacion_eventos
       (empresa_id, plan_id, version, tipo, estado_antes, estado_despues, actor_id, detalle, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [actor.empresaId, e.planId, e.version, e.tipo, e.antes, e.despues, actor.usuarioId, e.detalle, snapshot],
  );
  await registrarAuditoriaTx(c, {
    empresaId: actor.empresaId,
    usuario: actor.usuario,
    accion: `liquidacion_viaje_${e.tipo.toLowerCase()}`,
    modulo: "tms",
    detalle: `Plan #${e.planId} · liquidación v${e.version}: ${e.antes ?? "—"} → ${e.despues}${e.detalle ? ` · ${e.detalle}` : ""}`,
  });
}

function validarVersionEsperada(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", "Falta la versión de la liquidación que se está modificando.", 400);
  }
  return v;
}

/**
 * Confirma que el piloto entregó su reporte (confirmación HUMANA; no implica llegada registrada). Crea la liquidación en
 * `REPORTE_RECIBIDO` (versión 1). Idempotente: si ya está en `REPORTE_RECIBIDO` devuelve la existente sin evento nuevo.
 */
export async function confirmarReporteRecibido(
  actor: ActorLiquidacion,
  entrada: { planId: number; observacion?: string | null; advertenciasReconocidas?: CodigoAdvertenciaReporte[] },
): Promise<ResultadoTransicionLiquidacion> {
  const observacionLimpia = (entrada.observacion ?? "").trim() || null;
  if (observacionLimpia && observacionLimpia.length > OBSERVACION_REPORTE_MAX) {
    throw new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", `La observación no puede superar ${OBSERVACION_REPORTE_MAX} caracteres.`, 400);
  }
  // Las advertencias reconocidas quedan en el evento (D02). El detalle es VARCHAR(500): nunca se trunca una observación en silencio.
  const reconocidas = [...new Set(entrada.advertenciasReconocidas ?? [])];
  const sufijo = reconocidas.length ? `[Advertencias reconocidas: ${reconocidas.join(", ")}]` : "";
  const observacion = [observacionLimpia, sufijo].filter(Boolean).join(" ") || null;
  if (observacion && observacion.length > OBSERVACION_REPORTE_MAX) {
    throw new ErrorLiquidacionViaje(
      "SOLICITUD_INVALIDA",
      `La observación es demasiado larga (máximo ${OBSERVACION_REPORTE_MAX - sufijo.length - 1} caracteres con advertencias reconocidas).`,
      400,
    );
  }
  return transaccion(async (c) => {
    const plan = await bloquearPlan(c, actor.empresaId, entrada.planId);
    const actual = await leerLiquidacionTx(c, actor.empresaId, entrada.planId);
    // Réplica ANTES de la regla de estado del plan: con la secuencia real el viaje puede cerrarse estando en REPORTE_RECIBIDO,
    // y un reintento posterior debe devolver la misma liquidación (no un error).
    if (actual) {
      if (actual.estado === "REPORTE_RECIBIDO") return { liquidacion: actual, evento: null, idempotente: true };
      throw new ErrorLiquidacionViaje("ESTADO_NO_PERMITE", `El viaje ya tiene una liquidación en estado ${actual.estado}.`);
    }
    exigirPlanAdmite(plan);
    await c.execute(
      `INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por)
       VALUES (?, ?, 'REPORTE_RECIBIDO', 1, NOW(), ?)`,
      [actor.empresaId, entrada.planId, actor.usuarioId],
    );
    await insertarEvento(c, actor, plan, {
      planId: entrada.planId, version: 1, tipo: "REPORTE_RECIBIDO", antes: null, despues: "REPORTE_RECIBIDO", detalle: observacion,
    });
    const creada = (await leerLiquidacionTx(c, actor.empresaId, entrada.planId))!;
    return { liquidacion: creada, evento: "REPORTE_RECIBIDO", idempotente: false };
  });
}

/**
 * `REPORTE_RECIBIDO → LIQUIDADO` (evento LIQUIDADO) o `EN_AJUSTE → LIQUIDADO` (evento RELIQUIDADO). Exige la versión que el
 * usuario vio (`versionEsperada`): una versión vieja es CONFLICTO_VERSION. Réplica idempotente: mismo actor, versión + 1.
 *
 * REGLA DE SECUENCIA: solo un viaje CERRADO puede pasar a LIQUIDADO/RELIQUIDADO (PLAN_NO_CERRADO si está abierto).
 *
 * FASE 3: al liquidar/re-liquidar el evento guarda en `snapshot_json` una fotografía OPERATIVA inmutable del viaje
 * (liquidacion-viaje-snapshot.ts; solo lectura, bajo el lock del plan). La liquidación NO modifica Programación, no cierra el
 * viaje y no crea costos, cargos ni facturación.
 */
export async function liquidarViaje(
  actor: ActorLiquidacion,
  entrada: { planId: number; versionEsperada: number; observacion?: string | null },
): Promise<ResultadoTransicionLiquidacion> {
  const esperada = validarVersionEsperada(entrada.versionEsperada);
  const observacion = (entrada.observacion ?? "").trim() || null;
  if (observacion && observacion.length > OBSERVACION_LIQUIDACION_MAX) {
    throw new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", `La observación no puede superar ${OBSERVACION_LIQUIDACION_MAX} caracteres.`, 400);
  }
  return transaccion(async (c) => {
    const plan = await bloquearPlan(c, actor.empresaId, entrada.planId);
    exigirPlanCerrado(plan);
    const actual = await leerLiquidacionTx(c, actor.empresaId, entrada.planId);
    if (!actual) throw new ErrorLiquidacionViaje("NO_ENCONTRADO", "El viaje no tiene un reporte recibido que liquidar.", 404);
    if (actual.estado === "LIQUIDADO" && actual.version === esperada + 1 && actual.liquidadoPor === actor.usuarioId) {
      return { liquidacion: actual, evento: null, idempotente: true };
    }
    if (actual.version !== esperada) {
      throw new ErrorLiquidacionViaje("CONFLICTO_VERSION", "La liquidación cambió mientras la revisabas. Recarga e inténtalo de nuevo.");
    }
    if (actual.estado === "LIQUIDADO") throw new ErrorLiquidacionViaje("ESTADO_NO_PERMITE", "El viaje ya está liquidado.");
    const tipo: TipoEventoLiquidacion = actual.estado === "EN_AJUSTE" ? "RELIQUIDADO" : "LIQUIDADO";
    // Fotografía operativa (SOLO LECTURA, bajo el lock del plan): evidencia de cómo quedó el viaje al liquidar.
    const operativo = await construirSnapshotOperativo(c, actor.empresaId, entrada.planId);
    if (!operativo) throw new ErrorLiquidacionViaje("NO_ENCONTRADO", "Viaje no encontrado.", 404);
    let reaperturaPrevia: NonNullable<SnapshotEventoLiquidacion["liquidacion"]>["reaperturaPrevia"] = null;
    if (actual.estado === "EN_AJUSTE") {
      const [rea] = await c.query<(RowDataPacket & { version: number; actor_id: number; detalle: string | null; creado_en: string })[]>(
        `SELECT version, actor_id, detalle, DATE_FORMAT(creado_en, '${FMT_DT}') AS creado_en
           FROM tms_viaje_liquidacion_eventos
          WHERE empresa_id = ? AND plan_id = ? AND tipo = 'REABIERTO' ORDER BY version DESC LIMIT 1`,
        [actor.empresaId, entrada.planId],
      );
      if (rea[0]) {
        reaperturaPrevia = { version: Number(rea[0].version), actorId: Number(rea[0].actor_id), motivo: rea[0].detalle, creadoEn: rea[0].creado_en };
      }
    }
    const [r] = await c.execute<ResultSetHeader>(
      `UPDATE tms_viaje_liquidaciones
          SET estado = 'LIQUIDADO', version = version + 1, liquidado_en = NOW(), liquidado_por = ?
        WHERE empresa_id = ? AND plan_id = ? AND version = ? AND estado = ?`,
      [actor.usuarioId, actor.empresaId, entrada.planId, actual.version, actual.estado],
    );
    if (r.affectedRows !== 1) throw new ErrorLiquidacionViaje("CONFLICTO_VERSION", "La liquidación cambió durante la operación.");
    await insertarEvento(c, actor, plan, {
      planId: entrada.planId, version: actual.version + 1, tipo, antes: actual.estado, despues: "LIQUIDADO", detalle: observacion,
      snapshotExtra: {
        operativo,
        liquidacion: {
          version: actual.version + 1,
          transicion: tipo === "RELIQUIDADO" ? "RELIQUIDADO" : "LIQUIDADO",
          estadoAntes: actual.estado,
          liquidadoPor: actor.usuarioId,
          liquidadoPorUsuario: actor.usuario,
          reporteRecibidoEn: actual.reporteRecibidoEn,
          reporteRecibidoPor: actual.reporteRecibidoPor,
          reaperturaPrevia,
        },
      },
    });
    return { liquidacion: (await leerLiquidacionTx(c, actor.empresaId, entrada.planId))!, evento: tipo, idempotente: false };
  });
}

/**
 * `LIQUIDADO → EN_AJUSTE` con motivo obligatorio (≥ 5 caracteres). Nunca borra ni reescribe la liquidación anterior:
 * agrega un evento REABIERTO y sube la versión. Solo si el plan no está `Cerrado`/`Cancelado`.
 */
export async function reabrirLiquidacion(
  actor: ActorLiquidacion,
  entrada: { planId: number; versionEsperada: number; motivo: string },
): Promise<ResultadoTransicionLiquidacion> {
  const esperada = validarVersionEsperada(entrada.versionEsperada);
  const motivo = (entrada.motivo ?? "").trim();
  if (motivo.length < MOTIVO_REAPERTURA_MIN) {
    throw new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", `El motivo debe tener al menos ${MOTIVO_REAPERTURA_MIN} caracteres.`, 400);
  }
  if (motivo.length > MOTIVO_REAPERTURA_MAX) {
    throw new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", `El motivo no puede superar ${MOTIVO_REAPERTURA_MAX} caracteres.`, 400);
  }
  return transaccion(async (c) => {
    const plan = await bloquearPlan(c, actor.empresaId, entrada.planId);
    exigirPlanReabrible(plan);
    const actual = await leerLiquidacionTx(c, actor.empresaId, entrada.planId);
    if (!actual) throw new ErrorLiquidacionViaje("NO_ENCONTRADO", "El viaje no tiene una liquidación que reabrir.", 404);
    if (actual.estado === "EN_AJUSTE" && actual.version === esperada + 1 && actual.reabiertoPor === actor.usuarioId) {
      return { liquidacion: actual, evento: null, idempotente: true };
    }
    if (actual.version !== esperada) {
      throw new ErrorLiquidacionViaje("CONFLICTO_VERSION", "La liquidación cambió mientras la revisabas. Recarga e inténtalo de nuevo.");
    }
    if (actual.estado !== "LIQUIDADO") {
      throw new ErrorLiquidacionViaje("ESTADO_NO_PERMITE", `Solo una liquidación LIQUIDADA puede reabrirse (estado actual: ${actual.estado}).`);
    }
    const [r] = await c.execute<ResultSetHeader>(
      `UPDATE tms_viaje_liquidaciones
          SET estado = 'EN_AJUSTE', version = version + 1, reabierto_en = NOW(), reabierto_por = ?
        WHERE empresa_id = ? AND plan_id = ? AND version = ? AND estado = 'LIQUIDADO'`,
      [actor.usuarioId, actor.empresaId, entrada.planId, actual.version],
    );
    if (r.affectedRows !== 1) throw new ErrorLiquidacionViaje("CONFLICTO_VERSION", "La liquidación cambió durante la operación.");
    await insertarEvento(c, actor, plan, {
      planId: entrada.planId, version: actual.version + 1, tipo: "REABIERTO", antes: "LIQUIDADO", despues: "EN_AJUSTE", detalle: motivo,
    });
    return { liquidacion: (await leerLiquidacionTx(c, actor.empresaId, entrada.planId))!, evento: "REABIERTO", idempotente: false };
  });
}

// ─────────────────────────────────────── lecturas ───────────────────────────────────────

/** Liquidación VIGENTE del viaje, acotada por empresa; null = «sin liquidación registrada». */
export async function leerLiquidacionPlan(empresaId: number, planId: number): Promise<LiquidacionViaje | null> {
  const [r] = await getPool().query<FilaLiq[]>(
    `SELECT ${COLS_LIQ} FROM tms_viaje_liquidaciones WHERE empresa_id = ? AND plan_id = ?`,
    [empresaId, planId],
  );
  return r[0] ? aLiquidacion(r[0]) : null;
}

/** Historia completa (append-only), de la más antigua a la más reciente. */
export async function listarEventosLiquidacion(empresaId: number, planId: number): Promise<EventoLiquidacionViaje[]> {
  const [r] = await getPool().query<(RowDataPacket & {
    id: number; plan_id: number; version: number; tipo: TipoEventoLiquidacion; estado_antes: EstadoLiquidacionViaje | null;
    estado_despues: EstadoLiquidacionViaje; actor_id: number; detalle: string | null; snapshot_json: string | null; creado_en: string;
  })[]>(
    `SELECT id, plan_id, version, tipo, estado_antes, estado_despues, actor_id, detalle, snapshot_json,
            DATE_FORMAT(creado_en, '${FMT_DT}') AS creado_en
       FROM tms_viaje_liquidacion_eventos WHERE empresa_id = ? AND plan_id = ? ORDER BY version ASC, id ASC`,
    [empresaId, planId],
  );
  return r.map((e) => ({
    id: Number(e.id),
    planId: Number(e.plan_id),
    version: Number(e.version),
    tipo: e.tipo,
    estadoAntes: e.estado_antes,
    estadoDespues: e.estado_despues,
    actorId: Number(e.actor_id),
    detalle: e.detalle,
    snapshot: e.snapshot_json ? (JSON.parse(e.snapshot_json) as EventoLiquidacionViaje["snapshot"]) : null,
    creadoEn: e.creado_en,
  }));
}

/**
 * Fecha de activación de la liquidación para la empresa (`YYYY-MM-DD`) o null. LECTURA SEGURA para la Fase 5: sin fila, con
 * fecha NULL o si las tablas de Fase 1 aún no existen en este entorno, devuelve null (= la liquidación NO se exige y el
 * sistema se comporta exactamente como antes). Cualquier OTRO error de BD se propaga: no se oculta una falla real.
 */
export async function obtenerFechaActivacionLiquidacion(
  empresaId: number,
  conexion: Pick<PoolConnection, "query"> = getPool(),
): Promise<string | null> {
  try {
    const [r] = await conexion.query<(RowDataPacket & { f: string | null })[]>(
      `SELECT DATE_FORMAT(fecha_activacion_liquidacion, '%Y-%m-%d') AS f FROM tms_liquidacion_config WHERE empresa_id = ?`,
      [empresaId],
    );
    return r[0]?.f ?? null;
  } catch (e) {
    if ((e as { errno?: number }).errno === 1146) return null; // ER_NO_SUCH_TABLE: migración aún no aplicada
    throw e;
  }
}

/**
 * Fija o limpia (null) la fecha de activación de la empresa. Operación interna/administrativa (sin endpoint en Fase 1):
 * el llamador verifica el permiso. Queda auditada con el valor anterior y el nuevo. No toca viajes ni liquidaciones.
 */
export async function configurarFechaActivacionLiquidacion(
  actor: ActorLiquidacion,
  fecha: string | null,
): Promise<{ anterior: string | null; actual: string | null }> {
  const actual = fecha === null ? null : normalizarFechaIso(fecha);
  if (fecha !== null && actual === null) {
    throw new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", "La fecha de activación debe tener formato YYYY-MM-DD válido.", 400);
  }
  return transaccion(async (c) => {
    const [prev] = await c.query<(RowDataPacket & { f: string | null })[]>(
      `SELECT DATE_FORMAT(fecha_activacion_liquidacion, '%Y-%m-%d') AS f FROM tms_liquidacion_config WHERE empresa_id = ? FOR UPDATE`,
      [actor.empresaId],
    );
    const anterior = prev[0]?.f ?? null;
    await c.execute(
      `INSERT INTO tms_liquidacion_config (empresa_id, fecha_activacion_liquidacion, actualizado_por)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE fecha_activacion_liquidacion = VALUES(fecha_activacion_liquidacion), actualizado_por = VALUES(actualizado_por)`,
      [actor.empresaId, actual, actor.usuarioId],
    );
    await registrarAuditoriaTx(c, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      accion: "liquidacion_viaje_configurar_activacion",
      modulo: "tms",
      detalle: `Fecha de activación de liquidación: ${anterior ?? "sin fecha"} → ${actual ?? "sin fecha"}`,
    });
    return { anterior, actual };
  });
}

/**
 * Liquidación VIGENTE de varios viajes en UNA consulta (sin N+1), acotada por empresa, para la tabla de Planes/Viajes.
 * Lectura tolerante: si las tablas de Fase 1 aún no existen en este entorno devuelve un mapa vacío (la pantalla muestra «—» y
 * sigue funcionando); cualquier otro error se propaga. Nunca infiere «liquidado»: viaje sin fila = ausente del mapa.
 */
export async function liquidacionesDePlanes(
  empresaId: number,
  planIds: number[],
  conexion?: Pick<PoolConnection, "query">,
): Promise<Map<number, ResumenLiquidacionFila>> {
  const ids = [...new Set(planIds.filter((id) => Number.isInteger(id) && id > 0))];
  const mapa = new Map<number, ResumenLiquidacionFila>();
  if (!ids.length) return mapa;
  const sql = `SELECT plan_id, estado, version FROM tms_viaje_liquidaciones
        WHERE empresa_id = ? AND plan_id IN (${ids.map(() => "?").join(",")})`;
  const params = [empresaId, ...ids];
  try {
    // Mismo helper `query` del resto de las lecturas de reportes (planesConCierreManual, etc.) cuando no se inyecta conexión.
    const rows = conexion
      ? (await conexion.query<(RowDataPacket & { plan_id: number; estado: EstadoLiquidacionViaje; version: number })[]>(sql, params))[0]
      : await query<(RowDataPacket & { plan_id: number; estado: EstadoLiquidacionViaje; version: number })[]>(sql, params);
    for (const r of rows ?? []) mapa.set(Number(r.plan_id), { estado: r.estado, version: Number(r.version) });
  } catch (e) {
    if ((e as { errno?: number }).errno === 1146) return new Map(); // ER_NO_SUCH_TABLE: migración aún no aplicada
    throw e;
  }
  return mapa;
}
