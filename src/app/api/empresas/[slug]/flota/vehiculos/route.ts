import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, getPool, query } from "@/lib/db";
import { requireTenantFlota, requireTenantFlotaAny } from "@/lib/tenant";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import {
  empresasAccesoPorVehiculos,
  guardarAccesoVehiculo,
  listarEmpresasActivasSimple,
  listarVehiculosAccesibles,
  obtenerVehiculoAccesible,
} from "@/lib/flota/acceso";
import {
  guardarFiltrosVehiculo,
  listarFiltrosPorVehiculos,
  type FiltroVehiculo,
} from "@/lib/flota/filtros";
import { KM_INTERVALO_SERVICIO_DEFAULT } from "@/lib/flota/constants";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    [
      "flota_vehiculos",
      "flota_lecturas",
      "flota_servicios",
      "flota_piloto",
      "flota_reportes",
    ],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlotaLectura();
  } catch {
    /* ok */
  }

  const rows = await listarVehiculosAccesibles(guard.empresa.id);
  const ids = rows.map((r) => Number(r.id));
  const duenosIds = rows
    .filter((r) => Number(r.empresa_id) === guard.empresa.id)
    .map((r) => Number(r.id));
  // Filtros + accesos + empresas en paralelo (antes eran 3 round-trips en serie).
  const [filtrosMap, accesosMap, empresas] = await Promise.all([
    listarFiltrosPorVehiculos(ids),
    empresasAccesoPorVehiculos(duenosIds),
    listarEmpresasActivasSimple(),
  ]);
  const vehiculos = [];
  for (const r of rows) {
    const vid = Number(r.id);
    let filtros = filtrosMap.get(vid) ?? [];
    // GET no escribe migraciones (evita N+1). Mostrar legacy si aún no hay filas.
    if (!filtros.length) {
      const legacy: FiltroVehiculo[] = [];
      if (r.filtro_servicio_mayor != null && String(r.filtro_servicio_mayor).trim()) {
        legacy.push({
          tipo: "Servicio mayor",
          codigo: String(r.filtro_servicio_mayor).trim(),
        });
      }
      if (r.filtro_servicio_menor != null && String(r.filtro_servicio_menor).trim()) {
        legacy.push({
          tipo: "Servicio menor",
          codigo: String(r.filtro_servicio_menor).trim(),
        });
      }
      filtros = legacy;
    }
    const esDueno = Number(r.empresa_id) === guard.empresa.id;
    vehiculos.push({
      ...r,
      compartido: Number(r.compartido ?? 0) === 1,
      accesoEmpresaIds: esDueno ? (accesosMap.get(vid) ?? []) : [],
      esDueno,
      filtros,
    });
  }
  return NextResponse.json({
    vehiculos,
    empresas,
    empresaActualId: guard.empresa.id,
  });
}

