import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { ahoraLocal } from "@/lib/rrhh/dates";
import {
  buscarEmpleadoPorNombre,
  normalizarNombrePiloto,
  vehiculoPorPlaca,
} from "@/lib/flota/pilotos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const viajes = await query<RowDataPacket[]>(
    `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
            v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
            v.es_externo, v.empleado_id, ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.empresa_id = ?
     ORDER BY v.hora_salida DESC
     LIMIT 100`,
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
       LIMIT 100`,
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
});

const llegadaSchema = z.object({
  accion: z.literal("llegada"),
  viajeId: z.number().int().positive(),
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
      const rows = await query<RowDataPacket[]>(
        `SELECT id, placa, en_taller, km_actual, activo FROM flota_vehiculos
         WHERE id = ? AND empresa_id = ? LIMIT 1`,
        [d.vehiculoId, guard.empresa.id],
      );
      veh = rows[0] ?? null;
    }
    if (!veh) {
      return NextResponse.json(
        { error: "Placa / unidad no encontrada. Escríbela como en el listado (ej. C-034BXR)." },
        { status: 404 },
      );
    }
    if (Number(veh.activo) === 0) {
      return NextResponse.json({ error: "Vehículo inactivo." }, { status: 400 });
    }
    if (Number(veh.en_taller) === 1) {
      return NextResponse.json(
        { error: `${veh.placa} está en taller.` },
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

    // Mismo piloto (mismo nombre) no puede tener otro viaje abierto
    const abiertoPiloto = await query<RowDataPacket[]>(
      `SELECT v.id, ve.placa FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ? AND v.estado = 'abierto'
         AND (
           LOWER(TRIM(v.piloto_nombre)) = ?
           OR v.piloto_nombre_norm = ?
         )
       LIMIT 1`,
      [guard.empresa.id, nombre.toLowerCase(), norm],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT v.id, ve.placa FROM flota_viajes v
         INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
         WHERE v.empresa_id = ? AND v.estado = 'abierto'
           AND LOWER(TRIM(v.piloto_nombre)) = ?
         LIMIT 1`,
        [guard.empresa.id, nombre.toLowerCase()],
      ),
    );
    if (abiertoPiloto[0]) {
      return NextResponse.json(
        {
          error: `El piloto "${nombre}" ya tiene viaje abierto en ${abiertoPiloto[0].placa}. Cierra la llegada primero.`,
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

    const r = await execute(
      `INSERT INTO flota_viajes
        (empresa_id, vehiculo_id, piloto_nombre, piloto_nombre_norm, piloto_usuario_id,
         km_salida, hora_salida, destino, estado, es_externo, empleado_id, permiso_externo_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'abierto', ?, ?, ?)`,
      [
        guard.empresa.id,
        Number(veh.id),
        nombre,
        norm,
        guard.session.id,
        d.kmSalida,
        ahora,
        d.destino ?? null,
        esExterno ? 1 : 0,
        empleado?.id ?? null,
        permisoId,
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
          d.destino ?? null,
        ],
      ),
    );

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
    ).catch(async () => {
      await execute(
        `INSERT INTO flota_lecturas
          (empresa_id, vehiculo_id, km, fecha_lectura, nota, registrado_por)
         VALUES (?, ?, ?, CURDATE(), ?, ?)`,
        [
          guard.empresa.id,
          Number(veh.id),
          d.kmSalida,
          "Salida viaje",
          guard.session.username,
        ],
      );
    });

    await execute(
      `UPDATE flota_vehiculos SET km_actual = GREATEST(COALESCE(km_actual,0), ?)
       WHERE id = ? AND empresa_id = ?`,
      [d.kmSalida, Number(veh.id), guard.empresa.id],
    );

    const extra = empleado
      ? ` RRHH: ${empleado.codigo}.`
      : " Conductor externo autorizado por Operaciones.";

    return NextResponse.json({
      id: r.insertId,
      mensaje: `Salida de ${veh.placa} registrada (${nombre}).${extra}`,
      esExterno,
      empleado,
      permisoExternoId: permisoId,
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
    if (d.kmLlegada < Number(viaje[0].km_salida)) {
      return NextResponse.json(
        { error: "Km de llegada no puede ser menor que la salida." },
        { status: 400 },
      );
    }

    await execute(
      `UPDATE flota_viajes SET
        km_llegada = ?, hora_llegada = ?, estado = 'cerrado',
        observaciones = COALESCE(?, observaciones),
        piloto_nombre = COALESCE(?, piloto_nombre)
       WHERE id = ? AND empresa_id = ?`,
      [
        d.kmLlegada,
        ahora,
        d.observaciones ?? null,
        d.pilotoNombre?.trim() || null,
        d.viajeId,
        guard.empresa.id,
      ],
    );

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por)
       VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?, ?)`,
      [
        guard.empresa.id,
        Number(viaje[0].vehiculo_id),
        d.kmLlegada,
        d.pilotoNombre?.trim() || String(viaje[0].piloto_nombre),
        guard.session.username,
      ],
    ).catch(async () => {
      await execute(
        `INSERT INTO flota_lecturas
          (empresa_id, vehiculo_id, km, fecha_lectura, nota, registrado_por)
         VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?)`,
        [
          guard.empresa.id,
          Number(viaje[0].vehiculo_id),
          d.kmLlegada,
          guard.session.username,
        ],
      );
    });

    await execute(
      `UPDATE flota_vehiculos SET km_actual = GREATEST(COALESCE(km_actual,0), ?)
       WHERE id = ? AND empresa_id = ?`,
      [d.kmLlegada, Number(viaje[0].vehiculo_id), guard.empresa.id],
    );

    const recorridos = d.kmLlegada - Number(viaje[0].km_salida);
    return NextResponse.json({
      mensaje: `Llegada de ${viaje[0].placa}: ${recorridos.toLocaleString("es-GT")} km.`,
    });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
