import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarEntrevistadoresActivos } from "@/lib/rrhh/entrevistas";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/empresas/[slug]/rrhh/entrevistas/entrevistadores
 * ATRACCION-TALENTO-1 (corrección post-revisión) — un usuario con
 * `entrevistas:ver` pero SIN `empleados:ver` debe poder ver el selector de
 * entrevistador (Entrevistas y Reportes de Atracción); antes ambas
 * pantallas llamaban a `/empleados?estado=Activo`, que exige
 * `empleados:ver` — el selector quedaba vacío para ese usuario, aunque el
 * módulo entero ya estaba correctamente gateado por `entrevistas:ver`.
 *
 * Guard: mismo permiso que el resto de Entrevistas (`entrevistas`, "ver") —
 * NO se crea un permiso nuevo, NO se relaja el endpoint general de
 * empleados. Devuelve únicamente id/codigo/nombre de empleados ACTIVOS de
 * esta empresa (tenant siempre desde `guard.empresa.id`) — nunca sueldo,
 * DPI, NIT, banco, cuenta, teléfono, email ni otro dato del expediente.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;

  const entrevistadores = await listarEntrevistadoresActivos(guard.empresa.id);
  return NextResponse.json(
    { entrevistadores },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
