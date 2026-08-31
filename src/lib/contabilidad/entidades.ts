import { z } from "zod";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

export class EntidadInvalida extends Error {}
const id = z.number().int().positive().max(2147483647);
export const entidadAccionSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("crear"), codigo: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/), nombre: z.string().trim().min(1).max(200) }),
  z.object({ accion: z.literal("estado"), entidadId: id, activa: z.boolean() }),
]);

/** El caller debe haber verificado permiso efectivo de Contabilidad y acceso al tenant. */
export async function listarEntidades(empresaId: number, admin: boolean) {
  return query<RowDataPacket[]>(
    admin
      ? "SELECT id, codigo, nombre, activa FROM cont_entidades WHERE empresa_id = ? ORDER BY codigo"
      : "SELECT id, codigo, nombre, activa FROM cont_entidades WHERE empresa_id = ? AND activa = 1 ORDER BY codigo",
    [empresaId],
  );
}

/** Solo llamado desde el endpoint de configuración protegido para Admin. */
export async function configurarEntidad(empresaId: number, usuario: string, input: unknown) {
  const parsed = entidadAccionSchema.safeParse(input);
  if (!parsed.success) throw new EntidadInvalida("Revisa los datos del libro. Los permisos se administran en Usuarios.");
  const d = parsed.data;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let entidadId: number;
    if (d.accion === "crear") {
      const [r] = await conn.execute<ResultSetHeader>(
        "INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, ?, ?)",
        [empresaId, d.codigo.toUpperCase(), d.nombre],
      );
      entidadId = Number(r.insertId);
    } else {
      entidadId = d.entidadId;
      const [entidades] = await conn.query<RowDataPacket[]>(
        "SELECT id, activa FROM cont_entidades WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, entidadId],
      );
      if (!entidades.length) throw new EntidadInvalida("Entidad no disponible en esta empresa.");
      if (d.accion === "estado") {
        await conn.execute("UPDATE cont_entidades SET activa = ? WHERE empresa_id = ? AND id = ?", [d.activa ? 1 : 0, empresaId, entidadId]);
      }
    }
    const detalle = d.accion === "crear" ? `Entidad #${entidadId} creada.`
      : `Entidad #${entidadId}; activa=${d.activa}.`;
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "contabilidad", accion: `entidad_${d.accion}`, detalle });
    await conn.commit();
    return entidadId;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
