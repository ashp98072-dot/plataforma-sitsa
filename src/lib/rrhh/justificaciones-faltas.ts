import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorDominioFormulario, type EstadoDominio } from "@/lib/validacion-formulario";
import { hoyLocal } from "./dates";
import { obtenerReporteAsistencias } from "./reportes";
import {
  ESTADO_FALTA,
  ESTADO_FALTA_JUSTIFICADA,
  fechaCalendarioValida,
  validarMotivoReversion,
  validarObservacionJustificacion,
  validarTipoJustificacion,
  type EstadoJustificacion,
  type JustificacionResumen,
} from "./justificaciones-faltas-shared";

/**
 * RRHH — JUSTIFICACIÓN DE FALTAS (capa sobre la ausencia real). Una fila por empresa + empleado + fecha
 * (`rrhh_asistencia_justificaciones`, estado ACTIVA/REVERTIDA; nunca se borra).
 *
 * NO crea marcajes ni sesiones, NO escribe en `incidencias`, `rrhh_asistencia_ausencias`, vacaciones ni planilla, y NO reinterpreta
 * la ausencia como asistencia: el reporte la muestra como «Falta justificada» conservando tipo, observación, quién y cuándo.
 * La falta se REVALIDA contra el mismo cálculo del reporte (no se puede justificar un día que no es falta). La empresa y el actor
 * vienen SIEMPRE de la sesión; cada cambio queda en `auditoria` con el estado anterior y el nuevo.
 */

export type CodigoErrorJustificacion =
  | "NO_ENCONTRADO"
  | "NO_ES_FALTA"
  | "YA_JUSTIFICADA"
  | "NO_ACTIVA"
  | "CONFLICTO_VERSION"
  | "SOLICITUD_INVALIDA";

export class ErrorJustificacionFalta extends ErrorDominioFormulario {
  readonly codigoJustificacion: CodigoErrorJustificacion;
  constructor(codigo: CodigoErrorJustificacion, message: string, status: EstadoDominio = 409) {
    super(message, status);
    this.name = "ErrorJustificacionFalta";
    this.codigoJustificacion = codigo;
  }
}

export type ActorJustificacion = { empresaId: number; usuario: string };

export type JustificacionFalta = JustificacionResumen & {
  empleadoId: number;
  fecha: string;
  estado: EstadoJustificacion;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
  revertidoPor: string | null;
  revertidoEn: string | null;
  motivoReversion: string | null;
};

export type ResultadoJustificacion = { justificacion: JustificacionFalta; evento: "JUSTIFICADA" | "EDITADA" | "REVERTIDA" | null; idempotente: boolean };

const FMT = "%Y-%m-%d %H:%i:%s";
const COLS = `id, empleado_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, tipo, observacion, estado, version, creado_por,
  DATE_FORMAT(creado_en, '${FMT}') AS creado_en, actualizado_por, DATE_FORMAT(actualizado_en, '${FMT}') AS actualizado_en,
  revertido_por, DATE_FORMAT(revertido_en, '${FMT}') AS revertido_en, motivo_reversion`;

interface Fila extends RowDataPacket {
  id: number; empleado_id: number; fecha: string; tipo: string; observacion: string | null; estado: EstadoJustificacion; version: number;
  creado_por: string; creado_en: string; actualizado_por: string | null; actualizado_en: string | null;
  revertido_por: string | null; revertido_en: string | null; motivo_reversion: string | null;
}

const aJustificacion = (r: Fila): JustificacionFalta => ({
  id: Number(r.id),
  empleadoId: Number(r.empleado_id),
  fecha: r.fecha,
  tipo: r.tipo,
  observacion: r.observacion,
  estado: r.estado,
  version: Number(r.version),
  creadoPor: r.creado_por,
  creadoEn: r.creado_en,
  actualizadoPor: r.actualizado_por,
  actualizadoEn: r.actualizado_en,
  revertidoPor: r.revertido_por,
  revertidoEn: r.revertido_en,
  motivoReversion: r.motivo_reversion,
});

const sinTabla = (e: unknown) => (e as { errno?: number }).errno === 1146;
const invalido = (error: string): never => {
  throw new ErrorJustificacionFalta("SOLICITUD_INVALIDA", error, 400);
};
const unwrap = <T>(r: { ok: true; valor: T } | { ok: false; error: string }): T => (r.ok ? r.valor : invalido(r.error));
const versionValida = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return invalido("Falta la versión de la justificación.");
  return v;
};

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

