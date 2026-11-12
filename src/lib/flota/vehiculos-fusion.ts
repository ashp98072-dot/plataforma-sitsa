import { referencias } from "./vehiculos-duplicados";
import { createHash } from "node:crypto";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorCB2 } from "./cb2/model";
import { rows, insert } from "./cb2/repository";
import { placaComparable } from "./combustible-coincidencias";
export const fusionesHabilitadas = () => process.env.FLOTA_FUSIONES_APROBADAS === "1";
export async function fusionarVehiculos(ctx: { empresaId: number; usuarioId: number; usuario: string; autorizar: () => Promise<void> }, op: { id: number; conservarId: number; motivo: string; revision: string; destinoRevision?: string }) {
  if (!fusionesHabilitadas()) throw new ErrorCB2("Fusiones deshabilitadas hasta auditar migración y activar configuración.", 403);
  const c = await getPool().getConnection(); let commit = false, limpia = false;
  try {
    await c.beginTransaction();
    // Mismo orden para fusión, referencias concurrentes y revisiones empresariales.
    const vs = await rows(c, "SELECT * FROM flota_vehiculos WHERE id IN (?,?) ORDER BY id FOR UPDATE", [Math.min(op.id, op.conservarId), Math.max(op.id, op.conservarId)]);
    await ctx.autorizar();
    if (!fusionesHabilitadas()) throw new ErrorCB2("Fusiones deshabilitadas durante la espera.", 403);
    const [actor] = await rows(c, "SELECT id,activo,rol_global FROM usuarios WHERE id=? LOCK IN SHARE MODE", [ctx.usuarioId]);
    const origen = vs.find(v => Number(v.id) === op.id), destino = vs.find(v => Number(v.id) === op.conservarId);
    if (!actor || Number(actor.activo) !== 1 || actor.rol_global !== "Admin" || !origen || !destino || op.id === op.conservarId || Number(origen.empresa_id) !== ctx.empresaId || Number(destino.empresa_id) !== ctx.empresaId) throw new ErrorCB2("Se requieren dos vehículos propios distintos y administrador vigente de la empresa.", 403);
    if (createHash("sha256").update(JSON.stringify(origen)).digest("hex") !== op.revision || createHash("sha256").update(JSON.stringify(destino)).digest("hex") !== op.destinoRevision) throw new ErrorCB2("Los registros cambiaron. Compara ambos de nuevo antes de fusionar.");
    const serial = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s/g, "");
    if (!placaComparable(String(origen.placa)) || placaComparable(String(origen.placa)) !== placaComparable(String(destino.placa)) || origen.tipo_unidad !== destino.tipo_unidad || !/^[A-Z0-9]{6,32}$/.test(serial(origen.chasis)) || /^(.)\1+$/.test(serial(origen.chasis)) || ["DESCONOCIDO","PENDIENTE","SINDATO","NOAPLICA"].includes(serial(origen.chasis)) || serial(origen.chasis) !== serial(destino.chasis)) throw new ErrorCB2("La placa no demuestra identidad. Se requiere tipo y chasis/serie real coincidente, no vacío ni genérico.");
    if (Number(origen.activo) !== 1 || Number(destino.activo) !== 1 || origen.estado !== "Activo" || destino.estado !== "Activo" || Number(origen.en_taller ?? 0) || Number(destino.en_taller ?? 0)) throw new ErrorCB2("Ambas unidades deben estar activas y fuera de taller.");
    const refs = await referencias(c, ctx.empresaId, op.id, true);
    const historicas = new Set(["flota_cb2_consumos","flota_cb2_filas","flota_cb2_asignaciones","flota_combustible_cargas","flota_vehiculo_acceso","flota_viajes","tms_planes_viaje"]);
    if (refs.some(r => !historicas.has(r.tabla))) throw new ErrorCB2("Hay referencias operativas, indirectas o de otros ámbitos sin verificación segura. No se fusionan automáticamente.");
    const tablas = await rows(c, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_viajes','tms_planes_viaje')");
    for (const tabla of tablas) {
      const sql = tabla.TABLE_NAME === "flota_viajes" ? "SELECT id FROM flota_viajes WHERE vehiculo_id IN (?,?) AND (estado<>'cerrado' OR hora_llegada IS NULL) FOR UPDATE" : "SELECT id FROM tms_planes_viaje WHERE tc_vehiculo_id IN (?,?) AND (estado NOT IN ('Cerrado','Cancelado') OR fecha_plan>=CURRENT_DATE) FOR UPDATE";
      if ((await rows(c, sql, [op.id, op.conservarId])).length) throw new ErrorCB2("Hay viajes abiertos o reservas vigentes. Resolverlas antes de fusionar sin cambiar sus IDs.");
    }
    const previas = await rows(c, "SELECT origen_id FROM flota_vehiculos_fusiones WHERE origen_id IN (?,?) OR destino_id=? FOR UPDATE", [op.id, op.conservarId, op.id]);
    if (previas.length) throw new ErrorCB2("No se permiten cadenas, ciclos ni repetir una fusión.");
    await insert(c, "flota_vehiculos_fusiones", { origen_id: op.id, destino_id: op.conservarId, empresa_id: ctx.empresaId, administrador_id: ctx.usuarioId, motivo: op.motivo, origen_snapshot: JSON.stringify(origen), destino_snapshot: JSON.stringify(destino) });
    await c.execute("UPDATE flota_vehiculos SET activo=0,estado='Inactivo' WHERE empresa_id=? AND id=?", [ctx.empresaId, op.id]);
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.usuario, modulo: "flota", accion: "fusion_alias_vehiculo", detalle: JSON.stringify({ origen: op.id, destino: op.conservarId, motivo: op.motivo, administrador: ctx.usuarioId, referenciasHistoricas: "sin modificar" }) });
    commit = true; await c.commit(); limpia = true; return { origen: op.id, destino: op.conservarId, historicosReasignados: 0 };
  } catch (e) {
    try { await c.rollback(); limpia = !commit; } catch { limpia = false; }
    if (commit) throw new ErrorCB2("Resultado incierto. Consulta ambos IDs y el alias antes de reintentar.", 503, true);
    throw e;
  } finally { if (limpia) { try { c.release(); } catch { try { c.destroy(); } catch {} } } else { try { c.destroy(); } catch {} } }
}
