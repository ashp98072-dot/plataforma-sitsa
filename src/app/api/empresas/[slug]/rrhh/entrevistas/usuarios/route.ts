import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarUsuariosEntrevistadores } from "@/lib/rrhh/entrevistas";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/empresas/[slug]/rrhh/entrevistas/usuarios
 * ATRACCION-TALENTO-2 (secciones 4-8) — catálogo de usuarios elegibles como
 * entrevistador principal/auxiliar: activos, con acceso real a esta empresa
 * y con permiso efectivo entrevistas:ver (o Admin). Guard: mismo permiso que
 * el resto de Entrevistas (entrevistas, "ver") — no crea un permiso nuevo.
 * Payload mínimo: id/nombre/username/rol — nunca password_hash, salt ni la
 * matriz de permisos completa. Tenant siempre desde guard.empresa.id.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;

  const usuarios = await listarUsuariosEntrevistadores(guard.empresa.id);
  return NextResponse.json(
    { usuarios },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
