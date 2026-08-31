import { NextResponse } from "next/server";
import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { rechazarViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * VIATICOS-RECHAZADO-1 — PROGRAMADO -> RECHAZADO. Permiso EXACTAMENTE
 * `viaticos_autorizar:editar` (requireTenantViaticosAutorizar) — el
 * mismo que autorizar, verificado ANTES de tocar el body. No se amplía
 * ningún permiso: Facturador/AuxiliarOperaciones nunca lo traen por
 * defecto (ver src/lib/permisos-shared.ts).
 *
 * Body JSON simple: `{ motivoRechazo: string }` — sin multipart (este
 * flujo no maneja archivos/imágenes; nunca llama a SelectorFirma/
 * FirmaCanvas/crearFirmaInterna/guardarImagenFirma — ver JSDoc de
 * rechazarViatico en src/lib/tms/viaticos.ts). Validación de longitud
 * (mínimo/máximo) vive en rechazarViatico(), no aquí — este endpoint
 * solo valida forma (JSON parseable, campo string) y delega.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantViaticosAutorizar(slug, "editar");
    if (guard.error) return guard.error;

    const viaticoId = Number(id);
    if (!Number.isFinite(viaticoId)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const motivoRechazo = typeof body?.motivoRechazo === "string" ? body.motivoRechazo : "";

    const r = await rechazarViatico(guard.empresa.id, viaticoId, motivoRechazo, guard.session.username);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json({ mensaje: "Viático rechazado." });
  } catch (error) {
    console.error("POST rechazar viático", error);
    return NextResponse.json({ error: "No se pudo rechazar el viático." }, { status: 500 });
  }
}
