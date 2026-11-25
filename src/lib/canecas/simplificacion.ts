import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createHash } from 'node:crypto';

/** Fecha operativa (AAAA-MM-DD) en Guatemala: el servidor la fija, el cliente no la envía. */
export function fechaHoyGuatemala(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/** Clave determinista (formato UUID) derivada de otra, para que los pasos de un flujo sean idempotentes. */
export function claveDerivada(clave: string, sufijo: string): string {
  const h = createHash('sha256').update(`${clave}:${sufijo}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const PREFIJOS = { COMPRA: 'COMP-', VENTA: 'VTA-', PRODUCTO: 'CAN-' } as const;
export type TipoSecuencia = keyof typeof PREFIJOS;

/**
 * Siguiente número de la empresa, atómico: la fila del contador queda bloqueada hasta que termina la transacción
 * del llamador, por lo que dos solicitudes concurrentes nunca reciben el mismo número. Si la transacción se revierte,
 * el número no se consume. Requiere una transacción abierta en `conn`.
 */
export async function siguienteNumero(conn: PoolConnection, empresaId: number, tipo: TipoSecuencia): Promise<string> {
  if (!Number.isSafeInteger(empresaId) || empresaId < 1 || !(tipo in PREFIJOS)) throw Error('SECUENCIA_INVALIDA');
  await conn.execute<ResultSetHeader>('INSERT INTO canecas_secuencias (empresa_id,tipo,ultimo) VALUES (?,?,LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE ultimo=LAST_INSERT_ID(ultimo+1)', [empresaId, tipo]);
  const [filas] = await conn.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS n');
  const n = Number(filas[0]?.n);
  if (!Number.isSafeInteger(n) || n < 1) throw Error('SECUENCIA_INVALIDA');
  return `${PREFIJOS[tipo]}${String(n).padStart(6, '0')}`;
}

/**
 * Producto único de aceite de la empresa. Si la empresa no tiene ninguno lo crea con código automático;
 * si tiene varios activos (datos históricos) se detiene: no se elige uno por el usuario.
 */
export async function productoUnico(conn: PoolConnection, empresaId: number): Promise<number> {
  const [filas] = await conn.query<RowDataPacket[]>('SELECT id,activo FROM canecas_productos WHERE empresa_id=? ORDER BY id', [empresaId]);
  const activos = filas.filter(f => Number(f.activo) === 1);
  if (activos.length === 1) return Number(activos[0].id);
  if (activos.length > 1) throw Error('PRODUCTO_AMBIGUO');
  if (filas.length) throw Error('PRODUCTO_INACTIVO');
  const codigo = await siguienteNumero(conn, empresaId, 'PRODUCTO');
  try {
    const [r] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_productos (empresa_id,codigo,nombre,marca,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (?,?,'Caneca','','Caneca',1,'unidad','caneca')", [empresaId, codigo]);
    return r.insertId;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
    const [otra] = await conn.query<RowDataPacket[]>("SELECT id FROM canecas_productos WHERE empresa_id=? AND activo=1 ORDER BY id", [empresaId]);
    if (otra.length !== 1) throw Error('PRODUCTO_AMBIGUO');
    return Number(otra[0].id);
  }
}
