import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { getPool, query } from "@/lib/db";
import { conPlazo, ErrorPlazoOperacion } from "@/lib/db-plazo";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { validarEmpleadoCorreccion } from "./asignaciones";
import { clasificarIdentificacion } from "./identificacion-masiva";
import { normalizarNombreReportado } from "./pilotos-nombres";
import { esquemaPilotosReportados, resolverNombreTx } from "./pilotos-reportados";
import { ErrorCB2, hash, id, clave } from "./model";
import { insert, rows, tx, type Contexto } from "./repository";

const item = z.object({ id, revision: z.number().int().nonnegative() }).strict();
export const vistaIdentificacionSchema = z.object({ nombre: z.string().trim().min(1).max(255), empleadoId: id, consumoId: id.optional() }).strict();
export const confirmarIdentificacionSchema = vistaIdentificacionSchema.extend({ proveedorId: id, items: z.array(item).min(1).max(5000), motivo: z.string().trim().min(10).max(1000), clave }).strict();
export const recordarIdentificacionSchema = vistaIdentificacionSchema.omit({ consumoId: true }).extend({ proveedorId: id }).strict();
type Vista = z.infer<typeof vistaIdentificacionSchema>;
type Confirmacion = z.infer<typeof confirmarIdentificacionSchema>;

const seleccion = (instalado: boolean) => `SELECT c.*${instalado ? ", r.piloto_reportado_id" : ""} FROM flota_cb2_consumos c ${instalado ? "LEFT JOIN flota_cb2_consumo_piloto_reportado r ON r.empresa_id=c.empresa_id AND r.proveedor_id=c.proveedor_id AND r.consumo_id=c.id" : ""}`;
// Cada solicitud examina como máximo 25 000 filas; nunca devuelve una vista incompleta como si fuera completa.
const MAX_PAGINAS_VISTA = 25;
let vistasActivas = 0;

/** La consulta se limita a la empresa de sesión y compara en JS con la normalización canónica. */
export async function vistaIdentificacion(empresaId: number, op: Vista) {
  if (vistasActivas >= 2) throw new ErrorCB2("Hay otras vistas previas en curso; vuelve a intentarlo.", 503);
  vistasActivas++;
  try { return await conPlazo(getPool(), { presupuestoMs: 8000, limiteSentenciaMs: 2000, soloLectura: true }, () => consultarVistaIdentificacion(empresaId, op)); }
  catch (error) { if (error instanceof ErrorPlazoOperacion) throw new ErrorCB2("La vista previa excedió el plazo; esta consulta no modificó consumos.", 503); throw error; }
  finally { vistasActivas--; }
}
async function consultarVistaIdentificacion(empresaId: number, op: Vista) {
  const empleado = await query<RowDataPacket[]>("SELECT id,nombre FROM empleados WHERE empresa_id=? AND id=? AND estado IN ('Activo','Baja')", [empresaId, op.empleadoId]);
  if (!empleado.length) throw new ErrorCB2("Empleado no autorizado para esta empresa.", 403);
  const instalado = await esquemaPilotosReportados();
  const proveedores = new Map<number, { proveedorId: number; pendientes: { id: number; revision: number }[]; identificados: number; conflictos: number; conflictoIds: number[] }>();
  let despues = 0;
  for (let pagina = 0; ; pagina++) {
    const consumos = await query<RowDataPacket[]>(`${seleccion(instalado)} WHERE c.empresa_id=? AND c.id>? AND c.piloto_informado IS NOT NULL${op.consumoId ? " AND c.id=?" : ""} ORDER BY c.id LIMIT 1000`, op.consumoId ? [empresaId, despues, op.consumoId] : [empresaId, despues]);
    for (const c of consumos) {
    const estado = clasificarIdentificacion(c as Parameters<typeof clasificarIdentificacion>[0], op.nombre, op.empleadoId);
    if (estado === "AJENO") continue;
    const proveedorId = Number(c.proveedor_id), p = proveedores.get(proveedorId) ?? { proveedorId, pendientes: [], identificados: 0, conflictos: 0, conflictoIds: [] };
    if (estado === "PENDIENTE") p.pendientes.push({ id: Number(c.id), revision: Number(c.revision_asignacion) });
    else if (estado === "IDENTIFICADO") p.identificados++;
    else { p.conflictos++; p.conflictoIds.push(Number(c.id)); }
    proveedores.set(proveedorId, p);
    }
    if (consumos.length < 1000) break;
    if (pagina + 1 >= MAX_PAGINAS_VISTA) throw new ErrorCB2("La vista alcanzó el límite de 25 000 consumos examinados. Usa la opción de un solo consumo; esta consulta no modificó consumos.", 413);
    const siguiente = Number(consumos[consumos.length - 1].id);
    if (!Number.isSafeInteger(siguiente) || siguiente <= despues) throw new ErrorCB2("No se pudo completar la vista previa; vuelve a consultar.", 503);
    despues = siguiente;
  }
  return { nombre: op.nombre, empleado: { id: op.empleadoId, nombre: String(empleado[0].nombre) }, empresaId, proveedores: [...proveedores.values()] };
}

