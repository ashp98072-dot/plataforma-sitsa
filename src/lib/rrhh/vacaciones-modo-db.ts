import type { RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { getPool, query, type SqlParams } from "@/lib/db";
import type { ResultadoPreflight } from "./vacaciones-modo-preflight";
import { PARAMETRO_MODO_CARGA_HISTORICA, politicaPorModo, valorEsCargaHistorica, type PoliticaVacaciones } from "./vacaciones-politica";

/**
 * RRHH VACACIONES — MODO DE CARGA HISTÓRICA (capa de BD). La bandera vive POR EMPRESA en el almacén genérico ya existente
 * `configuracion(empresa_id, parametro, valor)` (sin tablas ni migraciones nuevas): `parametro = 'vacaciones_modo_carga_historica'`, `valor = '1'` ⇒ activo.
 * Ausente (o cualquier otro valor) ⇒ modo NORMAL. Cambiar el modo SOLO escribe esa fila y la auditoría: no toca saldos, incidencias, vacaciones, detalle
 * FIFO, evidencias ni fechas. Los saldos persistidos convergen con la sincronización normal (por colaborador, transaccional) o con la resincronización administrada.
 */

export type ConsultaModo = (sql: string, params?: SqlParams) => Promise<RowDataPacket[]>;

const SQL_LEER = "SELECT valor FROM configuracion WHERE empresa_id = ? AND parametro = ? LIMIT 1";

const sinTabla = (e: unknown) => (e as { errno?: number } | null)?.errno === 1146;

/** ¿La empresa está en modo de carga histórica? Sin tabla/fila ⇒ false (modo NORMAL). Cualquier otro error se propaga (no se asume un modo a ciegas). */
export async function modoCargaHistoricaActivo(consulta: ConsultaModo, empresaId: number, bloquear = false): Promise<boolean> {
  try {
    const rows = await consulta(SQL_LEER + (bloquear ? " FOR UPDATE" : ""), [empresaId, PARAMETRO_MODO_CARGA_HISTORICA]);
    return valorEsCargaHistorica(rows[0]?.valor);
  } catch (error) {
    if (sinTabla(error)) return false;
    throw error;
  }
}

/** ¿Modo de carga histórica activo? (lectura con el pool). */
export async function leerModoCargaHistorica(empresaId: number): Promise<boolean> {
  return modoCargaHistoricaActivo((sql, p) => query<RowDataPacket[]>(sql, p), empresaId);
}

/** Política vigente de la empresa leyendo con el pool (solo lectura). */
export async function obtenerPoliticaVacaciones(empresaId: number): Promise<PoliticaVacaciones> {
  return politicaPorModo(await modoCargaHistoricaActivo((sql, p) => query<RowDataPacket[]>(sql, p), empresaId));
}

/** Política vigente de la empresa dentro de una consulta (p. ej. la conexión transaccional del llamador). */
export async function obtenerPoliticaConConsulta(consulta: ConsultaModo, empresaId: number): Promise<PoliticaVacaciones> {
  return politicaPorModo(await modoCargaHistoricaActivo(consulta, empresaId));
}

export type ResultadoCambioModo = {
  cambiado: boolean;
  valorAnterior: boolean;
  valorNuevo: boolean;
  /** Presente cuando se pidió ACTIVAR y el preflight encontró consumo no verificable: NO se cambió nada. */
  preflight?: ResultadoPreflight;
};

/**
 * Activa o desactiva el modo de la empresa en UNA transacción: bloquea la fila, registra el cambio y audita (`vacaciones_modo_historico_activado` /
 * `vacaciones_modo_historico_desactivado`: empresa, usuario, fecha, valor anterior y nuevo). Idempotente: pedir el valor que ya tiene no escribe ni audita.
 * ACTIVAR exige antes un PREFLIGHT de solo lectura: si algún colaborador tiene consumo que no puede reconstruirse de forma verificable (en modo carga el saldo sale de
 * `otorgados − detalle FIFO` y podría inventar días), NO se cambia la bandera, NO se audita la activación y se devuelve el resumen en `preflight`. DESACTIVAR nunca se bloquea.
 */
export async function cambiarModoCargaHistorica(empresaId: number, activo: boolean, opciones: { usuario?: string | null; hoy?: Date } = {}): Promise<ResultadoCambioModo> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const anterior = await modoCargaHistoricaActivo(async (sql, p) => (await conn.query<RowDataPacket[]>(sql, p))[0], empresaId, true);
    if (anterior === activo) {
      await conn.rollback(); // nada que escribir
      return { cambiado: false, valorAnterior: anterior, valorNuevo: activo };
    }
    if (activo) {
      const { ejecutarPreflightModoHistorico } = await import("./vacaciones-modo-preflight-db"); // carga diferida (evita el ciclo con el rebase)
      const preflight = await ejecutarPreflightModoHistorico(async (sql, p) => (await conn.query<RowDataPacket[]>(sql, p))[0], empresaId);
      if (!preflight.puedeActivar) {
        await conn.rollback(); // nada que escribir
        return { cambiado: false, valorAnterior: anterior, valorNuevo: anterior, preflight };
      }
    }
    await conn.execute(
      "INSERT INTO configuracion (empresa_id, parametro, valor) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
      [empresaId, PARAMETRO_MODO_CARGA_HISTORICA, activo ? "1" : "0"],
    );
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: opciones.usuario ?? null, modulo: "rrhh",
      accion: activo ? "vacaciones_modo_historico_activado" : "vacaciones_modo_historico_desactivado",
      detalle: JSON.stringify({ empresaId, usuario: opciones.usuario ?? null, fecha: (opciones.hoy ?? new Date()).toISOString(), valorAnterior: anterior, valorNuevo: activo }),
    });
    await conn.commit();
    return { cambiado: true, valorAnterior: anterior, valorNuevo: activo };
  } catch (error) {
    try { await conn.rollback(); } catch { /* la conexión pudo perderse */ }
    throw error;
  } finally {
    conn.release();
  }
}
