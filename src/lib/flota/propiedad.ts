import { z } from "zod";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarFiltrosVehiculo } from "./filtros";

export const propiedadHabilitada = () => process.env.FLOTA_PROPIEDAD_EXTERNA === "1";
export class ErrorPropiedad extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const propiedadSchema = z.object({
  tipoPropiedad: z.enum(["EMPRESA", "EXTERNO"]),
  empresaPropietariaId: z.number().int().positive().nullable(),
  propietarioExterno: z.string().trim().max(120).default(""),
  tipoVehiculo: z.string().trim().max(80).default(""),
}).superRefine((d, ctx) => {
  if (d.tipoPropiedad === "EMPRESA" && !d.empresaPropietariaId)
    ctx.addIssue({ code: "custom", message: "Selecciona la empresa propietaria." });
  if (d.tipoPropiedad === "EXTERNO" && (!d.propietarioExterno || d.empresaPropietariaId !== null || !d.tipoVehiculo))
    ctx.addIssue({ code: "custom", message: "Indica propietario externo y tipo de vehículo, sin empresa propietaria interna." });
});
export const editarPropiedadSchema = propiedadSchema.safeExtend({
  id: z.number().int().positive(), revision: z.number().int().nonnegative(),
});
export const crearConPropiedadSchema = propiedadSchema.safeExtend({
  placa: z.string().trim().min(1).max(40).transform(v => v.toUpperCase()),
  marca: z.string().max(80).default(""), modelo: z.string().max(80).default(""),
  descripcion: z.string().max(200).default(""), color: z.string().max(80).default(""),
  tipoUnidad: z.enum(["VEHICULO", "CABEZAL", "TC"]).default("VEHICULO"),
  kmActual: z.number().int().nonnegative().default(0),
  kmIntervaloServicio: z.number().int().positive().default(5000),
  odometroFuncional: z.boolean().default(true), mantenimientoIntervaloMeses: z.number().int().min(1).max(60).default(3),
  notas: z.string().max(10000).default(""), activo: z.boolean().default(true),
  empresaActivo: z.string().max(120).optional(),
  rinLlanta: z.string().max(80).default(""), medidaLlanta: z.string().max(80).default(""), tipoAceite: z.string().max(80).default(""),
  filtros: z.array(z.object({ tipo: z.string().min(1).max(80), codigo: z.string().min(1).max(120) })).max(100).default([]),
});

/** Enriquecer SOLO las unidades que ya pasaron por la regla central de acceso. */
export async function propiedadesVehiculos(ids: number[]) {
  if (!ids.length) return new Map<number, RowDataPacket>();
  const rows = await query<RowDataPacket[]>(`SELECT v.id, v.empresa_id, v.tipo_propiedad,
    COALESCE(v.empresa_propietaria_id, IF(v.tipo_propiedad = 'EMPRESA', v.empresa_id, NULL)) empresa_propietaria_id,
    v.propietario_externo, v.tipo_vehiculo, v.revision_propiedad,
    e.nombre propietario_nombre FROM flota_vehiculos v LEFT JOIN empresas e
    ON e.id = COALESCE(v.empresa_propietaria_id, IF(v.tipo_propiedad = 'EMPRESA', v.empresa_id, NULL))
    WHERE v.id IN (${ids.map(() => "?").join(",")})`, ids);
  return new Map(rows.map(r => [Number(r.id), r]));
}