const schema = z.object({
  placa: z.string().min(1),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  descripcion: z.string().optional(),
  color: z.string().optional(),
  tipoCombustible: z.string().optional(),
  chasis: z.string().optional(),
  capacidad: z.string().optional(),
  kmActual: z.number().int().nonnegative().default(0),
  kmIntervaloServicio: z
    .number()
    .int()
    .positive()
    .default(KM_INTERVALO_SERVICIO_DEFAULT),
  odometroFuncional: z.boolean().default(true),
  mantenimientoIntervaloMeses: z.number().int().min(1).max(60).optional(),
  credito: z.string().optional(),
  empresaActivo: z.string().optional(),
  nit: z.string().optional(),
  condicionPropiedad: z.string().optional(),
  seguros: z.string().optional(),
  notas: z.string().optional(),
  activo: z.boolean().optional(),
  rinLlanta: z.string().optional(),
  medidaLlanta: z.string().optional(),
  tipoAceite: z.string().optional(),
  filtros: z
    .array(
      z.object({
        tipo: z.string().min(1),
        codigo: z.string().min(1),
        notas: z.string().optional().nullable(),
      }),
    )
    .optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ignore */
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const placa = d.placa.trim().toUpperCase();

  const dup = await query<RowDataPacket[]>(
    "SELECT id FROM flota_vehiculos WHERE empresa_id = ? AND placa = ? LIMIT 1",
    [guard.empresa.id, placa],
  );
  if (dup[0]) {
    return NextResponse.json(
      { error: `Ya existe la placa ${placa}.` },
      { status: 409 },
    );
  }

  try {
    const result = await execute(
      `INSERT INTO flota_vehiculos
        (empresa_id, placa, marca, modelo, descripcion, color, tipo_combustible,
         chasis, capacidad, credito, empresa_activo, nit, condicion_propiedad,
         seguros, km_actual, km_intervalo_servicio, km_ultimo_servicio, notas, activo,
         filtro_servicio_mayor, filtro_servicio_menor, rin_llanta, medida_llanta, tipo_aceite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        placa,
        d.marca ?? null,
        d.modelo ?? null,
        d.descripcion ?? null,
        d.color ?? null,
        d.tipoCombustible ?? "diesel",
        d.chasis ?? null,
        d.capacidad ?? null,
        d.credito ?? null,
        d.empresaActivo ?? null,
        d.nit ?? null,
        d.condicionPropiedad ?? null,
        d.seguros ?? null,
        d.kmActual,
        d.kmIntervaloServicio,
        d.kmActual,
        d.notas ?? null,
        d.activo === false ? 0 : 1,
        null,
        null,
        d.rinLlanta ?? null,
        d.medidaLlanta ?? null,
        d.tipoAceite ?? null,
      ],
    );
    const nuevoId = Number(result.insertId);
    await execute(
      `UPDATE flota_vehiculos
       SET odometro_funcional = ?, mantenimiento_intervalo_meses = ?, km_actual = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        d.odometroFuncional ? 1 : 0,
        d.odometroFuncional ? null : (d.mantenimientoIntervaloMeses ?? 3),
        d.odometroFuncional ? d.kmActual : null,
        nuevoId,
        guard.empresa.id,
      ],
    );
    if (d.filtros?.length) {
      await guardarFiltrosVehiculo(
        guard.empresa.id,
        nuevoId,
        d.filtros as FiltroVehiculo[],
      );
    }
    return NextResponse.json({
      id: nuevoId,
      mensaje: "Vehículo registrado.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `No se pudo registrar: ${err.message}`
            : "No se pudo registrar.",
      },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  enTaller: z.boolean().optional(),
  motivoTaller: z.string().optional(),
  estado: z.string().optional(),
  activo: z.boolean().optional(),
  placa: z.string().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  descripcion: z.string().optional(),
  color: z.string().optional(),
  kmActual: z.number().int().nonnegative().optional(),
  kmIntervaloServicio: z.number().int().positive().optional(),
  odometroFuncional: z.boolean().optional(),
  mantenimientoIntervaloMeses: z.number().int().min(1).max(60).optional(),
  reiniciarKilometraje: z.boolean().optional(),
  notas: z.string().optional(),
  rinLlanta: z.string().optional(),
  medidaLlanta: z.string().optional(),
  tipoAceite: z.string().optional(),
  tipoCombustible: z.string().optional(),
  empresaActivo: z.string().optional(),
  filtros: z
    .array(
      z.object({
        tipo: z.string().min(1),
        codigo: z.string().min(1),
        notas: z.string().optional().nullable(),
      }),
    )
    .optional(),
  /** Empresas que pueden usar este vehículo (además de la dueña). */
  accesoEmpresaIds: z.array(z.number().int().positive()).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "editar");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const curRow = await obtenerVehiculoAccesible(guard.empresa.id, d.id);
  if (!curRow) {
    return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
  }
  const cur = [curRow];
  const esDueno = Number(curRow.empresa_id) === guard.empresa.id;

  if (d.reiniciarKilometraje) {
    if (!esDueno) {
      return NextResponse.json(
        { error: "Solo la empresa dueña puede limpiar el kilometraje." },
        { status: 403 },
      );
    }
    await execute(
      "UPDATE flota_vehiculos SET km_actual = NULL WHERE id = ? AND empresa_id = ?",
      [d.id, guard.empresa.id],
    );
    return NextResponse.json({
      mensaje: "Kilometraje actual limpiado. El historial de viajes, lecturas y servicios se conservó.",
    });
  }

  if (d.enTaller === true && !String(d.motivoTaller ?? "").trim()) {
    return NextResponse.json(
      { error: "Indica el motivo para enviar a taller." },
      { status: 400 },
    );
  }

  if (d.enTaller === true) {
    const enRuta = await query<RowDataPacket[]>(
      `SELECT id, piloto_nombre FROM flota_viajes
       WHERE vehiculo_id = ? AND estado = 'abierto' LIMIT 1`,
      [d.id],
    );
    if (enRuta[0]) {
      return NextResponse.json(
        {
          error: `${cur[0].placa} está en ruta con ${enRuta[0].piloto_nombre}. Cierra la llegada antes de enviarlo a taller.`,
        },
        { status: 409 },
      );
    }
  }

  // Unidades compartidas: solo taller/estado operativo (no reasignar accesos ajenos).
  if (!esDueno && d.accesoEmpresaIds) {
    return NextResponse.json(
      {
        error:
          "Solo la empresa dueña puede cambiar con quién se comparte esta unidad.",
      },
      { status: 403 },
    );
  }

  const enTaller =
    d.enTaller == null ? Number(cur[0].en_taller) : d.enTaller ? 1 : 0;
  const fechaTaller =
    d.enTaller === true
      ? new Date().toISOString().slice(0, 10)
      : d.enTaller === false
        ? null
        : (cur[0].fecha_entrada_taller as string | null);
  const motivo =
    d.enTaller === false
      ? null
      : d.motivoTaller != null
        ? d.motivoTaller.trim()
        : (cur[0].motivo_taller as string | null);

  try {
    await execute(
      `UPDATE flota_vehiculos SET
        placa = ?,
        marca = ?,
        modelo = ?,
        descripcion = ?,
        color = ?,
        tipo_combustible = ?,
        km_actual = ?,
        km_intervalo_servicio = ?,
        odometro_funcional = ?,
        mantenimiento_intervalo_meses = ?,
        en_taller = ?,
        fecha_entrada_taller = ?,
        motivo_taller = ?,
        estado = ?,
        activo = ?,
        notas = ?,
        filtro_servicio_mayor = ?,
        filtro_servicio_menor = ?,
        rin_llanta = ?,
        medida_llanta = ?,
        tipo_aceite = ?,
        empresa_activo = ?
       WHERE id = ?`,
      [
        d.placa?.trim().toUpperCase() || String(cur[0].placa),
        d.marca ?? cur[0].marca,
        d.modelo ?? cur[0].modelo,
        d.descripcion ?? cur[0].descripcion,
        d.color ?? cur[0].color,
        d.tipoCombustible ?? cur[0].tipo_combustible,
        d.kmActual ?? cur[0].km_actual,
        d.kmIntervaloServicio ?? cur[0].km_intervalo_servicio,
        d.odometroFuncional == null
          ? Number(cur[0].odometro_funcional ?? 1)
          : d.odometroFuncional ? 1 : 0,
        d.odometroFuncional === false
          ? (d.mantenimientoIntervaloMeses ?? Number(cur[0].mantenimiento_intervalo_meses ?? 3))
          : d.mantenimientoIntervaloMeses ?? cur[0].mantenimiento_intervalo_meses,
        enTaller,
        fechaTaller,
        motivo,
        d.estado ??
          (d.activo === false
            ? "Inactivo"
            : d.activo === true && !enTaller
              ? "Activo"
              : enTaller
                ? "En taller"
                : String(cur[0].estado || "Activo")),
        d.activo == null
          ? Number(cur[0].activo ?? 1)
          : d.activo
            ? 1
            : 0,
        d.notas ?? cur[0].notas,
        cur[0].filtro_servicio_mayor ?? null,
        cur[0].filtro_servicio_menor ?? null,
        d.rinLlanta ?? cur[0].rin_llanta,
        d.medidaLlanta ?? cur[0].medida_llanta,
        d.tipoAceite ?? cur[0].tipo_aceite,
        d.empresaActivo !== undefined
          ? d.empresaActivo.trim() || null
          : cur[0].empresa_activo,
        d.id,
      ],
    );
    if (d.filtros && esDueno) {
      await guardarFiltrosVehiculo(
        Number(cur[0].empresa_id),
        d.id,
        d.filtros as FiltroVehiculo[],
      );
    }
    if (d.accesoEmpresaIds && esDueno) {
      await guardarAccesoVehiculo(
        d.id,
        d.accesoEmpresaIds,
        Number(cur[0].empresa_id),
      );
    }
    return NextResponse.json({
      mensaje:
        d.enTaller === true
          ? "Vehículo enviado a taller."
          : d.enTaller === false
            ? "Vehículo salió de taller."
            : d.activo === false
              ? "Vehículo marcado como inactivo."
              : d.activo === true
                ? "Vehículo marcado como activo."
                : "Vehículo actualizado.",
    });
  } catch (err) {
    // Fallback mínimo si faltan columnas nuevas
    try {
      await execute(
        `UPDATE flota_vehiculos SET
          en_taller = ?,
          fecha_entrada_taller = ?,
          estado = ?
         WHERE id = ?`,
        [
          enTaller,
          fechaTaller,
          enTaller ? "En taller" : "Activo",
          d.id,
        ],
      );
      return NextResponse.json({
        mensaje:
          d.enTaller != null
            ? enTaller
              ? "Enviado a taller (campos básicos)."
              : "Salió de taller."
            : "Actualizado (campos básicos).",
      });
    } catch (err2) {
      return NextResponse.json(
        {
          error:
            err2 instanceof Error
              ? err2.message
              : err instanceof Error
                ? err.message
                : "No se pudo actualizar.",
        },
        { status: 500 },
      );
    }
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const modo = (url.searchParams.get("modo") ?? "eliminar").toLowerCase();
  const id = Number(url.searchParams.get("id") ?? 0);
  if (!id) {
    return NextResponse.json({ error: "ID requerido." }, { status: 400 });
  }

  // Dar de baja = soft delete (activo=0); eliminar = borrado físico
  if (modo === "baja") {
    const guard = await requireTenantFlota(slug, "flota_vehiculos", "editar");
    if (guard.error) return guard.error;

    const cur = await query<RowDataPacket[]>(
      "SELECT id, placa, activo FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1",
      [id, guard.empresa.id],
    );
    if (!cur[0]) {
      return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
    }

    const abierto = await query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes
       WHERE empresa_id = ? AND vehiculo_id = ? AND estado = 'abierto' LIMIT 1`,
      [guard.empresa.id, id],
    );
    if (abierto[0]) {
      return NextResponse.json(
        {
          error:
            "Tiene un viaje abierto. Cierra la llegada antes de darlo de baja.",
        },
        { status: 409 },
      );
    }

    await execute(
      `UPDATE flota_vehiculos
       SET activo = 0, estado = 'Inactivo', en_taller = 0, motivo_taller = NULL
       WHERE id = ? AND empresa_id = ?`,
      [id, guard.empresa.id],
    );
    return NextResponse.json({
      mensaje: `Vehículo ${cur[0].placa} dado de baja (inactivo).`,
    });
  }

  const guard = await requireTenantFlota(slug, "flota_vehiculos", "eliminar");
  if (guard.error) return guard.error;

  const conn = await getPool().getConnection();
  let descartarConexion = false;
  try {
    await conn.beginTransaction();
    const [cur] = await conn.query<RowDataPacket[]>(
      "SELECT id, placa FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
      [id, guard.empresa.id],
    );
    if (!cur[0]) {
      await conn.rollback();
      return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
    }

    // FUTURO MULTAS: después de aplicar su migración, agregar AQUÍ el guard
    // de revisiones/multas históricas de esta unidad, usando esta misma conn.
    // Si existen: rollback + 409 indicando utilizar "Dar de baja".
    // No consultar tablas de Multas antes de que exista la migración.
    const [abierto] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes
       WHERE empresa_id = ? AND vehiculo_id = ? AND estado = 'abierto' LIMIT 1 FOR UPDATE`,
      [guard.empresa.id, id],
    );
    if (abierto[0]) {
      await conn.rollback();
      return NextResponse.json(
        {
          error:
            "Tiene un viaje abierto. Cierra la llegada o dale de baja en lugar de eliminar.",
        },
        { status: 409 },
      );
    }

    const eid = guard.empresa.id;

    await conn.execute(
      `DELETE e FROM flota_viaje_evidencias e
       INNER JOIN flota_viajes v ON v.id = e.viaje_id
       WHERE v.vehiculo_id = ? AND v.empresa_id = ?`,
      [id, eid],
    );
    await conn.execute(
      `DELETE e FROM flota_lectura_evidencias e
       INNER JOIN flota_lecturas l ON l.id = e.lectura_id
       WHERE l.vehiculo_id = ? AND l.empresa_id = ?`,
      [id, eid],
    );
    await conn.execute(
      `DELETE a FROM flota_servicio_adjuntos a
       INNER JOIN flota_servicios s ON s.id = a.servicio_id
       WHERE s.vehiculo_id = ? AND s.empresa_id = ?`,
      [id, eid],
    );
    await conn.execute(
      "DELETE FROM flota_viajes WHERE vehiculo_id = ? AND empresa_id = ?",
      [id, eid],
    );
    await conn.execute(
      "DELETE FROM flota_lecturas WHERE vehiculo_id = ? AND empresa_id = ?",
      [id, eid],
    );
    await conn.execute(
      "DELETE FROM flota_servicios WHERE vehiculo_id = ? AND empresa_id = ?",
      [id, eid],
    );
    await conn.execute(
      "DELETE FROM flota_vehiculo_filtros WHERE vehiculo_id = ? AND empresa_id = ?",
      [id, eid],
    );
    await conn.execute("DELETE FROM flota_vehiculo_acceso WHERE vehiculo_id = ?", [id]);

    const [resultado] = await conn.execute<ResultSetHeader>(
      "DELETE FROM flota_vehiculos WHERE id = ? AND empresa_id = ?",
      [id, eid],
    );
    if (resultado.affectedRows !== 1) {
      throw new Error("No se eliminó exactamente una unidad.");
    }
    await conn.commit();
    return NextResponse.json({
      mensaje: `Vehículo ${cur[0].placa} eliminado definitivamente.`,
    });
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      descartarConexion = true;
      conn.destroy();
      console.error("Rollback DELETE vehículo", rollbackError);
    }
    console.error("DELETE vehículo", error);
    return NextResponse.json(
      { error: "No se pudo completar la eliminación del vehículo. Utiliza Dar de baja si debe conservarse su historial." },
      { status: 500 },
    );
  } finally {
    if (!descartarConexion) conn.release();
  }
}
