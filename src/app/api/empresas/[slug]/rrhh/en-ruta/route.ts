import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  eliminarEnRuta,
  obtenerEmpleadosVariables,
  obtenerRegistrosEnRuta,
  registrarEnRuta,
} from "@/lib/rrhh/en-ruta";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const hoy = hoyLocal();
  const desde = url.searchParams.get("desde") ?? hoy;
  const hasta = url.searchParams.get("hasta") ?? hoy;
  const [registros, variables] = await Promise.all([
    obtenerRegistrosEnRuta(guard.empresa.id, desde, hasta),
    obtenerEmpleadosVariables(guard.empresa.id),
  ]);
  return NextResponse.json({ registros, variables });
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  comentario: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const r = await registrarEnRuta(guard.empresa.id, {
    idEmpleado: parsed.data.empleadoId,
    fechaInicio: parsed.data.fechaInicio,
    fechaFin: parsed.data.fechaFin,
    comentario: parsed.data.comentario,
    registradoPor: guard.session.username,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;
  const id = Number(new URL(req.url).searchParams.get("id") ?? "0");
  if (!id) {
    return NextResponse.json({ error: "id requerido." }, { status: 400 });
  }
  const ok = await eliminarEnRuta(guard.empresa.id, id);
  if (!ok) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  return NextResponse.json({ mensaje: "Eliminado." });
}
