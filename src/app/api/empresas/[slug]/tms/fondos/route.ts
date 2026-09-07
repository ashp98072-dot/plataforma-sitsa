import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { CATEGORIAS_GASTO } from "@/lib/tms/gastos";
import { ESTADOS_FONDO, crearSolicitudFondo, listarSolicitudesFondo } from "@/lib/tms/fondos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const p = new URL(req.url).searchParams;
  const estado = p.get("estado");
  const solicitudes = await listarSolicitudesFondo(guard.empresa.id, {
    estado: estado && (ESTADOS_FONDO as readonly string[]).includes(estado) ? (estado as (typeof ESTADOS_FONDO)[number]) : undefined,
    fechaDesde: p.get("fechaDesde") || undefined,
    fechaHasta: p.get("fechaHasta") || undefined,
  });
  return NextResponse.json(
    { solicitudes, estados: ESTADOS_FONDO },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const lineaSchema = z.object({
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99),
});

const schema = z.object({
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  fechaRequerimiento: z.string().min(1),
  observaciones: z.string().max(300).nullable().optional(),
  lineas: z.array(lineaSchema).min(1).max(40),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  try {
    const solicitud = await crearSolicitudFondo(guard.empresa.id, parsed.data, guard.session.username);
    return NextResponse.json({ mensaje: "Solicitud de fondo creada.", solicitud });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear la solicitud." }, { status: 400 });
  }
}
