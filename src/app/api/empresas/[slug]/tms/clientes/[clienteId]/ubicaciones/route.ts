import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { crearUbicacionCliente, listarUbicacionesCliente } from "@/lib/tms/cliente-ubicaciones";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * VIAT-1 (punto 3) — ubicaciones/paradas guardadas de un cliente
 * (tms_clientes.id, la misma identidad que ya usa tms_planes_viaje.
 * cliente_id). Uso interno TMS/Programación.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  try {
    const ubicaciones = await listarUbicacionesCliente(guard.empresa.id, cid);
    return NextResponse.json(
      { ubicaciones },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET tms/clientes/[clienteId]/ubicaciones", e);
    return NextResponse.json({
      ubicaciones: [],
      aviso: "No se pudo leer el catálogo de ubicaciones. Verifica que la migración VIAT-1 esté aplicada.",
    });
  }
}

const schema = z.object({
  nombre: z.string().min(1).max(160),
  direccion: z.string().max(300).optional(),
  municipio: z.string().max(120).optional(),
  departamento: z.string().max(120).optional(),
  referencia: z.string().max(300).optional(),
  tipo: z.enum(["CARGA", "ENTREGA", "AMBOS"]).optional(),
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
    const ubicacion = await crearUbicacionCliente(guard.empresa.id, cid, parsed.data);
    return NextResponse.json({ ubicacion, mensaje: "Ubicación guardada." });
  } catch (e) {
    console.error("POST tms/clientes/[clienteId]/ubicaciones", e);
    return NextResponse.json(
      { error: "No se pudo guardar la ubicación." },
      { status: 500 },
    );
  }
}
