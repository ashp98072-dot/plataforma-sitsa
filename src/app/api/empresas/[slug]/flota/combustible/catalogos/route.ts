import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { catalogosCombustible } from "@/lib/flota/combustible-staff";
import { query } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;
  try {
    const catalogos = await catalogosCombustible(guard.empresa.id);
    // RRHH activo de la empresa; lectura sin reparar ni crear relaciones TMS.
    let personal: RowDataPacket[] = [], empleadosDisponibles = true;
    try { personal = await query<RowDataPacket[]>("SELECT id, nombre FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre, id", [guard.empresa.id]); }
    catch { empleadosDisponibles = false; }
    const empleados = personal.map(p => ({ id: Number(p.id), nombre: String(p.nombre) }));
    const pilotos = empleados;
    const limitacionPilotos = (empleadosDisponibles ? "" : "Catálogo de empleados no disponible: no se proponen vínculos. ") + "El vínculo usa empleados activos de la empresa y conserva el nombre original. Dos o más tokens completos permiten autopropuesta solo con un empleado coincidente; ante ambigüedad se exige elección manual.";
    return NextResponse.json({ ...catalogos, empleados, empleadosDisponibles, pilotos, limitacionPilotos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    // Siempre JSON con mensaje (antes un fallo de cualquiera de las 3 consultas daba un 500 vacío y selectores en blanco sin explicación).
    const referencia = randomUUID().slice(0, 8);
    console.error(`[combustible-catalogos] ref=${referencia}`, e);
    return NextResponse.json({ error: `No se pudieron cargar los catálogos de combustible. Referencia ${referencia}.` }, { status: 500 });
  }
}
