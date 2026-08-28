import { z } from "zod";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

export class EntidadInvalida extends Error {}
const id = z.number().int().positive().max(2147483647);
export const entidadAccionSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("crear"), codigo: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/), nombre: z.string().trim().min(1).max(200) }),
  z.object({ accion: z.literal("estado"), entidadId: id, activa: z.boolean() }),
  z.object({ accion: z.literal("acceso"), entidadId: id, usuarioId: id, acceso: z.enum(["ver", "editar", "revocar"]) }),
]);

/** El caller debe haber verificado permiso efectivo de Contabilidad y acceso al tenant. */
export async function listarEntidades(empresaId: number, usuarioId: number, admin: boolean) {
  return query<RowDataPacket[]>(
    admin
      ? "SELECT id, codigo, nombre, activa FROM cont_entidades WHERE empresa_id = ? ORDER BY codigo"
      : `SELECT e.id, e.codigo, e.nombre, e.activa, a.puede_editar
         FROM cont_entidades e INNER JOIN cont_entidad_usuarios a
         ON a.empresa_id = e.empresa_id AND a.entidad_id = e.id
         WHERE e.empresa_id = ? AND e.activa = 1 AND a.usuario_id = ? AND a.activo = 1 ORDER BY e.codigo`,
    admin ? [empresaId] : [empresaId, usuarioId],
  );
}

export async function listarAsignaciones(empresaId: number) {
  return query<RowDataPacket[]>(
    `SELECT a.entidad_id, a.usuario_id, a.puede_editar, u.username, u.nombre
     FROM cont_entidad_usuarios a INNER JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.empresa_id = ? AND a.activo = 1 ORDER BY a.entidad_id, u.username`, [empresaId],
  );
}

export async function usuariosAsignables(empresaId: number) {
  // Asignar aquí no concede permiso de módulo. Ese permiso sigue verificándose en cada petición.
  return query<RowDataPacket[]>(
    `SELECT u.id, u.username, u.nombre FROM usuarios u WHERE u.activo = 1
     AND (u.rol_global = 'Admin' OR u.acceso_todas_empresas = 1 OR EXISTS
       (SELECT 1 FROM usuario_empresa ue WHERE ue.usuario_id = u.id AND ue.empresa_id = ?))
     ORDER BY u.username`, [empresaId],
  );
}

/** Solo llamado desde el endpoint de configuración protegido para Admin. */
export async function configurarEntidad(empresaId: number, usuario: string, input: unknown) {
  const parsed = entidadAccionSchema.safeParse(input);
  if (!parsed.success) throw new EntidadInvalida("Revisa los datos de la entidad o del acceso.");
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
      } else if (d.acceso === "revocar") {
        // Permite revocar aunque el usuario ya esté inactivo o haya perdido acceso al tenant.
        await conn.execute("UPDATE cont_entidad_usuarios SET activo = 0, puede_editar = 0 WHERE empresa_id = ? AND entidad_id = ? AND usuario_id = ?", [empresaId, entidadId, d.usuarioId]);
      } else {
        if (Number(entidades[0].activa) !== 1) throw new EntidadInvalida("Activa la entidad antes de asignar acceso.");
        const [usuarios] = await conn.query<RowDataPacket[]>(
          "SELECT id, activo, rol_global, acceso_todas_empresas FROM usuarios WHERE id = ? FOR UPDATE", [d.usuarioId],
        );
        const u = usuarios[0];
        if (!u || Number(u.activo) !== 1) throw new EntidadInvalida("Usuario no disponible.");
        if (u.rol_global !== "Admin" && Number(u.acceso_todas_empresas) !== 1) {
          const [accesos] = await conn.query<RowDataPacket[]>(
            "SELECT usuario_id FROM usuario_empresa WHERE empresa_id = ? AND usuario_id = ? FOR UPDATE", [empresaId, d.usuarioId],
          );
          if (!accesos.length) throw new EntidadInvalida("El usuario no tiene acceso a esta empresa.");
        }
        await conn.execute(
          `INSERT INTO cont_entidad_usuarios (empresa_id, entidad_id, usuario_id, activo, puede_editar)
           VALUES (?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE activo = 1, puede_editar = VALUES(puede_editar)`,
          [empresaId, entidadId, d.usuarioId, d.acceso === "editar" ? 1 : 0],
        );
      }
    }
    const detalle = d.accion === "crear" ? `Entidad #${entidadId} creada.`
      : d.accion === "estado" ? `Entidad #${entidadId}; activa=${d.activa}.`
      : `Entidad #${entidadId}; usuario #${d.usuarioId}; acceso=${d.acceso}.`;
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "contabilidad", accion: `entidad_${d.accion}`, detalle });
    await conn.commit();
    return entidadId;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
