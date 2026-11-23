import type { RowDataPacket } from "mysql2";
import { getPool, query, type SqlValue } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { ErrorCB2 } from "./model";
import { esquemaPilotosReportados } from "./pilotos-reportados";

/**
 * Administración de las equivalencias de pilotos (nombre del Excel → empleado de RR. HH. o piloto reportado) que reconocen automáticamente las importaciones Shell y HALEL.
 * Corregir una equivalencia SOLO cambia el reconocimiento de importaciones FUTURAS: nunca modifica consumos, vínculos consumo↔piloto reportado, empleados ni el registro del piloto
 * reportado (flota_cb2_pilotos_reportados). Todo se acota por la empresa de la sesión y se audita.
 */
export type EquivalenciaPiloto = {
  nombreHash: string; nombre: string; tipo: "EMPLEADO" | "REPORTADO"; empleadoId: number | null; empleadoNombre: string | null; reportadoId: number | null; reportadoNombre: string | null;
  requiereRevision: boolean; confirmadoEn: string | null; consumos: number;
};
export type CorreccionEquivalencia = { nombreHash: string; accion: "QUITAR" } | { nombreHash: string; accion: "EMPLEADO"; empleadoId: number };
export type ContextoEquivalencias = { empresaId: number; actor: { id: number; username: string } };

/** Lista las equivalencias de la empresa; vacía si el registro de pilotos reportados no está instalado. */
export async function listarEquivalenciasPilotos(empresaId: number): Promise<{ instalado: boolean; items: EquivalenciaPiloto[] }> {
  if (!(await esquemaPilotosReportados())) return { instalado: false, items: [] };
  const filas = await query<RowDataPacket[]>(
    `SELECT e.nombre_hash, e.nombre_normalizado, e.empleado_id, emp.nombre AS empleado_nombre, e.piloto_reportado_id, p.nombre_muestra AS reportado_nombre, e.requiere_revision, e.confirmado_en,
            (SELECT COUNT(*) FROM flota_cb2_consumo_piloto_reportado c WHERE c.empresa_id = e.empresa_id AND c.piloto_reportado_id = e.piloto_reportado_id) AS consumos
     FROM flota_cb2_pilotos_equivalencias e
     LEFT JOIN empleados emp ON emp.id = e.empleado_id AND emp.empresa_id = e.empresa_id
     LEFT JOIN flota_cb2_pilotos_reportados p ON p.empresa_id = e.empresa_id AND p.id = e.piloto_reportado_id
     WHERE e.empresa_id = ? AND e.normalizacion_version = 1 ORDER BY e.nombre_normalizado LIMIT 1000`, [empresaId] as SqlValue[]);
  return { instalado: true, items: filas.map((r) => ({
    nombreHash: String(r.nombre_hash), nombre: String(r.nombre_normalizado), tipo: r.empleado_id != null ? "EMPLEADO" : "REPORTADO",
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null, empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
    reportadoId: r.piloto_reportado_id != null ? Number(r.piloto_reportado_id) : null, reportadoNombre: r.reportado_nombre != null ? String(r.reportado_nombre) : null,
    requiereRevision: Number(r.requiere_revision) === 1, confirmadoEn: r.confirmado_en != null ? String(r.confirmado_en) : null, consumos: Number(r.consumos ?? 0),
  })) };
}

/**
 * QUITAR: borra la equivalencia (la próxima importación vuelve a preguntar por ese nombre). EMPLEADO: la reasigna a un empleado de RR. HH. de la empresa (Activo o de Baja).
 * Los consumos ya importados conservan su vínculo original.
 */
export async function corregirEquivalenciaPiloto(ctx: ContextoEquivalencias, entrada: CorreccionEquivalencia) {
  if (!(await esquemaPilotosReportados())) throw new ErrorCB2("El registro de pilotos reportados no está instalado.", 503);
  const c = await getPool().getConnection();
  try {
    await c.beginTransaction();
    const [filas] = await c.query<RowDataPacket[]>("SELECT * FROM flota_cb2_pilotos_equivalencias WHERE empresa_id = ? AND normalizacion_version = 1 AND nombre_hash = ? FOR UPDATE", [ctx.empresaId, entrada.nombreHash]);
    const anterior = filas[0];
    if (!anterior) throw new ErrorCB2("La equivalencia no existe en esta empresa.", 404);
    if (entrada.accion === "QUITAR") {
      await c.execute("DELETE FROM flota_cb2_pilotos_equivalencias WHERE empresa_id = ? AND normalizacion_version = 1 AND nombre_hash = ?", [ctx.empresaId, entrada.nombreHash]);
    } else {
      const [emp] = await c.query<RowDataPacket[]>("SELECT id FROM empleados WHERE empresa_id = ? AND id = ? AND estado IN ('Activo','Baja') LOCK IN SHARE MODE", [ctx.empresaId, entrada.empleadoId]);
      if (!emp[0]) throw new ErrorCB2("Empleado no autorizado para esta empresa.", 403);
      await c.execute("UPDATE flota_cb2_pilotos_equivalencias SET empleado_id = ?, piloto_reportado_id = NULL, requiere_revision = 0, confirmado_por = ?, confirmado_en = ? WHERE empresa_id = ? AND normalizacion_version = 1 AND nombre_hash = ?",
        [entrada.empleadoId, ctx.actor.id, ahoraLocal(), ctx.empresaId, entrada.nombreHash]);
    }
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_corregir_equivalencia_piloto",
      detalle: JSON.stringify({ accion: entrada.accion, nombreHash: entrada.nombreHash, nombre: anterior.nombre_normalizado, anterior: { empleadoId: anterior.empleado_id ?? null, pilotoReportadoId: anterior.piloto_reportado_id ?? null }, nuevo: entrada.accion === "EMPLEADO" ? { empleadoId: entrada.empleadoId } : null, actorId: ctx.actor.id }).slice(0, 2000) });
    await c.commit();
    return { ok: true as const };
  } catch (e) {
    try { await c.rollback(); } catch { /* la conexión pudo perderse */ }
    throw e;
  } finally { c.release(); }
}
