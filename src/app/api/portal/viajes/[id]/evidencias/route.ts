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
import { buscarPlanCandidatoUnicoParaViaje, vincularViajeAPlan } from "@/lib/tms/vincular-viaje-plan";
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

  // PORTAL-HARDENING-2 (Fase E) + ÚLTIMA CORRECCIÓN P1 (unificación de
  // autoridad de vínculo): causa raíz de "evidencia subida pero no visible
  // en Operaciones/TMS" — la sincronización a tms_evidencias
  // (guardarEvidenciaViaje) exige un plan_id. Si al iniciar el viaje el
  // emparejamiento automático no encontró una coincidencia única,
  // flota_viajes.plan_id queda NULL. Este auto-vínculo YA NO escribe
  // flota_viajes.plan_id por su cuenta con una UPDATE propia — usa la
  // MISMA autoridad transaccional que el vínculo administrativo manual
  // (src/lib/tms/vincular-viaje-plan.ts): un candidato único y verificable
  // (mismo piloto por ID, misma unidad por ID, misma fecha, estado
  // compatible) se busca aquí de forma best-effort
  // (buscarPlanCandidatoUnicoParaViaje), pero la decisión FINAL —
  // incluida la exclusividad "un plan = un solo viaje técnico" y el
  // backfill de evidencia previa — la hace vincularViajeAPlan bajo FOR
  // UPDATE, exactamente igual que si Operaciones lo vinculara a mano
  // (origen: "AUTO_PORTAL", solo para que auditoría/mensajes sean
  // correctos). Si el vínculo NO se concreta por cualquier motivo
  // esperado (0/2+ candidatos, el plan ya está en uso por otro viaje,
  // carrera con otra solicitud), la evidencia se guarda de todas formas y
  // se agrega un aviso — nunca bloquea la subida. Un error técnico
  // inesperado del intento de vínculo tampoco bloquea la subida, pero SÍ
  // queda en el log del servidor (no se esconde).
  let avisoVinculoPendiente: string | null = null;
  if (!participacion.planId) {
    try {
      const candidatoPlanId = await buscarPlanCandidatoUnicoParaViaje(session.empresaId, viajeId);
      const resultado = candidatoPlanId
        ? await vincularViajeAPlan(
            session.empresaId,
            candidatoPlanId,
            viajeId,
            `portal:${empleado.codigo}`,
            "AUTO_PORTAL",
          )
        : null;
      if (resultado?.ok) {
        participacion.planId = candidatoPlanId;
      } else {
        // CORRECCIÓN PR #107: ya no se promete un vínculo automático
        // futuro ni que "aparecerá en TMS" — ahora sí existe una
        // herramienta real para que Operaciones lo resuelva (POST
        // /api/empresas/[slug]/tms/planes/[id]/vincular-viaje), pero el
        // aviso al piloto no debe anticipar el resultado. Se muestra
        // tanto si nunca hubo candidato como si el intento de vínculo
        // falló por una condición esperada (409: exclusividad, carrera).
        avisoVinculoPendiente =
          "La evidencia se guardó. El viaje aún no está vinculado a su programación; Operaciones deberá revisarlo.";
      }
    } catch (err) {
      // Error técnico inesperado (p.ej. falla del backfill dentro de
      // vincularViajeAPlan) — no debe bloquear la subida de evidencia
      // (que es respaldo, nunca condicionada al vínculo), pero tampoco se
      // esconde: queda en el log del servidor.
      console.error("Auto-vínculo de plan (evidencias portal)", err);
      avisoVinculoPendiente =
        "La evidencia se guardó. El viaje aún no está vinculado a su programación; Operaciones deberá revisarlo.";
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
