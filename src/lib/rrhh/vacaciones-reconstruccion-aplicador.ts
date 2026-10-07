import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { getPool, query, type SqlParams } from "@/lib/db";
import type { Consulta } from "./vacaciones-historial-actual";
import {
  cargarFuente,
  planificarReconstruccion,
  resumenParaDryRun,
  type Bloqueo,
  type DryRunReconstruccion,
  type EvidenciaRespaldo,
  type PlanReconstruccion,
} from "./vacaciones-reconstruccion-plan";

/**
 * RRHH VACACIONES — APLICADOR CONTROLADO de la reconstrucción desde el historial validado, PRESERVANDO LAS EVIDENCIAS.
 *
 * ⚠ ESTE MÓDULO NO SE EJECUTA DESDE NINGUNA RUTA NI BOTÓN DE ESTE PR. Queda listo y probado; ejecutarlo contra producción exige un paso
 * posterior, autorizado por escrito, con la confirmación fuerte descrita abajo. El dry-run (`simularReconstruccion`) sí está expuesto y
 * es de SOLO LECTURA.
 *
 * Es TODO-O-NADA: o la transacción completa verifica todo y hace COMMIT, o hace ROLLBACK COMPLETO. Nunca deja una reconstrucción parcial.
 *
 * FLUJO
 *   0. Confirmación fuerte: frase exacta + empresa + huella de la fuente (la del dry-run revisado) + sello de respaldos + usuario.
 *   1. Re-valida (con el mismo plan del dry-run): historial lossless, sin duplicados/futuras/superpuestas/bloqueantes, sin decisiones
 *      pendientes, relink de evidencias posible (0 o >1 coincidencias = HARD ERROR) y huella de la fuente idéntica.
 *   2. Respaldos nuevos y separados `bk_reset_<sello>_*` (NUNCA se sobrescriben; `backup_saldos_vacaciones_20261006` no se toca) con
 *      verificación de conteos. Es DDL: se hace ANTES de la transacción y permanece aunque luego haya ROLLBACK (es lo deseado).
 *   3. BEGIN → relee TODO bajo bloqueo (FOR UPDATE) y vuelve a planificar: si la huella cambió, aborta.
 *   4. STAGING de evidencias en memoria (todos los campos + identidad lógica) ANTES de borrar nada. La FK `fk_ev_inc`
 *      (evidencias_incidencias.incidencia_id → incidencias.id) es ON DELETE CASCADE: borrar una incidencia borra su evidencia.
 *   5. Borra, siempre con empresa_id y SOLO por ids del conjunto objetivo: detalle FIFO → incidencias de vacaciones → vacaciones → saldos.
 *      Sin TRUNCATE, sin FOREIGN_KEY_CHECKS=0, sin DELETE global, sin tocar incidencias de otros tipos, empleados ni solicitudes.
 *   6. Regenera períodos desde fecha_alta, reinserta las vacaciones cronológicamente (incidencia + fila espejo + detalle FIFO nuevo).
 *   7. RELINK de evidencias: como el CASCADE ya eliminó las filas, cada evidencia del staging se RECREA con su MISMO id y todos sus campos
 *      (empresa, ruta_archivo, nombre_original, subido_en, subido_por) apuntando a la ÚNICA incidencia nueva con su identidad lógica
 *      (empresa + empleado + tipo + fecha_inicio + fecha_fin + dias_habiles). El archivo físico NO se toca.
 *   8. Verifica: cardinalidad de evidencias (n antes = n después), campos idénticos, sin huérfanas ni duplicadas inesperadas, detalle FIFO,
 *      saldos, otras incidencias/empleados/solicitudes sin cambio, respaldo histórico intacto. 9. Auditoría. 10. COMMIT.
 *
 * ARCHIVOS FÍSICOS: este módulo (y el plan) NO importan `fs`, `@/lib/uploads` ni `limpiar-archivos`, y no llaman a ningún helper de borrado.
 * Un test lo comprueba. Ver docs/RRHH-VACACIONES-APLICADOR-RECONSTRUCCION.md (dónde viven los archivos y qué funciones podrían borrarlos).
 */

export const TIPOS_VACACIONES = ["Vacaciones", "A cuenta de Vacaciones"] as const;
const TIPOS_SQL = "('Vacaciones', 'A cuenta de Vacaciones')";
const BACKUP_HISTORICO = "backup_saldos_vacaciones_20261006";
const TROZO = 400;

