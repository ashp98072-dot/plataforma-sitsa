import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { actualizarContactoCliente } from "@/lib/tms/cliente-contactos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  cargo: z.string().max(120).nullable().optional(),
  telefono: z.string().max(80).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  activo: z.boolean().optional(),
});

/**
 * VIAT-4 — edita un contacto de cliente y/o lo activa/desactiva. Nunca lo
 * elimina (histórico preservado, mismo criterio que /tms/ubicaciones/[id]).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const contactoId = Number(id);
  if (!Number.isFinite(contactoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const contacto = await actualizarContactoCliente(guard.empresa.id, contactoId, parsed.data);
    if (!contacto) {
      return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404 });
    }
    return NextResponse.json({ contacto, mensaje: "Contacto actualizado." });
  } catch (e) {
    console.error("PATCH tms/contactos/[id]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar el contacto." },
      { status: 400 },
    );
  }
}
