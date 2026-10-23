import { z } from "zod";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { ErrorCB2, hash, id, clave } from "./model";
import { productos } from "./clasificacion";
import { rows, insert, tx, vehiculos, type Contexto } from "./repository";
export const corregirSchema = z.object({ proveedorId: id, consumoId: id, revision: z.number().int().nonnegative(), vehiculoId: id, empleadoId: id.nullable(), productoClasificado: z.enum(productos), motivo: z.string().trim().min(10).max(1000), clave }).strict();
export async function corregirAsignacion(ctx: Contexto, op: z.infer<typeof corregirSchema>) {
    const digest = hash(JSON.stringify([ctx.empresaId, ctx.actor.id, op]));
    return tx(ctx, async c => {
        const [previo] = await rows(c, "SELECT digest,nuevo FROM flota_cb2_asignaciones WHERE empresa_id=? AND proveedor_id=? AND clave=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, op.clave]);
        if (previo) {
            if (previo.digest !== digest) throw new ErrorCB2("Clave de corrección usada con otra solicitud.");
            return { consumoId: op.consumoId, repetida: true, asignacion: JSON.parse(String(previo.nuevo)) };
        }
        const [consumo] = await rows(c, "SELECT id,vehiculo_id,empleado_id,producto_clasificado,revision_asignacion FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, op.consumoId]);
        if (!consumo) throw new ErrorCB2("Consumo no encontrado.", 404);
        if (Number(consumo.revision_asignacion) !== op.revision) throw new ErrorCB2("La asignación cambió; actualiza antes de corregir.");
        await vehiculos(c, ctx, [op.vehiculoId]);
        if (op.empleadoId !== null) {
            const [empleado] = await rows(c, "SELECT id FROM empleados WHERE empresa_id=? AND id=? AND estado='Activo' FOR UPDATE", [ctx.empresaId, op.empleadoId]);
            if (!empleado) throw new ErrorCB2("Empleado no autorizado para esta empresa.", 403);
        }
        const nuevo = { vehiculoId: op.vehiculoId, empleadoId: op.empleadoId, productoClasificado: op.productoClasificado, revision: op.revision + 1 };
        await c.execute("UPDATE flota_cb2_consumos SET vehiculo_id=?,empleado_id=?,producto_clasificado=?,revision_asignacion=revision_asignacion+1 WHERE empresa_id=? AND proveedor_id=? AND id=?", [op.vehiculoId, op.empleadoId, op.productoClasificado, ctx.empresaId, ctx.proveedorId, op.consumoId]);
        await insert(c, "flota_cb2_asignaciones", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, consumo_id: op.consumoId, clave: op.clave, digest, anterior: JSON.stringify(consumo), nuevo: JSON.stringify(nuevo), motivo: op.motivo, usuario_id: ctx.actor.id, creado_en: ahoraLocal() });
        await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_corregir_asignacion", detalle: JSON.stringify({ consumoId: op.consumoId, clave: op.clave, nuevo, motivo: op.motivo }) });
        return { consumoId: op.consumoId, asignacion: nuevo };
    });
}
