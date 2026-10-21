import type { RowDataPacket } from "mysql2";
import { query, execute } from "@/lib/db";

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — capa de ELEGIBILIDAD operativa, separada tanto de
 * `empleados.categoria_ops`/`puesto` (puesto/categoría contractual de RRHH — nunca se toca desde aquí) como
 * de `tms_personal` (catálogo operativo que se sigue creando/resolviendo igual al asignar un viaje, vía
 * `personalDesdeEmpleado()` en personal-resolucion.ts — esta tabla NUNCA escribe en `tms_personal`).
 *
 * Una habilitación es (empresa_id, empleado_id, rol) -> estado, con `activo` para desactivar sin borrar
 * historial (UNIQUE KEY real sobre esos tres campos — ver sql/migrate-2026-10-tms-personal-habilitaciones.sql).
 * `estado` solo decide un BADGE visual ("En capacitación") en los selectores — nunca bloquea selección ni
 * cambia disponibilidad (que sigue cruzando por `id_empleado` en disponibilidad-traslapes.ts, sin cambios).
 */
export const ROLES_HABILITACION = ["PILOTO", "AUXILIAR"] as const;
export type RolHabilitacion = (typeof ROLES_HABILITACION)[number];

export const ESTADOS_HABILITACION = ["HABILITADO", "CAPACITACION"] as const;
export type EstadoHabilitacion = (typeof ESTADOS_HABILITACION)[number];

export type HabilitacionOperativa = {
  id: number;
  empleadoId: number;
  rol: RolHabilitacion;
  estado: EstadoHabilitacion;
  activo: boolean;
};

export class HabilitacionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function mapRow(r: RowDataPacket): HabilitacionOperativa {
  return {
    id: Number(r.id),
    empleadoId: Number(r.empleado_id),
    rol: r.rol as RolHabilitacion,
    estado: r.estado as EstadoHabilitacion,
    activo: Number(r.activo) === 1,
  };
}

/** Todas las habilitaciones (activas e inactivas) de la empresa — la pantalla de administración decide qué mostrar/ocultar. */
export async function listarHabilitacionesEmpresa(empresaId: number): Promise<HabilitacionOperativa[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empleado_id, rol, estado, activo FROM tms_personal_habilitaciones WHERE empresa_id = ? ORDER BY empleado_id, rol`,
    [empresaId],
  );
  return rows.map(mapRow);
}

/**
 * Solo las ACTIVAS, acotadas a un conjunto de empleados — lo que consume personal-ops/route.ts para armar
 * `habilitacionesOps` por empleado (aditivo, no reemplaza ningún campo existente de ese endpoint).
 */
export async function listarHabilitacionesActivasDe(
  empresaId: number,
  empleadoIds: number[],
): Promise<Map<number, { rol: RolHabilitacion; estado: EstadoHabilitacion }[]>> {
  const mapa = new Map<number, { rol: RolHabilitacion; estado: EstadoHabilitacion }[]>();
  const ids = [...new Set(empleadoIds)];
  if (!ids.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT empleado_id, rol, estado FROM tms_personal_habilitaciones
     WHERE empresa_id = ? AND activo = 1 AND empleado_id IN (${ids.map(() => "?").join(",")})`,
    [empresaId, ...ids],
  );
  for (const r of rows) {
    const eid = Number(r.empleado_id);
    mapa.set(eid, [...(mapa.get(eid) ?? []), { rol: r.rol as RolHabilitacion, estado: r.estado as EstadoHabilitacion }]);
  }
  return mapa;
}

/**
 * Crea, activa o cambia de estado una habilitación — UPSERT sobre la UNIQUE KEY real
 * (empresa_id, empleado_id, rol). `estado=null` la DESACTIVA (`activo=0`) sin borrar historial — esta
 * función nunca ejecuta DELETE. Valida que el empleado exista y esté Activo en ESA empresa antes de
 * escribir (nunca confía en un empleadoId que pueda pertenecer a otra empresa).
 *
 * NO crea ni toca `tms_personal` — por diseño (regla 7 del ticket): la habilitación solo determina si el
 * empleado puede aparecer/seleccionarse; `tms_personal` se sigue creando exclusivamente cuando el empleado
 * finalmente se asigna a un viaje real, vía personalDesdeEmpleado().
 */
export async function fijarHabilitacion(
  empresaId: number,
  empleadoId: number,
  rol: RolHabilitacion,
  estado: EstadoHabilitacion | null,
): Promise<void> {
  const emp = await query<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE empresa_id = ? AND id = ? AND estado = 'Activo' LIMIT 1`,
    [empresaId, empleadoId],
  );
  if (!emp.length) throw new HabilitacionError("El empleado no existe o no está activo en esta empresa.", 404);

  if (estado == null) {
    await execute(
      `UPDATE tms_personal_habilitaciones SET activo = 0 WHERE empresa_id = ? AND empleado_id = ? AND rol = ?`,
      [empresaId, empleadoId, rol],
    );
    return;
  }

  await execute(
    `INSERT INTO tms_personal_habilitaciones (empresa_id, empleado_id, rol, estado, activo)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE estado = VALUES(estado), activo = 1`,
    [empresaId, empleadoId, rol, estado],
  );
}
