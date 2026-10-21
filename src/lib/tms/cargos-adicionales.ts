import { createHash } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import { ErrorDominioFormulario, type EstadoDominio } from "@/lib/validacion-formulario";
import {
  evaluarEdicionCargos,
  totalCargosActivos,
  totalComercialPreliminar,
  validarConceptoCargo,
  validarMontoCargo,
  validarMotivoAnulacionCargo,
  validarObservacionCargo,
  type CargoAdicional,
  type EdicionCargos,
  type ResumenCargosPlan,
  type TipoEventoCargo,
  type TotalComercialPreliminar,
} from "./cargos-adicionales-shared";
import type { EstadoLiquidacionViaje } from "./liquidacion-viaje-shared";

/**
 * TMS — CARGOS ADICIONALES FACTURABLES (Liquidación de viajes, Fase 4).
 *
 * Importes facturables al CLIENTE por servicios extra de un viaje (espera, maniobra, desvío…), separados de la tarifa base y de
 * los costos internos. Gestionados desde «Ajustes rápidos» de Programación. NO tocan cierre, facturación, FEL, contabilidad,
 * fondos, gastos ni viáticos, y NO definen IVA (pendiente de definición de negocio/fiscal). Nunca se borran: se anulan con
 * motivo (y pueden reactivarse); cada cambio deja un evento append-only con su estado antes/después.
 *
 * Reglas por estado (los cargos son de la liquidación/comercial, NO de la operación física): editables con el viaje abierto no
 * liquidado, Cerrado + REPORTE_RECIBIDO y Cerrado + EN_AJUSTE; bloqueados en LIQUIDADO/re-liquidado (reabrir la liquidación
 * primero, sin reabrir el viaje) y en Cancelado. El permiso lo verifica el endpoint; la empresa y el usuario salen SIEMPRE de la
 * sesión.
 *
 * Concurrencia: todo cambio toma primero el lock del PLAN y luego el de la LIQUIDACIÓN (mismo orden que liquidarViaje), de modo
 * que liquidar y modificar cargos se serializan; cada cargo lleva `version` optimista y un evento por versión.
 */

export type CodigoErrorCargo =
  | "NO_ENCONTRADO"
  | "PLAN_NO_ADMITE"
  | "LIQUIDACION_CERRADA"
  | "ESTADO_NO_PERMITE"
  | "CONFLICTO_VERSION"
  | "CONFLICTO_IDEMPOTENCIA"
  | "SOLICITUD_INVALIDA";

export class ErrorCargoAdicional extends ErrorDominioFormulario {
  readonly codigoCargo: CodigoErrorCargo;
  constructor(codigo: CodigoErrorCargo, message: string, status: EstadoDominio = 409) {
    super(message, status);
    this.name = "ErrorCargoAdicional";
    this.codigoCargo = codigo;
  }
}

export type ActorCargos = { empresaId: number; usuarioId: number; usuario: string };

export type ResultadoCargo = { cargo: CargoAdicional; evento: TipoEventoCargo | null; idempotente: boolean };

export type EventoCargo = {
  id: number;
  cargoId: number;
  version: number;
  tipo: TipoEventoCargo;
  actorId: number;
  antes: EstadoCargoJson | null;
  despues: EstadoCargoJson;
  motivo: string | null;
  creadoEn: string;
};
type EstadoCargoJson = { concepto: string; monto: string; observacion: string | null; activo: number };

const FMT = "%Y-%m-%d %H:%i:%s";
const COLS = `id, plan_id, concepto, monto, observacion, activo, version, anulado_por,
  DATE_FORMAT(anulado_en, '${FMT}') AS anulado_en, motivo_anulacion, creado_por,
  DATE_FORMAT(creado_en, '${FMT}') AS creado_en, actualizado_por, DATE_FORMAT(actualizado_en, '${FMT}') AS actualizado_en`;