const detalle = (j: { id: number; empleadoId: number; fecha: string; tipo: string; observacion: string | null }, extra = "") =>
  `Justificación #${j.id} · empleado #${j.empleadoId} · ${j.fecha} · ${j.tipo}${j.observacion ? ` · «${j.observacion}»` : ""}${extra}`;

// ───────────────────────────────────────── lecturas ─────────────────────────────────────────

export type ContextoJustificacion = {
  empleado: { id: number; codigo: string; nombre: string };
  fecha: string;
  /** Estado actual de la fila en el reporte: «Falta», «Falta justificada» u otro (no justificable). */
  estadoActual: string;
  justificable: boolean;
  justificacion: JustificacionFalta | null;
  /** Impacto conocido en planilla (solo informativo; justificar NO lo modifica). */
  planilla: { ausenciaConfirmada: boolean; aplicadaEnPlanilla: boolean };
};

async function filaDelReporte(empresaId: number, empleadoId: number, fecha: string) {
  const filas = await obtenerReporteAsistencias(empresaId, fecha, fecha, { empleadoId });
  return filas.find((f) => f.fecha === fecha) ?? null;
}

export async function obtenerContextoJustificacion(empresaId: number, empleadoId: number, fecha: string): Promise<ContextoJustificacion | null> {
  if (!fechaCalendarioValida(fecha)) invalido("Fecha inválida (YYYY-MM-DD).");
  const fila = await filaDelReporte(empresaId, empleadoId, fecha);
  if (!fila) return null;
  let justificacion: JustificacionFalta | null = null;
  try {
    const rows = await query<Fila[]>(
      `SELECT ${COLS} FROM rrhh_asistencia_justificaciones WHERE empresa_id = ? AND empleado_id = ? AND fecha = ?`,
      [empresaId, empleadoId, fecha],
    );
    if (rows[0]) justificacion = aJustificacion(rows[0]);
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }
  let ausenciaConfirmada = false;
  let aplicadaEnPlanilla = false;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT planilla_periodo_id FROM rrhh_asistencia_ausencias
        WHERE empresa_id = ? AND empleado_id = ? AND fecha = ? AND estado = 'CONFIRMADA' LIMIT 1`,
      [empresaId, empleadoId, fecha],
    );
    if (rows[0]) {
      ausenciaConfirmada = true;
      aplicadaEnPlanilla = rows[0].planilla_periodo_id != null;
    }
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }
  const justificable = fila.estadoEntrada === ESTADO_FALTA || fila.estadoEntrada === ESTADO_FALTA_JUSTIFICADA;
  return {
    empleado: { id: empleadoId, codigo: fila.codigo, nombre: fila.nombre },
    fecha,
    estadoActual: fila.estadoEntrada,
    justificable,
    justificacion,
    planilla: { ausenciaConfirmada, aplicadaEnPlanilla },
  };
}

// ───────────────────────────────────────── mutaciones ─────────────────────────────────────────

async function leerParaActualizar(c: PoolConnection, empresaId: number, id: number): Promise<JustificacionFalta | null> {
  const [r] = await c.query<Fila[]>(
    `SELECT ${COLS} FROM rrhh_asistencia_justificaciones WHERE empresa_id = ? AND id = ? FOR UPDATE`,
    [empresaId, id],
  );
  return r[0] ? aJustificacion(r[0]) : null;
}

/**
 * Justifica la falta de `empleadoId` en `fecha`. Idempotente: repetir exactamente la misma justificación (doble clic) devuelve la
 * existente; una justificación ACTIVA distinta se rechaza (editar es otra operación). Una REVERTIDA se reactiva (versión + 1).
 */
export async function justificarFalta(
  actor: ActorJustificacion,
  entrada: { empleadoId: number; fecha: string; tipo: unknown; observacion?: unknown },
): Promise<ResultadoJustificacion> {
  if (!Number.isInteger(entrada.empleadoId) || entrada.empleadoId <= 0) invalido("Empleado inválido.");
  if (!fechaCalendarioValida(entrada.fecha)) invalido("Fecha inválida (YYYY-MM-DD).");
  if (entrada.fecha > hoyLocal()) invalido("No se puede justificar una falta de una fecha futura.");
  const tipo = unwrap(validarTipoJustificacion(entrada.tipo));
  const observacion = unwrap(validarObservacionJustificacion(entrada.observacion));

  // La falta debe ser REAL según el mismo cálculo del reporte (y el empleado de ESTA empresa).
  const fila = await filaDelReporte(actor.empresaId, entrada.empleadoId, entrada.fecha);
  if (!fila) throw new ErrorJustificacionFalta("NO_ENCONTRADO", "No se encontró ese día para el empleado en esta empresa.", 404);
  if (fila.estadoEntrada !== ESTADO_FALTA && fila.estadoEntrada !== ESTADO_FALTA_JUSTIFICADA) {
    throw new ErrorJustificacionFalta("NO_ES_FALTA", `Ese día no es una falta (estado actual: ${fila.estadoEntrada}).`);
  }

  return transaccion(async (c) => {
    const [previo] = await c.query<Fila[]>(
      `SELECT ${COLS} FROM rrhh_asistencia_justificaciones WHERE empresa_id = ? AND empleado_id = ? AND fecha = ? FOR UPDATE`,
      [actor.empresaId, entrada.empleadoId, entrada.fecha],
    );
    const existente = previo[0] ? aJustificacion(previo[0]) : null;
    if (existente?.estado === "ACTIVA") {
      if (existente.tipo === tipo && (existente.observacion ?? null) === observacion) {
        return { justificacion: existente, evento: null, idempotente: true };
      }
      throw new ErrorJustificacionFalta("YA_JUSTIFICADA", "Esa falta ya está justificada. Edita la justificación existente.");
    }
    if (existente) {
      await c.execute<ResultSetHeader>(
        `UPDATE rrhh_asistencia_justificaciones
            SET tipo = ?, observacion = ?, estado = 'ACTIVA', version = version + 1, actualizado_por = ?, actualizado_en = NOW(),
                revertido_por = NULL, revertido_en = NULL, motivo_reversion = NULL
          WHERE empresa_id = ? AND id = ? AND estado = 'REVERTIDA'`,
        [tipo, observacion, actor.usuario, actor.empresaId, existente.id],
      );
    } else {
      try {
        await c.execute<ResultSetHeader>(
          `INSERT INTO rrhh_asistencia_justificaciones (empresa_id, empleado_id, fecha, tipo, observacion, creado_por)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [actor.empresaId, entrada.empleadoId, entrada.fecha, tipo, observacion, actor.usuario],
        );
      } catch (e) {
        if ((e as { errno?: number }).errno === 1062) {
          // Carrera: otro envío ganó el UNIQUE. Se relee y se trata como idempotente si es lo mismo.
          const [ya] = await c.query<Fila[]>(
            `SELECT ${COLS} FROM rrhh_asistencia_justificaciones WHERE empresa_id = ? AND empleado_id = ? AND fecha = ?`,
            [actor.empresaId, entrada.empleadoId, entrada.fecha],
          );
          const j = ya[0] ? aJustificacion(ya[0]) : null;
          if (j && j.estado === "ACTIVA" && j.tipo === tipo && (j.observacion ?? null) === observacion) {
            return { justificacion: j, evento: null, idempotente: true };
          }
          throw new ErrorJustificacionFalta("YA_JUSTIFICADA", "Esa falta ya fue justificada por otro envío.");
        }
        throw e;
      }
    }
    const [leida] = await c.query<Fila[]>(
      `SELECT ${COLS} FROM rrhh_asistencia_justificaciones WHERE empresa_id = ? AND empleado_id = ? AND fecha = ?`,
      [actor.empresaId, entrada.empleadoId, entrada.fecha],
    );
    const justificacion = aJustificacion(leida[0]);
    await registrarAuditoriaTx(c, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      accion: existente ? "justificacion_falta_reactivada" : "justificacion_falta_creada",
      modulo: "rrhh",
      detalle: detalle(justificacion),
    });
    return { justificacion, evento: "JUSTIFICADA" as const, idempotente: false };
  });
}

