import { readFileSync } from "fs";
import { NextResponse } from "next/server";



import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";

import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";

import {
  listarCargasCombustibleViaje,
  obtenerArchivoCargaCombustible,
} from "@/lib/flota/combustible";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";


/**
 * FLOTA-COMBUSTIBLE-1 (Fase 1: captura del piloto) — registrar y listar
 * cargas de combustible del propio viaje.
 *
 * GET (listar/ver el vale): mismo patrón que
 * .../viajes/[id]/evidencias/route.ts — colaboradorParticipaEnViaje()
 * (piloto O auxiliar realmente asignado a ESE viaje, nunca otro). Un
 * auxiliar sí puede CONSULTAR lo ya registrado en el viaje que comparte.
 *
 * POST (registrar): FLOTA-COMBUSTIBLE-HARDENING-1 — colaboradorParticipa
 * EnViaje() por sí solo NO basta aquí: acepta piloto O auxiliar (ver su
 * WHERE en viajes-piloto.ts, condición `pil.id_empleado = ? OR
 * aux.id_empleado = ? OR aux_legacy.id_empleado = ?`). El registro de
 * combustible es responsabilidad exclusiva del PILOTO — se exige además
 * que `flota_viajes.empleado_id` (el dueño real del viaje técnico)
 * coincida con la sesión. Se reutiliza ese campo tal cual, sin una
 * segunda autenticación: `empleado_id` SIEMPRE es el piloto que hizo la
 * salida — la propia ruta de salida (api/portal/viajes/route.ts) exige
 * `personal.tipo === "Piloto"` antes de insertar la fila, y usa ese
 * mismo empleadoId para poblarlo; es también el mismo campo que ya
 * exige la acción "llegada" de esa ruta (`v.empleado_id = ? AND
 * v.empleado_id = session.empleadoId` en su UPDATE) — mismo criterio de
 * "dueño del viaje", no uno nuevo.
 */

type Ctx = { params: Promise<{ id: string }> };



async function contextoParticipante(ctx: Ctx) {
  const session = await getColaboradorSession();
  const { id } = await ctx.params;
  const viajeId = Number(id);
  if (!session || !viajeId) return { session, viajeId, participacion: null };
  const participacion = await colaboradorParticipaEnViaje(
    session.empresaId,
    session.empleadoId,
    viajeId,
  );
  return { session, viajeId, participacion };
}

export async function GET(req: Request, ctx: Ctx) {
  const { session, viajeId, participacion } = await contextoParticipante(ctx);
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!participacion) {
    return NextResponse.json({ error: "No estás asignado a este viaje." }, { status: 403 });
  }

  const adjuntoId = Number(new URL(req.url).searchParams.get("adjuntoId") ?? 0);
  if (adjuntoId) {
    const archivo = await obtenerArchivoCargaCombustible(session.empresaId, viajeId, adjuntoId);
    if (!archivo) return NextResponse.json({ error: "Vale no encontrado." }, { status: 404 });
    try {
      return new NextResponse(readFileSync(absPathFromRelative(archivo.rutaRelativa)), {
        headers: {
          "Content-Type": archivo.mime || contentTypeFor(archivo.nombreOriginal),
          "Content-Disposition": `inline; filename="${archivo.nombreOriginal.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
    }
  }
  const cargas = await listarCargasCombustibleViaje(session.empresaId, viajeId);
  return NextResponse.json({
    cargas: cargas.map((c) => ({
      ...c,
      url: `/api/portal/viajes/${viajeId}/combustible?adjuntoId=${c.id}`,
    })),
  });
}

/** Captura retirada. GET mantiene consultas y evidencias históricas. */
export async function POST() {
  return NextResponse.json({ error: "La captura de combustible se realiza desde Operaciones." }, { status: 410 });
}
