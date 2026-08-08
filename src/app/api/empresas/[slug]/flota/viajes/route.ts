import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { actualizarKmActualVehiculo } from "@/lib/flota/km-vehiculo";
import { ahoraLocal } from "@/lib/rrhh/dates";
import {
  buscarEmpleadoPorNombre,
  normalizarNombrePiloto,
  vehiculoPorPlaca,
} from "@/lib/flota/pilotos";
import {
  buscarPlanesParaSalida,
  marcarPlanDescargado,
  marcarPlanEnRuta,
} from "@/lib/tms/planes-salida";
import {
  listarParadasDelPlan,
  paradasPendientesEvidencia,
} from "@/lib/tms/paradas";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const soloAbiertos = url.searchParams.get("solo") === "abiertos";
  const limitRaw = Number(url.searchParams.get("limit") ?? (soloAbiertos ? 40 : 80));
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 80, 1), 200);

  if (soloAbiertos) {
    const abiertos = await query<RowDataPacket[]>(
      `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
              v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
              v.es_externo, v.empleado_id, v.plan_id, ve.placa
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ? AND v.estado = 'abierto'
       ORDER BY v.hora_salida DESC
       LIMIT ${limit}`,
      [guard.empresa.id],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
                v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
                ve.placa
         FROM flota_viajes v
         INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
         WHERE v.empresa_id = ? AND v.estado = 'abierto'
         ORDER BY v.hora_salida DESC
         LIMIT ${limit}`,
        [guard.empresa.id],
      ),
    );
    return NextResponse.json({ viajes: abiertos, abiertos });
  }

  const viajes = await query<RowDataPacket[]>(
    `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
            v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
            v.es_externo, v.empleado_id, v.plan_id, ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.empresa_id = ?
     ORDER BY v.hora_salida DESC
     LIMIT ${limit}`,
    [guard.empresa.id],
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
              v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
              ve.placa
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ?
       ORDER BY v.hora_salida DESC
       LIMIT ${limit}`,
      [guard.empresa.id],
    ),
  );

  const abiertos = viajes.filter((x) => String(x.estado) === "abierto");
  return NextResponse.json({ viajes, abiertos });
}

const salidaSchema = z.object({
  accion: z.literal("salida"),
  placa: z.string().min(2).optional(),
  vehiculoId: z.number().int().positive().optional(),
  pilotoNombre: z.string().min(2),
  kmSalida: z.number().int().nonnegative(),
  destino: z.string().optional(),
  esExterno: z.boolean().optional(),
  motivoExterno: z.string().optional(),
  permisoExternoId: z.number().int().positive().optional(),
  planId: z.number().int().positive().optional(),
});

