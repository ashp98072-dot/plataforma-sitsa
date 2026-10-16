import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

const estacionCampos = z.object({
  proveedorId: z.coerce.number().int().positive(),
  nombre: z.string().trim().min(1, "Indica el nombre de la estación.").max(150),
  direccion: z.string().trim().max(500),
  activo: z.boolean(),
});
export const estacionSchema = estacionCampos.extend({ direccion: estacionCampos.shape.direccion.default(""), activo: estacionCampos.shape.activo.default(true) });
export const estacionPatchSchema = estacionCampos.partial().refine(v => Object.keys(v).length > 0, "Indica los datos a modificar.");
export type Estacion = { id: number; proveedorId: number; proveedorNombre: string; nombre: string; direccion: string | null; activo: boolean };
export async function listarEstaciones(empresaId: number, filtros: { proveedorId?: number; buscar?: string; activo?: boolean } = {}): Promise<Estacion[]> {
  const rows = await query<RowDataPacket[]>(`SELECT e.id, e.proveedor_id, p.nombre_comercial AS proveedor_nombre, e.nombre, e.direccion, e.activo
    FROM flota_combustible_estaciones e JOIN compras_proveedores p ON p.id=e.proveedor_id AND p.empresa_id=e.empresa_id
    WHERE e.empresa_id=? AND (? IS NULL OR e.proveedor_id=?) AND (? IS NULL OR e.activo=?)
      AND (?='' OR LOCATE(?, e.nombre)>0 OR LOCATE(?, COALESCE(e.direccion,''))>0)
    ORDER BY p.nombre_comercial, e.nombre, e.id`, [empresaId, filtros.proveedorId ?? null, filtros.proveedorId ?? null, filtros.activo ?? null, filtros.activo ?? null, filtros.buscar ?? "", filtros.buscar ?? "", filtros.buscar ?? ""]);
  return rows.map(r => ({ id: Number(r.id), proveedorId: Number(r.proveedor_id), proveedorNombre: String(r.proveedor_nombre), nombre: String(r.nombre), direccion: r.direccion == null ? null : String(r.direccion), activo: Boolean(r.activo) }));
}

/** Proveedores ACTIVOS de la empresa para el selector del mantenimiento de estaciones (no depende del catálogo de vales ni de vehículos). */
export async function listarProveedoresActivos(empresaId: number): Promise<{ id: number; nombre: string }[]> {
  const rows = await query<RowDataPacket[]>("SELECT id, nombre_comercial AS nombre FROM compras_proveedores WHERE empresa_id=? AND activo=1 ORDER BY nombre_comercial, id", [empresaId]);
  return rows.map(r => ({ id: Number(r.id), nombre: String(r.nombre) }));
}

export async function guardarEstacion(empresaId: number, actor: { usuarioId: number; username: string }, datos: Partial<z.infer<typeof estacionSchema>>, id?: number) {
  const cambios = id == null ? estacionSchema.parse(datos) : estacionPatchSchema.parse(datos);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    // La ruta de escritura de vales toma proveedor -> estación. Conservar el mismo orden.
    let proveedorId = cambios.proveedorId;
    if (proveedorId == null && id != null) {
      const [previo] = await conn.query<RowDataPacket[]>("SELECT proveedor_id FROM flota_combustible_estaciones WHERE empresa_id=? AND id=?", [empresaId, id]);
      if (!previo[0]) throw new ErrorDominioFormulario("Estación no encontrada.", 404);
      proveedorId = Number(previo[0].proveedor_id);
    }
    const [proveedor] = await conn.query<RowDataPacket[]>("SELECT id, activo FROM compras_proveedores WHERE empresa_id=? AND id=? FOR UPDATE", [empresaId, proveedorId!]);
    if (!proveedor[0]) throw new ErrorDominioFormulario("Proveedor no válido para esta empresa.");
    let antes: RowDataPacket | undefined;
    if (id != null) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT proveedor_id, nombre, direccion, activo FROM flota_combustible_estaciones WHERE empresa_id=? AND id=? FOR UPDATE", [empresaId, id]);
      antes = rows[0];
      if (!antes) throw new ErrorDominioFormulario("Estación no encontrada.", 404);
      if (cambios.proveedorId == null && Number(antes.proveedor_id) !== proveedorId) throw new ErrorDominioFormulario("La estación cambió. Actualiza y vuelve a intentar.", 409);
      if (Number(antes.proveedor_id) !== proveedorId) {
        const [usos] = await conn.query<RowDataPacket[]>("SELECT id FROM flota_combustible_cargas WHERE empresa_id=? AND estacion_id=? LIMIT 1", [empresaId, id]);
        if (usos.length) throw new ErrorDominioFormulario("Una estación utilizada en vales no puede cambiar de proveedor. Crea otra estación.", 409);
      }
    }
    if (!proveedor[0].activo && (!antes || Number(antes.proveedor_id) !== proveedorId || cambios.activo === true)) throw new ErrorDominioFormulario("El proveedor está inactivo.");
    const final = estacionSchema.parse({ proveedorId, nombre: cambios.nombre ?? antes?.nombre, direccion: cambios.direccion ?? antes?.direccion ?? "", activo: cambios.activo ?? (antes ? Boolean(antes.activo) : true) });
    if (id == null) {
      const [r] = await conn.execute<ResultSetHeader>(`INSERT INTO flota_combustible_estaciones (empresa_id,proveedor_id,nombre,direccion,activo,creado_por_usuario_id,actualizado_por_usuario_id) VALUES (?,?,?,?,?,?,?)`, [empresaId, final.proveedorId, final.nombre, final.direccion || null, final.activo, actor.usuarioId, actor.usuarioId]);
      id = Number(r.insertId);
    } else {
      await conn.execute("UPDATE flota_combustible_estaciones SET proveedor_id=?, nombre=?, direccion=?, activo=?, actualizado_por_usuario_id=? WHERE empresa_id=? AND id=?", [final.proveedorId, final.nombre, final.direccion || null, final.activo, actor.usuarioId, empresaId, id]);
    }
    await registrarAuditoriaTx(conn, { empresaId, usuario: actor.username, accion: !antes ? "crear_estacion_combustible" : Boolean(antes.activo) !== final.activo ? final.activo ? "reactivar_estacion_combustible" : "desactivar_estacion_combustible" : "editar_estacion_combustible", modulo: "flota_combustible", detalle: `Estación #${id} · proveedor #${final.proveedorId} · usuario #${actor.usuarioId}` });
    await conn.commit();
    return id;
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}
