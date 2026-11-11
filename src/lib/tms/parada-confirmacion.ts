import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal, fmtTs } from "@/lib/rrhh/dates";

/**
 * TMS-ENTREGA-PILOTO-1 — confirmación de entrega POR PARADA hecha por el piloto (decisión D08 aprobada por el propietario).
 * Reutiliza tms_plan_paradas, flota_viaje_evidencias (evidencia de la parada que ya sube el Portal del piloto, tipo 'producto' + parada_id)
 * y la auditoría existente. Tabla nueva: tms_parada_confirmaciones (sql/migrate-2026-11-tms-parada-confirmaciones.sql, PARA REVISIÓN).
 *
 * Reglas:
 *  - Solo el piloto PRINCIPAL o EXTRA del plan (no auxiliares) confirma; la empresa sale de la sesión; plan, parada y evidencia deben ser de esa empresa y de ese viaje.
 *  - El viaje debe estar en curso (flota_viajes 'abierto' y plan 'En ruta'); solo paradas Entrega/Descarga (no Carga).
 *  - Exige al menos una evidencia vinculada a ESA parada; cada parada tiene su propia confirmación independiente.
 *  - Sin aprobación previa de personal. PARCIAL / RECHAZADA / INCIDENCIA exigen nota y quedan PENDIENTES de revisión humana; mientras haya una pendiente, el piloto no
 *    puede confirmar esa parada como entregada.
 *  - Solo se AGREGAN filas: nada actualiza ni borra confirmaciones. La evidencia referenciada no se puede eliminar (ver evidenciaConfirmada).
 *  - NO es recepción aceptada por PriceSmart: no publica estados externos ni toca solicitudes, outbox o adaptación.
 */

export const RESULTADOS_CONFIRMACION = ["ENTREGADA_POR_PILOTO", "PARCIAL", "RECHAZADA", "INCIDENCIA"] as const;
export type ResultadoConfirmacion = (typeof RESULTADOS_CONFIRMACION)[number];
export const TIPOS_PARADA_CONFIRMABLES = ["Entrega", "Descarga"] as const;
export const NOTA_MIN = 5;
export const NOTA_MAX = 500;
/** Estado oficial de la recepción en PriceSmart: SIEMPRE «no aceptada» aquí; la confirmación del piloto no equivale a recepción oficial. */
export const RECEPCION_OFICIAL = "NO_ACEPTADA_POR_PRICESMART" as const;

export const confirmarParadaSchema = z.object({
  resultado: z.enum(RESULTADOS_CONFIRMACION),
  evidenciaId: z.number().int().positive().optional(),
  nota: z.string().trim().max(NOTA_MAX).optional(),
}).strict();
export type ConfirmarParadaBody = z.infer<typeof confirmarParadaSchema>;

export type ConfirmacionParada = {
  id: number;
  planId: number;
  paradaId: number;
  resultado: ResultadoConfirmacion;
  revision: "NO_REQUERIDA" | "PENDIENTE";
  pilotoUsuario: string;
  confirmadoEn: string;
  evidenciaId: number;
  nota: string | null;
  recepcionOficial: typeof RECEPCION_OFICIAL;
  estadoExternoPublicado: false;
};

export type CodigoErrorConfirmacion =
  | "NO_ASIGNADO" | "PARADA_INVALIDA" | "TIPO_NO_CONFIRMABLE" | "VIAJE_NO_EN_CURSO" | "SIN_EVIDENCIA" | "EVIDENCIA_INVALIDA"
  | "NOTA_REQUERIDA" | "YA_CONFIRMADA" | "REVISION_PENDIENTE" | "NO_DISPONIBLE";
const STATUS: Record<CodigoErrorConfirmacion, number> = {
  NO_ASIGNADO: 403, PARADA_INVALIDA: 404, TIPO_NO_CONFIRMABLE: 409, VIAJE_NO_EN_CURSO: 409, SIN_EVIDENCIA: 409, EVIDENCIA_INVALIDA: 400,
  NOTA_REQUERIDA: 400, YA_CONFIRMADA: 409, REVISION_PENDIENTE: 409, NO_DISPONIBLE: 503,
};
const MENSAJE: Record<CodigoErrorConfirmacion, string> = {
  NO_ASIGNADO: "Solo el piloto asignado al viaje puede confirmar entregas.",
  PARADA_INVALIDA: "La parada no pertenece al viaje.",
  TIPO_NO_CONFIRMABLE: "Solo las paradas de entrega o descarga se confirman.",
  VIAJE_NO_EN_CURSO: "El viaje debe estar en ruta para confirmar entregas.",
  SIN_EVIDENCIA: "Registra primero una evidencia de esta parada.",
  EVIDENCIA_INVALIDA: "La evidencia no corresponde a esta parada.",
  NOTA_REQUERIDA: `Describe lo ocurrido (mínimo ${NOTA_MIN} caracteres).`,
  YA_CONFIRMADA: "Esta parada ya fue confirmada como entregada.",
  REVISION_PENDIENTE: "Esta parada tiene una incidencia pendiente de revisión.",
  NO_DISPONIBLE: "La confirmación de entregas aún no está habilitada.",
};
export type ResultadoConfirmar =
  | { ok: true; confirmacion: ConfirmacionParada; replayed: boolean }
  | { ok: false; codigo: CodigoErrorConfirmacion; status: number; mensaje: string };
