import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  crearEntradaBitacoraLegal,
  listarBitacoraLegal,
} from "@/lib/rrhh/bitacora-legal";

type Ctx = { params: Promise<{ slug: string }> };

const crearSchema = z.object({
  tipo: z.enum(["Amonestacion", "Suspension", "Despido", "GestionGeneral", "Otro"]),
  fecha: z.string().min(1),
  descripcion: z.string().min(1),
  empleadoId: z.number().int().positive().optional().nullable(),
});

/**
 * GET /api/empresas/[slug]/rrhh/bitacora-legal
 * ?empleadoId=123 -> filtra a un solo empleado (ficha individual).
 * ?tipo=Despido -> filtra por tipo.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "bitacora_legal", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const empleadoId = Number(url.searchParams.get("empleadoId")) || undefined;
  const tipoParam = url.searchParams.get("tipo");
  const tipo =
    tipoParam &&
    ["Amonestacion", "Suspension", "Despido", "GestionGeneral", "Otro"].includes(
      tipoParam,
    )
      ? (tipoParam as
          | "Amonestacion"
          | "Suspension"
          | "Despido"
          | "GestionGeneral"
          | "Otro")
      : undefined;

  const entradas = await listarBitacoraLegal(guard.empresa.id, {
    empleadoId,
    tipo,
  });
  return NextResponse.json({ entradas });
}

/**
 * POST /api/empresas/[slug]/rrhh/bitacora-legal
 * Registra una nueva entrada en la bitácora legal.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "bitacora_legal", "editar");
  if (guard.error) return guard.error;

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const creadoPor = guard.session.nombre || guard.session.username || "RRHH";

  const r = await crearEntradaBitacoraLegal({
    empresaId: guard.empresa.id,
    tipo: parsed.data.tipo,
    fecha: parsed.data.fecha,
    descripcion: parsed.data.descripcion,
    empleadoId: parsed.data.empleadoId,
    creadoPor,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje, id: r.id });
}