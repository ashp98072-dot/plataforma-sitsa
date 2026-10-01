import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query } from "@/lib/db";
import { cuadrillaSchema, type CuadrillaInput, type IntegranteCuadrilla } from "./cuadrilla-contrato";

export class CuadrillaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function cuadrillaDePlanes(empresaId: number, planIds: number[], conn?: PoolConnection): Promise<Map<number, IntegranteCuadrilla[]>> {
  const ids = [...new Set(planIds)];
  const mapa = new Map<number, IntegranteCuadrilla[]>();
  if (!ids.length) return mapa;
  const sql = `SELECT c.plan_id, c.tipo, c.id_empleado, c.nombre, c.identificacion, c.telefono
    FROM tms_plan_cuadrilla c INNER JOIN tms_planes_viaje p ON p.id = c.plan_id AND p.empresa_id = c.empresa_id
    WHERE c.empresa_id = ? AND c.plan_id IN (${ids.map(() => "?").join(",")}) ORDER BY c.plan_id, c.orden, c.id`;
  const rows = conn ? (await conn.query<RowDataPacket[]>(`${sql} FOR UPDATE`, [empresaId, ...ids]))[0]
    : await query<RowDataPacket[]>(sql, [empresaId, ...ids]);
  for (const r of rows) {
    const id = Number(r.plan_id);
    mapa.set(id, [...(mapa.get(id) ?? []), {
      tipo: r.tipo === "INTERNO" ? "INTERNO" : "EXTERNO", empleadoId: r.id_empleado == null ? null : Number(r.id_empleado),
      nombre: String(r.nombre), identificacion: r.identificacion == null ? null : String(r.identificacion),
      telefono: r.telefono == null ? null : String(r.telefono),
    }]);
  }
  return mapa;
}

/** No crea personal operativo ni empleados: el snapshot interno proviene exclusivamente de RRHH. */
export async function resolverCuadrilla(empresaId: number, entrada: CuadrillaInput[], conn: PoolConnection, anteriores: IntegranteCuadrilla[] = []): Promise<IntegranteCuadrilla[]> {
  const filas = cuadrillaSchema.parse(entrada);
  const ids = filas.flatMap((f) => f.tipo === "INTERNO" ? [f.empleadoId] : []);
  const rows = ids.length ? (await conn.query<RowDataPacket[]>(
    `SELECT id, nombre, estado FROM empleados WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`,
    [empresaId, ...ids],
  ))[0] : [];
  return filas.map((f) => {
    if (f.tipo === "EXTERNO") return { tipo: f.tipo, empleadoId: null, nombre: f.nombre, identificacion: f.identificacion || null, telefono: f.telefono || null };
    const empleado = rows.find((r) => Number(r.id) === f.empleadoId);
    const anterior = anteriores.find((a) => a.empleadoId === f.empleadoId);
    if (!empleado || (!anterior && empleado.estado !== "Activo")) throw new CuadrillaError("El integrante interno no está activo o no pertenece a esta empresa.");
    return anterior ?? { tipo: f.tipo, empleadoId: f.empleadoId, nombre: String(empleado.nombre), identificacion: null, telefono: null };
  });
}

export async function validarCuadrillaRoles(empresaId: number, cuadrilla: IntegranteCuadrilla[], personalIds: number[], conn: PoolConnection): Promise<void> {
  const ids = cuadrilla.flatMap((c) => c.empleadoId == null ? [] : [c.empleadoId]);
  if (!ids.length || !personalIds.length) return;
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id_empleado FROM tms_personal WHERE empresa_id = ? AND id IN (${personalIds.map(() => "?").join(",")}) FOR UPDATE`,
    [empresaId, ...personalIds],
  );
  if (rows.some((r) => r.id_empleado != null && ids.includes(Number(r.id_empleado)))) throw new CuadrillaError("Un integrante de cuadrilla no puede ser también piloto o auxiliar del mismo viaje.");
}

export async function guardarCuadrillaPlan(empresaId: number, planId: number, filas: IntegranteCuadrilla[], conn: PoolConnection): Promise<void> {
  const [padres] = await conn.query<RowDataPacket[]>("SELECT id FROM tms_planes_viaje WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, planId]);
  if (!padres.length) throw new Error("Plan no encontrado en esta empresa.");
  await conn.execute("DELETE FROM tms_plan_cuadrilla WHERE empresa_id = ? AND plan_id = ?", [empresaId, planId]);
  for (const [i, f] of filas.entries()) await conn.execute(
    `INSERT INTO tms_plan_cuadrilla (empresa_id, plan_id, orden, tipo, id_empleado, nombre, identificacion, telefono) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, planId, i + 1, f.tipo, f.empleadoId, f.nombre, f.identificacion, f.telefono],
  );
}
