import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { DEFINICIONES_ENTREGA, type ModuloEntrega } from "./catalogo";

/**
 * Adaptadores por módulo: leen y BLOQUEAN (FOR UPDATE) la fila del documento SIEMPRE filtrando por empresa_id. Solo leen;
 * nunca modifican el documento (las entregas no cambian su estado). En PR 1 no hay ningún módulo conectado: estos adaptadores
 * solo los usa la librería común.
 */

export type DocumentoEntrega = {
  id: number;
  codigo: string | null;
  estado: string | null;
  /** El documento admite registrar una NUEVA entrega en su estado actual. */
  admiteEntrega: boolean;
};

type Adaptador = { sql: string; admite: (fila: RowDataPacket) => boolean };

const enEstados = (modulo: ModuloEntrega, estado: unknown) =>
  typeof estado === "string" && DEFINICIONES_ENTREGA[modulo].estadosDocumento.includes(estado);

const ADAPTADORES: Record<ModuloEntrega, Adaptador> = {
  FONDOS: {
    sql: "SELECT id, codigo, estado FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
    admite: (f) => enEstados("FONDOS", f.estado),
  },
  GASTOS: {
    // Un gasto desactivado (activo = 0) o histórico (estado NULL) nunca admite entregas.
    sql: "SELECT id, codigo, estado, activo FROM tms_gastos_operativos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
    admite: (f) => Number(f.activo) === 1 && enEstados("GASTOS", f.estado),
  },
  COMPRAS: {
    sql: "SELECT id, codigo, estado FROM compras_requerimientos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
    admite: (f) => enEstados("COMPRAS", f.estado),
  },
};

/** `null` si el documento no existe EN ESTA EMPRESA (el llamador responde 404 sin distinguir "existe en otra empresa"). */
export async function bloquearDocumento(
  conn: PoolConnection, empresaId: number, modulo: ModuloEntrega, entidadId: number,
): Promise<DocumentoEntrega | null> {
  const adaptador = ADAPTADORES[modulo];
  const [filas] = await conn.query<RowDataPacket[]>(adaptador.sql, [entidadId, empresaId]);
  const fila = filas[0];
  if (!fila) return null;
  return {
    id: Number(fila.id),
    codigo: fila.codigo != null ? String(fila.codigo) : null,
    estado: fila.estado != null ? String(fila.estado) : null,
    admiteEntrega: adaptador.admite(fila),
  };
}
