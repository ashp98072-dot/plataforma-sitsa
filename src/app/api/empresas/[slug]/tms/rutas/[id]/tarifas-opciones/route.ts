import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRutas } from "@/lib/tenant";
import { obtenerRuta } from "@/lib/tms/cliente-rutas";
import { crearTarifaRuta, listarTarifasDeRuta } from "@/lib/tms/ruta-tarifas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1) — catálogo de OPCIONES
 * de tarifa de una ruta (varias activas a la vez). Distinto del historial
 * append-only en /rutas/[id]/tarifas (ese no se toca).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRutas(slug, "ver");
  if (guard.error) return guard.error;
  const rutaId = Number(id);
  if (!Number.isFinite(rutaId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const ruta = await obtenerRuta(guard.empresa.id, rutaId);
  if (!ruta) return NextResponse.json({ error: "Ruta no encontrada." }, { status: 404 });
  const tarifas = await listarTarifasDeRuta(guard.empresa.id, rutaId);
  return NextResponse.json({ tarifas }, { headers: { "Cache-Control": "private, no-store" } });
}

const crearSchema = z.object({
  nombre: z.string().min(1).max(120),
  descripcion: z.string().max(300).nullish(),
  monto: z.number().nonnegative().max(9999999999.99),
  moneda: z.string().min(1).max(10).optional(),
  vigenteDesde: z.string().regex(FECHA_RE).optional(),
  vigenteHasta: z.string().regex(FECHA_RE).nullish(),
  observacion: z.string().max(300).nullish(),
  predeterminada: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRutas(slug, "crear");
  if (guard.error) return guard.error;
  const rutaId = Number(id);
  if (!Number.isFinite(rutaId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const parsed = crearSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos de la tarifa inválidos." }, { status: 400 });

  try {
    const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
    const tarifas = await crearTarifaRuta(guard.empresa.id, rutaId, parsed.data, actor);
    return NextResponse.json({ tarifas, mensaje: "Tarifa creada." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo crear la tarifa." },
      { status: 400 },
    );
  }
}
