import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticosPagar } from "@/lib/tenant";
import {
  LIMITE_LOTE_ENTREGA_MASIVA,
  registrarEntregaViaticosMasiva,
  type DatosEntregaMasiva,
} from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * VIATICOS-PAGO-MASIVO-1 — entrega/pago MASIVO de viáticos AUTORIZADOS.
 * Permiso: EXACTAMENTE `viaticos_pagar:editar` (requireTenantViaticosPagar
 * — mismo permiso que el endpoint individual .../[id]/entrega, sin
 * ampliarlo). JSON simple (sin multipart — este flujo no maneja
 * archivos/imágenes, a diferencia de autorizar/liquidar).
 *
 * Dos formas de body según `metodoPago` (sección 2/5 del ticket):
 * - TRANSFERENCIA/EFECTIVO: `{ ids: number[], metodoPago, referenciaPago? }`
 *   — UNA sola referencia para todo el lote (representa el lote/operación
 *   bancaria en TRANSFERENCIA; EFECTIVO no la exige).
 * - CHEQUE: `{ metodoPago: "CHEQUE", items: [{ id, referenciaPago }] }` —
 *   cada viático trae SU PROPIO número de cheque (nunca uno compartido:
 *   cada persona recibe un cheque físico distinto).
 *
 * Body inválido/mal formado -> 400 ANTES de tocar la base de datos. La
 * regla de "TODO O NADA" (rollback completo si cualquier seleccionado no
 * califica) vive en registrarEntregaViaticosMasiva() — este endpoint solo
 * valida forma y delega.
 */
const itemChequeSchema = z.object({
  id: z.number().int().positive(),
  referenciaPago: z.string().trim().min(1).max(100),
});

const schema = z.discriminatedUnion("metodoPago", [
  z.object({
    metodoPago: z.literal("TRANSFERENCIA"),
    ids: z.array(z.number().int().positive()).min(1).max(LIMITE_LOTE_ENTREGA_MASIVA),
    referenciaPago: z.string().trim().min(1).max(100),
  }),
  z.object({
    metodoPago: z.literal("EFECTIVO"),
    ids: z.array(z.number().int().positive()).min(1).max(LIMITE_LOTE_ENTREGA_MASIVA),
    referenciaPago: z.string().trim().max(100).optional().nullable(),
  }),
  z.object({
    metodoPago: z.literal("CHEQUE"),
    items: z.array(itemChequeSchema).min(1).max(LIMITE_LOTE_ENTREGA_MASIVA),
  }),
]);

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantViaticosPagar(slug, "editar");
    if (guard.error) return guard.error;

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    const d = parsed.data;

    const datos: DatosEntregaMasiva =
      d.metodoPago === "CHEQUE"
        ? { metodoPago: "CHEQUE", items: d.items.map((it) => ({ id: it.id, referenciaPago: it.referenciaPago })) }
        : {
            metodoPago: d.metodoPago,
            items: d.ids.map((id) => ({ id, referenciaPago: d.referenciaPago?.trim() || null })),
          };

    const r = await registrarEntregaViaticosMasiva(guard.empresa.id, datos, guard.session.username);
    if (!r.ok) {
      return NextResponse.json({ error: r.error, detalles: r.detalles }, { status: r.status });
    }
    return NextResponse.json({ procesados: r.procesados, total: r.total, metodoPago: r.metodoPago });
  } catch (error) {
    console.error("POST entrega masiva viáticos", error);
    return NextResponse.json({ error: "No se pudo registrar la entrega masiva." }, { status: 500 });
  }
}
