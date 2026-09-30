import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViajesMasivoPorPeriodo } from "@/lib/tms/cierre-masivo";

type Ctx = { params: Promise<{ slug: string }> };

const agrupacion = z.enum(["DIA", "SEMANA", "MES"]);
const valor = z.string().min(1).max(20);
const filtros = z.object({
  clienteId: z.number().int().positive().optional(),
  pilotoId: z.number().int().positive().optional(),
  unidadId: z.number().int().positive().optional(),
  estado: z.string().optional(),
  ruta: z.string().optional(),
  estadoFacturacion: z.enum(["No aplica", "Pendiente de facturación", "En borrador de factura", "Facturado"]).optional(),
  estadoCobro: z.enum(["Sin pagos", "Pago parcial", "Cobrado"]).optional(),
}).strict().optional();

/**
 * Esquema ESTRICTO, mismo criterio que /tms/planes/cerrar-masivo: NORMAL no acepta motivo/comentario; MANUAL
 * exige motivo común (5–500) y admite comentario común opcional (≤1000). Sin empresa_id ni planIds — la
 * empresa sale siempre de la sesión, y los ids SIEMPRE se resuelven server-side (ver cerrarViajesMasivoPorPeriodo).
 */
const bodySchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("NORMAL"), agrupacion, valor, filtros }).strict(),
  z.object({
    tipo: z.literal("MANUAL"),
    agrupacion,
    valor,
    filtros,
    motivo: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres.").max(500, "El motivo no puede superar 500 caracteres."),
    comentario: z.string().trim().max(1000, "El comentario no puede superar 1000 caracteres.").optional(),
  }).strict(),
]);

/**
 * PLANES-CIERRE-PERIODO — POST /tms/planes/cerrar-masivo-periodo. Cierra TODOS los viajes elegibles de un
 * período (Día/Semana/Mes) completo, más allá de la página cargada por el cliente — mismo permiso que el
 * cierre individual y el masivo por selección (`viajes_cerrar:editar`). SIEMPRE resuelve los candidatos desde
 * la base de datos en este momento (nunca acepta una lista de ids del cliente): si un viaje cambió de estado
 * mientras el usuario tenía el modal de confirmación abierto, queda omitido con su motivo, nunca se fuerza.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViajesCerrar(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const body = parsed.data;
  const resultado = await cerrarViajesMasivoPorPeriodo({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    tipo: body.tipo,
    agrupacion: body.agrupacion,
    valor: body.valor,
    filtros: body.filtros,
    motivo: body.tipo === "MANUAL" ? body.motivo : undefined,
    comentario: body.tipo === "MANUAL" ? body.comentario || null : null,
  });
  if ("error" in resultado) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
}
