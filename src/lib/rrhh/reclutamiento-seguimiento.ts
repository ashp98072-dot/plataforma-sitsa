import type { RowDataPacket } from "mysql2";
import { execute, getPool, query } from "@/lib/db";

export async function listarUsuariosReclutamiento(empresaId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT u.id, u.username, u.nombre
     FROM usuarios u
     LEFT JOIN usuario_modulo um ON um.usuario_id = u.id
       AND (um.empresa_id IS NULL OR um.empresa_id = ?)
       AND um.modulo IN ('rrhh', 'entrevistas') AND um.puede_ver = 1
     WHERE u.activo = 1
       AND (u.acceso_todas_empresas = 1 OR EXISTS (
         SELECT 1 FROM usuario_empresa ue WHERE ue.usuario_id = u.id AND ue.empresa_id = ?
       ))
       AND (u.rol_global IN ('Admin', 'RRHH') OR um.id IS NOT NULL)
     ORDER BY COALESCE(u.nombre, u.username), u.username`,
    [empresaId, empresaId],
  );
  return rows.map(r => ({ id: Number(r.id), username: String(r.username), nombre: r.nombre ? String(r.nombre) : null }));
}

export async function obtenerSeguimiento(empresaId: number, entrevistaId: number) {
  const [responsables, comentarios] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT u.id, u.username, u.nombre, er.asignado_en
       FROM entrevista_responsables er INNER JOIN usuarios u ON u.id = er.usuario_id
       WHERE er.empresa_id = ? AND er.entrevista_id = ? ORDER BY COALESCE(u.nombre, u.username)`,
      [empresaId, entrevistaId],
    ),
    query<RowDataPacket[]>(
      `SELECT es.id, es.comentario, es.creado_en, u.username, u.nombre
       FROM entrevista_seguimiento es INNER JOIN usuarios u ON u.id = es.creado_por
       WHERE es.empresa_id = ? AND es.entrevista_id = ? ORDER BY es.creado_en DESC, es.id DESC`,
      [empresaId, entrevistaId],
    ),
  ]);
  return {
    responsables: responsables.map(r => ({ id: Number(r.id), username: String(r.username), nombre: r.nombre ? String(r.nombre) : null, asignadoEn: String(r.asignado_en) })),
    comentarios: comentarios.map(r => ({ id: Number(r.id), comentario: String(r.comentario), creadoEn: String(r.creado_en), autor: r.nombre ? String(r.nombre) : String(r.username), username: String(r.username) })),
  };
}

export async function reemplazarResponsables(input: { empresaId: number; entrevistaId: number; usuarioIds: number[]; asignadoPor: number }) {
  const ids = [...new Set(input.usuarioIds)];
  const elegibles = await listarUsuariosReclutamiento(input.empresaId);
  const permitidos = new Set(elegibles.map(u => u.id));
  if (ids.some(id => !permitidos.has(id))) throw new Error("Uno de los responsables no tiene acceso a RRHH en esta empresa.");
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [ent] = await conn.query<RowDataPacket[]>("SELECT id FROM entrevistas WHERE empresa_id = ? AND id = ? LIMIT 1 FOR UPDATE", [input.empresaId, input.entrevistaId]);
    if (!ent[0]) throw new Error("Entrevista no encontrada.");
    await conn.execute("DELETE FROM entrevista_responsables WHERE empresa_id = ? AND entrevista_id = ?", [input.empresaId, input.entrevistaId]);
    for (const usuarioId of ids) await conn.execute(
      `INSERT INTO entrevista_responsables (empresa_id, entrevista_id, usuario_id, asignado_por) VALUES (?, ?, ?, ?)`,
      [input.empresaId, input.entrevistaId, usuarioId, input.asignadoPor],
    );
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

export async function agregarComentario(input: { empresaId: number; entrevistaId: number; usuarioId: number; comentario: string }) {
  const comentario = input.comentario.trim();
  if (!comentario) throw new Error("Escribe un comentario de seguimiento.");
  const result = await execute(
    `INSERT INTO entrevista_seguimiento (empresa_id, entrevista_id, comentario, creado_por)
     SELECT ?, id, ?, ? FROM entrevistas WHERE empresa_id = ? AND id = ?`,
    [input.empresaId, comentario, input.usuarioId, input.empresaId, input.entrevistaId],
  );
  if (!result.affectedRows) throw new Error("Entrevista no encontrada.");
}
