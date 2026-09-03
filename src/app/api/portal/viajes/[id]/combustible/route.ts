import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import {
  listarCargasCombustibleViaje,
  obtenerArchivoCargaCombustible,
  registrarCargaCombustible,
  type TipoCombustible,
} from "@/lib/flota/combustible";
import { UploadValidationError, absPathFromRelative, contentTypeFor } from "@/lib/uploads";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 1: captura del piloto) — registrar y listar
 * cargas de combustible del propio viaje. Mismo patrón de autorización
 * que .../viajes/[id]/evidencias/route.ts: colaboradorParticipaEnViaje()
 * (piloto o auxiliar realmente asignado a ESE viaje, nunca otro).
 */

type Ctx = { params: Promise<{ id: string }> };

const TIPOS: TipoCombustible[] = ["diesel", "gasolina"];

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

export async function POST(req: Request, ctx: Ctx) {
  const { session, viajeId, participacion } = await contextoParticipante(ctx);
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!participacion) {
    return NextResponse.json({ error: "No estás asignado a este viaje." }, { status: 403 });
  }
  if (participacion.estado !== "abierto") {
    return NextResponse.json(
      { error: "Solo se registra combustible mientras el viaje está en curso." },
      { status: 409 },
    );
  }
  const empleado = await obtenerEmpleado(session.empresaId, session.empleadoId);
  if (!empleado) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  const viaje = await query<RowDataPacket[]>(
    `SELECT v.vehiculo_id, v.piloto_nombre FROM flota_viajes v
     WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
    [viajeId, session.empresaId],
  );
  if (!viaje[0]) return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });

  const form = await req.formData();
  const tipoRaw = String(form.get("tipoCombustible") ?? "");
  const tipoCombustible = TIPOS.includes(tipoRaw as TipoCombustible) ? (tipoRaw as TipoCombustible) : null;
  if (!tipoCombustible) {
    return NextResponse.json({ error: "Selecciona el tipo de combustible." }, { status: 400 });
  }
  const galones = Number(form.get("galones"));
  if (!Number.isFinite(galones) || galones <= 0) {
    return NextResponse.json({ error: "Indica los galones cargados." }, { status: 400 });
  }
  const monto = Number(form.get("monto"));
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: "Indica el valor pagado." }, { status: 400 });
  }
  const kmRaw = form.get("km");
  const km = typeof kmRaw === "string" && kmRaw.trim() !== "" ? Number(kmRaw) : null;
  if (km != null && (!Number.isInteger(km) || km < 0)) {
    return NextResponse.json({ error: "Kilometraje inválido." }, { status: 400 });
  }
  const gasolineraRaw = form.get("gasolinera");
  const gasolinera = typeof gasolineraRaw === "string" && gasolineraRaw.trim() ? gasolineraRaw.trim().slice(0, 150) : null;

  const archivo = form.get("file");
  if (!(archivo instanceof Blob) || archivo.size <= 0) {
    return NextResponse.json({ error: "Adjunta la fotografía del vale." }, { status: 400 });
  }

  let cargaId: number;
  try {
    cargaId = await registrarCargaCombustible({
      empresaId: session.empresaId,
      vehiculoId: Number(viaje[0].vehiculo_id),
      viajeId,
      empleadoId: session.empleadoId,
      pilotoNombre: String(viaje[0].piloto_nombre ?? empleado.nombre),
      tipoCombustible,
      galones,
      monto,
      km,
      gasolinera,
      file: {
        name: (archivo as Blob & { name?: string }).name || `vale_${Date.now()}.jpg`,
        size: archivo.size,
        type: archivo.type,
        arrayBuffer: () => archivo.arrayBuffer(),
      },
      username: `portal:${empleado.codigo}`,
    });
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Registrar carga de combustible", err);
    return NextResponse.json({ error: "No se pudo registrar la carga de combustible." }, { status: 500 });
  }

  await registrarAuditoria({
    empresaId: session.empresaId,
    usuario: `portal:${empleado.codigo}`,
    accion: "registrar_combustible",
    modulo: "tms",
    detalle: `Carga de combustible #${cargaId} en viaje #${viajeId} · ${tipoCombustible} · ${galones} gal · Q${monto.toFixed(2)} · ${empleado.nombre}`,
  });

  return NextResponse.json({
    id: cargaId,
    mensaje: "Carga de combustible registrada. Operaciones la revisará.",
  });
}
