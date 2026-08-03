import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "flota");
  if (guard.error) return guard.error;

  const vehiculos = await query<RowDataPacket[]>(
    `SELECT id, placa, marca, modelo, km_actual, km_intervalo_servicio, km_ultimo_servicio,
            en_taller, estado
     FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
    [guard.empresa.id],
  );

  const costos = await query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(fecha_servicio, '%Y-%m') AS mes, SUM(costo) AS total, COUNT(*) AS n
     FROM flota_servicios
     WHERE empresa_id = ?
     GROUP BY DATE_FORMAT(fecha_servicio, '%Y-%m')
     ORDER BY mes DESC
     LIMIT 12`,
    [guard.empresa.id],
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
    costosPorMes: costos,
  });
}