const llegadaSchema = z.object({
  accion: z.literal("llegada"),
  viajeId: z.number().int().positive(),
  /** Obligatorio al cerrar (también en rutas multi-parada: km final). */
  kmLlegada: z.number().int().nonnegative(),
  pilotoNombre: z.string().optional(),
  observaciones: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const body = await req.json();
  const ahora = ahoraLocal();

  if (body?.accion === "salida") {
    const parsed = salidaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Completa nombre del piloto, placa y km de salida." },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const nombre = d.pilotoNombre.trim();
    const norm = normalizarNombrePiloto(nombre);

    let veh: RowDataPacket | null = null;
    if (d.placa?.trim()) {
      veh = await vehiculoPorPlaca(guard.empresa.id, d.placa);
    } else if (d.vehiculoId) {
      // Incluye unidades compartidas (dueño en otra empresa del grupo).
      const vid = Number(d.vehiculoId);
      const rows = await query<RowDataPacket[]>(
        `SELECT v.id, v.placa, v.en_taller, v.km_actual, v.activo, v.estado
         FROM flota_vehiculos v
         WHERE v.id = ?
           AND (
             v.empresa_id = ?
             OR EXISTS (
               SELECT 1 FROM flota_vehiculo_acceso a
               WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
             )
           )
         LIMIT 1`,
        [vid, guard.empresa.id, guard.empresa.id],
      ).catch(async () =>
        query<RowDataPacket[]>(
          `SELECT id, placa, en_taller, km_actual, activo, estado FROM flota_vehiculos
           WHERE id = ? AND empresa_id = ? LIMIT 1`,
          [vid, guard.empresa.id],
        ),
      );
      veh = rows[0] ?? null;
    }
    if (!veh) {
      return NextResponse.json(
        {
          error:
            "Placa / unidad no encontrada. Escríbela completa (ej. C-034BXR). Si es parcial, debe coincidir con una sola unidad.",
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
    // También bloquear si el estado textual indica taller
    const estadoTxt = String(
      (veh as { estado?: string }).estado ?? "",
    ).toLowerCase();
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
      [guard.empresa.id, veh.id],
    );
    if (abiertoVeh[0]) {
      return NextResponse.json(
        { error: `La unidad ${veh.placa} ya tiene un viaje abierto.` },
        { status: 409 },
      );
    }

    // Mismo piloto sin importar mayúsculas/acentos (Walter = walter)
    const abiertosEmp = await query<RowDataPacket[]>(
      `SELECT v.id, v.piloto_nombre, v.piloto_nombre_norm, ve.placa
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ? AND v.estado = 'abierto'`,
      [guard.empresa.id],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT v.id, v.piloto_nombre, ve.placa
         FROM flota_viajes v
         INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
         WHERE v.empresa_id = ? AND v.estado = 'abierto'`,
        [guard.empresa.id],
      ),
    );
    const abiertoPiloto = abiertosEmp.find((row) => {
      const rowNorm =
        (row.piloto_nombre_norm
          ? String(row.piloto_nombre_norm)
          : null) || normalizarNombrePiloto(String(row.piloto_nombre ?? ""));
      return rowNorm === norm;
    });
    if (abiertoPiloto) {
      return NextResponse.json(
        {
          error: `El piloto "${nombre}" ya tiene viaje abierto en ${abiertoPiloto.placa} (sin importar mayúsculas). Cierra la llegada primero.`,
        },
        { status: 409 },
      );
    }

    const empleado = await buscarEmpleadoPorNombre(guard.empresa.id, nombre);
    let esExterno = Boolean(d.esExterno) || !empleado;
    let permisoId: number | null = d.permisoExternoId ?? null;

    if (!empleado) {
      if (!d.esExterno) {
        return NextResponse.json(
          {
            error: "NO_EN_RRHH",
            code: "NO_EN_RRHH",
            mensaje:
              "Ese nombre no aparece en personal activo de RRHH. Si es externo o en prueba, marca la casilla y solicita permiso a Operaciones.",
          },
          { status: 422 },
        );
      }
      const motivo = (d.motivoExterno ?? "").trim();
      if (motivo.length < 5 && !permisoId) {
        return NextResponse.json(
          {
            error:
              "Indica el motivo para Operaciones (conductor externo / en prueba).",
          },
          { status: 400 },
        );
      }

      if (!permisoId) {
        // Reutilizar permiso aprobado vigente (últimos 7 días)
        const prev = await query<RowDataPacket[]>(
          `SELECT id, estado FROM flota_permisos_externos
           WHERE empresa_id = ? AND piloto_nombre_norm = ?
             AND estado IN ('aprobado','pendiente')
             AND creado_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
           ORDER BY FIELD(estado,'aprobado','pendiente'), id DESC
           LIMIT 1`,
          [guard.empresa.id, norm],
        );
        if (prev[0]?.estado === "aprobado") {
          permisoId = Number(prev[0].id);
        } else if (prev[0]?.estado === "pendiente") {
          return NextResponse.json(
            {
              error: "PERMISO_PENDIENTE",
              code: "PERMISO_PENDIENTE",
              permisoExternoId: Number(prev[0].id),
              mensaje:
                "Ya hay una solicitud pendiente en Operaciones para este conductor. Espera la autorización para registrar la salida.",
            },
            { status: 422 },
          );
        } else {
          const rPerm = await execute(
            `INSERT INTO flota_permisos_externos
              (empresa_id, piloto_nombre, piloto_nombre_norm, motivo, estado, solicitado_por, creado_at)
             VALUES (?, ?, ?, ?, 'pendiente', ?, ?)`,
            [
              guard.empresa.id,
              nombre,
              norm,
              motivo,
              guard.session.username,
              ahora,
            ],
          );
          return NextResponse.json(
            {
              error: "SOLICITUD_ENVIADA",
              code: "SOLICITUD_ENVIADA",
              permisoExternoId: Number(rPerm.insertId),
              mensaje: `Solicitud enviada a Operaciones para conductor externo/prueba: ${nombre}. Cuando aprueben, vuelve a guardar la salida.`,
            },
            { status: 202 },
          );
        }
      } else {
        const ok = await query<RowDataPacket[]>(
          `SELECT id, estado FROM flota_permisos_externos
           WHERE id = ? AND empresa_id = ? LIMIT 1`,
          [permisoId, guard.empresa.id],
        );
        if (!ok[0] || String(ok[0].estado) !== "aprobado") {
          return NextResponse.json(
            {
              error:
                "El permiso externo no está aprobado. Espera autorización de Operaciones.",
            },
            { status: 422 },
          );
        }
      }
      esExterno = true;
    }

    // Detectar plan TMS del día (piloto / placa)
    const planesMatch = await buscarPlanesParaSalida(guard.empresa.id, {
      pilotoNombre: nombre,
      placa: String(veh.placa),
    });
    let planId: number | null = d.planId ?? null;
    if (planId) {
      const ok = planesMatch.find((p) => p.id === planId);
      if (!ok) {
        // Validar que el plan exista aunque no coincida filtro
        const check = await query<RowDataPacket[]>(
          `SELECT id FROM tms_planes_viaje
           WHERE id = ? AND empresa_id = ?
             AND estado IN ('Programado','En ruta') LIMIT 1`,
          [planId, guard.empresa.id],
        );
        if (!check[0]) {
          return NextResponse.json(
            { error: "Plan TMS no válido o no está programado." },
            { status: 400 },
          );
        }
      }
    } else if (planesMatch.length === 1) {
      planId = planesMatch[0].id;
    }

    const destinoFinal =
      d.destino?.trim() ||
      planesMatch.find((p) => p.id === planId)?.cliente ||
      null;

    const lockKey = `flota_salida_${guard.empresa.id}_${Number(veh.id)}`;
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
        [guard.empresa.id, veh.id],
      );
      if (recheckRows[0]) {
        return NextResponse.json(
          { error: `La unidad ${veh.placa} ya tiene un viaje abierto.` },
          { status: 409 },
        );
      }

      r = await execute(
        `INSERT INTO flota_viajes
        (empresa_id, vehiculo_id, piloto_nombre, piloto_nombre_norm, piloto_usuario_id,
         km_salida, hora_salida, destino, estado, es_externo, empleado_id, permiso_externo_id, plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'abierto', ?, ?, ?, ?)`,
        [
          guard.empresa.id,
          Number(veh.id),
          nombre,
          norm,
          guard.session.id,
          d.kmSalida,
          ahora,
          destinoFinal,
          esExterno ? 1 : 0,
          empleado?.id ?? null,
          permisoId,
          planId,
        ],
      ).catch(async () =>
        execute(
          `INSERT INTO flota_viajes
          (empresa_id, vehiculo_id, piloto_nombre, piloto_usuario_id, km_salida,
           hora_salida, destino, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'abierto')`,
          [
            guard.empresa.id,
            Number(veh.id),
            nombre,
            guard.session.id,
            d.kmSalida,
            ahora,
            destinoFinal,
          ],
        ),
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
      await marcarPlanEnRuta(guard.empresa.id, planId);
    }

    await registrarAuditoria({
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: "salida_viaje",
      modulo: "tms",
      detalle: `Viaje #${r.insertId} salida · piloto ${nombre} · placa ${String(veh.placa)} · km ${d.kmSalida}${
        planId ? ` · plan TMS #${planId} → En ruta` : ""
      }${destinoFinal ? ` · destino ${destinoFinal}` : ""}`,
    });

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por, viaje_id, capturado_en)
       VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        Number(veh.id),
        d.kmSalida,
        d.destino ? `Salida viaje → ${d.destino}` : "Salida viaje",
        nombre,
        guard.session.username,
        Number(r.insertId),
        ahora,
      ],
    ).catch(async () => {
      await execute(
        `INSERT INTO flota_lecturas
          (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por)
         VALUES (?, ?, ?, CURDATE(), ?, ?, ?)`,
        [
          guard.empresa.id,
          Number(veh.id),
          d.kmSalida,
          d.destino ? `Salida viaje → ${d.destino}` : "Salida viaje",
          nombre,
          guard.session.username,
        ],
      );
    });

    await actualizarKmActualVehiculo(Number(veh.id), d.kmSalida);

    const extra = empleado
      ? ` RRHH: ${empleado.codigo}.`
      : " Conductor externo autorizado por Operaciones.";
    const planInfo = planId
      ? planesMatch.find((p) => p.id === planId)
      : null;
    const planMsg = planInfo
      ? ` Plan TMS ${planInfo.codigo} → En ruta.`
      : planesMatch.length > 1
        ? ` Hay ${planesMatch.length} planes posibles; selecciona uno.`
        : "";

    return NextResponse.json({
      id: r.insertId,
      vehiculoId: Number(veh.id),
      placa: String(veh.placa),
      kmSalida: d.kmSalida,
      mensaje: `Salida de ${veh.placa} registrada (${nombre}).${extra}${planMsg}`,
      esExterno,
      empleado,
      permisoExternoId: permisoId,
      planId,
      planesSugeridos: planesMatch,
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
    const viaje = await query<RowDataPacket[]>(
      `SELECT v.*, ve.placa FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
      [d.viajeId, guard.empresa.id],
    );
    if (!viaje[0] || String(viaje[0].estado) !== "abierto") {
      return NextResponse.json(
        { error: "Viaje abierto no encontrado." },
        { status: 404 },
      );
    }

    const planIdPre =
      viaje[0].plan_id != null ? Number(viaje[0].plan_id) : null;
    const paradasRuta = planIdPre
      ? await listarParadasDelPlan(planIdPre)
      : [];
    /** Ruta con destinos: evidencia por parada; al cerrar exige km final + foto tablero. */
    const esRutaConParadas = paradasRuta.length > 0;
    const kmSalida = Number(viaje[0].km_salida);
    const kmFinal = Number(d.kmLlegada);

    if (!Number.isFinite(kmFinal)) {
      return NextResponse.json(
        { error: "Indica el km de llegada / km final." },
        { status: 400 },
      );
    }
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
        const nombres = pendientes
          .map((p) => `${p.orden}. ${p.lugar_nombre}`)
          .join("; ");
        return NextResponse.json(
          {
            error: `Faltan evidencias de producto en ${pendientes.length} parada(s) de la ruta: ${nombres}. Sube las fotos en cada destino antes de cerrar.`,
            code: "PARADAS_SIN_EVIDENCIA",
            pendientes,
          },
          { status: 422 },
        );
      }
    }

    if (esRutaConParadas && guard.session.rol === "Piloto") {
      const tablero = await query<RowDataPacket[]>(
        `SELECT id FROM flota_viaje_evidencias
         WHERE viaje_id = ? AND tipo = 'tablero_llegada' LIMIT 1`,
        [d.viajeId],
      ).catch(() => [] as RowDataPacket[]);
      if (!tablero.length) {
        return NextResponse.json(
          {
            error:
              "Toma la foto del tablero con el km final antes de cerrar la ruta.",
            code: "FALTA_TABLERO_FINAL",
          },
          { status: 422 },
        );
      }
    }

    const kmLlegadaDb = kmFinal;

    const upd = await execute(
      `UPDATE flota_viajes SET
        km_llegada = ?, hora_llegada = ?, estado = 'cerrado',
        observaciones = COALESCE(?, observaciones),
        piloto_nombre = COALESCE(?, piloto_nombre)
       WHERE id = ? AND empresa_id = ? AND estado = 'abierto'`,
      [
        kmLlegadaDb,
        ahora,
        d.observaciones ??
          (esRutaConParadas
            ? `Cierre ruta ${paradasRuta.length} parada(s); km salida ${kmSalida} → final ${kmFinal}.`
            : null),
        d.pilotoNombre?.trim() || null,
        d.viajeId,
        guard.empresa.id,
      ],
    );
    if (!upd.affectedRows) {
      return NextResponse.json(
        { error: "Este viaje ya fue cerrado. Actualiza la lista e inténtalo de nuevo." },
        { status: 409 },
      );
    }

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por, viaje_id, capturado_en)
       VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        Number(viaje[0].vehiculo_id),
        kmLlegadaDb,
        d.pilotoNombre?.trim() || String(viaje[0].piloto_nombre),
        guard.session.username,
        d.viajeId,
        ahora,
      ],
    ).catch(async () => {
      await execute(
        `INSERT INTO flota_lecturas
          (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por)
         VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?, ?)`,
        [
          guard.empresa.id,
          Number(viaje[0].vehiculo_id),
          kmLlegadaDb,
          d.pilotoNombre?.trim() || String(viaje[0].piloto_nombre),
          guard.session.username,
        ],
      );
    });

    // Por id (no por empresa_id): unidades compartidas entre KT/Mónaco
    await actualizarKmActualVehiculo(
      Number(viaje[0].vehiculo_id),
      kmLlegadaDb,
    );

    if (planIdPre) {
      await marcarPlanDescargado(guard.empresa.id, planIdPre);
    }

    await registrarAuditoria({
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: "llegada_viaje",
      modulo: "tms",
      detalle: `Viaje #${d.viajeId} llegada · piloto ${
        d.pilotoNombre?.trim() || String(viaje[0].piloto_nombre)
      } · placa ${String(viaje[0].placa)} · km ${kmSalida} → ${kmLlegadaDb}${
        planIdPre ? ` · plan TMS #${planIdPre} → Descargado` : ""
      }${esRutaConParadas ? ` · ${paradasRuta.length} parada(s)` : ""}`,
    });

    return NextResponse.json({
      viajeId: d.viajeId,
      vehiculoId: Number(viaje[0].vehiculo_id),
      placa: String(viaje[0].placa),
      kmSalida,
      kmLlegada: kmLlegadaDb,
      mensaje: `Llegada de ${viaje[0].placa}: ${(kmLlegadaDb - kmSalida).toLocaleString("es-GT")} km recorridos.${
        planIdPre ? " Plan TMS → Descargado." : ""
      }`,
      planId: planIdPre,
      esRutaConParadas,
      paradas: paradasRuta.length,
    });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
