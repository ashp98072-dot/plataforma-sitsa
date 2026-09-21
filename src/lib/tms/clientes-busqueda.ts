import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * COTIZACIONES — buscador de clientes TMS (búsqueda remota).
 *
 * El `id` devuelto es SIEMPRE `tms_clientes.id` (el que consumen cotizaciones,
 * rutas y programación), nunca `clientes.id`. `codigo` solo existe en el
 * maestro compartido `clientes`; se resuelve por el vínculo explícito
 * `clientes.tms_cliente_id` (UNIQUE por empresa_id + tms_cliente_id, así el
 * LEFT JOIN devuelve como máximo una fila por cliente TMS) y nunca por
 * coincidencia de nombre/NIT. Sin vínculo, `codigo` queda null.
 *
 * Ambas tablas se filtran por `empresa_id` (también en el JOIN). Mismo criterio
 * de precedencia que GET /tms/catalogos: si hay vínculo se prefieren los datos
 * del maestro compartido.
 */
export const LIMITE_BUSQUEDA_CLIENTES = 20;
const MAX_LARGO_Q = 100;

export type ClienteTmsBusqueda = {
  id: number;
  nombre: string;
  codigo: string | null;
  nit: string | null;
  telefono: string | null;
  estado: string;
};

/** Escapa los comodines de LIKE para que `q` se busque como texto literal. */
export function patronLike(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Normaliza el texto de búsqueda: recorta y limita el largo. */
export function normalizarBusquedaCliente(q: string | null | undefined): string {
  return String(q ?? "").trim().slice(0, MAX_LARGO_Q);
}

const SELECT_VINCULADO = `SELECT t.id AS id,
       COALESCE(c.nombre, t.nombre) AS nombre,
       c.codigo AS codigo,
       COALESCE(c.nit, t.nit) AS nit,
       COALESCE(c.telefono, t.telefono) AS telefono,
       COALESCE(c.estado, t.estado) AS estado
  FROM tms_clientes t
  LEFT JOIN clientes c ON c.tms_cliente_id = t.id AND c.empresa_id = t.empresa_id
 WHERE t.empresa_id = ?
   AND COALESCE(c.estado, t.estado) = 'Activo'`;

const SELECT_SOLO_TMS = `SELECT t.id AS id, t.nombre AS nombre, NULL AS codigo, t.nit AS nit,
       t.telefono AS telefono, t.estado AS estado
  FROM tms_clientes t
 WHERE t.empresa_id = ?
   AND t.estado = 'Activo'`;

function mapear(r: RowDataPacket): ClienteTmsBusqueda {
  return {
    id: Number(r.id),
    nombre: String(r.nombre),
    codigo: r.codigo != null && String(r.codigo) !== "" ? String(r.codigo) : null,
    nit: r.nit != null && String(r.nit) !== "" ? String(r.nit) : null,
    telefono: r.telefono != null && String(r.telefono) !== "" ? String(r.telefono) : null,
    estado: String(r.estado ?? "Activo"),
  };
}

/**
 * Clientes TMS ACTIVOS de la empresa que coinciden por nombre, código, NIT o
 * teléfono. Sin `q` devuelve los primeros por nombre (para mostrar opciones al
 * enfocar el campo). Nunca más de LIMITE_BUSQUEDA_CLIENTES filas.
 */
export async function buscarClientesTms(
  empresaId: number,
  qRaw: string | null | undefined,
): Promise<ClienteTmsBusqueda[]> {
  const q = normalizarBusquedaCliente(qRaw);
  const limite = LIMITE_BUSQUEDA_CLIENTES;

  const armar = (base: string, campos: string[]) => {
    const params: (string | number)[] = [empresaId];
    let sql = base;
    if (q) {
      const like = patronLike(q);
      sql += `\n   AND (${campos.map((c) => `${c} LIKE ?`).join(" OR ")})`;
      for (let i = 0; i < campos.length; i++) params.push(like);
    }
    sql += `\n ORDER BY nombre ASC, t.id ASC\n LIMIT ${limite}`;
    return { sql, params };
  };

  try {
    const v = armar(SELECT_VINCULADO, [
      "COALESCE(c.nombre, t.nombre)",
      "c.codigo",
      "COALESCE(c.nit, t.nit)",
      "COALESCE(c.telefono, t.telefono)",
    ]);
    return (await query<RowDataPacket[]>(v.sql, v.params)).map(mapear);
  } catch {
    // La tabla `clientes` puede no existir aún en instalaciones incrementales:
    // TMS sigue funcionando solo con tms_clientes (sin código).
    const s = armar(SELECT_SOLO_TMS, ["t.nombre", "t.nit", "t.telefono"]);
    return (await query<RowDataPacket[]>(s.sql, s.params)).map(mapear);
  }
}
