import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { CATEGORIAS_GASTO, METODOS_PAGO_GASTO, crearGasto, listarGastos } from "@/lib/tms/gastos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const p = url.searchParams;
  const numero = (v: string | null) => {
    const n = Number(v);
    return v && Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const gastos = await listarGastos(guard.empresa.id, {
    fechaDesde: p.get("fechaDesde") || undefined,
    fechaHasta: p.get("fechaHasta") || undefined,
    categoria: p.get("categoria") || undefined,
    clienteId: numero(p.get("clienteId")),
    vehiculoId: numero(p.get("vehiculoId")),
    planId: numero(p.get("planId")),
    empleadoId: numero(p.get("empleadoId")),
    incluirInactivos: p.get("incluirInactivos") === "1",
  });
  return NextResponse.json(
    { gastos, categorias: CATEGORIAS_GASTO, metodosPago: METODOS_PAGO_GASTO },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  fechaSolicitud: z.string().min(1),
  fechaViaje: z.string().nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99),
  metodoPago: z.enum(METODOS_PAGO_GASTO).nullable().optional(),
  numeroCuentaPago: z.string().max(80).nullable().optional(),
  tieneFactura: z.boolean().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 3) — TODOS opcionales, mismo criterio
   * que crearGasto (Fase 2): la UI actual (Fase 4, todavía no
   * implementada) no los envía, así que "Crear gasto" sigue funcionando
   * igual sin ellos. `estado`/`autorizante*` NO están aquí a propósito —
   * nunca se aceptan en creación/edición, solo los escriben
   * autorizarGasto/rechazarGasto vía sus propios endpoints.
   */
  entidadRequirenteId: z.number().int().positive().optional(),
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  requirenteUsuarioId: z.number().int().positive().nullable().optional(),
  solicitanteUsuarioId: z.number().int().positive().nullable().optional(),
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
    const gasto = await crearGasto(guard.empresa.id, parsed.data, guard.session.username);
    return NextResponse.json({ mensaje: "Gasto registrado.", gasto });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear el gasto." }, { status: 400 });
  }
}