interface FilaCargo extends RowDataPacket {
  id: number; plan_id: number; concepto: string; monto: string; observacion: string | null; activo: number; version: number;
  anulado_por: number | null; anulado_en: string | null; motivo_anulacion: string | null; creado_por: number; creado_en: string;
  actualizado_por: number | null; actualizado_en: string | null; huella?: string; clave_envio?: string;
  creado_por_nombre?: string | null; actualizado_por_nombre?: string | null; anulado_por_nombre?: string | null;
}

const aCargo = (r: FilaCargo): CargoAdicional => ({
  id: Number(r.id),
  planId: Number(r.plan_id),
  concepto: r.concepto,
  monto: Number(r.monto).toFixed(2),
  observacion: r.observacion,
  activo: Number(r.activo) === 1,
  version: Number(r.version),
  anuladoPor: r.anulado_por == null ? null : Number(r.anulado_por),
  anuladoEn: r.anulado_en,
  motivoAnulacion: r.motivo_anulacion,
  creadoPor: Number(r.creado_por),
  creadoEn: r.creado_en,
  actualizadoPor: r.actualizado_por == null ? null : Number(r.actualizado_por),
  actualizadoEn: r.actualizado_en,
  ...(r.creado_por_nombre !== undefined
    ? {
        creadoPorNombre: r.creado_por_nombre,
        actualizadoPorNombre: r.actualizado_por_nombre ?? null,
        anuladoPorNombre: r.anulado_por_nombre ?? null,
      }
    : {}),
});

const estadoJson = (c: { concepto: string; monto: string; observacion: string | null; activo: boolean }): EstadoCargoJson => ({
  concepto: c.concepto,
  monto: c.monto,
  observacion: c.observacion,
  activo: c.activo ? 1 : 0,
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

const invalido = (error: string): never => {
  throw new ErrorCargoAdicional("SOLICITUD_INVALIDA", error, 400);
};
const unwrap = <T>(r: { ok: true; valor: T } | { ok: false; error: string }): T => (r.ok ? r.valor : invalido(r.error));
const versionValida = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return invalido("Falta la versión del cargo que se está modificando.");
  return v;
};

/** Primer y segundo lock de TODA mutación: plan (acotado por empresa) y luego liquidación (si ya existe la tabla/fila). */
async function bloquear(c: PoolConnection, empresaId: number, planId: number) {
  const [p] = await c.query<(RowDataPacket & { estado: string })[]>(
    "SELECT estado FROM tms_planes_viaje WHERE empresa_id = ? AND id = ? FOR UPDATE",
    [empresaId, planId],
  );
  if (!p[0]) throw new ErrorCargoAdicional("NO_ENCONTRADO", "Viaje no encontrado.", 404);
  let estadoLiquidacion: EstadoLiquidacionViaje | null = null;
  try {
    const [l] = await c.query<(RowDataPacket & { estado: EstadoLiquidacionViaje })[]>(
      "SELECT estado FROM tms_viaje_liquidaciones WHERE empresa_id = ? AND plan_id = ? FOR UPDATE",
      [empresaId, planId],
    );
    estadoLiquidacion = l[0]?.estado ?? null;
  } catch (e) {
    if ((e as { errno?: number }).errno !== 1146) throw e; // ER_NO_SUCH_TABLE: liquidación aún no instalada
  }
  return { estadoPlan: String(p[0].estado), estadoLiquidacion };
}

function exigirEditable(e: EdicionCargos): void {
  if (!e.editable) throw new ErrorCargoAdicional(e.codigo, e.motivo);
}

async function leerCargoTx(c: PoolConnection, empresaId: number, planId: number, cargoId: number): Promise<CargoAdicional | null> {
  const [r] = await c.query<FilaCargo[]>(
    `SELECT ${COLS} FROM tms_viaje_cargos_adicionales WHERE empresa_id = ? AND plan_id = ? AND id = ? FOR UPDATE`,
    [empresaId, planId, cargoId],
  );
  return r[0] ? aCargo(r[0]) : null;
}

async function insertarEvento(
  c: PoolConnection, actor: ActorCargos, cargo: CargoAdicional, tipo: TipoEventoCargo,
  antes: EstadoCargoJson | null, motivo: string | null,
): Promise<void> {
  await c.execute(
    `INSERT INTO tms_viaje_cargo_eventos (empresa_id, cargo_id, plan_id, version, tipo, actor_id, estado_antes, estado_despues, motivo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [actor.empresaId, cargo.id, cargo.planId, cargo.version, tipo, actor.usuarioId, antes ? JSON.stringify(antes) : null,
      JSON.stringify(estadoJson(cargo)), motivo],
  );
  await registrarAuditoriaTx(c, {
    empresaId: actor.empresaId,
    usuario: actor.usuario,
    accion: `cargo_adicional_${tipo.toLowerCase()}`,
    modulo: "tms",
    detalle: `Plan #${cargo.planId} · cargo #${cargo.id} v${cargo.version} · ${cargo.concepto} · Q${cargo.monto}${motivo ? ` · ${motivo}` : ""}`,
  });
}

