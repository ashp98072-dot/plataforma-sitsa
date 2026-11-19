import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { validarLote } from "@/lib/tms/programacion-lote";
import { ErrorVistaPrevia } from "@/lib/tms/lector-vista-previa";
import { getPool } from "@/lib/db";
import { conPlazo, ErrorPlazoOperacion } from "@/lib/db-plazo";
import { LIMITE_SENTENCIA_COPIAR_MS, PLAZO_SERVIDOR_COPIAR_MS } from "@/lib/tms/plazos-copia";
import { diagnosticarBloqueos, registrarDiagnosticoBloqueo } from "@/lib/tms/programacion-copia-diagnostico";
import { borradoresDesdeCliente } from "@/lib/tms/programacion-copia";
import { cuerpoCopiaSchema } from "@/lib/tms/programacion-copia-schema";

type Ctx = { params: Promise<{ slug: string }> };

/** POST: revalida las filas editadas contra la fecha destino (solo lectura). `programacion:ver`; empresa de la sesión. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  const parsed = cuerpoCopiaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { fechaOrigen, fechaDestino, filas } = parsed.data;
  try {
    return await conPlazo(getPool(), { presupuestoMs: PLAZO_SERVIDOR_COPIAR_MS, limiteSentenciaMs: LIMITE_SENTENCIA_COPIAR_MS, soloLectura: true }, async () => {
      const b = await borradoresDesdeCliente(guard.empresa.id, fechaOrigen, filas, fechaDestino);
      if (!b.ok) return NextResponse.json({ error: b.error }, { status: 400 });
      const validacion = await validarLote(guard.empresa.id, fechaDestino, b.borradores);
      const diagnostico = diagnosticarBloqueos(validacion);   // solo conteos y números de fila
      registrarDiagnosticoBloqueo(diagnostico);
      return NextResponse.json({ validacion, diagnostico }, { headers: { "Cache-Control": "private, no-store" } });
    });
  } catch (e) {
    if (e instanceof ErrorVistaPrevia || e instanceof ErrorPlazoOperacion) return NextResponse.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "private, no-store" } });
    throw e;
  }
}
