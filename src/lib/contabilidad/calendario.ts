import { z } from "zod";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { bloquearAmbito, type AmbitoContable } from "./ambito";
import { validarCalendarioContable, type EjercicioCalendario, type PeriodoCalendario } from "./calendario-schema";
import { ErrorCalendario } from "./calendario-errores";
export { ErrorCalendario } from "./calendario-errores";
const id = z.number().int().positive().max(2147483647);
const columnas = "id, codigo, DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fechaInicio, DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fechaFin, estado";
async function exigirEntidad(c: PoolConnection, empresaId: number, entidadId: number) {
  id.parse(empresaId); id.parse(entidadId);
  const [rows] = await c.query<RowDataPacket[]>("SELECT id FROM cont_entidades WHERE empresa_id = ? AND id = ?", [empresaId, entidadId]);
  if (!rows.length) throw new ErrorCalendario("Entidad no disponible.", 404);
}

/** No DDL, seeds ni modificaciones de asientos. El lock de ámbito serializa incluso el caso sin ejercicios previos. */
export async function crearEjercicioConPeriodos(empresaId: number, usuario: string, ambito: AmbitoContable, input: unknown) {
  const d = validarCalendarioContable(input);
  id.parse(empresaId); id.parse(ambito.entidadId); id.parse(ambito.usuarioId);
  const c = await getPool().getConnection();
  try {
    await c.beginTransaction();
    // Primera lectura de negocio: lock estable de empresa incluso sin ejercicios.
    // El adaptador no debe introducir lecturas consistentes antes de este lock:
    // en MariaDB con snapshot isolation fijarían una vista anterior al ganador.
    await bloquearAmbito(c, empresaId, ambito, true);
    const [conflictos] = await c.query<RowDataPacket[]>(
      "SELECT id FROM cont_ejercicios WHERE empresa_id = ? AND entidad_id = ? AND (codigo = ? OR (fecha_inicio <= ? AND fecha_fin >= ?)) FOR UPDATE",
      [empresaId, ambito.entidadId, d.codigo, d.fechaFin, d.fechaInicio],
    );
    if (conflictos.length) throw new ErrorCalendario("Ya existe un ejercicio con ese código o con fechas que se solapan.");
    const [r] = await c.execute<ResultSetHeader>(
      "INSERT INTO cont_ejercicios (empresa_id, entidad_id, codigo, fecha_inicio, fecha_fin, estado, creado_por) VALUES (?, ?, ?, ?, ?, 'CONFIGURADO', ?)",
      [empresaId, ambito.entidadId, d.codigo, d.fechaInicio, d.fechaFin, ambito.usuarioId],
    );
    for (const [i, p] of d.periodos.entries()) await c.execute(
      "INSERT INTO cont_periodos (empresa_id, entidad_id, ejercicio_id, codigo, orden, fecha_inicio, fecha_fin, estado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIGURADO', ?)",
      [empresaId, ambito.entidadId, r.insertId, p.codigo, i + 1, p.fechaInicio, p.fechaFin, ambito.usuarioId],
    );
    await registrarAuditoriaTx(c, { empresaId, usuario, modulo: "contabilidad", accion: "calendario_crear",
      detalle: JSON.stringify({ entidadId: ambito.entidadId, ejercicioId: r.insertId, actorId: ambito.usuarioId, estado: "CONFIGURADO", ...d }) });
    await c.commit();
    return { id: r.insertId };
  } catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
}

export async function listarEjercicios(empresaId: number, entidadId: number): Promise<EjercicioCalendario[]> {
  const c = await getPool().getConnection();
  try {
    await exigirEntidad(c, empresaId, entidadId);
    const [rows] = await c.query<RowDataPacket[]>(`SELECT ${columnas} FROM cont_ejercicios WHERE empresa_id = ? AND entidad_id = ? ORDER BY fecha_inicio DESC, id DESC`, [empresaId, entidadId]);
    return rows as EjercicioCalendario[];
  } finally { c.release(); }
}

export async function listarPeriodos(empresaId: number, entidadId: number, ejercicioId: number): Promise<PeriodoCalendario[]> {
  id.parse(ejercicioId);
  const c = await getPool().getConnection();
  try {
    await exigirEntidad(c, empresaId, entidadId);
    const [padre] = await c.query<RowDataPacket[]>("SELECT id FROM cont_ejercicios WHERE empresa_id = ? AND entidad_id = ? AND id = ?", [empresaId, entidadId, ejercicioId]);
    if (!padre.length) throw new ErrorCalendario("Ejercicio no disponible.", 404);
    const [rows] = await c.query<RowDataPacket[]>(`SELECT ${columnas}, ejercicio_id AS ejercicioId, orden FROM cont_periodos WHERE empresa_id = ? AND entidad_id = ? AND ejercicio_id = ? ORDER BY orden`, [empresaId, entidadId, ejercicioId]);
    return rows as PeriodoCalendario[];
  } finally { c.release(); }
}
