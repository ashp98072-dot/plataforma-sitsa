import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { toIsoDate } from "@/lib/rrhh/dates";

export type ViajeAbiertoPiloto = {
  id: number;
  placa: string;
  kmSalida: number;
  horaSalida: string;
  destino: string | null;
  planId: number | null;
};

export type AsignacionOperativaPortal = {
  planId: number;
  codigo: string;
  fecha: string;
  horaSalida: string | null;
  regresoEstimado: string | null;
  estado: string;
  cliente: string | null;
  origen: string | null;
  destino: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliares: string[];
  viajeId: number | null;
  viajeEstado: string | null;
  kmSalida: number | null;
};

/** Planes donde el colaborador participa como piloto o auxiliar. */
export async function listarAsignacionesOperativasEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<AsignacionOperativaPortal[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT p.id, p.codigo, p.fecha_plan, p.hora_carga,
            p.regreso_estimado, p.estado, c.nombre AS cliente,
            lc.nombre AS origen, ld.nombre AS destino, u.placa,
            pil.nombre AS piloto, fv.id AS viaje_id,
            fv.estado AS viaje_estado, fv.km_salida
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id
     LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id
     LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_plan_auxiliares pa ON pa.plan_id = p.id
     LEFT JOIN tms_personal aux ON aux.id = pa.personal_id
     LEFT JOIN tms_personal aux_legacy ON aux_legacy.id = p.auxiliar_id
     LEFT JOIN flota_viajes fv ON fv.plan_id = p.id AND fv.empresa_id = p.empresa_id
     WHERE p.empresa_id = ?
       AND (pil.id_empleado = ? OR aux.id_empleado = ? OR aux_legacy.id_empleado = ?)
       AND (p.fecha_plan >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            OR fv.estado = 'abierto')
     ORDER BY (fv.estado = 'abierto') DESC, p.fecha_plan ASC, p.hora_carga ASC
     LIMIT 40`,
    [empresaId, empleadoId, empleadoId, empleadoId],
  ).catch(() => [] as RowDataPacket[]);

  const ids = rows.map((r) => Number(r.id));
  const auxMap = new Map<number, string[]>();
  if (ids.length) {
    const auxRows = await query<RowDataPacket[]>(
      `SELECT a.plan_id, per.nombre FROM tms_plan_auxiliares a
       INNER JOIN tms_personal per ON per.id = a.personal_id
       WHERE a.plan_id IN (${ids.map(() => "?").join(",")})
       ORDER BY a.plan_id, a.orden`,
      ids,
    ).catch(() => [] as RowDataPacket[]);
    for (const r of auxRows) {
      const list = auxMap.get(Number(r.plan_id)) ?? [];
      list.push(String(r.nombre));
      auxMap.set(Number(r.plan_id), list);
    }
  }
  return rows.map((r) => ({
    planId: Number(r.id),
    codigo: String(r.codigo),
    fecha: toIsoDate(r.fecha_plan as string | Date | null) ?? "",
    horaSalida: r.hora_carga ? String(r.hora_carga).slice(0, 8) : null,
    regresoEstimado: r.regreso_estimado ? String(r.regreso_estimado) : null,
    estado: String(r.estado),
    cliente: r.cliente ? String(r.cliente) : null,
    origen: r.origen ? String(r.origen) : null,
    destino: r.destino ? String(r.destino) : null,
    placa: r.placa ? String(r.placa) : null,
    piloto: r.piloto ? String(r.piloto) : null,
    auxiliares: auxMap.get(Number(r.id)) ?? [],
    viajeId: r.viaje_id != null ? Number(r.viaje_id) : null,
    viajeEstado: r.viaje_estado ? String(r.viaje_estado) : null,
    kmSalida: r.km_salida != null ? Number(r.km_salida) : null,
  }));
}

/** Autoriza al piloto o a cualquier auxiliar asignado al plan del viaje. */
export async function colaboradorParticipaEnViaje(
  empresaId: number,
  empleadoId: number,
  viajeId: number,
): Promise<{ viajeId: number; planId: number | null; estado: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT fv.id, fv.plan_id, fv.estado
     FROM flota_viajes fv
     LEFT JOIN tms_planes_viaje p ON p.id = fv.plan_id AND p.empresa_id = fv.empresa_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_plan_auxiliares pa ON pa.plan_id = p.id
     LEFT JOIN tms_personal aux ON aux.id = pa.personal_id
     LEFT JOIN tms_personal aux_legacy ON aux_legacy.id = p.auxiliar_id
     WHERE fv.id = ? AND fv.empresa_id = ?
       AND (fv.empleado_id = ? OR pil.id_empleado = ?
            OR aux.id_empleado = ? OR aux_legacy.id_empleado = ?)
     LIMIT 1`,
    [viajeId, empresaId, empleadoId, empleadoId, empleadoId, empleadoId],
  ).catch(() => [] as RowDataPacket[]);
  return rows[0]
    ? {
        viajeId: Number(rows[0].id),
        planId: rows[0].plan_id != null ? Number(rows[0].plan_id) : null,
        estado: String(rows[0].estado),
      }
    : null;
}

/** El viaje abierto del propio piloto, si tiene uno (portal). */
export async function obtenerViajeAbiertoDeEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<ViajeAbiertoPiloto | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT v.id, v.km_salida, v.hora_salida, v.destino, v.plan_id, ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.empresa_id = ? AND v.empleado_id = ? AND v.estado = 'abierto'
     LIMIT 1`,
    [empresaId, empleadoId],
  ).catch(() => [] as RowDataPacket[]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    placa: String(r.placa),
    kmSalida: Number(r.km_salida),
    horaSalida: String(r.hora_salida),
    destino: r.destino ? String(r.destino) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
  };
}