/** empresaId y usuario proceden exclusivamente del guard. Nunca se transfiere empresa_id. */
export async function guardarPropiedad(empresaId: number, usuario: string, raw: unknown, crear = false) {
  if (!propiedadHabilitada()) throw new ErrorPropiedad("La gestión de propietarios no está habilitada.", 503);
  const d = crear ? crearConPropiedadSchema.parse(raw) : editarPropiedadSchema.parse(raw);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let antes: RowDataPacket | null = null;
    if ("id" in d) {
      const [rows] = await conn.execute<RowDataPacket[]>("SELECT * FROM flota_vehiculos WHERE id = ? AND empresa_id = ? FOR UPDATE", [d.id, empresaId]);
      antes = rows[0] ?? null;
      if (!antes) throw new ErrorPropiedad("Solo la empresa administradora puede cambiar el propietario.", 403);
      if (Number(antes.revision_propiedad) !== d.revision) throw new ErrorPropiedad("El propietario cambió. Recarga el vehículo antes de guardar.", 409);
    }
    if (d.tipoPropiedad === "EMPRESA") {
      const [empresas] = await conn.execute<RowDataPacket[]>("SELECT id FROM empresas WHERE id = ? AND activa = 1 LOCK IN SHARE MODE", [d.empresaPropietariaId]);
      const actual = antes && antes.tipo_propiedad === "EMPRESA" ? Number(antes.empresa_propietaria_id ?? antes.empresa_id) : null;
      if (!empresas.length && actual !== d.empresaPropietariaId) throw new ErrorPropiedad("Selecciona una empresa existente y activa.");
    }
    let id: number;
    if ("placa" in d) {
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO flota_vehiculos
        (empresa_id, placa, marca, modelo, descripcion, color, tipo_unidad, km_actual,
         km_intervalo_servicio, km_ultimo_servicio, odometro_funcional, mantenimiento_intervalo_meses,
         notas, activo, empresa_activo, rin_llanta, medida_llanta, tipo_aceite,
         tipo_propiedad, empresa_propietaria_id, propietario_externo, tipo_vehiculo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, d.placa, d.marca, d.modelo, d.descripcion, d.color, d.tipoUnidad,
        d.odometroFuncional ? d.kmActual : null, d.kmIntervaloServicio, d.odometroFuncional ? d.kmActual : null,
        d.odometroFuncional ? 1 : 0, d.odometroFuncional ? null : d.mantenimientoIntervaloMeses,
        d.notas, d.activo ? 1 : 0, d.empresaActivo ?? null, d.rinLlanta, d.medidaLlanta, d.tipoAceite,
        d.tipoPropiedad, d.empresaPropietariaId, d.tipoPropiedad === "EXTERNO" ? d.propietarioExterno : null, d.tipoVehiculo || null]);
      id = Number(result.insertId);
      await guardarFiltrosVehiculo(empresaId, id, d.filtros, conn);
    } else {
      id = d.id;
      await conn.execute(`UPDATE flota_vehiculos SET tipo_propiedad = ?, empresa_propietaria_id = ?,
        propietario_externo = ?, tipo_vehiculo = ?, revision_propiedad = revision_propiedad + 1
        WHERE id = ? AND empresa_id = ?`, [d.tipoPropiedad, d.empresaPropietariaId,
        d.tipoPropiedad === "EXTERNO" ? d.propietarioExterno : null, d.tipoVehiculo || null, id, empresaId]);
    }
    const snapshot = (r: RowDataPacket) => ({ tipoPropiedad: r.tipo_propiedad,
      empresaPropietariaId: r.tipo_propiedad === "EMPRESA" ? Number(r.empresa_propietaria_id ?? r.empresa_id) : null,
      propietarioExterno: r.propietario_externo, tipoVehiculo: r.tipo_vehiculo, revision: Number(r.revision_propiedad) });
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "flota_vehiculos",
      accion: crear ? "crear_vehiculo_propiedad" : "cambiar_propiedad_vehiculo",
      detalle: JSON.stringify({ vehiculoId: id, antes: antes ? snapshot(antes) : null,
        despues: { tipoPropiedad: d.tipoPropiedad, empresaPropietariaId: d.empresaPropietariaId,
          propietarioExterno: d.tipoPropiedad === "EXTERNO" ? d.propietarioExterno : null, tipoVehiculo: d.tipoVehiculo,
          revision: antes ? Number(antes.revision_propiedad) + 1 : 0 } }) });
    await conn.commit();
    return { id, revision: antes ? Number(antes.revision_propiedad) + 1 : 0,
      mensaje: crear ? "Vehículo registrado." : "Propietario actualizado. El historial se conserva." };
  } catch (e) {
    await conn.rollback();
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") throw new ErrorPropiedad("La placa ya está registrada en esta empresa.", 409);
    throw e;
  } finally { conn.release(); }
}
