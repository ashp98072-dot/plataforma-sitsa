import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticosPagar } from "@/lib/tenant";
import { registrarEntregaViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE"]),
  referenciaPago: z.string().max(100).optional().nullable(),
  observaciones: z.string().max(300).optional().nullable(),
});

/**
 * VIAT-2 — AUTORIZADO -> ENTREGADO. "OPERACIONES AUTORIZA, FACTURADOR
 * PAGA": permiso EXPLÍCITO `viaticos_pagar:editar`
 * (requireTenantViaticosPagar), separado de `viaticos_autorizar` — quien
 * autorizó no puede entregar solo por eso, y viceversa. El body nunca
 * acepta monto/monto_asignado — actualizarMontoViatico además bloquea
 * cualquier cambio de monto fuera de PROGRAMADO, así que el facturador no
 * puede modificarlo aunque lo intentara por otra vía.
 *
 * VIATICOS-PAGO-SNAPSHOT-1 — registrarEntregaViatico ahora abre una
 * transacción real (antes era un execute() suelto) para poder congelar
 * banco/cuenta_bancaria/tipo_cuenta cuando el método es TRANSFERENCIA —
 * try/catch explícito aquí (mismo criterio que autorizar/liquidar/
 * entrega-masiva route.ts): una excepción no controlada de la nueva
 * transacción (p. ej. fallo real de conexión) ya no debe escapar como un
 * 500 sin cuerpo JSON.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantViaticosPagar(slug, "editar");
    if (guard.error) return guard.error;

    const viaticoId = Number(id);
    if (!Number.isFinite(viaticoId)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    const d = parsed.data;

    const r = await registrarEntregaViatico(
      guard.empresa.id,
      viaticoId,
      {
        metodoPago: d.metodoPago,
        referenciaPago: d.referenciaPago ?? null,
        observaciones: d.observaciones ?? null,
      },
      guard.session.username,
    );
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    }
    return NextResponse.json({ mensaje: "Entrega registrada." });
  } catch (error) {
    console.error("POST entrega viático", error);
    return NextResponse.json({ error: "No se pudo registrar la entrega del viático." }, { status: 500 });
  }
}
