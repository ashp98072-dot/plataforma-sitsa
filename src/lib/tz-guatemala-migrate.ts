import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";

const MIGRATION_ID = "tz_guatemala_marcajes_v1";

let enCurso: Promise<void> | null = null;

/**
 * Una sola vez: resta 6 h a marcajes guardados como UTC (reloj de pared).
 * Seguro llamar en cada request; no-op tras la primera aplicación.
 */
export async function asegurarCorreccionTzGuatemala(): Promise<void> {
  if (!enCurso) {
    enCurso = aplicarUnaVez().finally(() => {
      enCurso = null;
    });
  }
  await enCurso;
}

async function aplicarUnaVez(): Promise<void> {
  try {
    await execute(
      `CREATE TABLE IF NOT EXISTS sitsa_migrations (
        id VARCHAR(64) PRIMARY KEY,
        aplicado_at DATETIME NOT NULL
      )`,
    );
  } catch {
    return;
  }

  try {
    const done = await query<RowDataPacket[]>(
      "SELECT id FROM sitsa_migrations WHERE id = ? LIMIT 1",
      [MIGRATION_ID],
    );
    if (done.length) return;
  } catch {
    return;
  }

  try {
    await execute(
      `UPDATE sesiones_trabajo
       SET
         entrada_at = DATE_SUB(entrada_at, INTERVAL 6 HOUR),
         salida_at = IF(salida_at IS NULL, NULL, DATE_SUB(salida_at, INTERVAL 6 HOUR))`,
    );
    await execute(
      `UPDATE sesiones_trabajo
       SET fecha_jornada = DATE(entrada_at)
       WHERE entrada_at IS NOT NULL`,
    );

    await execute(
      `INSERT INTO sitsa_migrations (id, aplicado_at) VALUES (?, ?)`,
      [MIGRATION_ID, ahoraLocal()],
    );
  } catch (e) {
    console.error("[tz_guatemala_marcajes_v1] no se pudo aplicar:", e);
  }
}