/** Edita tipo y/o observación de una justificación ACTIVA (versión optimista). */
export async function editarJustificacion(
  actor: ActorJustificacion,
  entrada: { id: number; versionEsperada: unknown; tipo?: unknown; observacion?: unknown },
): Promise<ResultadoJustificacion> {
  if (!Number.isInteger(entrada.id) || entrada.id <= 0) invalido("Justificación inválida.");
  const esperada = versionValida(entrada.versionEsperada);
  const tipo = entrada.tipo === undefined ? undefined : unwrap(validarTipoJustificacion(entrada.tipo));
  const observacion = entrada.observacion === undefined ? undefined : unwrap(validarObservacionJustificacion(entrada.observacion));
  if (tipo === undefined && observacion === undefined) invalido("No hay cambios que guardar.");

  return transaccion(async (c) => {
    const actual = await leerParaActualizar(c, actor.empresaId, entrada.id);
    if (!actual) throw new ErrorJustificacionFalta("NO_ENCONTRADO", "Justificación no encontrada.", 404);
    const nuevoTipo = tipo ?? actual.tipo;
    const nuevaObs = observacion === undefined ? actual.observacion : observacion;
    const igual = nuevoTipo === actual.tipo && (nuevaObs ?? null) === (actual.observacion ?? null);
    if (actual.estado === "ACTIVA" && actual.version === esperada + 1 && actual.actualizadoPor === actor.usuario && igual) {
      return { justificacion: actual, evento: null, idempotente: true }; // réplica del mismo envío
    }
    if (actual.estado !== "ACTIVA") throw new ErrorJustificacionFalta("NO_ACTIVA", "La justificación está revertida; justifica la falta de nuevo.");
    if (actual.version !== esperada) throw new ErrorJustificacionFalta("CONFLICTO_VERSION", "La justificación cambió mientras la editabas. Recarga e inténtalo de nuevo.");
    if (igual) return { justificacion: actual, evento: null, idempotente: true };
    await c.execute<ResultSetHeader>(
      `UPDATE rrhh_asistencia_justificaciones
          SET tipo = ?, observacion = ?, version = version + 1, actualizado_por = ?, actualizado_en = NOW()
        WHERE empresa_id = ? AND id = ? AND version = ? AND estado = 'ACTIVA'`,
      [nuevoTipo, nuevaObs, actor.usuario, actor.empresaId, actual.id, esperada],
    );
    const despues = await leerParaActualizar(c, actor.empresaId, actual.id);
    await registrarAuditoriaTx(c, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      accion: "justificacion_falta_editada",
      modulo: "rrhh",
      detalle: `${detalle(despues!)} · antes: ${actual.tipo}${actual.observacion ? ` «${actual.observacion}»` : ""}`,
    });
    return { justificacion: despues!, evento: "EDITADA" as const, idempotente: false };
  });
}

