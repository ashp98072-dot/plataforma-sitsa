import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";

const MIGRATION_ID = "tz_guatemala_marcajes_v1";

/** En memoria: evita hits a DB en cada request tras la 1.ª vez. */
let estado: "unknown" | "done" | "pending" = "unknown";
let enCurso: Promise<void> | null = null;

/**
 * Una sola vez: resta 6 h a marcajes guardados como UTC (reloj de pared).
 * Tras aplicada, es no-op en memoria (sin consultas).
 */
export async function asegurarCorreccionTzGuatemala(): Promise<void> {
  if (estado === "done") return;
  if (!enCurso) {
    enCurso = aplicarUnaVez().finally(() => {
      enCurso = null;
    });
  }
  await enCurso;
}

async function aplicarUnaVez(): Promise<void> {
  if (estado === "done") return;

  try {
    await execute(
      `CREATE TABLE IF NOT EXISTS sitsa_migrations (
        id VARCHAR(64) PRIMARY KEY,
        aplicado_at DATETIME NOT NULL
      )`,
    );
  } catch {
    estado = "done"; // no bloquear la app
    return;
  }

  try {
    const done = await query<RowDataPacket[]>(
      "SELECT id FROM sitsa_migrations WHERE id = ? LIMIT 1",
      [MIGRATION_ID],
    );
    if (done.length) {
      estado = "done";
      return;
    }
  } catch {
    estado = "done";
    return;
  }

  if (estado === "pending") return;
  estado = "pending";

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
  } finally {
    estado = "done";
  }
}
