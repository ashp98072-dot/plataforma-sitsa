import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { asegurarSchemaFlota, asegurarSchemaFlotaLectura } from "@/lib/flota/schema";
import {
  listarCargasCombustibleViaje,
  obtenerArchivoCargaCombustible,
  registrarCargaCombustible,
  type TipoCombustible,
} from "@/lib/flota/combustible";
import { UploadValidationError, absPathFromRelative, contentTypeFor } from "@/lib/uploads";

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
  await asegurarSchemaFlotaLectura().catch(() => undefined);
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

  await asegurarSchemaFlota().catch(() => undefined);

  const viaje = await query<RowDataPacket[]>(
    `SELECT v.vehiculo_id, v.piloto_nombre, v.empleado_id FROM flota_viajes v
     WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
    [viajeId, session.empresaId],
  );
  if (!viaje[0]) return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
  // FLOTA-COMBUSTIBLE-HARDENING-1 — solo el piloto responsable del viaje
  // (dueño real de flota_viajes) registra combustible; un auxiliar
  // asignado al mismo viaje pasa colaboradorParticipaEnViaje() pero NO
  // debe poder registrar.
  if (Number(viaje[0].empleado_id) !== session.empleadoId) {
    return NextResponse.json(
      { error: "Solo el piloto responsable del viaje puede registrar combustible." },
      { status: 403 },
    );
  }

  const form = await req.formData();
  const tipoRaw = String(form.get("tipoCombustible") ?? "");
  const tipoCombustible = TIPOS.includes(tipoRaw as TipoCombustible) ? (tipoRaw as TipoCombustible) : null;
  if (!tipoCombustible) {
    return NextResponse.json({ error: "Selecciona el tipo de combustible." }, { status: 400 });
  }
  // FLOTA-COMBUSTIBLE-2 (sección 2) — obligatorio. No se asume un
  // formato numérico puro (el reporte real de la gasolinera no lo
  // garantiza): solo se exige que no venga vacío y un largo razonable,
  // sin restricción de caracteres.
  const numeroValeRaw = form.get("numeroVale");
  const numeroVale = typeof numeroValeRaw === "string" ? numeroValeRaw.trim() : "";
  if (!numeroVale) {
    return NextResponse.json({ error: "Indica el número de vale." }, { status: 400 });
  }
  if (numeroVale.length > 40) {
    return NextResponse.json({ error: "El número de vale es demasiado largo (máximo 40 caracteres)." }, { status: 400 });
  }
  // FLOTA-COMBUSTIBLE-2 (sección 3) — obligatoria; representa la fecha
  // FÍSICA de la carga (la que declara el piloto), nunca la fecha de
  // registro en el sistema (esa sigue siendo creado_at, independiente).
  const fechaConsumoRaw = form.get("fechaConsumo");
  const fechaConsumo = typeof fechaConsumoRaw === "string" ? fechaConsumoRaw.trim() : "";
  const fechaConsumoValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaConsumo) && !Number.isNaN(new Date(fechaConsumo).getTime());
  if (!fechaConsumoValida) {
    return NextResponse.json({ error: "Indica la fecha en que se cargó el combustible." }, { status: 400 });
  }
  const galones = Number(form.get("galones"));
  if (!Number.isFinite(galones) || galones <= 0) {
    return NextResponse.json({ error: "Indica los galones cargados." }, { status: 400 });
  }
  const monto = Number(form.get("monto"));
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: "Indica el valor pagado." }, { status: 400 });
  }
  // FLOTA-COMBUSTIBLE-2 (sección 4) — obligatorio. El servidor NO
  // recalcula ni rechaza por diferencia entre galones×precio y el monto
  // ingresado (la advertencia visual es responsabilidad del formulario,
  // ver combustible-form-ui.ts) — "no inventar reglas de rechazo
  // automático sin autorización".
  const precioGalon = Number(form.get("precioGalon"));
  if (!Number.isFinite(precioGalon) || precioGalon <= 0) {
    return NextResponse.json({ error: "Indica el precio por galón." }, { status: 400 });
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
      numeroVale,
      fechaConsumo,
      galones,
      monto,
      precioGalon,
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
    // FLOTA-COMBUSTIBLE-HARDENING-1 — todo el dominio de combustible se
    // audita bajo "flota" (mismo módulo que aprobar/rechazar en
    // .../flota/combustible/[id]/revisar/route.ts); antes quedaba "tms"
    // aquí por inconsistencia, no por intención.
    modulo: "flota",
    detalle: `Carga de combustible #${cargaId} en viaje #${viajeId} · vale ${numeroVale} · consumo ${fechaConsumo} · ${tipoCombustible} · ${galones} gal · Q${monto.toFixed(2)} · ${empleado.nombre}`,
  });

  return NextResponse.json({
    id: cargaId,
    mensaje: "Carga de combustible registrada. Operaciones la revisará.",
  });
}
