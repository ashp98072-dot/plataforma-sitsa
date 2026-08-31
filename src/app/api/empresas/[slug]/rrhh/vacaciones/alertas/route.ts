import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { sincronizarVacacionesEmpleadosActivos } from "@/lib/rrhh/vacaciones";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;

  const empresaId = guard.empresa.id;
  await sincronizarVacacionesEmpleadosActivos(empresaId);
  const [solicitudes, saldos] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT sv.id, sv.id_empleado, sv.tipo, sv.fecha_inicio, sv.fecha_fin,
              sv.dias_habiles, sv.creado_en, e.codigo, e.nombre, e.dpi
       FROM solicitudes_vacaciones sv
       INNER JOIN empleados e
         ON e.id = sv.id_empleado AND e.empresa_id = sv.empresa_id
       WHERE sv.empresa_id = ? AND sv.estado = 'Pendiente'
       ORDER BY sv.creado_en ASC, e.nombre ASC`,
      [empresaId],
    ).catch(() => [] as RowDataPacket[]),
    query<RowDataPacket[]>(
      `SELECT e.id, e.codigo, e.nombre, e.dpi, DATE_FORMAT(e.fecha_alta, '%Y-%m-%d') AS fecha_contratacion,
              ROUND(SUM(s.dias_disponibles), 2) AS dias_disponibles
       FROM saldos_vacaciones s
       INNER JOIN empleados e
         ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
       WHERE s.empresa_id = ? AND s.estado = 'Vigente'
         AND e.estado = 'Activo' AND s.dias_disponibles > 0
       GROUP BY e.id, e.codigo, e.nombre, e.dpi, e.fecha_alta
       HAVING SUM(s.dias_disponibles) >= 15
       ORDER BY dias_disponibles DESC, e.nombre ASC`,
      [empresaId],
    ).catch(() => [] as RowDataPacket[]),
  ]);

  return NextResponse.json({
    solicitudesPendientes: solicitudes.map((r) => ({
      id: Number(r.id),
      empleadoId: Number(r.id_empleado),
      codigo: String(r.codigo ?? ""),
      nombre: String(r.nombre ?? ""),
      dpi: r.dpi ? String(r.dpi) : null,
      tipo: String(r.tipo ?? "Vacaciones"),
      fechaInicio: String(r.fecha_inicio).slice(0, 10),
      fechaFin: String(r.fecha_fin).slice(0, 10),
      diasHabiles: Number(r.dias_habiles),
      creadoEn: r.creado_en ? String(r.creado_en) : null,
    })),
    colaboradoresConQuinceDias: saldos.map((r) => ({
      empleadoId: Number(r.id),
      codigo: String(r.codigo ?? ""),
      nombre: String(r.nombre ?? ""),
      dpi: r.dpi ? String(r.dpi) : null,
      diasDisponibles: Number(r.dias_disponibles),
      fechaContratacion: r.fecha_contratacion ? String(r.fecha_contratacion) : null,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