const falla = (codigo: CodigoErrorConfirmacion): ResultadoConfirmar => ({ ok: false, codigo, status: STATUS[codigo], mensaje: MENSAJE[codigo] });

/** ENTREGADA_POR_PILOTO no requiere revisión; todo lo demás (parcial, rechazada, incidencia) queda PENDIENTE de revisión humana. */
export function revisionDe(resultado: ResultadoConfirmacion): "NO_REQUERIDA" | "PENDIENTE" {
  return resultado === "ENTREGADA_POR_PILOTO" ? "NO_REQUERIDA" : "PENDIENTE";
}
const tablaFaltante = (e: unknown) => (e as { errno?: number; code?: string })?.errno === 1146 || (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

function mapFila(r: RowDataPacket): ConfirmacionParada {
  return {
    id: Number(r.id), planId: Number(r.plan_id), paradaId: Number(r.parada_id), resultado: String(r.resultado) as ResultadoConfirmacion,
    revision: String(r.revision) as "NO_REQUERIDA" | "PENDIENTE", pilotoUsuario: String(r.piloto_usuario), confirmadoEn: fmtTs(r.confirmado_en as string | Date) ?? String(r.confirmado_en),
    evidenciaId: Number(r.evidencia_id), nota: r.nota != null ? String(r.nota) : null, recepcionOficial: RECEPCION_OFICIAL, estadoExternoPublicado: false,
  };
}

/**
 * Confirma (o registra la incidencia de) UNA parada. Una transacción: bloquea la parada (mismo bloqueo que el flujo de evidencias y la edición de paradas),
 * valida y agrega una fila + auditoría, o no deja nada. Un reintento idéntico del mismo piloto devuelve la confirmación ya guardada (`replayed`).
 */
export async function confirmarParadaPorPiloto(input: {
  empresaId: number; empleadoId: number; usuario: string; viajeId: number; planId: number; paradaId: number; body: ConfirmarParadaBody;
}): Promise<ResultadoConfirmar> {
  const { empresaId, empleadoId, usuario, viajeId, planId, paradaId } = input;
  const body = confirmarParadaSchema.parse(input.body);
  const nota = body.nota && body.nota.length ? body.nota : null;
  if (body.resultado !== "ENTREGADA_POR_PILOTO" && (nota === null || nota.length < NOTA_MIN)) return falla("NOTA_REQUERIDA");
  const conn: PoolConnection = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [paradas] = await conn.query<RowDataPacket[]>(
      `SELECT pp.id, pp.orden, pp.lugar_nombre, pp.tipo, p.estado AS plan_estado, p.piloto_id
       FROM tms_plan_paradas pp INNER JOIN tms_planes_viaje p ON p.id = pp.plan_id
       WHERE pp.id = ? AND pp.plan_id = ? AND p.empresa_id = ? FOR UPDATE`,
      [paradaId, planId, empresaId]);
    const parada = paradas[0];
    if (!parada) { await conn.rollback(); return falla("PARADA_INVALIDA"); }
    const [pilotos] = await conn.query<RowDataPacket[]>(
      `SELECT per.id FROM tms_personal per
       WHERE per.empresa_id = ? AND per.id_empleado = ?
         AND (per.id = ? OR per.id IN (SELECT x.personal_id FROM tms_plan_pilotos_adicionales x WHERE x.plan_id = ?))
       LIMIT 1`,
      [empresaId, empleadoId, parada.piloto_id ?? 0, planId]);
    if (!pilotos[0]) { await conn.rollback(); return falla("NO_ASIGNADO"); }
    const personalId = Number(pilotos[0].id);
    if (!(TIPOS_PARADA_CONFIRMABLES as readonly string[]).includes(String(parada.tipo))) { await conn.rollback(); return falla("TIPO_NO_CONFIRMABLE"); }
    const [viajes] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes WHERE id = ? AND empresa_id = ? AND plan_id = ? AND estado = 'abierto' LIMIT 1`, [viajeId, empresaId, planId]);
    if (!viajes[0] || String(parada.plan_estado) !== "En ruta") { await conn.rollback(); return falla("VIAJE_NO_EN_CURSO"); }

    const [evidencias] = body.evidenciaId
      ? await conn.query<RowDataPacket[]>(
        `SELECT id, ruta_relativa, capturado_en, subido_por FROM flota_viaje_evidencias
         WHERE id = ? AND empresa_id = ? AND viaje_id = ? AND parada_id = ? AND tipo = 'producto' FOR UPDATE`, [body.evidenciaId, empresaId, viajeId, paradaId])
      : await conn.query<RowDataPacket[]>(
        `SELECT id, ruta_relativa, capturado_en, subido_por FROM flota_viaje_evidencias
         WHERE empresa_id = ? AND viaje_id = ? AND parada_id = ? AND tipo = 'producto' ORDER BY id DESC LIMIT 1 FOR UPDATE`, [empresaId, viajeId, paradaId]);
    const evidencia = evidencias[0];
    if (!evidencia) { await conn.rollback(); return falla(body.evidenciaId ? "EVIDENCIA_INVALIDA" : "SIN_EVIDENCIA"); }

    const [previas] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM tms_parada_confirmaciones WHERE empresa_id = ? AND parada_id = ? ORDER BY id DESC LIMIT 1`, [empresaId, paradaId]);
    const previa = previas[0];
    if (previa) {
      const mismoPiloto = Number(previa.piloto_empleado_id) === empleadoId;
      // Reintento idéntico del mismo piloto (p. ej. red inestable): se devuelve lo ya guardado.
      if (previa.resultado === body.resultado && mismoPiloto) { await conn.rollback(); return { ok: true, confirmacion: mapFila(previa), replayed: true }; }
      await conn.rollback();
      return falla(previa.resultado === "ENTREGADA_POR_PILOTO" ? "YA_CONFIRMADA" : "REVISION_PENDIENTE");
    }

    const ahora = ahoraLocal();
    let id: number;
    try {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO tms_parada_confirmaciones
          (empresa_id, plan_id, viaje_id, parada_id, parada_tipo, parada_orden, parada_lugar_nombre, resultado, revision, entrega_vigente,
           piloto_empleado_id, piloto_personal_id, piloto_usuario, evidencia_id, evidencia_ruta, evidencia_capturada_en, evidencia_subido_por, nota, confirmado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, planId, viajeId, paradaId, String(parada.tipo), Number(parada.orden), String(parada.lugar_nombre), body.resultado, revisionDe(body.resultado),
          body.resultado === "ENTREGADA_POR_PILOTO" ? 1 : null, empleadoId, personalId, usuario, Number(evidencia.id), String(evidencia.ruta_relativa),
          evidencia.capturado_en ?? null, evidencia.subido_por ?? null, nota, ahora]);
      id = Number(r.insertId);
    } catch (e) {
      await conn.rollback();
      if ((e as { code?: string })?.code === "ER_DUP_ENTRY") return falla("YA_CONFIRMADA");   // carrera residual: el UNIQUE de la base lo impide
      if (tablaFaltante(e)) return falla("NO_DISPONIBLE");
      throw e;
    }
    await registrarAuditoriaTx(conn, {
      empresaId, usuario, accion: "confirmar_entrega_parada_piloto", modulo: "tms",
      detalle: `Confirmación #${id}: ${body.resultado} · parada #${paradaId} (${String(parada.tipo)} ${Number(parada.orden)}) del plan #${planId} · viaje #${viajeId} · evidencia #${Number(evidencia.id)}.`,
    });
    await conn.commit();
    return { ok: true, replayed: false, confirmacion: { id, planId, paradaId, resultado: body.resultado, revision: revisionDe(body.resultado), pilotoUsuario: usuario,
      confirmadoEn: ahora, evidenciaId: Number(evidencia.id), nota, recepcionOficial: RECEPCION_OFICIAL, estadoExternoPublicado: false } };
  } catch (error) {
    try { await conn.rollback(); } catch { /* conexión ya cerrada */ }
    if (tablaFaltante(error)) return falla("NO_DISPONIBLE");
    throw error;
  } finally {
    conn.release();
  }
}

