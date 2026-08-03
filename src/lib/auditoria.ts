import { execute } from "./db";

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