export async function recordarIdentificacion(ctx: Contexto, op: z.infer<typeof recordarIdentificacionSchema>) {
  return tx(ctx, async c => {
    if (!(await esquemaPilotosReportados(c))) throw new ErrorCB2("El registro de equivalencias no está instalado.", 503);
    await validarEmpleadoCorreccion(c, ctx.empresaId, op.empleadoId);
    await rows(c, "SELECT id FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
    const normalizado = normalizarNombreReportado(op.nombre);
    const [previo] = await rows(c, "SELECT nombre_normalizado,empleado_id,piloto_reportado_id,requiere_revision FROM flota_cb2_pilotos_equivalencias WHERE empresa_id=? AND normalizacion_version=1 AND nombre_hash=? FOR UPDATE", [ctx.empresaId, hash(normalizado)]);
    if (previo) {
      if (previo.nombre_normalizado !== normalizado || Number(previo.empleado_id) !== op.empleadoId || previo.piloto_reportado_id != null) throw new ErrorCB2("Ya existe otra equivalencia para este nombre; revísala individualmente.");
      return { guardada: true, repetida: true, requiereRevision: Number(previo.requiere_revision) === 1 };
    }
    await resolverNombreTx(c, ctx, op.nombre, { tipo: "EMPLEADO", empleadoId: op.empleadoId, confirmado: true });
    const [guardada] = await rows(c, "SELECT requiere_revision FROM flota_cb2_pilotos_equivalencias WHERE empresa_id=? AND normalizacion_version=1 AND nombre_hash=?", [ctx.empresaId, hash(normalizado)]);
    return { guardada: true, repetida: false, requiereRevision: Number(guardada.requiere_revision) === 1 };
  });
}

/** Una solicitud por proveedor; si cambia una revisión, se revierte toda su transacción. */
export async function confirmarIdentificacion(ctx: Contexto, op: Confirmacion) {
  if (new Set(op.items.map(i => i.id)).size !== op.items.length) throw new ErrorCB2("Consumos duplicados.", 400);
  const orden = [...op.items].sort((a, b) => a.id - b.id);
  const digest = hash(JSON.stringify([ctx.empresaId, ctx.actor.id, op]));
  return tx(ctx, async c => {
    await validarEmpleadoCorreccion(c, ctx.empresaId, op.empleadoId);
    const instalado = await esquemaPilotosReportados(c);
    let actualizados = 0, repetidos = 0;
    for (const item of orden) {
      const key = hash(`${op.clave}:${item.id}`);
      const [previo] = await rows(c, "SELECT digest FROM flota_cb2_asignaciones WHERE empresa_id=? AND proveedor_id=? AND clave=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, key]);
      if (previo) {
        if (previo.digest !== digest) throw new ErrorCB2("Clave ya utilizada para otra solicitud.");
        repetidos++;
        continue;
      }
      const [consumo] = await rows(c, `${seleccion(instalado)} WHERE c.empresa_id=? AND c.proveedor_id=? AND c.id=? FOR UPDATE`, [ctx.empresaId, ctx.proveedorId, item.id]);
      if (!consumo || (op.consumoId && item.id !== op.consumoId) || Number(consumo.revision_asignacion) !== item.revision || clasificarIdentificacion(consumo as Parameters<typeof clasificarIdentificacion>[0], op.nombre, op.empleadoId) !== "PENDIENTE") throw new ErrorCB2("Un consumo cambió o ya no es elegible; actualiza la vista previa.");
      const [resultado] = await c.execute<import("mysql2").ResultSetHeader>("UPDATE flota_cb2_consumos SET empleado_id=?,revision_asignacion=revision_asignacion+1 WHERE empresa_id=? AND proveedor_id=? AND id=? AND empleado_id IS NULL AND revision_asignacion=?", [op.empleadoId, ctx.empresaId, ctx.proveedorId, item.id, item.revision]);
      if (resultado.affectedRows !== 1) throw new ErrorCB2("La asignación cambió; vuelve a consultar.");
      const nuevo = { empleadoId: op.empleadoId, revision: item.revision + 1 };
      await insert(c, "flota_cb2_asignaciones", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, consumo_id: item.id, clave: key, digest, anterior: JSON.stringify({ empleadoId: null, revision: item.revision }), nuevo: JSON.stringify(nuevo), motivo: op.motivo, usuario_id: ctx.actor.id, creado_en: ahoraLocal() });
      await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_corregir_asignacion", detalle: JSON.stringify({ consumoId: item.id, clave: key, nombreNormalizado: normalizarNombreReportado(op.nombre), nuevo, motivo: op.motivo }) });
      actualizados++;
    }
    if (repetidos && actualizados) throw new ErrorCB2("Resultado previo inconsistente; requiere revisión.");
    return { proveedorId: ctx.proveedorId, actualizados, repetidos };
  });
}
