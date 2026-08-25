import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { actualizarRuta, obtenerRuta } from "@/lib/tms/cliente-rutas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** VIAT-4 — detalle completo de una ruta (con paradas), para autocompletar Programación al elegirla. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
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

const paradaSchema = z.object({
  tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
  lugarNombre: z.string().min(1),
  clienteUbicacionId: z.number().int().positive().optional(),
});

const schema = z.object({
  codigo: z.string().min(1).max(40).optional(),
  nombre: z.string().max(200).nullable().optional(),
  ubicacionCargaId: z.number().int().positive().nullable().optional(),
  lugarCargaTexto: z.string().max(300).nullable().optional(),
  destinoDescripcion: z.string().max(300).nullable().optional(),
  horaHabitual: z.string().max(20).nullable().optional(),
  contactoClienteId: z.number().int().positive().nullable().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  paradas: z.array(paradaSchema).max(20).optional(),
  activo: z.boolean().optional(),
});

/**
 * VIAT-4 — edita una ruta (código/nombre/carga/hora/contacto/paradas) y/o
 * la activa/desactiva. Nunca hard-delete — desactivarla NO afecta viajes
 * ya creados a partir de ella (fotografía histórica en tms_planes_viaje).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const rutaId = Number(id);
  if (!Number.isFinite(rutaId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const ruta = await actualizarRuta(guard.empresa.id, rutaId, parsed.data);
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
