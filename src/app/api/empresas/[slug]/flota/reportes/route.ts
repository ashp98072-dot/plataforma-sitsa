import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import { listarParadasDePlanes } from "@/lib/tms/paradas";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import { hoyLocal } from "@/lib/rrhh/dates";
import { KM_INTERVALO_SERVICIO_DEFAULT } from "@/lib/flota/constants";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_reportes", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlotaLectura();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const hoy = hoyLocal();
  const [y, m] = hoy.split("-").map(Number);
  const mesInicio = m - 5;
  const anioInicio = y + Math.floor((mesInicio - 1) / 12);
  const mesNorm = ((((mesInicio - 1) % 12) + 12) % 12) + 1;
  const desdeDefault = `${anioInicio}-${String(mesNorm).padStart(2, "0")}-01`;

  const fechaDesde = (url.searchParams.get("desde") || desdeDefault).slice(0, 10);
  const fechaHasta = (url.searchParams.get("hasta") || hoy).slice(0, 10);
  const hastaExclusive = `${fechaHasta} 23:59:59`;

  // 2 oleadas en paralelo (pool Hostinger ~15): más rápido sin saturar.
  const [vehiculos, costosPorMes, totalRow] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT id, placa, marca, modelo, km_actual, km_intervalo_servicio, km_ultimo_servicio,
              en_taller, estado
       FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
      [guard.empresa.id],
    ),
    query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(fecha_servicio, '%Y-%m') AS mes,
              SUM(costo) AS total, COUNT(*) AS n
       FROM flota_servicios
       WHERE empresa_id = ?
         AND fecha_servicio BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(fecha_servicio, '%Y-%m')
       ORDER BY mes ASC`,
      [guard.empresa.id, fechaDesde, fechaHasta],
    ),
    query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(costo), 0) AS total, COUNT(*) AS n
       FROM flota_servicios
       WHERE empresa_id = ?
         AND fecha_servicio BETWEEN ? AND ?`,
      [guard.empresa.id, fechaDesde, fechaHasta],
    ),
  ]);
  const [costosPorUnidad, viajesRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT v.placa, v.id AS vehiculo_id,
              SUM(s.costo) AS total, COUNT(*) AS n
       FROM flota_servicios s
       INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
       WHERE s.empresa_id = ?
         AND s.fecha_servicio BETWEEN ? AND ?
       GROUP BY v.id, v.placa
       ORDER BY total DESC
       LIMIT 40`,
      [guard.empresa.id, fechaDesde, fechaHasta],
    ),
    query<RowDataPacket[]>(
      `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
              v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
              v.es_externo, v.plan_id, ve.placa,
              p.codigo AS plan_codigo, p.estado AS plan_estado,
              c.nombre AS plan_cliente
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       LEFT JOIN tms_planes_viaje p ON p.id = v.plan_id
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id
       WHERE v.empresa_id = ?
         AND v.hora_salida >= ? AND v.hora_salida <= ?
       ORDER BY v.hora_salida DESC
       LIMIT 200`,
      [guard.empresa.id, fechaDesde, hastaExclusive],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
                v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
                ve.placa
         FROM flota_viajes v
         INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
         WHERE v.empresa_id = ?
           AND v.hora_salida >= ? AND v.hora_salida <= ?
         ORDER BY v.hora_salida DESC
         LIMIT 200`,
        [guard.empresa.id, fechaDesde, hastaExclusive],
      ),
    ),
  ]);

  const alertas = vehiculos.filter((v) => {
    if (v.en_taller) return false;
    const km = Number(v.km_actual ?? 0);
    const intervalo = Number(
      v.km_intervalo_servicio ?? KM_INTERVALO_SERVICIO_DEFAULT,
    );
    const ultimo = Number(v.km_ultimo_servicio ?? 0);
    return km - ultimo >= intervalo;
  });

  const viajeIds = viajesRows.map((r) => Number(r.id));
  const evidenciasMap = new Map<number, number>();
  if (viajeIds.length) {
    try {
      const ev = await query<RowDataPacket[]>(
        `SELECT viaje_id, COUNT(*) AS n FROM flota_viaje_evidencias
         WHERE empresa_id = ? AND viaje_id IN (${viajeIds.map(() => "?").join(",")})
         GROUP BY viaje_id`,
        [guard.empresa.id, ...viajeIds],
      );
      for (const a of ev) evidenciasMap.set(Number(a.viaje_id), Number(a.n));
    } catch {
      /* ok */
    }
  }

  const planIds = viajesRows
    .map((r) => (r.plan_id != null ? Number(r.plan_id) : 0))
    .filter((id) => id > 0);
  const paradasByPlan = await listarParadasDePlanes(planIds);

  return NextResponse.json({
    resumen: {
      totalVehiculos: vehiculos.length,
      enTaller: vehiculos.filter((v) => v.en_taller).length,
      alertasServicio: alertas.length,
    },
    alertas,
    rango: { desde: fechaDesde, hasta: fechaHasta },
    costosPorMes: costosPorMes.map((r) => ({
      mes: String(r.mes),
      total: Number(r.total ?? 0),
      n: Number(r.n ?? 0),
    })),
    costosPorUnidad: costosPorUnidad.map((r) => ({
      placa: String(r.placa),
      vehiculoId: Number(r.vehiculo_id),
      total: Number(r.total ?? 0),
      n: Number(r.n ?? 0),
    })),
    totalPeriodo: {
      total: Number(totalRow[0]?.total ?? 0),
      n: Number(totalRow[0]?.n ?? 0),
    },
    viajes: viajesRows.map((r) => {
      const planId = r.plan_id != null ? Number(r.plan_id) : null;
      const paradas = planId ? (paradasByPlan.get(planId) ?? []) : [];
      return {
        id: Number(r.id),
        vehiculo_id: Number(r.vehiculo_id),
        placa: String(r.placa),
        piloto_nombre: String(r.piloto_nombre ?? ""),
        km_salida: Number(r.km_salida ?? 0),
        km_llegada: r.km_llegada != null ? Number(r.km_llegada) : null,
        hora_salida: r.hora_salida,
        hora_llegada: r.hora_llegada ?? null,
        destino: r.destino ? String(r.destino) : null,
        observaciones: r.observaciones ? String(r.observaciones) : null,
        estado: String(r.estado ?? ""),
        es_externo: Number(r.es_externo ?? 0),
        plan_id: planId,
        plan_codigo: r.plan_codigo ? String(r.plan_codigo) : null,
        plan_estado: r.plan_estado ? String(r.plan_estado) : null,
        plan_cliente: r.plan_cliente ? String(r.plan_cliente) : null,
        evidencias: evidenciasMap.get(Number(r.id)) ?? Number(r.evidencias ?? 0),
        km_recorridos:
          r.km_llegada != null
            ? Number(r.km_llegada) - Number(r.km_salida ?? 0)
            : null,
        paradas,
        paradasPendientes: paradas.filter(
          (p) => p.requiere_evidencia && p.evidencias < 1,
        ).length,
      };
    }),
  });
}
