import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { crearContactoCliente, listarContactosCliente } from "@/lib/tms/cliente-contactos";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * VIAT-4 (punto 1) — contactos operativos de un cliente. Uso interno
 * TMS/Programación/Operaciones > Rutas. Mismo patrón que
 * /tms/clientes/[clienteId]/ubicaciones (VIAT-1).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  const todas = new URL(req.url).searchParams.get("todas") === "1";

  try {
    const contactos = await listarContactosCliente(guard.empresa.id, cid, {
      incluirInactivos: todas,
    });
    return NextResponse.json(
      { contactos },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET tms/clientes/[clienteId]/contactos", e);
    return NextResponse.json({
      contactos: [],
      aviso: "No se pudo leer el catálogo de contactos. Verifica que la migración VIAT-4 esté aplicada.",
    });
  }
}

const schema = z.object({
  nombre: z.string().min(1).max(160),
  cargo: z.string().max(120).optional(),
  telefono: z.string().max(80).optional(),
  email: z.string().max(160).optional(),
  observaciones: z.string().max(300).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const contacto = await crearContactoCliente(guard.empresa.id, cid, parsed.data);
    return NextResponse.json({ contacto, mensaje: "Contacto guardado." });
  } catch (e) {
    console.error("POST tms/clientes/[clienteId]/contactos", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo guardar el contacto." },
      { status: 400 },
    );
  }
}
