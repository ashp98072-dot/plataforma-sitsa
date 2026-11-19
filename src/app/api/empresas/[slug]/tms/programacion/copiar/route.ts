import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { validarLote } from "@/lib/tms/programacion-lote";
import { ErrorVistaPrevia } from "@/lib/tms/lector-vista-previa";
import { getPool } from "@/lib/db";
import { conPlazo, ErrorPlazoOperacion } from "@/lib/db-plazo";
import { LIMITE_SENTENCIA_COPIAR_MS, PLAZO_SERVIDOR_COPIAR_MS } from "@/lib/tms/plazos-copia";
import { diagnosticarBloqueos, registrarDiagnosticoBloqueo } from "@/lib/tms/programacion-copia-diagnostico";
import { cargarCopiaDeFecha, catalogosParaCopia } from "@/lib/tms/programacion-copia";

type Ctx = { params: Promise<{ slug: string }> };
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — GET: carga la vista previa de "Copiar programación". SOLO LECTURA: no guarda
 * nada. Permiso de lectura de Programación (`programacion:ver`); la empresa sale SIEMPRE de la sesión.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  const sp = new URL(req.url).searchParams;
  const origen = fecha.safeParse(sp.get("fechaOrigen"));
  const destino = fecha.safeParse(sp.get("fechaDestino"));
  if (!origen.success || !destino.success) return NextResponse.json({ error: "Fechas inválidas (YYYY-MM-DD)." }, { status: 400 });
  if (origen.data === destino.data) return NextResponse.json({ error: "La fecha destino debe ser distinta de la fecha origen." }, { status: 400 });

  try {
    // TODA la operación (cargar + validar + catálogos) con plazo y cancelación real: una conexión dedicada, límites de sesión por sentencia y, al vencer,
    // KILL QUERY + destrucción de la conexión ANTES de responder (db-plazo.ts). Las validaciones de identidad y su lector no cambian.
    return await conPlazo(getPool(), { presupuestoMs: PLAZO_SERVIDOR_COPIAR_MS, limiteSentenciaMs: LIMITE_SENTENCIA_COPIAR_MS, soloLectura: true }, async () => {
      const filas = await cargarCopiaDeFecha(guard.empresa.id, origen.data);
      const validacion = filas.length ? await validarLote(guard.empresa.id, destino.data, filas.map((f) => f.borrador)) : [];
      const rutaIds = [...new Set(filas.map((f) => f.borrador.rutaId).filter((n): n is number => n != null))];
      const catalogos = await catalogosParaCopia(guard.empresa.id, rutaIds);
      const diagnostico = diagnosticarBloqueos(validacion);   // solo conteos y números de fila
      registrarDiagnosticoBloqueo(diagnostico);
      return NextResponse.json(
        { filas: filas.map((f, i) => ({ ...f, validacion: validacion[i] })), catalogos, diagnostico },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    });
  } catch (e) {
    // Fallo técnico controlado (bloqueo, plazo agotado, base ocupada): 503 con mensaje claro; nunca una espera infinita. Otros errores no se disfrazan.
    if (e instanceof ErrorVistaPrevia || e instanceof ErrorPlazoOperacion) return NextResponse.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "private, no-store" } });
    throw e;
  }
}
