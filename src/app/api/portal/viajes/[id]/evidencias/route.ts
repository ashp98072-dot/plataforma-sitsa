import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
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
/**
 * PORTAL-HARDENING-2 (Fase C/D): vocabulario simplificado
 * SALIDA/PARADA/LLEGADA/OTRO, mapeado sobre los mismos valores ya
 * existentes en flota_viaje_evidencias.tipo (VARCHAR libre, sin ENUM —
 * no requiere migración). Se retira "salida" (evidencia del punto de
 * carga, ligada al kmCarga eliminado en Fase B) y se agrega "otro" para
 * evidencia libre/de contratiempo.
 */
const TIPOS: TipoEvidenciaViaje[] = [
  "tablero_salida",
  "tablero_llegada",
  "producto",
  "otro",
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

  // PORTAL-HARDENING-2 (Fase E, endurecido en revisión de PR #107 —
  // HALLAZGO 1): causa raíz de "evidencia subida pero no visible en
  // Operaciones/TMS" — la sincronización a tms_evidencias
  // (guardarEvidenciaViaje) exige un plan_id. Si al iniciar el viaje el
  // emparejamiento automático no encontró una coincidencia única,
  // flota_viajes.plan_id queda NULL. Si tampoco se puede vincular aquí con
  // certeza, la herramienta administrativa REAL para resolverlo es
  // POST /api/empresas/[slug]/tms/planes/[id]/vincular-viaje (ver
  // src/lib/tms/vincular-viaje-plan.ts) — no un flujo prometido pero
  // inexistente.
  //
  // El primer intento de esta corrección reutilizaba buscarPlanesParaSalida
  // (match por NOMBRE de piloto normalizado + PLACA normalizada, sobre
  // "hoy") — heurística demasiado débil para vincular retroactivamente:
  // dos pilotos con nombre similar, o el viaje evaluado en una fecha
  // distinta a la del plan, podían producir "exactamente un candidato"
  // incorrecto.
  //
  // Criterio estricto actual (SOLO vincula si TODO coincide, con datos ya
  // existentes, sin heurística de texto):
  //   - misma empresa (guard.empresa.id de la sesión, nunca del cliente)
  //   - mismo PILOTO por identidad real (tms_personal.id_empleado =
  //     flota_viajes.empleado_id — el piloto dueño del viaje, no
  //     necesariamente quien sube la evidencia si es un auxiliar)
  //   - misma UNIDAD exacta (tms_unidades.flota_vehiculo_id =
  //     flota_viajes.vehiculo_id — IDs, no placa como texto)
  //   - misma FECHA (tms_planes_viaje.fecha_plan = fecha real de
  //     flota_viajes.hora_salida, no "hoy")
  //   - estado operativo compatible (Programado/Cargado/En ruta)
  //   - exactamente UN plan cumple todo lo anterior
  // Si no se cumple TODO lo anterior con un único resultado, NO se
  // vincula — la evidencia igual se guarda en flota_viaje_evidencias, y
  // la respuesta agrega un aviso para que Operaciones resuelva el vínculo
  // manualmente. No repara evidencia ya subida antes de este cambio.
  let avisoVinculoPendiente: string | null = null;
  if (!participacion.planId) {
    const viajeInfo = await query<RowDataPacket[]>(
      `SELECT v.empleado_id, v.vehiculo_id, v.hora_salida
       FROM flota_viajes v WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
      [viajeId, session.empresaId],
    );
    const vi = viajeInfo[0];
    if (vi && vi.empleado_id != null && vi.vehiculo_id != null && vi.hora_salida) {
      const fechaViaje = String(vi.hora_salida).slice(0, 10);
      const candidatos = await query<RowDataPacket[]>(
        `SELECT p.id FROM tms_planes_viaje p
         INNER JOIN tms_personal pil ON pil.id = p.piloto_id
         INNER JOIN tms_unidades u ON u.id = p.unidad_id
         WHERE p.empresa_id = ?
           AND pil.id_empleado = ?
           AND u.flota_vehiculo_id = ?
           AND p.fecha_plan = ?
           AND p.estado IN ('Programado', 'Cargado', 'En ruta')
         LIMIT 2`,
        [session.empresaId, Number(vi.empleado_id), Number(vi.vehiculo_id), fechaViaje],
      );
      if (candidatos.length === 1) {
        const upd = await execute(
          `UPDATE flota_viajes SET plan_id = ?
           WHERE id = ? AND empresa_id = ? AND plan_id IS NULL`,
          [candidatos[0].id, viajeId, session.empresaId],
        );
        if (upd.affectedRows) participacion.planId = Number(candidatos[0].id);
      } else {
        // CORRECCIÓN PR #107 (última revisión): ya no se promete un
        // vínculo automático futuro ni que "aparecerá en TMS" — ahora sí
        // existe una herramienta real para que Operaciones lo resuelva
        // (POST /api/empresas/[slug]/tms/planes/[id]/vincular-viaje), pero
        // el aviso al piloto no debe anticipar el resultado.
        avisoVinculoPendiente =
          "La evidencia se guardó. El viaje aún no está vinculado a su programación; Operaciones deberá revisarlo.";
      }
    }
  }

  const form = await req.formData();
  const tipoRaw = String(form.get("tipo") ?? "producto");
  const tipo = TIPOS.includes(tipoRaw as TipoEvidenciaViaje)
    ? (tipoRaw as TipoEvidenciaViaje)
    : null;
  if (!tipo) return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
  const paradaId = Number(form.get("paradaId") ?? 0) || null;
  const vehiculo = await query<RowDataPacket[]>(
    `SELECT COALESCE(ve.odometro_funcional, 1) AS odometro_funcional
     FROM flota_viajes v INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
    [viajeId, session.empresaId],
  );
  const odometroFuncional = Number(vehiculo[0]?.odometro_funcional ?? 1) === 1;
  if (!odometroFuncional && (tipo === "tablero_salida" || tipo === "tablero_llegada")) {
    return NextResponse.json({ error: "Esta unidad no requiere fotografías del medidor de kilometraje." }, { status: 409 });
  }
  // PORTAL-HARDENING-2 (Fase C): las evidencias son respaldo, no controlan
  // estado ni orden. Ya NO se exige orden secuencial (tablero de salida
  // primero, carga antes de paradas/llegada, etc.) — el piloto adjunta lo
  // que tiene, cuando lo tiene. Para "producto" (evidencia de parada), el
  // piloto ELIGE explícitamente la dirección/parada (paradaId) en vez de
  // que el sistema calcule "la siguiente" — solo se valida que la parada
  // pertenezca a este viaje/plan.
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
      syncTmsTipo:
        tipo === "producto" ? "Producto"
        : tipo === "otro" ? "Otro"
        : tipo === "tablero_salida" ? "Carga"
        : "Descarga",
    }));
  }
  await registrarAuditoria({
    empresaId: session.empresaId,
    usuario: `portal:${empleado.codigo}`,
    accion: "subir_evidencia_viaje",
    modulo: "tms",
    detalle: `${ids.length} evidencia(s) agregadas al viaje #${viajeId} por ${empleado.nombre}`,
  });
  return NextResponse.json({
    ids,
    mensaje: `${ids.length} evidencia(s) guardada(s).`,
    ...(avisoVinculoPendiente ? { aviso: avisoVinculoPendiente } : {}),
  });
}