/** Revierte (no borra) una justificación ACTIVA con motivo obligatorio; la falta vuelve a mostrarse como «Falta». */
export async function revertirJustificacion(
  actor: ActorJustificacion,
  entrada: { id: number; versionEsperada: unknown; motivo: unknown },
): Promise<ResultadoJustificacion> {
  if (!Number.isInteger(entrada.id) || entrada.id <= 0) invalido("Justificación inválida.");
  const esperada = versionValida(entrada.versionEsperada);
  const motivo = unwrap(validarMotivoReversion(entrada.motivo));

  return transaccion(async (c) => {
    const actual = await leerParaActualizar(c, actor.empresaId, entrada.id);
    if (!actual) throw new ErrorJustificacionFalta("NO_ENCONTRADO", "Justificación no encontrada.", 404);
    if (actual.estado === "REVERTIDA" && actual.version === esperada + 1 && actual.revertidoPor === actor.usuario) {
      return { justificacion: actual, evento: null, idempotente: true };
    }
    if (actual.estado !== "ACTIVA") throw new ErrorJustificacionFalta("NO_ACTIVA", "La justificación ya estaba revertida.");
    if (actual.version !== esperada) throw new ErrorJustificacionFalta("CONFLICTO_VERSION", "La justificación cambió mientras la revisabas. Recarga e inténtalo de nuevo.");
    await c.execute<ResultSetHeader>(
      `UPDATE rrhh_asistencia_justificaciones
          SET estado = 'REVERTIDA', version = version + 1, revertido_por = ?, revertido_en = NOW(), motivo_reversion = ?,
              actualizado_por = ?, actualizado_en = NOW()
        WHERE empresa_id = ? AND id = ? AND version = ? AND estado = 'ACTIVA'`,
      [actor.usuario, motivo, actor.usuario, actor.empresaId, actual.id, esperada],
    );
    const despues = await leerParaActualizar(c, actor.empresaId, actual.id);
    await registrarAuditoriaTx(c, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      accion: "justificacion_falta_revertida",
      modulo: "rrhh",
      detalle: `${detalle(actual)} · motivo: ${motivo}`,
    });
    return { justificacion: despues!, evento: "REVERTIDA" as const, idempotente: false };
  });
}