export const fraseConfirmacion = (empresaId: number) => `RECONSTRUIR VACACIONES EMPRESA ${empresaId}`;

export type ConfirmacionAplicacion = {
  empresaId: number;
  /** Debe ser EXACTAMENTE `fraseConfirmacion(empresaId)`. */
  frase: string;
  /** `huellaFuente` del dry-run que se revisó: ata la aplicación a esos datos. */
  huellaFuente: string;
  /** AAAAMMDDHHMM: sello único de los respaldos bk_reset_<sello>_*. */
  sello: string;
  usuario: string;
};
export type ParametrosAplicacion = { empresaId: number; decisiones?: unknown; confirmacion: ConfirmacionAplicacion };

/** Lo mínimo que el aplicador usa de una conexión mysql2 (permite una BD en memoria en las pruebas). */
export interface ConexionSql {
  query(sql: string, params?: SqlParams): Promise<unknown>;
  execute(sql: string, params?: SqlParams): Promise<unknown>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}
export type DepsAplicador = { obtenerConexion: () => Promise<ConexionSql>; consultaPool: Consulta; ahora: () => Date };

export const depsReales = (): DepsAplicador => ({
  obtenerConexion: async () => (await getPool().getConnection()) as unknown as ConexionSql,
  consultaPool: (sql, params) => query<RowDataPacket[]>(sql, params),
  ahora: () => new Date(),
});

export type FaseAplicacion = "CONFIRMACION" | "VALIDACION" | "RESPALDOS" | "TRANSACCION" | "ELIMINACION" | "RECONSTRUCCION" | "RELINK" | "VERIFICACION" | "AUDITORIA";
export class ErrorAplicacion extends Error {
  constructor(public codigo: string, public fase: FaseAplicacion, message: string, public bloqueos: Bloqueo[] = []) {
    super(message);
    this.name = "ErrorAplicacion";
  }
}

