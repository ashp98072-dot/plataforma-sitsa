import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { actualizarUbicacionCliente } from "@/lib/tms/cliente-ubicaciones";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  direccion: z.string().max(300).nullable().optional(),
  municipio: z.string().max(120).nullable().optional(),
  departamento: z.string().max(120).nullable().optional(),
  referencia: z.string().max(300).nullable().optional(),
  tipo: z.enum(["CARGA", "ENTREGA", "AMBOS"]).optional(),
  activo: z.boolean().optional(),
});

/**
 * VIAT-1b (administración TMS, punto 2) — edita una ubicación guardada de
 * cliente y/o la activa/desactiva. Nunca la elimina (histórico
 * preservado); "dejar de usarse" es activo=false.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const ubicacionId = Number(id);
  if (!Number.isFinite(ubicacionId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const ubicacion = await actualizarUbicacionCliente(guard.empresa.id, ubicacionId, parsed.data);
    if (!ubicacion) {
      return NextResponse.json({ error: "Ubicación no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ ubicacion, mensaje: "Ubicación actualizada." });
  } catch (e) {
    console.error("PATCH tms/ubicaciones/[id]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar la ubicación." },
      { status: 400 },
    );
  }
}
