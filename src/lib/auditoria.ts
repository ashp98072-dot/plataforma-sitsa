import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query } from "./db";

/** No inicia/termina transacciones ni silencia fallos: responsabilidad del caller. */
export async function registrarAuditoriaTx(
  conn: PoolConnection,
  input: Parameters<typeof registrarAuditoria>[0],
): Promise<void> {
  await conn.execute(
    `INSERT INTO auditoria (empresa_id, usuario, accion, modulo, detalle)
     VALUES (?, ?, ?, ?, ?)`,
    [input.empresaId ?? null, input.usuario ?? null, input.accion,
      input.modulo ?? null, input.detalle ?? null],
  );
}

export async function registrarAuditoria(input: {
  empresaId?: number | null;
  usuario?: string | null;
  accion: string;
  modulo?: string;
  detalle?: string;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO auditoria (empresa_id, usuario, accion, modulo, detalle)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.empresaId ?? null,
        input.usuario ?? null,
        input.accion,
        input.modulo ?? null,
        input.detalle ?? null,
      ],
    );
  } catch {
    // no bloquear la operación principal si la auditoría falla
  }
}

export type FilaAuditoria = {
  id: number;
  usuario: string | null;
  accion: string;
  modulo: string | null;
  detalle: string | null;
  creadoEn: string;
};

export async function listarAuditoria(opts: {
  empresaId: number;
  modulo?: string;
  limite?: number;
}): Promise<FilaAuditoria[]> {
  const limite = Math.min(Math.max(opts.limite ?? 100, 1), 500);
  try {
    const rows = opts.modulo
      ? await query<RowDataPacket[]>(
          `SELECT id, usuario, accion, modulo, detalle, creado_en
           FROM auditoria
           WHERE empresa_id = ? AND modulo = ?
           ORDER BY id DESC
           LIMIT ${limite}`,
          [opts.empresaId, opts.modulo],
        )
      : await query<RowDataPacket[]>(
          `SELECT id, usuario, accion, modulo, detalle, creado_en
           FROM auditoria
           WHERE empresa_id = ?
           ORDER BY id DESC
           LIMIT ${limite}`,
          [opts.empresaId],
        );
    return rows.map((r) => ({
      id: Number(r.id),
      usuario: r.usuario != null ? String(r.usuario) : null,
      accion: String(r.accion),
      modulo: r.modulo != null ? String(r.modulo) : null,
      detalle: r.detalle != null ? String(r.detalle) : null,
      creadoEn: String(r.creado_en ?? "").replace("T", " ").slice(0, 19),
    }));
  } catch {
    return [];
  }
}