export type ResultadoAplicacion = {
  ok: true;
  sello: string;
  respaldos: string[];
  vacaciones: number;
  incidencias: number;
  detalleFifo: number;
  saldos: number;
  evidenciasRelinkeadas: number;
  empleados: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const trozos = <T,>(xs: readonly T[], n = TROZO): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

/* ------------------------------------------------------------------ dry-run (SOLO LECTURA) */

/** Dry-run: calcula el plan completo sin escribir nada. */
export async function simularReconstruccion(empresaId: number, decisiones?: unknown, deps: DepsAplicador = depsReales()): Promise<DryRunReconstruccion> {
  const fuente = await cargarFuente(empresaId, deps.consultaPool);
  return resumenParaDryRun(planificarReconstruccion(fuente, { decisiones, hoy: deps.ahora() }));
}

/* ------------------------------------------------------------------ aplicador */

function validarConfirmacion(p: ParametrosAplicacion): void {
  const c = p.confirmacion;
  if (!c || c.empresaId !== p.empresaId) throw new ErrorAplicacion("CONFIRMACION_INVALIDA", "CONFIRMACION", "La confirmación no corresponde a la empresa.");
  if (c.frase !== fraseConfirmacion(p.empresaId)) throw new ErrorAplicacion("CONFIRMACION_INVALIDA", "CONFIRMACION", `Frase de confirmación incorrecta (debe ser «${fraseConfirmacion(p.empresaId)}»).`);
  if (!/^[0-9a-f]{64}$/.test(String(c.huellaFuente ?? ""))) throw new ErrorAplicacion("CONFIRMACION_INVALIDA", "CONFIRMACION", "Falta la huella de la fuente del dry-run revisado.");
  if (!/^\d{12}$/.test(String(c.sello ?? ""))) throw new ErrorAplicacion("CONFIRMACION_INVALIDA", "CONFIRMACION", "El sello de respaldos debe ser AAAAMMDDHHMM (12 dígitos).");
  if (typeof c.usuario !== "string" || c.usuario.trim().length < 3) throw new ErrorAplicacion("CONFIRMACION_INVALIDA", "CONFIRMACION", "Indique el usuario que ejecuta.");
}

const filas = (r: unknown): RowDataPacket[] => (Array.isArray(r) ? (r[0] as RowDataPacket[]) : []);
const cuenta = async (conn: ConexionSql, sql: string, params: SqlParams = []): Promise<number> => Number(filas(await conn.query(sql, params))[0]?.n ?? 0);
const insertId = (r: unknown): number => Number(((Array.isArray(r) ? r[0] : r) as ResultSetHeader).insertId);

export const nombresRespaldo = (sello: string) => ({
  vacaciones: `bk_reset_${sello}_vacaciones`,
  incidencias_vacaciones: `bk_reset_${sello}_incidencias_vacaciones`,
  detalle_consumo_vacaciones: `bk_reset_${sello}_detalle_consumo_vacaciones`,
  saldos_vacaciones: `bk_reset_${sello}_saldos_vacaciones`,
  solicitudes_vacaciones: `bk_reset_${sello}_solicitudes_vacaciones`,
  evidencias_incidencias: `bk_reset_${sello}_evidencias_incidencias`,
});

async function crearRespaldos(conn: ConexionSql, sello: string): Promise<string[]> {
  const n = nombresRespaldo(sello);
  const lista = Object.values(n);
  const existentes = await cuenta(conn, `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${ph(lista.length)})`, lista);
  if (existentes > 0) throw new ErrorAplicacion("RESPALDO_EXISTENTE", "RESPALDOS", `Ya existen tablas bk_reset_${sello}_*: nunca se sobrescriben respaldos. Use otro sello.`);
  const origen: [string, string, string][] = [
    [n.vacaciones, "SELECT * FROM vacaciones", "SELECT COUNT(*) AS n FROM vacaciones"],
    [n.incidencias_vacaciones, `SELECT * FROM incidencias WHERE tipo IN ${TIPOS_SQL}`, `SELECT COUNT(*) AS n FROM incidencias WHERE tipo IN ${TIPOS_SQL}`],
    [n.detalle_consumo_vacaciones, "SELECT * FROM detalle_consumo_vacaciones", "SELECT COUNT(*) AS n FROM detalle_consumo_vacaciones"],
    [n.saldos_vacaciones, "SELECT * FROM saldos_vacaciones", "SELECT COUNT(*) AS n FROM saldos_vacaciones"],
    [n.solicitudes_vacaciones, "SELECT * FROM solicitudes_vacaciones", "SELECT COUNT(*) AS n FROM solicitudes_vacaciones"],
    [
      n.evidencias_incidencias,
      `SELECT e.id, e.empresa_id, e.incidencia_id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles,
              e.ruta_archivo, e.nombre_original, e.subido_en, e.subido_por
       FROM evidencias_incidencias e LEFT JOIN incidencias i ON i.id = e.incidencia_id`,
      "SELECT COUNT(*) AS n FROM evidencias_incidencias",
    ],
  ];
  for (const [nombre, select, conteo] of origen) {
    try {
      await conn.execute(`CREATE TABLE \`${nombre}\` AS ${select}`);
    } catch (e) {
      throw new ErrorAplicacion("RESPALDO_FALLIDO", "RESPALDOS", `No se pudo crear el respaldo ${nombre}: ${(e as Error).message}`);
    }
    const esperado = await cuenta(conn, conteo);
    const real = await cuenta(conn, `SELECT COUNT(*) AS n FROM \`${nombre}\``);
    if (esperado !== real) throw new ErrorAplicacion("RESPALDO_FALLIDO", "RESPALDOS", `El respaldo ${nombre} tiene ${real} fila(s) y el origen ${esperado}.`);
  }
  return lista;
}

async function contarHistorico(conn: ConexionSql): Promise<number | null> {
  try { return await cuenta(conn, `SELECT COUNT(*) AS n FROM ${BACKUP_HISTORICO}`); } catch { return null; }
}

export async function aplicarReconstruccion(params: ParametrosAplicacion, deps: DepsAplicador = depsReales()): Promise<ResultadoAplicacion> {
  validarConfirmacion(params);
  const { empresaId, confirmacion } = params;

  // 1) Re-validación completa con el mismo plan del dry-run (lectura con el pool)
  const fuente0 = await cargarFuente(empresaId, deps.consultaPool);
  const plan0 = planificarReconstruccion(fuente0, { decisiones: params.decisiones, hoy: deps.ahora() });
  if (!plan0.puedeAplicarse) throw new ErrorAplicacion("PLAN_NO_APLICABLE", "VALIDACION", `La reconstrucción no puede aplicarse: ${plan0.bloqueos.map((b) => b.codigo).join(", ")}.`, plan0.bloqueos);
  if (plan0.huellaFuente !== confirmacion.huellaFuente) throw new ErrorAplicacion("FUENTE_CAMBIO", "VALIDACION", "La fuente cambió desde el dry-run revisado (huella distinta). Repita el dry-run.");

  const conn = await deps.obtenerConexion();
  let enTransaccion = false;
  try {
    // 2) Respaldos (DDL, fuera de la transacción) y línea base del respaldo histórico
    const historicoAntes = await contarHistorico(conn);
    const respaldos = await crearRespaldos(conn, confirmacion.sello);

    // 3) Transacción: relee BAJO BLOQUEO y vuelve a planificar
    await conn.beginTransaction();
    enTransaccion = true;
    for (const sql of [
      `SELECT id FROM incidencias WHERE empresa_id = ? AND tipo IN ${TIPOS_SQL} FOR UPDATE`,
      "SELECT id FROM vacaciones WHERE empresa_id = ? FOR UPDATE",
      "SELECT id FROM saldos_vacaciones WHERE empresa_id = ? FOR UPDATE",
      "SELECT id FROM evidencias_incidencias WHERE empresa_id = ? FOR UPDATE",
    ]) await conn.query(sql, [empresaId]);
    const consultaTx: Consulta = async (sql, p) => filas(await conn.query(sql, p));
    const fuente = await cargarFuente(empresaId, consultaTx);
    const plan = planificarReconstruccion(fuente, { decisiones: params.decisiones, hoy: deps.ahora() });
    if (!plan.puedeAplicarse) throw new ErrorAplicacion("PLAN_NO_APLICABLE", "VALIDACION", `Bajo bloqueo, la reconstrucción ya no es aplicable: ${plan.bloqueos.map((b) => b.codigo).join(", ")}.`, plan.bloqueos);
    if (plan.huellaFuente !== confirmacion.huellaFuente) throw new ErrorAplicacion("FUENTE_CAMBIO", "VALIDACION", "La fuente cambió bajo bloqueo (huella distinta). Repita el dry-run.");

    const antes = {
      otrasIncidencias: await cuenta(conn, `SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND tipo NOT IN ${TIPOS_SQL}`, [empresaId]),
      empleados: await cuenta(conn, "SELECT COUNT(*) AS n FROM empleados WHERE empresa_id = ?", [empresaId]),
      solicitudes: await cuenta(conn, "SELECT COUNT(*) AS n FROM solicitudes_vacaciones WHERE empresa_id = ?", [empresaId]).catch(() => 0),
      evidencias: fuente.totalEvidenciasEmpresa,
    };

    // 4) STAGING de evidencias (en memoria, copia profunda) ANTES de cualquier DELETE; coincide con el respaldo en BD
    const staging: EvidenciaRespaldo[] = plan.evidenciasRespaldo.map((e) => ({ ...e }));
    const enRespaldo = await cuenta(conn, `SELECT COUNT(*) AS n FROM \`${nombresRespaldo(confirmacion.sello).evidencias_incidencias}\` WHERE empresa_id = ?`, [empresaId]);
    if (enRespaldo !== antes.evidencias) throw new ErrorAplicacion("RESPALDO_FALLIDO", "RESPALDOS", `El respaldo de evidencias tiene ${enRespaldo} fila(s) de la empresa y hay ${antes.evidencias}.`);

    // 5) ELIMINACIÓN: solo ids del conjunto objetivo, siempre con empresa_id
    try {
      for (const t of trozos(plan.objetivos.incidenciaIds)) await conn.execute(`DELETE FROM detalle_consumo_vacaciones WHERE incidencia_id IN (${ph(t.length)})`, t);
      for (const t of trozos(plan.objetivos.incidenciaIds)) await conn.execute(`DELETE FROM incidencias WHERE empresa_id = ? AND tipo IN ${TIPOS_SQL} AND id IN (${ph(t.length)})`, [empresaId, ...t]);
      for (const t of trozos(plan.objetivos.vacacionIds)) await conn.execute(`DELETE FROM vacaciones WHERE empresa_id = ? AND id IN (${ph(t.length)})`, [empresaId, ...t]);
      const detalleRestante = plan.objetivos.saldoIds.length
        ? (await Promise.all(trozos(plan.objetivos.saldoIds).map((t) => cuenta(conn, `SELECT COUNT(*) AS n FROM detalle_consumo_vacaciones WHERE saldo_id IN (${ph(t.length)})`, t)))).reduce((a, b) => a + b, 0)
        : 0;
      if (detalleRestante !== 0) throw new ErrorAplicacion("DETALLE_RESTANTE", "ELIMINACION", `Quedan ${detalleRestante} línea(s) de detalle FIFO sobre los saldos a eliminar: se aborta (nunca se borra FIFO fuera del conjunto objetivo).`);
      for (const t of trozos(plan.objetivos.saldoIds)) await conn.execute(`DELETE FROM saldos_vacaciones WHERE empresa_id = ? AND id IN (${ph(t.length)})`, [empresaId, ...t]);
    } catch (e) {
      throw e instanceof ErrorAplicacion ? e : new ErrorAplicacion("ERROR_ELIMINACION", "ELIMINACION", (e as Error).message);
    }

    // 6) RECONSTRUCCIÓN: períodos desde fecha_alta + vacaciones cronológicas + detalle FIFO nuevo
    const saldoId = new Map<string, number>();
    const nuevaIncidencia = new Map<string, number>();
    let lineasDetalle = 0, saldosNuevos = 0;
    try {
      for (const e of plan.empleados) {
        for (const p of e.periodos) {
          const r = await conn.execute(
            "INSERT INTO saldos_vacaciones (empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [empresaId, e.empleadoId, p.anioLaboral, p.inicio, p.fin, p.otorgados, p.disponibles, p.estado],
          );
          saldoId.set(`${e.empleadoId}|${p.anioLaboral}`, insertId(r));
          saldosNuevos += 1;
        }
      }
      const ordenadas = [...plan.vacaciones].sort((a, b) => a.empleadoId - b.empleadoId || a.inicio.localeCompare(b.inicio) || a.fin.localeCompare(b.fin) || a.origen - b.origen);
      for (const v of ordenadas) {
        const ri = await conn.execute(
          "INSERT INTO incidencias (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles) VALUES (?, ?, ?, ?, ?, ?)",
          [empresaId, v.empleadoId, v.tipo, v.inicio, v.fin, v.dias],
        );
        const incidenciaId = insertId(ri);
        nuevaIncidencia.set(v.clave, incidenciaId);
        await conn.execute(
          "INSERT INTO vacaciones (empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, observaciones, estado) VALUES (?, ?, ?, ?, ?, ?, 'Aprobado')",
          [empresaId, v.empleadoId, v.inicio, v.fin, v.dias, v.observacion === "" ? null : v.observacion],
        );
        for (const c of v.consumos) {
          const sid = saldoId.get(`${v.empleadoId}|${c.anioLaboral}`);
          if (sid == null) throw new ErrorAplicacion("PERIODO_INEXISTENTE", "RECONSTRUCCION", `La vacación ${v.clave} consume el año laboral ${c.anioLaboral}, que no se generó.`);
          await conn.execute("INSERT INTO detalle_consumo_vacaciones (incidencia_id, saldo_id, dias_tomados) VALUES (?, ?, ?)", [incidenciaId, sid, c.dias]);
          lineasDetalle += 1;
        }
      }
    } catch (e) {
      throw e instanceof ErrorAplicacion ? e : new ErrorAplicacion("ERROR_RECONSTRUCCION", "RECONSTRUCCION", (e as Error).message);
    }

    // 7) RELINK: cada evidencia del staging → exactamente UNA incidencia nueva (identidad lógica), con el MISMO id y todos sus campos
    const esperadoPorIncidencia = new Map<number, number>();
    const destinoPorEvidencia = new Map<number, number>();
    try {
      const relinkPorEvidencia = new Map(plan.evidencias.relinks.map((r) => [r.evidenciaId, r]));
      for (const ev of staging) {
        const r = relinkPorEvidencia.get(ev.id);
        const nuevaId = r ? nuevaIncidencia.get(r.claveLogica) : undefined;
        if (!r || nuevaId == null) throw new ErrorAplicacion("RELINK_SIN_DESTINO", "RELINK", `La evidencia ${ev.id} no tiene una incidencia nueva compatible: se revierte todo.`);
        await conn.execute(
          "INSERT INTO evidencias_incidencias (id, empresa_id, incidencia_id, ruta_archivo, nombre_original, subido_en, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [ev.id, ev.empresaId, nuevaId, ev.rutaArchivo, ev.nombreOriginal, ev.subidoEn, ev.subidoPor],
        );
        destinoPorEvidencia.set(ev.id, nuevaId);
        esperadoPorIncidencia.set(nuevaId, (esperadoPorIncidencia.get(nuevaId) ?? 0) + 1);
      }
    } catch (e) {
      throw e instanceof ErrorAplicacion ? e : new ErrorAplicacion("ERROR_RELINK", "RELINK", (e as Error).message);
    }

    // 8) VERIFICACIÓN (cualquier diferencia → ROLLBACK COMPLETO)
    const fallo = (m: string) => new ErrorAplicacion("VERIFICACION_FALLIDA", "VERIFICACION", m);
    const nVac = await cuenta(conn, "SELECT COUNT(*) AS n FROM vacaciones WHERE empresa_id = ?", [empresaId]);
    if (nVac !== plan.vacaciones.length) throw fallo(`Vacaciones: ${nVac} en BD y ${plan.vacaciones.length} esperadas.`);
    const nInc = await cuenta(conn, `SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND tipo IN ${TIPOS_SQL}`, [empresaId]);
    if (nInc !== plan.vacaciones.length) throw fallo(`Incidencias de vacaciones: ${nInc} en BD y ${plan.vacaciones.length} esperadas.`);
    const nuevasIds = [...nuevaIncidencia.values()];
    let detalleBd = 0;
    const sumaPorInc = new Map<number, number>();
    for (const t of trozos(nuevasIds)) {
      for (const r of filas(await conn.query(`SELECT incidencia_id, COUNT(*) AS lineas, SUM(dias_tomados) AS dias FROM detalle_consumo_vacaciones WHERE incidencia_id IN (${ph(t.length)}) GROUP BY incidencia_id`, t))) {
        detalleBd += Number(r.lineas);
        sumaPorInc.set(Number(r.incidencia_id), r2(Number(r.dias)));
      }
    }
    if (detalleBd !== lineasDetalle) throw fallo(`Detalle FIFO: ${detalleBd} línea(s) en BD y ${lineasDetalle} esperadas.`);
    for (const v of plan.vacaciones) {
      const esperado = r2(v.dias - v.deficit);
      const real = sumaPorInc.get(nuevaIncidencia.get(v.clave)!) ?? 0;
      if (real !== esperado) throw fallo(`La vacación ${v.clave} suma ${real} día(s) de detalle FIFO y se esperaban ${esperado}.`);
    }
    for (const e of plan.empleados) {
      const n = await cuenta(conn, "SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ?", [empresaId, e.empleadoId]);
      if (n !== e.periodos.length) throw fallo(`${e.nombre}: ${n} saldo(s) en BD y ${e.periodos.length} esperados.`);
    }
    if (await cuenta(conn, "SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id = ? AND dias_disponibles < 0", [empresaId]) !== 0) throw fallo("Hay saldos con días disponibles negativos.");
    // evidencias: 13 antes = 13 después, campos idénticos, ninguna huérfana ni duplicada inesperada
    const despuesEv = await cuenta(conn, "SELECT COUNT(*) AS n FROM evidencias_incidencias WHERE empresa_id = ?", [empresaId]);
    if (despuesEv !== antes.evidencias) throw fallo(`Evidencias: ${antes.evidencias} antes y ${despuesEv} después.`);
    const evBd = new Map<number, RowDataPacket>();
    for (const r of filas(await conn.query("SELECT id, empresa_id, incidencia_id, ruta_archivo, nombre_original, DATE_FORMAT(subido_en, '%Y-%m-%d %H:%i:%s') AS subido_en, subido_por FROM evidencias_incidencias WHERE empresa_id = ?", [empresaId]))) evBd.set(Number(r.id), r);
    for (const ev of staging) {
      const r = evBd.get(ev.id);
      if (!r) throw fallo(`La evidencia ${ev.id} ya no existe.`);
      if (Number(r.empresa_id) !== ev.empresaId || String(r.ruta_archivo) !== ev.rutaArchivo || (r.nombre_original ?? null) !== ev.nombreOriginal || String(r.subido_en) !== ev.subidoEn || (r.subido_por ?? null) !== ev.subidoPor) {
        throw fallo(`La evidencia ${ev.id} cambió de contenido (ruta_archivo, nombre_original, subido_en, subido_por o empresa).`);
      }
      if (Number(r.incidencia_id) !== destinoPorEvidencia.get(ev.id)) throw fallo(`La evidencia ${ev.id} apunta a una incidencia distinta de la prevista.`);
    }
    const huerfanas = await cuenta(conn, "SELECT COUNT(*) AS n FROM evidencias_incidencias e LEFT JOIN incidencias i ON i.id = e.incidencia_id WHERE e.empresa_id = ? AND i.id IS NULL", [empresaId]);
    if (huerfanas !== 0) throw fallo(`${huerfanas} evidencia(s) huérfana(s).`);
    for (const t of trozos(nuevasIds)) {
      for (const r of filas(await conn.query(`SELECT incidencia_id, COUNT(*) AS n FROM evidencias_incidencias WHERE empresa_id = ? AND incidencia_id IN (${ph(t.length)}) GROUP BY incidencia_id`, [empresaId, ...t]))) {
        if (Number(r.n) !== (esperadoPorIncidencia.get(Number(r.incidencia_id)) ?? 0)) throw fallo(`La incidencia ${r.incidencia_id} tiene ${r.n} evidencia(s) y se esperaban ${esperadoPorIncidencia.get(Number(r.incidencia_id)) ?? 0}.`);
      }
    }
    if (await cuenta(conn, `SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND tipo NOT IN ${TIPOS_SQL}`, [empresaId]) !== antes.otrasIncidencias) throw fallo("Cambió la cantidad de incidencias de otros tipos.");
    if (await cuenta(conn, "SELECT COUNT(*) AS n FROM empleados WHERE empresa_id = ?", [empresaId]) !== antes.empleados) throw fallo("Cambió la cantidad de empleados.");
    if (await cuenta(conn, "SELECT COUNT(*) AS n FROM solicitudes_vacaciones WHERE empresa_id = ?", [empresaId]).catch(() => 0) !== antes.solicitudes) throw fallo("Cambió la cantidad de solicitudes de vacaciones.");
    if ((await contarHistorico(conn)) !== historicoAntes) throw fallo(`${BACKUP_HISTORICO} cambió.`);

    // 9) AUDITORÍA (dentro de la transacción)
    try {
      const pc = conn as unknown as PoolConnection;
      await registrarAuditoriaTx(pc, {
        empresaId, usuario: confirmacion.usuario, accion: "RECONSTRUCCION_VACACIONES", modulo: "rrhh",
        detalle: JSON.stringify({ sello: confirmacion.sello, huellaFuente: plan.huellaFuente, respaldos, resumen: plan.resumen, evidenciasRelinkeadas: staging.length }),
      });
      for (const d of plan.decisiones.aplicadas) {
        await registrarAuditoriaTx(pc, { empresaId, usuario: confirmacion.usuario, accion: "RECONSTRUCCION_VACACIONES_DECISION", modulo: "rrhh", detalle: JSON.stringify(d) });
      }
    } catch (e) {
      throw new ErrorAplicacion("ERROR_AUDITORIA", "AUDITORIA", (e as Error).message);
    }

    await conn.commit();
    enTransaccion = false;
    return { ok: true, sello: confirmacion.sello, respaldos, vacaciones: nVac, incidencias: nInc, detalleFifo: detalleBd, saldos: saldosNuevos, evidenciasRelinkeadas: staging.length, empleados: plan.empleados.length };
  } catch (e) {
    if (enTransaccion) { try { await conn.rollback(); } catch { /* la conexión pudo perderse: el servidor revierte la transacción abierta */ } }
    if (e instanceof ErrorAplicacion) throw e;
    throw new ErrorAplicacion("ERROR_INESPERADO", "TRANSACCION", (e as Error).message);
  } finally {
    conn.release();
  }
}

export type { PlanReconstruccion };
