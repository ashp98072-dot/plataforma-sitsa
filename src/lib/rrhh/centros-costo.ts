import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export type CentroCosto = {
  id: number;
  empresaId: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  creadoEn: string;
};

function mapCentroCosto(r: RowDataPacket): CentroCosto {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    activo: Boolean(r.activo),
    creadoEn: String(r.creado_en),
  };
}

/** Lista los centros de costo de una empresa. Por defecto solo los activos. */
export async function listarCentrosCosto(
  empresaId: number,
  opts?: { incluirInactivos?: boolean },
): Promise<CentroCosto[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, codigo, nombre, activo, creado_en
     FROM centros_costo
     WHERE empresa_id = ? ${opts?.incluirInactivos ? "" : "AND activo = 1"}
     ORDER BY nombre`,
    [empresaId],
  );
  return rows.map(mapCentroCosto);
}

export async function obtenerCentroCosto(
  empresaId: number,
  id: number,
): Promise<CentroCosto | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empresa_id, codigo, nombre, activo, creado_en
     FROM centros_costo
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapCentroCosto(rows[0]) : null;
}

export async function crearCentroCosto(input: {
  empresaId: number;
  codigo: string;
  nombre: string;
}): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  const codigo = input.codigo.trim();
  const nombre = input.nombre.trim();
  if (!codigo || !nombre) {
    return { ok: false, mensaje: "Código y nombre son obligatorios." };
  }
  const existente = await query<RowDataPacket[]>(
    `SELECT id FROM centros_costo WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
    [input.empresaId, codigo],
  );
  if (existente[0]) {
    return { ok: false, mensaje: "Ya existe un centro de costo con ese código." };
  }
  const result = await execute(
    `INSERT INTO centros_costo (empresa_id, codigo, nombre) VALUES (?, ?, ?)`,
    [input.empresaId, codigo, nombre],
  );
  return {
    ok: true,
    mensaje: "Centro de costo creado.",
    id: Number((result as ResultSetHeader).insertId),
  };
}

export async function actualizarCentroCosto(
  empresaId: number,
  id: number,
  patch: { codigo?: string; nombre?: string; activo?: boolean },
): Promise<{ ok: boolean; mensaje: string }> {
  const actual = await obtenerCentroCosto(empresaId, id);
  if (!actual) return { ok: false, mensaje: "Centro de costo no encontrado." };

  const codigo = patch.codigo !== undefined ? patch.codigo.trim() : actual.codigo;
  const nombre = patch.nombre !== undefined ? patch.nombre.trim() : actual.nombre;
  const activo = patch.activo !== undefined ? patch.activo : actual.activo;
  if (!codigo || !nombre) {
    return { ok: false, mensaje: "Código y nombre son obligatorios." };
  }

  if (codigo !== actual.codigo) {
    const dup = await query<RowDataPacket[]>(
      `SELECT id FROM centros_costo WHERE empresa_id = ? AND codigo = ? AND id != ? LIMIT 1`,
      [empresaId, codigo, id],
    );
    if (dup[0]) {
      return { ok: false, mensaje: "Ya existe otro centro de costo con ese código." };
    }
  }

  await execute(
    `UPDATE centros_costo SET codigo = ?, nombre = ?, activo = ? WHERE id = ? AND empresa_id = ?`,
    [codigo, nombre, activo ? 1 : 0, id, empresaId],
  );
  return { ok: true, mensaje: "Centro de costo actualizado." };
}

/**
 * "Elimina" desactivando en vez de borrar la fila: si el centro de costo ya
 * tiene empleados asignados (empleados.centro_costo_id), borrarlo de verdad
 * dejaría ese campo en NULL de golpe (por el ON DELETE SET NULL) sin aviso.
 * Desactivarlo es más seguro y reversible.
 */
export async function desactivarCentroCosto(
  empresaId: number,
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const actual = await obtenerCentroCosto(empresaId, id);
  if (!actual) return { ok: false, mensaje: "Centro de costo no encontrado." };
  await execute(
    `UPDATE centros_costo SET activo = 0 WHERE id = ? AND empresa_id = ?`,
    [id, empresaId],
  );
  return { ok: true, mensaje: "Centro de costo desactivado." };
}

/** Cuenta cuántos empleados activos tiene asignados cada centro de costo. */
export async function contarEmpleadosPorCentroCosto(
  empresaId: number,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const rows = await query<RowDataPacket[]>(
    `SELECT centro_costo_id, COUNT(*) AS total
     FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo' AND centro_costo_id IS NOT NULL
     GROUP BY centro_costo_id`,
    [empresaId],
  );
  for (const r of rows) {
    map.set(Number(r.centro_costo_id), Number(r.total));
  }
  return map;
}