const huellaCrear = (planId: number, concepto: string, monto: string, observacion: string | null) =>
  createHash("sha256").update(JSON.stringify(["CARGO_CREAR", 1, planId, concepto, monto, observacion])).digest("hex");

/** Crea un cargo. Idempotente por `claveEnvio`: misma clave y mismo contenido = el mismo cargo; distinto contenido = 409. */
export async function crearCargoAdicional(
  actor: ActorCargos,
  entrada: { planId: number; concepto: unknown; monto: unknown; observacion?: unknown; claveEnvio: string },
): Promise<ResultadoCargo> {
  const concepto = unwrap(validarConceptoCargo(entrada.concepto));
  const monto = unwrap(validarMontoCargo(entrada.monto));
  const observacion = unwrap(validarObservacionCargo(entrada.observacion));
  if (typeof entrada.claveEnvio !== "string" || !CLAVE_ENVIO_REGEX.test(entrada.claveEnvio)) invalido("Clave de envío inválida.");
  const huella = huellaCrear(entrada.planId, concepto, monto, observacion);

  return transaccion(async (c) => {
    const { estadoPlan, estadoLiquidacion } = await bloquear(c, actor.empresaId, entrada.planId);
    // Réplica: antes de la regla de estado (un reintento tras liquidar devuelve el cargo ya creado).
    const [previo] = await c.query<FilaCargo[]>(
      `SELECT ${COLS}, huella FROM tms_viaje_cargos_adicionales WHERE empresa_id = ? AND clave_envio = ?`,
      [actor.empresaId, entrada.claveEnvio],
    );
    if (previo[0]) {
      if (previo[0].huella !== huella || Number(previo[0].plan_id) !== entrada.planId) {
        throw new ErrorCargoAdicional("CONFLICTO_IDEMPOTENCIA", "La clave de envío ya fue usada con un cargo distinto.");
      }
      return { cargo: aCargo(previo[0]), evento: null, idempotente: true };
    }
    exigirEditable(evaluarEdicionCargos(estadoPlan, estadoLiquidacion));
    const [r] = await c.execute<ResultSetHeader>(
      `INSERT INTO tms_viaje_cargos_adicionales (empresa_id, plan_id, concepto, monto, observacion, clave_envio, huella, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.empresaId, entrada.planId, concepto, monto, observacion, entrada.claveEnvio, huella, actor.usuarioId],
    );
    const cargo = (await leerCargoTx(c, actor.empresaId, entrada.planId, Number(r.insertId)))!;
    await insertarEvento(c, actor, cargo, "CREADO", null, null);
    return { cargo, evento: "CREADO", idempotente: false };
  });
}

/** Edita concepto/monto/observación de un cargo ACTIVO. Los campos no enviados se conservan; sin cambios = no escribe nada. */
export async function editarCargoAdicional(
  actor: ActorCargos,
  entrada: { planId: number; cargoId: number; versionEsperada: number; concepto?: unknown; monto?: unknown; observacion?: unknown },
): Promise<ResultadoCargo> {
  const esperada = versionValida(entrada.versionEsperada);
  const concepto = entrada.concepto === undefined ? undefined : unwrap(validarConceptoCargo(entrada.concepto));
  const monto = entrada.monto === undefined ? undefined : unwrap(validarMontoCargo(entrada.monto));
  const observacion = entrada.observacion === undefined ? undefined : unwrap(validarObservacionCargo(entrada.observacion));
  if (concepto === undefined && monto === undefined && observacion === undefined) invalido("No hay cambios que guardar.");

  return transaccion(async (c) => {
    const { estadoPlan, estadoLiquidacion } = await bloquear(c, actor.empresaId, entrada.planId);
    const actual = await leerCargoTx(c, actor.empresaId, entrada.planId, entrada.cargoId);
    if (!actual) throw new ErrorCargoAdicional("NO_ENCONTRADO", "Cargo no encontrado.", 404);
    const objetivo = {
      concepto: concepto ?? actual.concepto,
      monto: monto ?? actual.monto,
      observacion: observacion === undefined ? actual.observacion : observacion,
    };
    const igual = objetivo.concepto === actual.concepto && objetivo.monto === actual.monto && objetivo.observacion === actual.observacion;
    // Réplica: el mismo actor ya aplicó exactamente este cambio (versión + 1) → mismo resultado, sin evento nuevo.
    if (actual.version === esperada + 1 && actual.actualizadoPor === actor.usuarioId && igual && actual.activo) {
      return { cargo: actual, evento: null, idempotente: true };
    }
    exigirEditable(evaluarEdicionCargos(estadoPlan, estadoLiquidacion));
    if (actual.version !== esperada) throw new ErrorCargoAdicional("CONFLICTO_VERSION", "El cargo cambió mientras lo editabas. Recarga e inténtalo de nuevo.");
    if (!actual.activo) throw new ErrorCargoAdicional("ESTADO_NO_PERMITE", "El cargo está anulado: reactívalo antes de editarlo.");
    if (igual) return { cargo: actual, evento: null, idempotente: true };
    const antes = estadoJson(actual);
    const [r] = await c.execute<ResultSetHeader>(
      `UPDATE tms_viaje_cargos_adicionales
          SET concepto = ?, monto = ?, observacion = ?, version = version + 1, actualizado_por = ?
        WHERE empresa_id = ? AND plan_id = ? AND id = ? AND version = ? AND activo = 1`,
      [objetivo.concepto, objetivo.monto, objetivo.observacion, actor.usuarioId, actor.empresaId, entrada.planId, entrada.cargoId, esperada],
    );
    if (r.affectedRows !== 1) throw new ErrorCargoAdicional("CONFLICTO_VERSION", "El cargo cambió durante la operación.");
    const cargo = (await leerCargoTx(c, actor.empresaId, entrada.planId, entrada.cargoId))!;
    await insertarEvento(c, actor, cargo, "EDITADO", antes, null);
    return { cargo, evento: "EDITADO", idempotente: false };
  });
}

/** Anula (no borra) un cargo con motivo obligatorio; conserva quién, cuándo y por qué. Puede reactivarse. */
export async function anularCargoAdicional(
  actor: ActorCargos,
  entrada: { planId: number; cargoId: number; versionEsperada: number; motivo: unknown },
): Promise<ResultadoCargo> {
  const esperada = versionValida(entrada.versionEsperada);
  const motivo = unwrap(validarMotivoAnulacionCargo(entrada.motivo));
  return transaccion(async (c) => {
    const { estadoPlan, estadoLiquidacion } = await bloquear(c, actor.empresaId, entrada.planId);
    const actual = await leerCargoTx(c, actor.empresaId, entrada.planId, entrada.cargoId);
    if (!actual) throw new ErrorCargoAdicional("NO_ENCONTRADO", "Cargo no encontrado.", 404);
    if (!actual.activo && actual.version === esperada + 1 && actual.anuladoPor === actor.usuarioId) {
      return { cargo: actual, evento: null, idempotente: true };
    }
    exigirEditable(evaluarEdicionCargos(estadoPlan, estadoLiquidacion));
    if (actual.version !== esperada) throw new ErrorCargoAdicional("CONFLICTO_VERSION", "El cargo cambió mientras lo revisabas. Recarga e inténtalo de nuevo.");
    if (!actual.activo) throw new ErrorCargoAdicional("ESTADO_NO_PERMITE", "El cargo ya está anulado.");
    const antes = estadoJson(actual);
    const [r] = await c.execute<ResultSetHeader>(
      `UPDATE tms_viaje_cargos_adicionales
          SET activo = 0, version = version + 1, anulado_por = ?, anulado_en = NOW(), motivo_anulacion = ?, actualizado_por = ?
        WHERE empresa_id = ? AND plan_id = ? AND id = ? AND version = ? AND activo = 1`,
      [actor.usuarioId, motivo, actor.usuarioId, actor.empresaId, entrada.planId, entrada.cargoId, esperada],
    );
    if (r.affectedRows !== 1) throw new ErrorCargoAdicional("CONFLICTO_VERSION", "El cargo cambió durante la operación.");
    const cargo = (await leerCargoTx(c, actor.empresaId, entrada.planId, entrada.cargoId))!;
    await insertarEvento(c, actor, cargo, "ANULADO", antes, motivo);
    return { cargo, evento: "ANULADO", idempotente: false };
  });
}

/** Reactiva un cargo anulado (misma regla de estado que cualquier cambio). Limpia las marcas de anulación; la historia queda en eventos. */
export async function reactivarCargoAdicional(
  actor: ActorCargos,
  entrada: { planId: number; cargoId: number; versionEsperada: number },
): Promise<ResultadoCargo> {
  const esperada = versionValida(entrada.versionEsperada);
  return transaccion(async (c) => {
    const { estadoPlan, estadoLiquidacion } = await bloquear(c, actor.empresaId, entrada.planId);
    const actual = await leerCargoTx(c, actor.empresaId, entrada.planId, entrada.cargoId);
    if (!actual) throw new ErrorCargoAdicional("NO_ENCONTRADO", "Cargo no encontrado.", 404);
    if (actual.activo && actual.version === esperada + 1 && actual.actualizadoPor === actor.usuarioId) {
      return { cargo: actual, evento: null, idempotente: true };
    }
    exigirEditable(evaluarEdicionCargos(estadoPlan, estadoLiquidacion));
    if (actual.version !== esperada) throw new ErrorCargoAdicional("CONFLICTO_VERSION", "El cargo cambió mientras lo revisabas. Recarga e inténtalo de nuevo.");
    if (actual.activo) throw new ErrorCargoAdicional("ESTADO_NO_PERMITE", "El cargo ya está activo.");
    const antes = estadoJson(actual);
    const [r] = await c.execute<ResultSetHeader>(
      `UPDATE tms_viaje_cargos_adicionales
          SET activo = 1, version = version + 1, anulado_por = NULL, anulado_en = NULL, motivo_anulacion = NULL, actualizado_por = ?
        WHERE empresa_id = ? AND plan_id = ? AND id = ? AND version = ? AND activo = 0`,
      [actor.usuarioId, actor.empresaId, entrada.planId, entrada.cargoId, esperada],
    );
    if (r.affectedRows !== 1) throw new ErrorCargoAdicional("CONFLICTO_VERSION", "El cargo cambió durante la operación.");
    const cargo = (await leerCargoTx(c, actor.empresaId, entrada.planId, entrada.cargoId))!;
    await insertarEvento(c, actor, cargo, "REACTIVADO", antes, null);
    return { cargo, evento: "REACTIVADO", idempotente: false };
  });
}

// ─────────────────────────────────────── lecturas (sin locks) ───────────────────────────────────────

const sinTabla = (e: unknown) => (e as { errno?: number }).errno === 1146;

/** Cargos del viaje (activos y anulados), acotados por empresa. Sin tablas aún ⇒ lista vacía. */
export async function listarCargosPlan(empresaId: number, planId: number): Promise<CargoAdicional[]> {
  try {
    const [r] = await getPool().query<FilaCargo[]>(
      `SELECT c.id, c.plan_id, c.concepto, c.monto, c.observacion, c.activo, c.version, c.anulado_por,
              DATE_FORMAT(c.anulado_en, '${FMT}') AS anulado_en, c.motivo_anulacion, c.creado_por,
              DATE_FORMAT(c.creado_en, '${FMT}') AS creado_en, c.actualizado_por,
              DATE_FORMAT(c.actualizado_en, '${FMT}') AS actualizado_en,
              uc.username AS creado_por_nombre, ua.username AS actualizado_por_nombre, un.username AS anulado_por_nombre
         FROM tms_viaje_cargos_adicionales c
         LEFT JOIN usuarios uc ON uc.id = c.creado_por
         LEFT JOIN usuarios ua ON ua.id = c.actualizado_por
         LEFT JOIN usuarios un ON un.id = c.anulado_por
        WHERE c.empresa_id = ? AND c.plan_id = ? ORDER BY c.activo DESC, c.id ASC`,
      [empresaId, planId],
    );
    return r.map(aCargo);
  } catch (e) {
    if (sinTabla(e)) return [];
    throw e;
  }
}

/** Historia append-only de los cargos del viaje (más reciente primero, máximo 300). */
export async function listarEventosCargosPlan(empresaId: number, planId: number): Promise<EventoCargo[]> {
  try {
    const [r] = await getPool().query<(RowDataPacket & {
      id: number; cargo_id: number; version: number; tipo: TipoEventoCargo; actor_id: number; estado_antes: string | null;
      estado_despues: string; motivo: string | null; creado_en: string;
    })[]>(
      `SELECT id, cargo_id, version, tipo, actor_id, estado_antes, estado_despues, motivo, DATE_FORMAT(creado_en, '${FMT}') AS creado_en
         FROM tms_viaje_cargo_eventos WHERE empresa_id = ? AND plan_id = ? ORDER BY id DESC LIMIT 300`,
      [empresaId, planId],
    );
    return r.map((e) => ({
      id: Number(e.id), cargoId: Number(e.cargo_id), version: Number(e.version), tipo: e.tipo, actorId: Number(e.actor_id),
      antes: e.estado_antes ? (JSON.parse(e.estado_antes) as EstadoCargoJson) : null,
      despues: JSON.parse(e.estado_despues) as EstadoCargoJson, motivo: e.motivo, creadoEn: e.creado_en,
    }));
  } catch (e) {
    if (sinTabla(e)) return [];
    throw e;
  }
}

/** Cantidad y total de cargos ACTIVOS por viaje, en UNA consulta (para la fila de Ajustes rápidos). Sin tablas ⇒ mapa vacío. */
export async function resumenCargosDePlanes(empresaId: number, planIds: number[]): Promise<Map<number, ResumenCargosPlan>> {
  const ids = [...new Set(planIds.filter((id) => Number.isInteger(id) && id > 0))];
  const mapa = new Map<number, ResumenCargosPlan>();
  if (!ids.length) return mapa;
  try {
    const rows = await query<(RowDataPacket & { plan_id: number; cantidad: number; total: string; moneda: string | null })[]>(
      `SELECT c.plan_id, COUNT(*) AS cantidad, SUM(c.monto) AS total, MAX(p.tarifa_moneda_historico) AS moneda
         FROM tms_viaje_cargos_adicionales c
         INNER JOIN tms_planes_viaje p ON p.empresa_id = c.empresa_id AND p.id = c.plan_id
        WHERE c.empresa_id = ? AND c.activo = 1 AND c.plan_id IN (${ids.map(() => "?").join(",")}) GROUP BY c.plan_id`,
      [empresaId, ...ids],
    );
    for (const r of rows ?? []) {
      mapa.set(Number(r.plan_id), { cantidad: Number(r.cantidad), total: Number(r.total).toFixed(2), moneda: r.moneda && String(r.moneda).trim() ? String(r.moneda) : "GTQ" });
    }
  } catch (e) {
    if (sinTabla(e)) return new Map();
    throw e;
  }
  return mapa;
}

// ───────────────────── Cerrados pendientes de liquidación (vista de Ajustes rápidos) ─────────────────────

/** Máximo de filas de la vista «Cerrados pendientes de liquidación» (acotada: nunca el histórico Cerrado completo). */
export const LIMITE_CERRADOS_PENDIENTES = 200;
/** Ventana de los LIQUIDADO que se pueden consultar (solo lectura de cargos: están bloqueados). */
export const DIAS_LIQUIDADOS_RECIENTES = 30;

export type CerradoPendienteCargos = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  cliente: string | null;
  ruta: string;
  tarifaComercial: string | null;
  moneda: string;
  estadoLiquidacion: EstadoLiquidacionViaje;
  versionLiquidacion: number;
  cargos: { cantidad: number; total: string };
  /** true si los cargos pueden modificarse (la misma regla que aplica el servidor al mutar). */
  editable: boolean;
};

export type ListaCerradosPendientes = { filas: CerradoPendienteCargos[]; truncado: boolean; limite: number; diasLiquidados: number };

/**
 * Viajes `Cerrado` que todavía requieren trabajo comercial/de liquidación: `REPORTE_RECIBIDO` y `EN_AJUSTE`; opcionalmente los
 * `LIQUIDADO` de los últimos DIAS_LIQUIDADOS_RECIENTES días (cargos bloqueados). Se parte de la TABLA DE LIQUIDACIONES (solo
 * existen filas para viajes con reporte confirmado), así que un Cerrado sin liquidación o ya antiguo y liquidado NO aparece.
 * Acotado por empresa y por LIMITE_CERRADOS_PENDIENTES. Solo lectura, sin locks. Sin tablas aún ⇒ lista vacía.
 */
export async function listarCerradosPendientesLiquidacion(
  empresaId: number,
  opciones: { incluirLiquidados?: boolean } = {},
): Promise<ListaCerradosPendientes> {
  const vacia: ListaCerradosPendientes = { filas: [], truncado: false, limite: LIMITE_CERRADOS_PENDIENTES, diasLiquidados: DIAS_LIQUIDADOS_RECIENTES };
  const incluir = opciones.incluirLiquidados === true;
  try {
    const [rows] = await getPool().query<(RowDataPacket & {
      id: number; codigo: string; fecha_plan: string; cliente: string | null; ruta_codigo: string | null; origen: string | null;
      destino: string | null; tarifa_comercial: string | null; moneda: string | null; liq_estado: EstadoLiquidacionViaje; liq_version: number;
    })[]>(
      `SELECT p.id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan, c.nombre AS cliente,
              p.ruta_codigo_historico AS ruta_codigo, lc.nombre AS origen, COALESCE(p.lugar_descarga_historico, ld.nombre) AS destino,
              p.tarifa_comercial, p.tarifa_moneda_historico AS moneda, l.estado AS liq_estado, l.version AS liq_version
         FROM tms_viaje_liquidaciones l
         INNER JOIN tms_planes_viaje p ON p.empresa_id = l.empresa_id AND p.id = l.plan_id
         LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
         LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id AND lc.empresa_id = p.empresa_id
         LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id AND ld.empresa_id = p.empresa_id
        WHERE l.empresa_id = ? AND p.estado = 'Cerrado'
          AND (l.estado IN ('REPORTE_RECIBIDO', 'EN_AJUSTE')
               OR (? = 1 AND l.estado = 'LIQUIDADO' AND l.liquidado_en >= (NOW() - INTERVAL ${DIAS_LIQUIDADOS_RECIENTES} DAY)))
        ORDER BY p.fecha_plan DESC, p.id DESC
        LIMIT ${LIMITE_CERRADOS_PENDIENTES + 1}`,
      [empresaId, incluir ? 1 : 0],
    );
    const truncado = rows.length > LIMITE_CERRADOS_PENDIENTES;
    const visibles = truncado ? rows.slice(0, LIMITE_CERRADOS_PENDIENTES) : rows;
    const resumen = await resumenCargosDePlanes(empresaId, visibles.map((r) => Number(r.id)));
    return {
      truncado,
      limite: LIMITE_CERRADOS_PENDIENTES,
      diasLiquidados: DIAS_LIQUIDADOS_RECIENTES,
      filas: visibles.map((r) => {
        const cargos = resumen.get(Number(r.id));
        return {
          planId: Number(r.id),
          codigo: String(r.codigo),
          fechaPlan: String(r.fecha_plan),
          cliente: r.cliente ?? null,
          ruta: r.origen || r.destino ? `${r.origen || "—"} → ${r.destino || "—"}` : (r.ruta_codigo ?? ""),
          tarifaComercial: r.tarifa_comercial != null ? Number(r.tarifa_comercial).toFixed(2) : null,
          moneda: r.moneda && String(r.moneda).trim() ? String(r.moneda) : "GTQ",
          estadoLiquidacion: r.liq_estado,
          versionLiquidacion: Number(r.liq_version),
          cargos: { cantidad: cargos?.cantidad ?? 0, total: cargos?.total ?? "0.00" },
          editable: evaluarEdicionCargos("Cerrado", r.liq_estado).editable,
        };
      }),
    };
  } catch (e) {
    if (sinTabla(e)) return vacia;
    throw e;
  }
}

export type VistaCargosPlan = {
  plan: { id: number; codigo: string; estado: string; tarifaComercial: string | null; moneda: string };
  liquidacion: { estado: EstadoLiquidacionViaje; version: number } | null;
  cargos: CargoAdicional[];
  eventos: EventoCargo[];
  edicion: EdicionCargos;
  totales: TotalComercialPreliminar & { cantidadActivos: number; cargosActivos: string };
};

/** Vista de lectura para el panel de cargos de un viaje (sin locks). null si el viaje no existe en la empresa. */
export async function obtenerVistaCargosPlan(empresaId: number, planId: number): Promise<VistaCargosPlan | null> {
  const [p] = await getPool().query<(RowDataPacket & {
    id: number; codigo: string; estado: string; tarifa_comercial: string | null; moneda: string | null;
  })[]>(
    `SELECT id, codigo, estado, tarifa_comercial, tarifa_moneda_historico AS moneda
       FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?`,
    [empresaId, planId],
  );
  if (!p[0]) return null;
  let liquidacion: VistaCargosPlan["liquidacion"] = null;
  try {
    const [l] = await getPool().query<(RowDataPacket & { estado: EstadoLiquidacionViaje; version: number })[]>(
      "SELECT estado, version FROM tms_viaje_liquidaciones WHERE empresa_id = ? AND plan_id = ?",
      [empresaId, planId],
    );
    if (l[0]) liquidacion = { estado: l[0].estado, version: Number(l[0].version) };
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }
  const [cargos, eventos] = await Promise.all([listarCargosPlan(empresaId, planId), listarEventosCargosPlan(empresaId, planId)]);
  const activos = cargos.filter((c) => c.activo);
  return {
    plan: {
      id: Number(p[0].id), codigo: String(p[0].codigo), estado: String(p[0].estado),
      tarifaComercial: p[0].tarifa_comercial != null ? Number(p[0].tarifa_comercial).toFixed(2) : null,
      moneda: p[0].moneda && String(p[0].moneda).trim() ? String(p[0].moneda) : "GTQ",
    },
    liquidacion,
    cargos,
    eventos,
    edicion: evaluarEdicionCargos(String(p[0].estado), liquidacion?.estado ?? null),
    totales: {
      ...totalComercialPreliminar(p[0].tarifa_comercial, cargos),
      cantidadActivos: activos.length,
      cargosActivos: totalCargosActivos(cargos),
    },
  };
}
