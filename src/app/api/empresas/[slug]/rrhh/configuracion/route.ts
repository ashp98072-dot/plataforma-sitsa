import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import {
  crearFeriado,
  guardarParametros,
  listarFeriados,
  obtenerParametros,
  toggleFeriado,
} from "@/lib/rrhh/config";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;
  const [parametros, feriados] = await Promise.all([
    obtenerParametros(guard.empresa.id),
    listarFeriados(guard.empresa.id),
  ]);
  return NextResponse.json({ parametros, feriados });
}

const schema = z.object({
  action: z.enum(["params", "feriado", "toggleFeriado"]),
  parametros: z.record(z.string(), z.string()).optional(),
  descripcion: z.string().optional(),
  fecha: z.string().optional(),
  feriadoId: z.number().int().positive().optional(),
  activo: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  if (d.action === "params") {
    const r = await guardarParametros(guard.empresa.id, d.parametros ?? {});
    if (!r.ok) {
      return NextResponse.json({ error: r.mensaje }, { status: 400 });
    }
    return NextResponse.json({ mensaje: r.mensaje });
  }

  if (d.action === "feriado") {
    if (!d.descripcion || !d.fecha) {
      return NextResponse.json(
        { error: "Descripción y fecha requeridas." },
        { status: 400 },
      );
    }
    const r = await crearFeriado(guard.empresa.id, d.descripcion, d.fecha);
    if (!r.ok) {
      return NextResponse.json({ error: r.mensaje }, { status: 400 });
    }
    return NextResponse.json({ id: r.id, mensaje: r.mensaje });
  }

  if (!d.feriadoId || d.activo == null) {
    return NextResponse.json({ error: "feriadoId y activo requeridos." }, { status: 400 });
  }
  const ok = await toggleFeriado(guard.empresa.id, d.feriadoId, d.activo);
  if (!ok) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  return NextResponse.json({ mensaje: "Feriado actualizado." });
}
