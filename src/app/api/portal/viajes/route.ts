import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { actualizarKmActualVehiculo } from "@/lib/flota/km-vehiculo";
import {
  normalizarNombrePiloto,
  obtenerPersonalOperativoDeEmpleado,
  vehiculoPorPlaca,
} from "@/lib/flota/pilotos";
import {
  buscarPlanesParaSalida,
  marcarPlanEnRuta,
} from "@/lib/tms/planes-salida";
import { paradasPendientesEvidencia } from "@/lib/tms/paradas";
import { resolverVehiculoDeUnidadTms } from "@/lib/tms/unidad-flota";
import { validarGeocercaKiosko } from "@/lib/rrhh/geocerca";

/**
 * Marcaje de viaje (salida/llegada de camión con km) desde el portal del
 * propio piloto. Reutiliza flota_viajes (misma tabla que usa Operaciones
 * en /e/[slug]/flota) y la detección automática de plan TMS ya existente
 * en buscarPlanesParaSalida — no se reconstruye esa lógica.
 *
 * Diferencia clave frente a la ruta de staff
 * (/api/empresas/[slug]/flota/viajes): aquí el piloto SIEMPRE es el dueño
 * de la sesión (empleadoId del JWT), nunca texto libre — no hay flujo de
 * "conductor externo".
 */

const salidaSchema = z.object({
  accion: z.literal("salida"),
  placa: z.string().min(2),
  kmSalida: z.number().int().nonnegative().optional(),
  destino: z.string().optional(),
  planId: z.number().int().positive().optional(),
});

const llegadaSchema = z.object({
  accion: z.literal("llegada"),
  viajeId: z.number().int().positive(),
  kmLlegada: z.number().int().nonnegative().optional(),
  observaciones: z.string().optional(),
  latitud: z.number().min(-90).max(90).optional(),
  longitud: z.number().min(-180).max(180).optional(),
});

/**
 * PORTAL-HARDENING-2 (Fase F): reemplaza a "cierreExcepcional". El piloto
 * NUNCA cierra ni cancela administrativamente el plan — esto solo registra
 * una observación/incidencia en la auditoría del viaje. No toca
 * flota_viajes.estado ni tms_planes_viaje.estado.
 */
const contratiempoSchema = z.object({
  accion: z.literal("contratiempo"),
  viajeId: z.number().int().positive(),
  motivo: z.string().trim().min(10).max(500),
});

