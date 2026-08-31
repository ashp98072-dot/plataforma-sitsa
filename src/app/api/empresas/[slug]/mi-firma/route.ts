import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { eliminarFirmaUsuario, guardarFirmaUsuario, obtenerFirmaUsuario } from "@/lib/firmas/usuario-firmas";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * MI-FIRMA-1 — firma manuscrita personal reutilizable. La firma es
 * GLOBAL por usuario (usuario_firmas.usuario_id, sin empresa_id) — este
 * endpoint vive dentro del contexto corporativo actual (`/e/[slug]/...`)
 * solo porque ahí ya existe sesión/autenticación resuelta
 * (requireTenant), NO porque la firma dependa de la empresa. El usuario
 * SIEMPRE viene de `guard.session.id` — nunca se acepta un usuario_id
 * del cliente.
 */

/** GET — estado (no expone la ruta física, solo si existe y cuándo se actualizó). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenant(slug);
    if (guard.error) return guard.error;

    const firma = await obtenerFirmaUsuario(guard.session.id);
    return NextResponse.json({
      tieneFirma: firma != null,
      actualizadoEn: firma?.actualizadoEn ?? null,
    });
  } catch (error) {
    console.error("GET mi-firma", error);
    return NextResponse.json({ error: "No se pudo consultar tu firma." }, { status: 500 });
  }
}

/** POST — registra o reemplaza la firma. multipart/form-data: firmaImagen (PNG, obligatorio, máx. 1 MB). */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenant(slug);
    if (guard.error) return guard.error;

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    const file = form.get("firmaImagen");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "Dibuja tu firma antes de continuar." }, { status: 400 });
    }
    if (file.size > MAX_FIRMA_IMAGEN_BYTES) {
      return NextResponse.json({ error: "La imagen de la firma supera el tamaño permitido." }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    if (!esPngValido(new Uint8Array(bytes))) {
      return NextResponse.json({ error: "La imagen de la firma debe ser un PNG válido." }, { status: 400 });
    }

    const firma = await guardarFirmaUsuario(guard.empresa.id, guard.session.id, {
      bytes,
      original: file.name || "firma.png",
    });
    return NextResponse.json({ mensaje: "Firma guardada.", actualizadoEn: firma.actualizadoEn });
  } catch (error) {
    console.error("POST mi-firma", error);
    return NextResponse.json({ error: "No se pudo guardar tu firma." }, { status: 500 });
  }
}

/** DELETE — elimina la firma guardada (nunca toca firmas_electronicas). */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenant(slug);
    if (guard.error) return guard.error;

    const r = await eliminarFirmaUsuario(guard.session.id);
    if (!r.ok) {
      return NextResponse.json({ error: "No tienes una firma guardada." }, { status: 404 });
    }
    return NextResponse.json({ mensaje: "Firma eliminada." });
  } catch (error) {
    console.error("DELETE mi-firma", error);
    return NextResponse.json({ error: "No se pudo eliminar tu firma." }, { status: 500 });
  }
}
