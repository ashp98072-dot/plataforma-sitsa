import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { crearEntrega, listarEntregas } from "@/lib/rrhh/inventario";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Fase INV-1: historial de entregas — global, o filtrado por artículo/
 * empleado (query params opcionales). Reutiliza listarEntregas(), que ya
 * hace el JOIN a inventario_rrhh/empleados para mostrar nombres/códigos.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "ver");
  if (guard.error) return guard.error;
  const sp = new URL(req.url).searchParams;
  const articuloId = sp.get("articuloId");
  const empleadoId = sp.get("empleadoId");
  const entregas = await listarEntregas(guard.empresa.id, {
    articuloId: articuloId ? Number(articuloId) : undefined,
    empleadoId: empleadoId ? Number(empleadoId) : undefined,
  });
  return NextResponse.json(
    { entregas },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  articuloId: z.number().int().positive(),
  empleadoId: z.number().int().positive(),
  cantidad: z.number().int().positive(),
  costoUnitario: z.number().min(0).optional(),
  cobraEmpleado: z.boolean(),
  montoCobrado: z.number().min(0).optional(),
  numeroCuotas: z.number().int().positive().max(60).optional(),
  periodicidad: z
    .enum([
      "UNA_VEZ",
      "CADA_QUINCENA",
      "SOLO_QUINCENA_1",
      "SOLO_QUINCENA_2",
      "CADA_N_QUINCENAS",
      "MENSUAL",
      "MANUAL",
    ])
    .optional(),
  cadaNQuincenas: z.number().int().positive().optional(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).").optional(),
  motivo: z.string().max(300).optional(),
});

function statusParaEntrega(motivo: string): number {
  if (motivo === "stock_insuficiente") return 409;
  if (motivo === "error") return 500;
  return 400;
}

/**
 * Fase INV-1: entrega un artículo a un empleado — descuenta stock, registra
 * el movimiento SALIDA, crea la entrega y, si cobraEmpleado, crea el
 * descuento D1/D2 (clasificación INVENTARIO) ya ACTIVO con sus cuotas, todo
 * en una sola transacción (ver crearEntrega en inventario.ts). No duplica
 * el motor de descuentos.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "editar");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  if (d.cobraEmpleado && !d.numeroCuotas) {
    return NextResponse.json(
      { error: "Indica el número de cuotas si la entrega genera descuento." },
      { status: 400 },
    );
  }
  const resultado = await crearEntrega(guard.empresa.id, {
    articuloId: d.articuloId,
    empleadoId: d.empleadoId,
    cantidad: d.cantidad,
    costoUnitario: d.costoUnitario ?? null,
    cobraEmpleado: d.cobraEmpleado,
    montoCobrado: d.montoCobrado ?? null,
    numeroCuotas: d.numeroCuotas,
    periodicidad: d.periodicidad,
    cadaNQuincenas: d.cadaNQuincenas ?? null,
    fechaInicio: d.fechaInicio,
    motivo: d.motivo ?? null,
    entregadoPor: guard.session.username,
  });
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.mensaje },
      { status: statusParaEntrega(resultado.motivo) },
    );
  }
  return NextResponse.json({
    id: resultado.id,
    descuentoId: resultado.descuentoId,
    stockResultante: resultado.stockResultante,
    mensaje: resultado.descuentoId
      ? `Entrega registrada. Descuento #${resultado.descuentoId} activo.`
      : "Entrega registrada (sin cobro).",
  });
}
