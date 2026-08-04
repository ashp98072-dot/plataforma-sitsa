import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  listarMarcajesRango,
  registrarMarcajeKiosko,
  registrarMarcajeManual,
} from "@/lib/rrhh/marcajes";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const hoy = hoyLocal();
  const desde = url.searchParams.get("desde") ?? hoy;
  const hasta = url.searchParams.get("hasta") ?? desde;
  const marcajes = await listarMarcajesRango(guard.empresa.id, desde, hasta);
  return NextResponse.json({ marcajes });
}

const kioskoSchema = z.object({
  modo: z.literal("kiosko"),
  codigo: z.string().min(1),
  viajeLargo: z.boolean().optional(),
});

const manualSchema = z.object({
  empleadoId: z.number().int().positive(),
  fechaJornada: z.string().min(8),
  tipo: z.enum(["entrada", "salida"]),
  comentarios: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const body = await req.json();

  if (body?.modo === "kiosko") {
    const parsed = kioskoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    const r = await registrarMarcajeKiosko(guard.empresa.id, {
      codigo: parsed.data.codigo,
      viajeLargo: parsed.data.viajeLargo,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.error, code: r.code }, { status: 400 });
    }
    return NextResponse.json({
      mensaje: `${r.tipo} de ${r.nombre} a las ${r.hora}`,
      ...r,
    });
  }

  const parsed = manualSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const r = await registrarMarcajeManual(guard.empresa.id, parsed.data);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ id: r.id, mensaje: r.mensaje });
}