export async function POST(req: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const personal = await obtenerPersonalOperativoDeEmpleado(
    session.empresaId,
    session.empleadoId,
  );
  if (!personal) {
    return NextResponse.json(
      { error: "Esta pantalla es para pilotos y auxiliares activos registrados en TMS." },
      { status: 403 },
    );
  }

  const empleado = await obtenerEmpleado(session.empresaId, session.empleadoId);
  if (!empleado) {
    return NextResponse.json(
      { error: "No se encontró tu ficha de empleado." },
      { status: 404 },
    );
  }

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const body = await req.json();
  const ahora = ahoraLocal();
  const empresaId = session.empresaId;
  const nombre = empleado.nombre;

  if (body?.accion === "salida") {
    if (personal.tipo !== "Piloto") {
      return NextResponse.json(
        { error: "Solo el piloto asignado puede iniciar el viaje." },
        { status: 403 },
      );
    }
    const parsed = salidaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Completa la placa y el kilometraje de salida." },
        { status: 400 },
      );
    }
    const d = parsed.data;

    let planAsignado: RowDataPacket | null = null;
    if (d.planId) {
      const planes = await query<RowDataPacket[]>(
        `SELECT DISTINCT p.id, p.unidad_id, p.codigo, ld.nombre AS destino,
                pil.nombre AS piloto_nombre, pil.id_empleado AS piloto_empleado_id
         FROM tms_planes_viaje p
         INNER JOIN tms_personal pil ON pil.id = p.piloto_id
         LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id
         WHERE p.id = ? AND p.empresa_id = ? AND pil.id_empleado = ?
           -- PORTAL-HARDENING-2 (Fase G): "Cargado" es un candidato válido de
           -- salida igual que "Programado" (ya lo acepta buscarPlanesParaSalida
           -- y marcarPlanEnRuta; aquí faltaba para el caso de plan explícito).
           AND p.estado IN ('Programado', 'Cargado') LIMIT 1`,
        [d.planId, empresaId, session.empleadoId],
      );
      planAsignado = planes[0] ?? null;
      if (!planAsignado) {
        return NextResponse.json(
          { error: "El viaje programado no está asignado a tu usuario o ya fue iniciado." },
          { status: 403 },
        );
      }
      if (!planAsignado.piloto_empleado_id) {
        return NextResponse.json(
          { error: "Operaciones debe vincular al piloto con un colaborador antes de iniciar el viaje." },
          { status: 409 },
        );
      }
    }
    const resuelto = planAsignado?.unidad_id
      ? await resolverVehiculoDeUnidadTms(empresaId, Number(planAsignado.unidad_id))
      : null;
    if (planAsignado && !resuelto) {
      return NextResponse.json(
        { error: "Operaciones debe asignar una unidad válida antes de iniciar este viaje." },
        { status: 409 },
      );
    }
    const veh = resuelto?.vehiculo ?? await vehiculoPorPlaca(empresaId, d.placa);
    if (!veh) {
      return NextResponse.json(
        {
          error:
            "Placa no encontrada. Escríbela completa (ej. C-034BXR). Si es parcial, debe coincidir con una sola unidad.",
        },
        { status: 404 },
      );
    }
    const odometroFuncional = Number(veh.odometro_funcional ?? 1) === 1;
    if (odometroFuncional && d.kmSalida == null) {
      return NextResponse.json({ error: "Completa el kilometraje de salida." }, { status: 400 });
    }
    if (Number(veh.activo) === 0) {
      return NextResponse.json({ error: "Vehículo inactivo." }, { status: 400 });
    }
    if (Number(veh.en_taller) === 1) {
      return NextResponse.json(
        {
          error: `${veh.placa} está en taller. No se puede enviar a ruta hasta que salga de servicio.`,
        },
        { status: 400 },
      );
    }
    const estadoTxt = String((veh as { estado?: string }).estado ?? "").toLowerCase();
    if (estadoTxt.includes("taller")) {
      return NextResponse.json(
        {
          error: `${veh.placa} está marcado en taller. No se puede registrar salida a ruta.`,
        },
        { status: 400 },
      );
    }

    const kmActual = Number(veh.km_actual ?? 0);
    if (odometroFuncional && Number(d.kmSalida) < kmActual) {
      return NextResponse.json(
        {
          error: `Km de salida (${Number(d.kmSalida).toLocaleString("es-GT")}) no puede ser menor al km actual de ${veh.placa} (${kmActual.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
        },
        { status: 400 },
      );
    }

    const abiertoVeh = await query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes
       WHERE empresa_id = ? AND vehiculo_id = ? AND estado = 'abierto' LIMIT 1`,
      [empresaId, veh.id],
    );
    if (abiertoVeh[0]) {
      return NextResponse.json(
        { error: `La unidad ${veh.placa} ya tiene un viaje abierto.` },
        { status: 409 },
      );
    }

    const abiertoPropio = await query<RowDataPacket[]>(
      `SELECT v.id, ve.placa FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ? AND v.empleado_id = ? AND v.estado = 'abierto' LIMIT 1`,
      [empresaId, session.empleadoId],
    );
    if (abiertoPropio[0]) {
      return NextResponse.json(
        {
          error: `Ya tienes un viaje abierto en ${abiertoPropio[0].placa}. Cierra la llegada primero.`,
        },
        { status: 409 },
      );
    }

    // Detección automática de ruta asignada por Operaciones (Fase 4): si hay
    // un único plan "Programado"/"En ruta" para hoy que coincida con el
    // piloto o la placa, se vincula solo — el piloto no tiene que buscarlo.
    const pilotoNombre = planAsignado?.piloto_nombre ? String(planAsignado.piloto_nombre) : nombre;
    const pilotoEmpleadoId = planAsignado?.piloto_empleado_id
      ? Number(planAsignado.piloto_empleado_id)
      : session.empleadoId;
    const planesMatch = await buscarPlanesParaSalida(empresaId, {
      pilotoNombre,
      placa: String(veh.placa),
    });
    const planId = planAsignado
      ? Number(planAsignado.id)
      : planesMatch.length === 1 ? planesMatch[0].id : null;
    const destinoFinal =
      d.destino?.trim() ||
      (planAsignado?.destino ? String(planAsignado.destino) : "") ||
      planesMatch.find((p) => p.id === planId)?.cliente ||
      null;

    const lockKey = `flota_salida_${empresaId}_${Number(veh.id)}`;
    const lockConn = await getPool().getConnection();
    let r: Awaited<ReturnType<typeof execute>> | undefined;
    try {
      try {
        await lockConn.query("SELECT GET_LOCK(?, 8) AS l", [lockKey]);
      } catch {
        /* ok */
      }
      const [recheckRows] = await lockConn.query<RowDataPacket[]>(
        `SELECT id FROM flota_viajes
         WHERE empresa_id = ? AND vehiculo_id = ? AND estado = 'abierto' LIMIT 1`,
        [empresaId, veh.id],
      );
      if (recheckRows[0]) {
        return NextResponse.json(
          { error: `La unidad ${veh.placa} ya tiene un viaje abierto.` },
          { status: 409 },
        );
      }

      r = await execute(
        `INSERT INTO flota_viajes
          (empresa_id, vehiculo_id, piloto_nombre, piloto_nombre_norm,
           km_salida, hora_salida, destino, estado, es_externo, empleado_id, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'abierto', 0, ?, ?)`,
        [
          empresaId,
          Number(veh.id),
          pilotoNombre,
          normalizarNombrePiloto(pilotoNombre),
          odometroFuncional ? Number(d.kmSalida) : null,
          ahora,
          destinoFinal,
          pilotoEmpleadoId,
          planId,
        ],
      );
    } finally {
      try {
        await lockConn.query("SELECT RELEASE_LOCK(?) AS l", [lockKey]);
      } catch {
        /* ok */
      }
      lockConn.release();
    }
    if (!r) {
      return NextResponse.json(
        { error: "No se pudo registrar la salida." },
        { status: 500 },
      );
    }

    if (planId) {
      await marcarPlanEnRuta(empresaId, planId);
    }

    await registrarAuditoria({
      empresaId,
      usuario: `portal:${empleado.codigo}`,
      accion: "salida_viaje",
      modulo: "tms",
      detalle: `Viaje #${r.insertId} iniciado por ${personal.tipo.toLowerCase()} ${nombre} · piloto ${pilotoNombre} · placa ${String(veh.placa)}${odometroFuncional ? ` · km ${d.kmSalida}` : " · unidad sin odómetro funcional"}${
        planId ? ` · plan TMS #${planId} → En ruta` : ""
      }${destinoFinal ? ` · destino ${destinoFinal}` : ""}`,
    });

    if (odometroFuncional) await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por, viaje_id, capturado_en)
       VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
      [
        empresaId,
        Number(veh.id),
        Number(d.kmSalida),
        d.destino ? `Salida viaje → ${d.destino}` : "Salida viaje",
        pilotoNombre,
        `portal:${empleado.codigo}`,
        Number(r.insertId),
        ahora,
      ],
    ).catch(() => undefined);

    if (odometroFuncional) await actualizarKmActualVehiculo(Number(veh.id), Number(d.kmSalida));

    const planInfo = planId ? planesMatch.find((p) => p.id === planId) : null;
    const planMsg = planInfo
      ? ` Ruta asignada por Operaciones detectada: ${planInfo.codigo}${planInfo.cliente ? ` (${planInfo.cliente})` : ""}.`
      : planesMatch.length > 1
        ? " Hay varios planes posibles para hoy; Operaciones lo vinculará manualmente."
        : "";

    return NextResponse.json({
      id: r.insertId,
      placa: String(veh.placa),
      kmSalida: odometroFuncional ? d.kmSalida : null,
      planId,
      mensaje: `Salida de ${veh.placa} registrada.${planMsg}`,
    });
  }

  if (body?.accion === "llegada") {
    const parsed = llegadaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos de llegada inválidos." },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Solo puede cerrar SU PROPIO viaje abierto — nunca el de otro piloto.
    const viaje = await query<RowDataPacket[]>(
      `SELECT v.*, ve.placa, ve.odometro_funcional FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.id = ? AND v.empresa_id = ? AND v.empleado_id = ? LIMIT 1`,
      [d.viajeId, empresaId, session.empleadoId],
    );
    if (!viaje[0] || String(viaje[0].estado) !== "abierto") {
      return NextResponse.json(
        { error: "No tienes ese viaje abierto." },
        { status: 404 },
      );
    }

    const planIdPre = viaje[0].plan_id != null ? Number(viaje[0].plan_id) : null;
    const odometroFuncional = Number(viaje[0].odometro_funcional ?? 1) === 1;
    const kmSalida = viaje[0].km_salida == null ? null : Number(viaje[0].km_salida);
    const kmFinal = odometroFuncional ? d.kmLlegada : null;
    if (odometroFuncional && (kmFinal == null || kmSalida == null)) {
      return NextResponse.json({ error: "Completa el kilometraje de llegada." }, { status: 400 });
    }

    if (odometroFuncional && Number(kmFinal) < Number(kmSalida)) {
      return NextResponse.json(
        { error: "Km final no puede ser menor que la salida." },
        { status: 400 },
      );
    }
    const vehKm = await query<RowDataPacket[]>(
      `SELECT km_actual FROM flota_vehiculos WHERE id = ? LIMIT 1`,
      [Number(viaje[0].vehiculo_id)],
    );
    const kmActualVeh = Number(vehKm[0]?.km_actual ?? kmSalida ?? 0);
    if (odometroFuncional && Number(kmFinal) < kmActualVeh) {
      return NextResponse.json(
        {
          error: `Km final (${Number(kmFinal).toLocaleString("es-GT")}) no puede ser menor al km actual de la unidad (${kmActualVeh.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
        },
        { status: 400 },
      );
    }

    // PORTAL-HARDENING-2 (Fase C/F): las evidencias son respaldo — ya NO
    // bloquean la llegada física. Se arma un aviso informativo (no
    // bloqueante) con lo que falte, en vez de un 422.
    const advertencias: string[] = [];
    if (planIdPre) {
      const pendientes = await paradasPendientesEvidencia(planIdPre);
      if (pendientes.length) {
        const nombres = pendientes.map((p) => `${p.orden}. ${p.lugar_nombre}`).join("; ");
        advertencias.push(`Hay ${pendientes.length} parada(s) sin evidencia: ${nombres}.`);
      }
    }
    const geo = await validarGeocercaKiosko(
      empresaId,
      session.empleadoId,
      { lat: d.latitud, lng: d.longitud },
      { requerirUbicacionRegistrada: true },
    );
    if (!geo.ok) return NextResponse.json({ error: `Debes regresar al predio para finalizar. ${geo.error}` }, { status: 409 });

    const upd = await execute(
      `UPDATE flota_viajes SET
        km_llegada = ?, hora_llegada = ?, estado = 'cerrado',
        observaciones = COALESCE(?, observaciones)
       WHERE id = ? AND empresa_id = ? AND empleado_id = ? AND estado = 'abierto'`,
      [
        kmFinal == null ? null : Number(kmFinal),
        ahora,
        d.observaciones?.trim() || null,
        d.viajeId,
        empresaId,
        session.empleadoId,
      ],
    );
    if (!upd.affectedRows) {
      return NextResponse.json(
        { error: "Este viaje ya fue cerrado. Actualiza la pantalla e inténtalo de nuevo." },
        { status: 409 },
      );
    }

    if (odometroFuncional) await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por, viaje_id, capturado_en)
       VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?, ?, ?, ?)`,
      [
        empresaId,
        Number(viaje[0].vehiculo_id),
        Number(kmFinal),
        nombre,
        `portal:${empleado.codigo}`,
        d.viajeId,
        ahora,
      ],
    ).catch(() => undefined);

    if (odometroFuncional) await actualizarKmActualVehiculo(Number(viaje[0].vehiculo_id), Number(kmFinal));

    // OPS-1 (corregido) + PORTAL-HARDENING-2 (Fase F): registrar llegada es
    // solo respaldo operativo — el piloto NUNCA finaliza, cierra ni cancela
    // el plan administrativamente. YA NO existe ninguna vía desde este
    // endpoint que mueva tms_planes_viaje.estado (el antiguo "cierre
    // excepcional" que lo pasaba a Cancelado fue eliminado — ver
    // "contratiempo" más abajo, que solo audita). El plan permanece en su
    // estado actual ("En ruta") hasta que un usuario con
    // viajes_cerrar:editar lo cierre explícitamente desde Programación (ver
    // src/lib/tms/cierre-viaje.ts) — "Pendiente de cierre" sigue siendo
    // puramente derivado (esta llegada técnica en flota_viajes + estado
    // administrativo sin cambiar).

    await registrarAuditoria({
      empresaId,
      usuario: `portal:${empleado.codigo}`,
      accion: "llegada_viaje",
      modulo: "tms",
      detalle: `Viaje #${d.viajeId} llegada al predio · ${nombre} · placa ${String(viaje[0].placa)}${odometroFuncional ? ` · km ${kmSalida} → ${kmFinal}` : " · unidad sin odómetro funcional"}${
        planIdPre ? ` · plan TMS #${planIdPre} (llegada registrada; sin cambio de estado, pendiente de cierre por Operaciones)` : ""
      }${advertencias.length ? ` · avisos: ${advertencias.join(" ")}` : ""}`,
    });

    return NextResponse.json({
      viajeId: d.viajeId,
      placa: String(viaje[0].placa),
      kmSalida,
      kmLlegada: kmFinal,
      advertencias,
      mensaje: odometroFuncional
        ? `Llegada registrada: ${(Number(kmFinal) - Number(kmSalida)).toLocaleString("es-GT")} km recorridos.`
        : `Llegada registrada sin kilometraje.`,
    });
  }

  if (body?.accion === "contratiempo") {
    const parsed = contratiempoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Describe el contratiempo con al menos 10 caracteres." },
        { status: 400 },
      );
    }
    const d = parsed.data;
    // Solo el propio piloto/auxiliar del viaje puede reportar, y solo
    // mientras el viaje sigue abierto — nunca administra el de otro.
    const viaje = await query<RowDataPacket[]>(
      `SELECT v.id, v.estado, ve.placa FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.id = ? AND v.empresa_id = ? AND v.empleado_id = ? LIMIT 1`,
      [d.viajeId, empresaId, session.empleadoId],
    );
    if (!viaje[0]) {
      return NextResponse.json({ error: "No tienes ese viaje." }, { status: 404 });
    }
    // PORTAL-HARDENING-2 (Fase F): esto es SOLO una observación/incidencia
    // de auditoría — a propósito no cambia flota_viajes.estado ni
    // tms_planes_viaje.estado. El piloto reporta, Operaciones decide.
    await registrarAuditoria({
      empresaId,
      usuario: `portal:${empleado.codigo}`,
      accion: "reportar_contratiempo",
      modulo: "tms",
      detalle: `Viaje #${d.viajeId} contratiempo reportado por ${nombre} · placa ${String(viaje[0].placa)}: ${d.motivo}`,
    });
    return NextResponse.json({
      mensaje: "Contratiempo registrado. Operaciones lo revisará; tu viaje sigue abierto.",
    });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
