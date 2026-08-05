import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_reportes", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const hoy = new Date().toISOString().slice(0, 10);
  const hace6 = new Date();
  hace6.setMonth(hace6.getMonth() - 5);
  const desdeDefault = `${hace6.getFullYear()}-${String(hace6.getMonth() + 1).padStart(2, "0")}-01`;

  const fechaDesde = (url.searchParams.get("desde") || desdeDefault).slice(0, 10);
  const fechaHasta = (url.searchParams.get("hasta") || hoy).slice(0, 10);

  const vehiculos = await query<RowDataPacket[]>(
    `SELECT id, placa, marca, modelo, km_actual, km_intervalo_servicio, km_ultimo_servicio,
            en_taller, estado
     FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
    [guard.empresa.id],
  );

  const costosPorMes = await query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(fecha_servicio, '%Y-%m') AS mes,
            SUM(costo) AS total, COUNT(*) AS n
     FROM flota_servicios
     WHERE empresa_id = ?
       AND fecha_servicio BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(fecha_servicio, '%Y-%m')
     ORDER BY mes ASC`,
    [guard.empresa.id, fechaDesde, fechaHasta],
  );

  const costosPorUnidad = await query<RowDataPacket[]>(
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
  );

  const totalRow = await query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(costo), 0) AS total, COUNT(*) AS n
     FROM flota_servicios
     WHERE empresa_id = ?
       AND fecha_servicio BETWEEN ? AND ?`,
    [guard.empresa.id, fechaDesde, fechaHasta],
  );

  const alertas = vehiculos.filter((v) => {
    if (v.en_taller) return false;
    const km = Number(v.km_actual ?? 0);
    const intervalo = Number(v.km_intervalo_servicio ?? 10000);
    const ultimo = Number(v.km_ultimo_servicio ?? 0);
    return km - ultimo >= intervalo;
  });

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
  });
}
