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
  obtenerPilotoDeEmpleado,
  vehiculoPorPlaca,
} from "@/lib/flota/pilotos";
import {
  buscarPlanesParaSalida,
  marcarPlanDescargado,
  marcarPlanEnRuta,
} from "@/lib/tms/planes-salida";
import { paradasPendientesEvidencia } from "@/lib/tms/paradas";
import { resolverVehiculoDeUnidadTms } from "@/lib/tms/unidad-flota";

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
  kmSalida: z.number().int().nonnegative(),
  destino: z.string().optional(),
  planId: z.number().int().positive().optional(),
});

const llegadaSchema = z.object({
  accion: z.literal("llegada"),
  viajeId: z.number().int().positive(),
  kmLlegada: z.number().int().nonnegative(),
  observaciones: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const piloto = await obtenerPilotoDeEmpleado(
    session.empresaId,
    session.empleadoId,
  );
  if (!piloto) {
    return NextResponse.json(
      { error: "Esta pantalla es solo para pilotos registrados en TMS." },
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
  const norm = normalizarNombrePiloto(nombre);

  if (body?.accion === "salida") {
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
        `SELECT p.id, p.unidad_id, p.codigo, ld.nombre AS destino
         FROM tms_planes_viaje p
         INNER JOIN tms_personal pil ON pil.id = p.piloto_id
         LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id
         WHERE p.id = ? AND p.empresa_id = ? AND pil.id_empleado = ?
           AND p.estado = 'Programado' LIMIT 1`,
        [d.planId, empresaId, session.empleadoId],
      );
      planAsignado = planes[0] ?? null;
      if (!planAsignado) {
        return NextResponse.json(
          { error: "El viaje programado no está asignado a tu usuario o ya fue iniciado." },
          { status: 403 },
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
    if (d.kmSalida < kmActual) {
      return NextResponse.json(
        {
          error: `Km de salida (${d.kmSalida.toLocaleString("es-GT")}) no puede ser menor al km actual de ${veh.placa} (${kmActual.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
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
    const planesMatch = await buscarPlanesParaSalida(empresaId, {
      pilotoNombre: nombre,
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
          nombre,
          norm,
          d.kmSalida,
          ahora,
          destinoFinal,
          session.empleadoId,
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
      detalle: `Viaje #${r.insertId} salida (portal piloto) · ${nombre} · placa ${String(veh.placa)} · km ${d.kmSalida}${
        planId ? ` · plan TMS #${planId} → En ruta` : ""
      }${destinoFinal ? ` · destino ${destinoFinal}` : ""}`,
    });

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por, viaje_id, capturado_en)
       VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
      [
        empresaId,
        Number(veh.id),
        d.kmSalida,
        d.destino ? `Salida viaje → ${d.destino}` : "Salida viaje",
        nombre,
        `portal:${empleado.codigo}`,
        Number(r.insertId),
        ahora,
      ],
    ).catch(() => undefined);

    await actualizarKmActualVehiculo(Number(veh.id), d.kmSalida);

    const planInfo = planId ? planesMatch.find((p) => p.id === planId) : null;
    const planMsg = planInfo
      ? ` Ruta asignada por Operaciones detectada: ${planInfo.codigo}${planInfo.cliente ? ` (${planInfo.cliente})` : ""}.`
      : planesMatch.length > 1
        ? " Hay varios planes posibles para hoy; Operaciones lo vinculará manualmente."
        : "";

    return NextResponse.json({
      id: r.insertId,
      placa: String(veh.placa),
      kmSalida: d.kmSalida,
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
      `SELECT v.*, ve.placa FROM flota_viajes v
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
    const kmSalida = Number(viaje[0].km_salida);
    const kmFinal = d.kmLlegada;

    if (kmFinal < kmSalida) {
      return NextResponse.json(
        { error: "Km final no puede ser menor que la salida." },
        { status: 400 },
      );
    }
    const vehKm = await query<RowDataPacket[]>(
      `SELECT km_actual FROM flota_vehiculos WHERE id = ? LIMIT 1`,
      [Number(viaje[0].vehiculo_id)],
    );
    const kmActualVeh = Number(vehKm[0]?.km_actual ?? kmSalida);
    if (kmFinal < kmActualVeh) {
      return NextResponse.json(
        {
          error: `Km final (${kmFinal.toLocaleString("es-GT")}) no puede ser menor al km actual de la unidad (${kmActualVeh.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
        },
        { status: 400 },
      );
    }

    if (planIdPre) {
      const pendientes = await paradasPendientesEvidencia(planIdPre);
      if (pendientes.length) {
        const nombres = pendientes.map((p) => `${p.orden}. ${p.lugar_nombre}`).join("; ");
        return NextResponse.json(
          {
            error: `Faltan evidencias de producto en ${pendientes.length} parada(s) de la ruta: ${nombres}. Súbelas desde Flota antes de cerrar, o pide apoyo a Operaciones.`,
            code: "PARADAS_SIN_EVIDENCIA",
          },
          { status: 422 },
        );
      }
    }

    const upd = await execute(
      `UPDATE flota_viajes SET
        km_llegada = ?, hora_llegada = ?, estado = 'cerrado',
        observaciones = COALESCE(?, observaciones)
       WHERE id = ? AND empresa_id = ? AND empleado_id = ? AND estado = 'abierto'`,
      [
        kmFinal,
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

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por, viaje_id, capturado_en)
       VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?, ?, ?, ?)`,
      [
        empresaId,
        Number(viaje[0].vehiculo_id),
        kmFinal,
        nombre,
        `portal:${empleado.codigo}`,
        d.viajeId,
        ahora,
      ],
    ).catch(() => undefined);

    await actualizarKmActualVehiculo(Number(viaje[0].vehiculo_id), kmFinal);

    if (planIdPre) {
      await marcarPlanDescargado(empresaId, planIdPre);
    }

    await registrarAuditoria({
      empresaId,
      usuario: `portal:${empleado.codigo}`,
      accion: "llegada_viaje",
      modulo: "tms",
      detalle: `Viaje #${d.viajeId} llegada (portal piloto) · ${nombre} · placa ${String(viaje[0].placa)} · km ${kmSalida} → ${kmFinal}${
        planIdPre ? ` · plan TMS #${planIdPre} → Descargado` : ""
      }`,
    });

    return NextResponse.json({
      viajeId: d.viajeId,
      placa: String(viaje[0].placa),
      kmSalida,
      kmLlegada: kmFinal,
      mensaje: `Llegada registrada: ${(kmFinal - kmSalida).toLocaleString("es-GT")} km recorridos.${
        planIdPre ? " Plan TMS → Descargado." : ""
      }`,
    });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
