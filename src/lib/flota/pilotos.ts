import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

export function normalizarNombrePiloto(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function buscarEmpleadoPorNombre(
  empresaId: number,
  nombre: string,
): Promise<{ id: number; codigo: string; nombre: string; estado: string } | null> {
  const norm = normalizarNombrePiloto(nombre);
  if (norm.length < 2) return null;

  // Coincidencia exacta (sin acentos) o LIKE por partes
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, estado FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'
     ORDER BY nombre
     LIMIT 500`,
    [empresaId],
  );

  const exacto = rows.find(
    (r) => normalizarNombrePiloto(String(r.nombre)) === norm,
  );
  if (exacto) {
    return {
      id: Number(exacto.id),
      codigo: String(exacto.codigo),
      nombre: String(exacto.nombre),
      estado: String(exacto.estado),
    };
  }

  // Si escribió "Juan Perez" y en RRHH está "Juan Carlos Perez"
  const tokens = norm.split(" ").filter((t) => t.length > 1);
  if (tokens.length >= 2) {
    const parcial = rows.find((r) => {
      const n = normalizarNombrePiloto(String(r.nombre));
      return tokens.every((t) => n.includes(t));
    });
    if (parcial) {
      return {
        id: Number(parcial.id),
        codigo: String(parcial.codigo),
        nombre: String(parcial.nombre),
        estado: String(parcial.estado),
      };
    }
  }

  return null;
}

export async function vehiculoPorPlaca(
  empresaId: number,
  placaRaw: string,
): Promise<RowDataPacket | null> {
  const placa = placaRaw.trim().toUpperCase().replace(/\s+/g, "-");
  const placaAlt = placaRaw.trim().toUpperCase().replace(/[\s-]+/g, "");
  const matchPlaca = `(
    UPPER(REPLACE(v.placa,' ','')) = ?
    OR UPPER(v.placa) = ?
    OR UPPER(REPLACE(v.placa,'-','')) = ?
  )`;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT v.id, v.placa, v.en_taller, v.km_actual, v.activo, v.estado, v.empresa_id
       FROM flota_vehiculos v
       WHERE ${matchPlaca}
         AND (
           v.empresa_id = ?
           OR EXISTS (
             SELECT 1 FROM flota_vehiculo_acceso a
             WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
           )
         )
       LIMIT 1`,
      [placaAlt, placa, placaAlt, empresaId, empresaId],
    );
    return rows[0] ?? null;
  } catch {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, placa, en_taller, km_actual, activo, estado, empresa_id
       FROM flota_vehiculos
       WHERE empresa_id = ?
         AND (
           UPPER(REPLACE(placa,' ','')) = ?
           OR UPPER(placa) = ?
           OR UPPER(REPLACE(placa,'-','')) = ?
         )
       LIMIT 1`,
      [empresaId, placaAlt, placa, placaAlt],
    );
    return rows[0] ?? null;
  }
}
