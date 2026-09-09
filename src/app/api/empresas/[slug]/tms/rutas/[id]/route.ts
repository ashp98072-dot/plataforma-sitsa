import { NextResponse } from "next/server";
import { requireTenantRutas } from "@/lib/tenant";
import { actualizarRuta, obtenerRuta } from "@/lib/tms/cliente-rutas";
import { actualizarRutaSchema, etiquetaCampoRutaFactory } from "@/lib/tms/rutas-validacion";
import { respuestaErrorValidacion } from "@/lib/validacion-http";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * VIAT-4 — detalle completo de una ruta (con paradas), para autocompletar
 * Programación al elegirla.
 *
 * OPS-5.2a: permiso propio `rutas` (con fallback a `tms` por
 * compatibilidad histórica) — ver requireTenantRutas en tenant.ts.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRutas(slug, "ver");
  if (guard.error) return guard.error;

  const rutaId = Number(id);
  if (!Number.isFinite(rutaId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const ruta = await obtenerRuta(guard.empresa.id, rutaId);
  if (!ruta) {
    return NextResponse.json({ error: "Ruta no encontrada." }, { status: 404 });
  }
  return NextResponse.json({ ruta }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * VIAT-4 — edita una ruta (código/nombre/carga/hora/contacto/paradas) y/o
 * la activa/desactiva. Nunca hard-delete — desactivarla NO afecta viajes
 * ya creados a partir de ella (fotografía histórica en tms_planes_viaje).
 *
 * RUTAS-TARIFARIO-HISTORIAL-1 (§10/§11) — mismo criterio que el POST:
 * error de validación por campo, nunca "Datos inválidos." genérico.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRutas(slug, "editar");
  if (guard.error) return guard.error;

  const rutaId = Number(id);
  if (!Number.isFinite(rutaId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = actualizarRutaSchema.safeParse(body);
  if (!parsed.success) {
    return respuestaErrorValidacion(parsed.error, etiquetaCampoRutaFactory(body), "No se pudo actualizar la ruta");
  }

  try {
    const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
    const ruta = await actualizarRuta(guard.empresa.id, rutaId, parsed.data, actor);
    if (!ruta) {
      return NextResponse.json({ error: "Ruta no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ ruta, mensaje: "Ruta actualizada." });
  } catch (e) {
    console.error("PATCH tms/rutas/[id]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar la ruta." },
      { status: 400 },
    );
  }
}
