import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { PreflightDatabase } from './production-preflight';

// PRICESMART API-20 — lector de preflight sobre un pool MariaDB ya construido por la composición administrativa. Ejecuta EXACTAMENTE dos sentencias de SOLO LECTURA, fijas y sin parámetros:
// `SELECT DATABASE() AS db, CURRENT_USER() AS account` y `SHOW GRANTS FOR CURRENT_USER()`. No admite SQL libre, no escribe, no crea el pool ni usa credenciales propias, y los errores del motor nunca se propagan
// (solo `UNAVAILABLE`). No está importado por la aplicación.
const IDENTITY_SQL = 'SELECT DATABASE() AS db, CURRENT_USER() AS account';
const GRANTS_SQL = 'SHOW GRANTS FOR CURRENT_USER()';
export const PREFLIGHT_STATEMENTS = Object.freeze([IDENTITY_SQL, GRANTS_SQL]);

export function mariaDbPreflightDatabase(pool: Pool): PreflightDatabase {
  const unavailable = () => new Error('UNAVAILABLE');
  async function read<T extends RowDataPacket>(sql: string): Promise<T[]> {
    let conn; let broken = false;
    try { conn = await pool.getConnection(); const [rows] = await conn.query<T[]>(sql); return rows; }
    catch { broken = true; throw unavailable(); }
    finally { if (conn) { if (broken) conn.destroy(); else conn.release(); } }
  }
  return {
    async identity() { const rows = await read<RowDataPacket>(IDENTITY_SQL); if (rows.length !== 1) throw unavailable(); return { db: String(rows[0].db ?? ''), account: String(rows[0].account ?? '') }; },
    async grants() { const rows = await read<RowDataPacket>(GRANTS_SQL); return rows.map(r => String(Object.values(r)[0] ?? '')); },
  };
}
