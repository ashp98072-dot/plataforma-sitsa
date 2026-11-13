import { validarAsignacionIndependiente } from "./asignacion-independiente";
import { validarTerceroDirecto } from "./terceros-directos";
import { z } from "zod";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { ErrorCB2, hash, id, clave } from "./model";
import { productos } from "./clasificacion";
import { rows, insert, tx, vehiculos, type Contexto } from "./repository";
import { validarTercero, tercerosHabilitados } from "./terceros";
export const corregirSchema = z.object({ proveedorId: id, consumoId: id, revision: z.number().int().nonnegative(), vehiculoId: z.number().int().min(-2147483647).max(2147483647).refine(n => n !== 0), pilotoTipo: z.enum(["INTERNO", "EXTERNO"]).optional(), metodoPiloto: z.enum(["AUTOMATICA", "MANUAL"]).optional(), pilotoExternoId: id.optional(), asociacionExternaId: id.optional(), empleadoId: id.nullable(), productoClasificado: z.enum(productos), motivo: z.string().trim().min(10).max(1000), clave }).strict().refine(s => s.pilotoTipo ? !s.asociacionExternaId && (s.pilotoTipo === "INTERNO" ? s.empleadoId !== null && !s.pilotoExternoId : s.empleadoId === null && !!s.pilotoExternoId) : (s.vehiculoId < 0) === (s.asociacionExternaId !== undefined || s.pilotoExternoId !== undefined) && !(s.asociacionExternaId !== undefined && s.pilotoExternoId !== undefined) && !(s.vehiculoId < 0 && s.empleadoId !== null));
export async function corregirAsignacion(ctx: Contexto, op: z.infer<typeof corregirSchema>) {
    const digest = hash(JSON.stringify([ctx.empresaId, ctx.actor.id, op]));
    return tx(ctx, async c => {
        const [previo] = await rows(c, "SELECT digest,nuevo FROM flota_cb2_asignaciones WHERE empresa_id=? AND proveedor_id=? AND clave=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, op.clave]);
        if (previo) {
            if (previo.digest !== digest) throw new ErrorCB2("Clave de corrección usada con otra solicitud.");
            return { consumoId: op.consumoId, repetida: true, asignacion: JSON.parse(String(previo.nuevo)) };
        }
        const [consumo] = await rows(c, "SELECT * FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, op.consumoId]);
        if (!consumo) throw new ErrorCB2("Consumo no encontrado.", 404);
        if (Number(consumo.revision_asignacion) !== op.revision) throw new ErrorCB2("La asignación cambió; actualiza antes de corregir.");
        const externa = op.pilotoTipo ? await validarAsignacionIndependiente(c,ctx,op,String(consumo.piloto_informado ?? ""),String(consumo.placa_normalizada)) : op.vehiculoId < 0 ? (op.pilotoExternoId !== undefined ? await validarTerceroDirecto(c, ctx, op.pilotoExternoId, -op.vehiculoId, String(consumo.piloto_informado ?? ""), String(consumo.placa_normalizada), op.motivo) : await validarTercero(c, ctx, op.asociacionExternaId!, -op.vehiculoId, String(consumo.piloto_informado ?? ""), String(consumo.placa_normalizada), op.motivo)) : null;
        if (!externa) await vehiculos(c, ctx, [op.vehiculoId]);
        if (consumo.vehiculo_id == null && !tercerosHabilitados()) throw new ErrorCB2("Edición externa deshabilitada hasta aprobar D2.", 403);
        if (op.empleadoId !== null) {
            const [empleado] = await rows(c, "SELECT id FROM empleados WHERE empresa_id=? AND id=? AND estado='Activo' FOR UPDATE", [ctx.empresaId, op.empleadoId]);
            if (!empleado) throw new ErrorCB2("Empleado no autorizado para esta empresa.", 403);
        }
        const nuevo = { vehiculoId: op.vehiculoId, empleadoId: op.empleadoId, productoClasificado: op.productoClasificado, revision: op.revision + 1, ...(externa ? { identidadExterna: externa } : {}) };
        if (externa || consumo.vehiculo_id == null) {
            await c.execute(`UPDATE flota_cb2_consumos SET vehiculo_id=?,empleado_id=?,producto_clasificado=?,asociacion_externa_id=?,identidad_externa=?,${"piloto_externo_id" in consumo ? "piloto_externo_id=?,unidad_externa_id=?," : ""}revision_asignacion=revision_asignacion+1 WHERE empresa_id=? AND proveedor_id=? AND id=?`, [op.vehiculoId < 0 ? null : op.vehiculoId, op.empleadoId, op.productoClasificado, op.asociacionExternaId ?? null, externa ? JSON.stringify(externa) : null, ...("piloto_externo_id" in consumo ? [op.pilotoExternoId ?? null, op.vehiculoId < 0 && (op.pilotoTipo || op.pilotoExternoId) ? -op.vehiculoId : null] : []), ctx.empresaId, ctx.proveedorId, op.consumoId]);
        } else
        await c.execute("UPDATE flota_cb2_consumos SET vehiculo_id=?,empleado_id=?,producto_clasificado=?,revision_asignacion=revision_asignacion+1 WHERE empresa_id=? AND proveedor_id=? AND id=?", [op.vehiculoId, op.empleadoId, op.productoClasificado, ctx.empresaId, ctx.proveedorId, op.consumoId]);
        await insert(c, "flota_cb2_asignaciones", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, consumo_id: op.consumoId, clave: op.clave, digest, anterior: JSON.stringify({ id: consumo.id, vehiculo_id: consumo.vehiculo_id, empleado_id: consumo.empleado_id, producto_clasificado: consumo.producto_clasificado, revision_asignacion: consumo.revision_asignacion, ...(consumo.identidad_externa ? { identidad_externa: consumo.identidad_externa, asociacion_externa_id: consumo.asociacion_externa_id } : {}) }), nuevo: JSON.stringify(nuevo), motivo: op.motivo, usuario_id: ctx.actor.id, creado_en: ahoraLocal() });
        await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_corregir_asignacion", detalle: JSON.stringify({ consumoId: op.consumoId, clave: op.clave, nuevo, motivo: op.motivo }) });
        return { consumoId: op.consumoId, asignacion: nuevo };
    });
}
