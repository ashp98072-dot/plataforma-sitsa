import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export type FiltroVehiculo = {
  id?: number;
  tipo: string;
  codigo: string;
  notas?: string | null;
};

/** Tipos sugeridos (el usuario puede escribir otros). */
export const TIPOS_FILTRO_SUGERIDOS = [
  "Aceite",
  "Aire",
  "Combustible",
  "Habitáculo",
  "Hidráulico",
  "Separador de agua",
] as const;

export async function listarFiltrosVehiculo(
  vehiculoId: number,
): Promise<FiltroVehiculo[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, tipo, codigo, notas
       FROM flota_vehiculo_filtros
       WHERE vehiculo_id = ?
       ORDER BY tipo, id`,
      [vehiculoId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      tipo: String(r.tipo ?? ""),
      codigo: String(r.codigo ?? ""),
      notas: r.notas != null ? String(r.notas) : null,
    }));
  } catch {
    return [];
  }
}

export async function listarFiltrosPorVehiculos(
  vehiculoIds: number[],
): Promise<Map<number, FiltroVehiculo[]>> {
  const map = new Map<number, FiltroVehiculo[]>();
  if (!vehiculoIds.length) return map;
  try {
    const placeholders = vehiculoIds.map(() => "?").join(",");
    const rows = await query<RowDataPacket[]>(
      `SELECT id, vehiculo_id, tipo, codigo, notas
       FROM flota_vehiculo_filtros
       WHERE vehiculo_id IN (${placeholders})
       ORDER BY tipo, id`,
      vehiculoIds,
    );
    for (const r of rows) {
      const vid = Number(r.vehiculo_id);
      const list = map.get(vid) ?? [];
      list.push({
        id: Number(r.id),
        tipo: String(r.tipo ?? ""),
        codigo: String(r.codigo ?? ""),
        notas: r.notas != null ? String(r.notas) : null,
      });
      map.set(vid, list);
    }
  } catch {
    /* tabla aún no existe */
  }
  return map;
}

export async function guardarFiltrosVehiculo(
  empresaId: number,
  vehiculoId: number,
  filtros: FiltroVehiculo[],
): Promise<void> {
  await execute(
    "DELETE FROM flota_vehiculo_filtros WHERE vehiculo_id = ? AND empresa_id = ?",
    [vehiculoId, empresaId],
  );
  const vistos = new Set<string>();
  for (const f of filtros) {
    const tipo = String(f.tipo ?? "").trim();
    const codigo = String(f.codigo ?? "").trim();
    if (!tipo || !codigo) continue;
    const key = `${tipo.toLowerCase()}|${codigo.toLowerCase()}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    await execute(
      `INSERT INTO flota_vehiculo_filtros
        (empresa_id, vehiculo_id, tipo, codigo, notas)
       VALUES (?, ?, ?, ?, ?)`,
      [
        empresaId,
        vehiculoId,
        tipo.slice(0, 80),
        codigo.slice(0, 120),
        f.notas?.trim() ? f.notas.trim().slice(0, 300) : null,
      ],
    );
  }
}

/** Migra valores viejos mayor/menor a filas de filtros (una sola vez por vehículo). */
export async function migrarFiltrosLegacySiVacio(
  empresaId: number,
  vehiculoId: number,
  mayor: string | null | undefined,
  menor: string | null | undefined,
): Promise<FiltroVehiculo[]> {
  const actuales = await listarFiltrosVehiculo(vehiculoId);
  if (actuales.length) return actuales;
  const legacy: FiltroVehiculo[] = [];
  if (mayor?.trim()) {
    legacy.push({ tipo: "Servicio mayor", codigo: mayor.trim() });
  }
  if (menor?.trim()) {
    legacy.push({ tipo: "Servicio menor", codigo: menor.trim() });
  }
  if (legacy.length) {
    await guardarFiltrosVehiculo(empresaId, vehiculoId, legacy);
    return legacy;
  }
  return [];
}

export function formatearFiltrosCorto(filtros: FiltroVehiculo[]): string {
  if (!filtros.length) return "—";
  return filtros.map((f) => `${f.tipo}: ${f.codigo}`).join(" · ");
}
