import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesCargosAdicionales } from "@/lib/tenant";
import { anularCargoAdicional } from "@/lib/tms/cargos-adicionales";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string; cargoId: string }> };

const schema = z.object({ expectedVersion: z.number().int().min(1).max(2147483647), motivo: z.string().max(500) }).strict();

/** Anula (NO borra) un cargo con motivo obligatorio (≥ 5 caracteres). Queda quién, cuándo y por qué; puede reactivarse. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id, cargoId } = await ctx.params;
  const guard = await requireTenantViajesCargosAdicionales(slug, "editar");
  if (guard.error) return guard.error;
  const planId = Number(id);
  const cId = Number(cargoId);
  if (!Number.isInteger(planId) || planId <= 0 || !Number.isInteger(cId) || cId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida: se requieren expectedVersion y motivo." }, { status: 400 });
  try {
    const r = await anularCargoAdicional(
      { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
      { planId, cargoId: cId, versionEsperada: parsed.data.expectedVersion, motivo: parsed.data.motivo },
    );
    return NextResponse.json({ mensaje: r.idempotente ? "El cargo ya estaba anulado." : "Cargo anulado.", idempotente: r.idempotente, evento: r.evento, cargo: r.cargo });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
