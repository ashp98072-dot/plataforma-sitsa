import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { ahoraLocal } from "@/lib/rrhh/dates";
import {
  colaboradorParticipaEnViaje,
} from "@/lib/flota/viajes-piloto";
import {
  guardarEvidenciaViaje,
  listarEvidenciasViaje,
  type TipoEvidenciaViaje,
} from "@/lib/flota/viaje-evidencias";
import { listarParadasDelPlan, validarParadaDelPlan } from "@/lib/tms/paradas";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ id: string }> };
const TIPOS: TipoEvidenciaViaje[] = [
  "tablero_salida",
  "salida",
  "tablero_llegada",
  "producto",
];

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
    const rows = await query<RowDataPacket[]>(
      `SELECT ruta_relativa, nombre_original, mime
       FROM flota_viaje_evidencias
       WHERE id = ? AND viaje_id = ? AND empresa_id = ? LIMIT 1`,
      [adjuntoId, viajeId, session.empresaId],
    );
    if (!rows[0]) return NextResponse.json({ error: "Evidencia no encontrada." }, { status: 404 });
    try {
      const nombre = String(rows[0].nombre_original);
      return new NextResponse(readFileSync(absPathFromRelative(String(rows[0].ruta_relativa))), {
        headers: {
          "Content-Type": String(rows[0].mime || contentTypeFor(nombre)),
          "Content-Disposition": `inline; filename="${nombre.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
    }
  }
  const evidencias = await listarEvidenciasViaje(session.empresaId, viajeId);
  return NextResponse.json({
    evidencias: evidencias.map((r) => ({
      id: Number(r.id),
      tipo: String(r.tipo),
      nombre: String(r.nombre_original),
      capturadoEn: r.capturado_en,
      subidoPor: r.subido_por ? String(r.subido_por) : null,
      url: `/api/portal/viajes/${viajeId}/evidencias?adjuntoId=${r.id}`,
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
    return NextResponse.json({ error: "Solo se agregan evidencias mientras el viaje está en curso." }, { status: 409 });
  }
  const empleado = await obtenerEmpleado(session.empresaId, session.empleadoId);
  if (!empleado) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });

  const form = await req.formData();
  const tipoRaw = String(form.get("tipo") ?? "producto");
  const tipo = TIPOS.includes(tipoRaw as TipoEvidenciaViaje)
    ? (tipoRaw as TipoEvidenciaViaje)
    : null;
  if (!tipo) return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
  const paradaId = Number(form.get("paradaId") ?? 0) || null;
  const progreso = await query<RowDataPacket[]>(
    `SELECT
       SUM(tipo = 'tablero_salida') AS tablero_salida,
       SUM(tipo = 'salida') AS carga,
       SUM(tipo = 'tablero_llegada') AS tablero_llegada
     FROM flota_viaje_evidencias WHERE empresa_id = ? AND viaje_id = ?`,
    [session.empresaId, viajeId],
  );
  const tieneTableroSalida = Number(progreso[0]?.tablero_salida ?? 0) > 0;
  const tieneCarga = Number(progreso[0]?.carga ?? 0) > 0;
  const tieneTableroLlegada = Number(progreso[0]?.tablero_llegada ?? 0) > 0;
  if (tipo === "tablero_salida" && tieneTableroSalida) {
    return NextResponse.json({ error: "La evidencia del tablero de salida ya fue registrada." }, { status: 409 });
  }
  if (tipo !== "tablero_salida" && !tieneTableroSalida) {
    return NextResponse.json({ error: "Primero adjunta el tablero de salida." }, { status: 409 });
  }
  if (tipo === "salida") {
    if (tieneCarga) {
      return NextResponse.json({ error: "La evidencia de carga ya fue registrada." }, { status: 409 });
    }
    const kmCarga = await query<RowDataPacket[]>(
      `SELECT id FROM flota_lecturas
       WHERE viaje_id = ? AND nota = 'Kilometraje en punto de carga' LIMIT 1`,
      [viajeId],
    );
    if (!kmCarga[0]) return NextResponse.json({ error: "Primero registra el kilometraje en el punto de carga." }, { status: 409 });
  }
  if (tipo === "tablero_llegada" && tieneTableroLlegada) {
    return NextResponse.json({ error: "El tablero de llegada ya fue registrado." }, { status: 409 });
  }
  if (tipo === "tablero_llegada" && !tieneCarga) {
    return NextResponse.json({ error: "Primero registra el kilometraje y la evidencia de carga." }, { status: 409 });
  }
  if (tipo === "producto") {
    if (!tieneCarga) return NextResponse.json({ error: "Primero adjunta la evidencia de carga." }, { status: 409 });
    if (!participacion.planId || !paradaId) {
      return NextResponse.json({ error: "Selecciona la parada de esta evidencia." }, { status: 400 });
    }
    const parada = await validarParadaDelPlan(
      session.empresaId,
      participacion.planId,
      paradaId,
    );
    if (!parada) return NextResponse.json({ error: "La parada no pertenece al viaje." }, { status: 400 });
    const paradas = await listarParadasDelPlan(participacion.planId);
    const siguiente = paradas.find((p) => p.requiere_evidencia && p.evidencias < 1);
    if (!siguiente || siguiente.id !== paradaId) {
      return NextResponse.json(
        { error: siguiente ? `La siguiente parada es ${siguiente.orden}. ${siguiente.lugar_nombre}.` : "Todas las paradas ya están completas." },
        { status: 409 },
      );
    }
  }
  if (tipo === "tablero_llegada" && participacion.planId) {
    const pendientes = (await listarParadasDelPlan(participacion.planId))
      .filter((p) => p.requiere_evidencia && p.evidencias < 1);
    if (pendientes.length) {
      return NextResponse.json({ error: "Completa todas las paradas antes de registrar el regreso al predio." }, { status: 409 });
    }
  }

  const latitudRaw = form.get("latitud");
  const longitudRaw = form.get("longitud");
  const latitud = typeof latitudRaw === "string" ? Number(latitudRaw) : NaN;
  const longitud = typeof longitudRaw === "string" ? Number(longitudRaw) : NaN;
  if (!Number.isFinite(latitud) || latitud < -90 || latitud > 90 ||
      !Number.isFinite(longitud) || longitud < -180 || longitud > 180) {
    return NextResponse.json(
      { error: "Activa y autoriza la ubicación GPS para guardar la evidencia." },
      { status: 400 },
    );
  }
  const archivos: Array<Blob & { name?: string }> = [];
  for (const [key, value] of form.entries()) {
    if ((key === "file" || key === "files") && value instanceof Blob && value.size > 0) {
      archivos.push(value as Blob & { name?: string });
    }
  }
  if (!archivos.length) return NextResponse.json({ error: "Selecciona al menos una foto." }, { status: 400 });

  const ids: number[] = [];
  for (const archivo of archivos) {
    ids.push(await guardarEvidenciaViaje({
      empresaId: session.empresaId,
      viajeId,
      tipo,
      file: {
        name: archivo.name || `evidencia_${Date.now()}.jpg`,
        size: archivo.size,
        type: archivo.type,
        arrayBuffer: () => archivo.arrayBuffer(),
      },
      latitud,
      longitud,
      capturadoEn: ahoraLocal(),
      username: `portal:${empleado.codigo}`,
      planId: participacion.planId,
      paradaId,
      syncTmsTipo: tipo === "producto" ? "Producto" : tipo.includes("salida") ? "Carga" : "Descarga",
    }));
  }
  await registrarAuditoria({
    empresaId: session.empresaId,
    usuario: `portal:${empleado.codigo}`,
    accion: "subir_evidencia_viaje",
    modulo: "tms",
    detalle: `${ids.length} evidencia(s) agregadas al viaje #${viajeId} por ${empleado.nombre}`,
  });
  return NextResponse.json({ ids, mensaje: `${ids.length} evidencia(s) guardada(s).` });
}