/** Historial (más reciente primero) de confirmaciones de las paradas de un plan de esta empresa. Tabla ausente ⇒ lista vacía (migración no aplicada). */
export async function listarConfirmacionesPlan(empresaId: number, planId: number): Promise<ConfirmacionParada[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT * FROM tms_parada_confirmaciones WHERE empresa_id = ? AND plan_id = ? ORDER BY id DESC`, [empresaId, planId]);
    return rows.map(mapFila);
  } catch (e) {
    if (tablaFaltante(e)) return [];
    throw e;
  }
}

/** ¿Alguna confirmación referencia esta evidencia (por id de flota o por ruta de archivo, que comparten flota_viaje_evidencias y tms_evidencias)? Impide eliminarla. Tabla ausente ⇒ false. */
export async function evidenciaConfirmada(empresaId: number, ruta: string): Promise<boolean> {
  if (!ruta) return false;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id FROM tms_parada_confirmaciones WHERE empresa_id = ? AND evidencia_ruta = ? LIMIT 1`, [empresaId, ruta]);
    return rows.length > 0;
  } catch (e) {
    if (tablaFaltante(e)) return false;
    throw e;
  }
}
export const MSG_EVIDENCIA_CONFIRMADA = "No se puede eliminar una evidencia que respalda la confirmación de una entrega.";
