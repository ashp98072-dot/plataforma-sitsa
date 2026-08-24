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
import { validarParadaDelPlan } from "@/lib/tms/paradas";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ id: string }> };
const TIPOS: TipoEvidenciaViaje[] = [
  "tablero_salida",
  "salida",
  "tablero_llegada",
  "llegada",
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
  if (tipo === "producto") {
    if (!participacion.planId || !paradaId) {
      return NextResponse.json({ error: "Selecciona la parada de esta evidencia." }, { status: 400 });
    }
    const parada = await validarParadaDelPlan(
      session.empresaId,
      participacion.planId,
      paradaId,
    );
    if (!parada) return NextResponse.json({ error: "La parada no pertenece al viaje." }, { status: 400 });
  }

  const latitud = Number(form.get("latitud"));
  const longitud = Number(form.get("longitud"));
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
      latitud: Number.isFinite(latitud) ? latitud : null,
      longitud: Number.isFinite(longitud) ? longitud : null,
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
