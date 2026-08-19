import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  crearCentroCosto,
  listarCentrosCosto,
  contarEmpleadosPorCentroCosto,
} from "@/lib/rrhh/centros-costo";

type Ctx = { params: Promise<{ slug: string }> };

const crearSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
});

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "centros_costo", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const incluirInactivos = url.searchParams.get("incluirInactivos") === "1";

  const [centros, conteo] = await Promise.all([
    listarCentrosCosto(guard.empresa.id, { incluirInactivos }),
    contarEmpleadosPorCentroCosto(guard.empresa.id),
  ]);

  const conConteo = centros.map((c) => ({
    ...c,
    empleadosActivos: conteo.get(c.id) ?? 0,
  }));

  return NextResponse.json({ centrosCosto: conConteo });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "centros_costo", "editar");
  if (guard.error) return guard.error;

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const r = await crearCentroCosto({
    empresaId: guard.empresa.id,
    codigo: parsed.data.codigo,
    nombre: parsed.data.nombre,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje, id: r.id });
}