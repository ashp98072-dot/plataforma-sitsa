import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

/**
 * VIAT-1 — ubicaciones/paradas guardadas por cliente (punto 3). Reutiliza
 * tms_clientes como identidad de cliente (misma tabla que ya usa
 * tms_planes_viaje.cliente_id) — no duplica el maestro de clientes.
 *
 * Esquema: NO se crea/altera desde este módulo (mismo criterio que
 * src/lib/tms/viaticos.ts) — asume que
 * sql/migrate-2026-08-viat-1-cliente-ubicaciones.sql ya se aplicó
 * manualmente. Si la tabla no existe, las funciones fallan con el error
 * real de MySQL.
 */

export type TipoUbicacion = "CARGA" | "ENTREGA" | "AMBOS";

export type UbicacionCliente = {
  id: number;
  clienteId: number;
  nombre: string;
  direccion: string | null;
  municipio: string | null;
  departamento: string | null;
  referencia: string | null;
  tipo: TipoUbicacion;
  activo: boolean;
};

function mapRow(r: RowDataPacket): UbicacionCliente {
  const tipo = String(r.tipo ?? "AMBOS");
  return {
    id: Number(r.id),
    clienteId: Number(r.cliente_id),
    nombre: String(r.nombre),
    direccion: r.direccion != null ? String(r.direccion) : null,
    municipio: r.municipio != null ? String(r.municipio) : null,
    departamento: r.departamento != null ? String(r.departamento) : null,
    referencia: r.referencia != null ? String(r.referencia) : null,
    tipo: (["CARGA", "ENTREGA", "AMBOS"].includes(tipo) ? tipo : "AMBOS") as TipoUbicacion,
    activo: Number(r.activo ?? 1) === 1,
  };
}

const SELECT =
  "SELECT id, cliente_id, nombre, direccion, municipio, departamento, referencia, tipo, activo FROM tms_cliente_ubicaciones";

/** Ubicaciones activas de un cliente, para el selector de paradas en Programación. */
export async function listarUbicacionesCliente(
  empresaId: number,
  clienteId: number,
): Promise<UbicacionCliente[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND cliente_id = ? AND activo = 1 ORDER BY nombre`,
    [empresaId, clienteId],
  );
  return rows.map(mapRow);
}

export type UbicacionClienteInput = {
  nombre: string;
  direccion?: string | null;
  municipio?: string | null;
  departamento?: string | null;
  referencia?: string | null;
  tipo?: TipoUbicacion;
};

/**
 * Alta rápida desde Programación al armar las paradas de un viaje — mismo
 * espíritu que "+ Cliente rápido" ya existente en TMS, para no obligar a
 * salir del flujo de creación del viaje.
 */
export async function crearUbicacionCliente(
  empresaId: number,
  clienteId: number,
  input: UbicacionClienteInput,
): Promise<UbicacionCliente> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("Nombre/alias de la ubicación requerido.");
  const r = await execute(
    `INSERT INTO tms_cliente_ubicaciones
      (empresa_id, cliente_id, nombre, direccion, municipio, departamento, referencia, tipo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      clienteId,
      nombre,
      input.direccion?.trim() || null,
      input.municipio?.trim() || null,
      input.departamento?.trim() || null,
      input.referencia?.trim() || null,
      input.tipo ?? "AMBOS",
    ],
  );
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? LIMIT 1`, [Number(r.insertId)]);
  return mapRow(rows[0]);
}
