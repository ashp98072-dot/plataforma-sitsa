import { esquemaPilotosReportados } from "@/lib/flota/cb2/pilotos-reportados";
import { tercerosDirectosHabilitados } from "@/lib/flota/cb2/terceros-directos";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { catalogosCombustible } from "@/lib/flota/combustible-staff";
import { query } from "@/lib/db";
import { listarCatalogosTerceros, tercerosHabilitados } from "@/lib/flota/cb2/terceros";
import type { RowDataPacket } from "mysql2";
import { esColumnaInexistente, fechaIso } from "@/lib/flota/cb2/empleados-baja";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;
  try {
    const catalogos = await catalogosCombustible(guard.empresa.id);
    const externos = await listarCatalogosTerceros(guard.empresa.id);
    const independencia = tercerosDirectosHabilitados() ? await query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_unico'") : [];
    const terceros = externos.asociaciones;
    const unidadesExternas = externos.unidades.map(u => ({ id: -u.id, placa: u.placa, descripcion: `Tercerizado #${u.id} · ${u.descripcion}`, tipo_unidad: u.tipo }));
    // RRHH activo de la empresa; lectura sin reparar ni crear relaciones TMS.
    let personal: RowDataPacket[] = [], empleadosDisponibles = true;
    // Activos y de baja (solo lectura): los consumos históricos pueden pertenecer a personas que ya no están en planilla.
    try { personal = await query<RowDataPacket[]>("SELECT id, nombre, estado, fecha_egreso, fecha_alta FROM empleados WHERE empresa_id = ? AND estado IN ('Activo','Baja') ORDER BY nombre, id", [guard.empresa.id]); }
    catch (e) {
        // Solo una columna opcional inexistente (fecha_egreso/fecha_alta) permite reintentar sin ellas; conexión, permisos u otros errores no se enmascaran.
        if (!esColumnaInexistente(e)) { console.error("[combustible-catalogos] empleados", e); empleadosDisponibles = false; }
        else {
            try { personal = await query<RowDataPacket[]>("SELECT id, nombre, estado, NULL AS fecha_egreso, NULL AS fecha_alta FROM empleados WHERE empresa_id = ? AND estado IN ('Activo','Baja') ORDER BY nombre, id", [guard.empresa.id]); }
            catch (e2) { console.error("[combustible-catalogos] empleados", e2); empleadosDisponibles = false; }
        }
    }
    const empleados = personal.map(p => ({ id: Number(p.id), nombre: String(p.nombre), estado: String(p.estado), fechaBaja: fechaIso(p.fecha_egreso), fechaAlta: fechaIso(p.fecha_alta) }));
    const pilotos = empleados;
    const limitacionPilotos = (empleadosDisponibles ? "" : "Catálogo de empleados no disponible: no se proponen vínculos. ") + "El vínculo usa empleados activos y de baja de la empresa (los de baja siempre con confirmación manual) y conserva el nombre original. Dos o más tokens completos permiten autopropuesta solo con un empleado coincidente; ante ambigüedad se exige elección manual.";
    const reportado = tercerosDirectosHabilitados() ? await query<RowDataPacket[]>("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_reportado'") : [];
    const pilotosReportados=await esquemaPilotosReportados();
    return NextResponse.json({ ...catalogos, pilotosReportados, pilotoReportadoExterno: reportado.length>0, identidadesIndependientes: independencia.length>0, vehiculos: [...catalogos.vehiculos, ...unidadesExternas], tercerosDirectos: tercerosDirectosHabilitados(), terceros, pilotosExternos: externos.pilotos, unidadesExternas: externos.unidades, tercerosHabilitados: tercerosHabilitados(), empleados, empleadosDisponibles, pilotos, limitacionPilotos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    // Siempre JSON con mensaje (antes un fallo de cualquiera de las 3 consultas daba un 500 vacío y selectores en blanco sin explicación).
    const referencia = randomUUID().slice(0, 8);
    console.error(`[combustible-catalogos] ref=${referencia}`, e);
    return NextResponse.json({ error: `No se pudieron cargar los catálogos de combustible. Referencia ${referencia}.` }, { status: 500 });
  }
}
