import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

export const casoSchema = z.object({
  titulo: z.string().trim().min(1).max(200),
  descripcion: z.string().trim().min(1).max(10000),
  empleadoId: z.number().int().positive().nullable(),
  responsableId: z.number().int().positive(),
});
export const seguimientoSchema = z.object({
  id: z.number().int().positive(), version: z.number().int().positive(),
  comentario: z.string().trim().min(1).max(10000),
  estado: z.enum(["Abierto", "En seguimiento", "Cerrado"]),
  responsableId: z.number().int().positive(),
});
export class ErrorCaso extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function consultarCasos(empresaId: number, id?: number, pagina = 1) {
  const casos = await query<RowDataPacket[]>(
    `SELECT id, titulo, descripcion, empleado_nombre, responsable_nombre, responsable_id,
      estado, version, creado_por, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS fecha
     FROM rrhh_casos_legales WHERE empresa_id = ? ${id ? "AND id = ?" : ""}
     ORDER BY id DESC LIMIT 51 OFFSET ?`,
    id ? [empresaId, id, 0] : [empresaId, (pagina - 1) * 50],
  );
  if (id && !casos.length) throw new ErrorCaso("Caso no encontrado.", 404);
  const seguimientos = id ? await query<RowDataPacket[]>(
    `SELECT version, comentario, estado, responsable_nombre, creado_por,
       DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS fecha
     FROM rrhh_casos_legales_seguimientos WHERE empresa_id = ? AND caso_id = ? ORDER BY version`, [empresaId, id],
  ) : [];
  const empleados = await query<RowDataPacket[]>("SELECT id, nombre FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre", [empresaId]);
  return { casos: casos.slice(0, 50), hayMas: casos.length > 50, seguimientos, empleados };
}

/** Cada cambio agrega historia inmutable y auditoría; nunca reescribe hechos previos. */
export async function guardarCaso(empresaId: number, autor: string, input: z.infer<typeof casoSchema> | z.infer<typeof seguimientoSchema>) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let id: number;
    let version = 1;
    if ("id" in input) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT id, version FROM rrhh_casos_legales WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, input.id]);
      if (!rows.length) throw new ErrorCaso("Caso no encontrado.", 404);
      if (Number(rows[0].version) !== input.version) throw new ErrorCaso("Otro usuario actualizó el caso. Recarga antes de guardar.", 409);
      id = input.id;
      version = input.version + 1;
    } else { id = 0; }
    const empleadoId = "empleadoId" in input ? input.empleadoId : null;
    const [personas] = await conn.query<RowDataPacket[]>(
      "SELECT id, nombre, estado FROM empleados WHERE empresa_id = ? AND id IN (?, ?) ORDER BY id FOR UPDATE",
      [empresaId, input.responsableId, empleadoId],
    );
    const responsable = personas.find((p) => Number(p.id) === input.responsableId && p.estado === "Activo");
    const empleado = personas.find((p) => Number(p.id) === empleadoId);
    if (!responsable || (empleadoId && !empleado)) throw new ErrorCaso("Empleado o responsable no válido para esta empresa.");
    const estado = "estado" in input ? input.estado : "Abierto";
    const comentario = "comentario" in input ? input.comentario : input.descripcion;
    if ("id" in input) {
      await conn.execute("UPDATE rrhh_casos_legales SET estado = ?, responsable_id = ?, responsable_nombre = ?, version = ? WHERE empresa_id = ? AND id = ?",
        [estado, input.responsableId, responsable.nombre, version, empresaId, id]);
    } else {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO rrhh_casos_legales (empresa_id, titulo, descripcion, empleado_id, empleado_nombre, responsable_id, responsable_nombre, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, input.titulo, input.descripcion, empleadoId, empleado?.nombre ?? null, input.responsableId, responsable.nombre, autor],
      );
      id = r.insertId;
    }
    await conn.execute(`INSERT INTO rrhh_casos_legales_seguimientos
      (empresa_id, caso_id, version, comentario, estado, responsable_nombre, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, id, version, comentario, estado, responsable.nombre, autor]);
    await registrarAuditoriaTx(conn, { empresaId, usuario: autor, modulo: "bitacora_legal", accion: "seguimiento_caso", detalle: `Caso #${id}; versión ${version}; estado ${estado}.` });
    await conn.commit();
    return { id, version };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
