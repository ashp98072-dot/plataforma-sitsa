import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/** Solo desde cancelarPeriodo, después de bloquear el período y descartar pagos.
 * Libera reservas, no modifica las condiciones originales ni revierte pagos.
 */
export async function liberarReservasPeriodo(
  conn: PoolConnection, empresaId: number, periodoId: number, usuario: string,
): Promise<void> {
  const [cuotas] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM rrhh_descuento_cuotas WHERE empresa_id = ? AND planilla_periodo_id = ? ORDER BY descuento_id, id FOR UPDATE",
    [empresaId, periodoId],
  );
  for (const cuota of cuotas) {
    if (cuota.estado !== "APLICADA") throw new Error("Cuota vinculada con estado inconsistente; revisar antes de cancelar.");
    const [result] = await conn.execute<ResultSetHeader>(
      `UPDATE rrhh_descuento_cuotas
       SET estado = 'PENDIENTE', monto_aplicado = NULL, planilla_periodo_id = NULL,
           aplicado_en = NULL, aplicado_por = NULL
       WHERE id = ? AND empresa_id = ? AND planilla_periodo_id = ? AND estado = 'APLICADA'`,
      [cuota.id, empresaId, periodoId],
    );
    if (result.affectedRows !== 1) throw new Error("No se pudo liberar la cuota.");
    await registrarAuditoriaTx(conn, {
      empresaId, usuario, accion: "liberar_cuota_planilla", modulo: "rrhh",
      detalle: JSON.stringify({ periodoId, cuotaAntes: cuota }),
    });
  }
  for (const descuentoId of new Set(cuotas.map((c) => Number(c.descuento_id)))) {
    const [maestros] = await conn.query<RowDataPacket[]>(
      "SELECT estado, monto_original FROM rrhh_descuentos_maestro WHERE empresa_id = ? AND id = ? FOR UPDATE",
      [empresaId, descuentoId],
    );
    if (!maestros[0]) throw new Error("Descuento de la cuota no encontrado.");
    if (maestros[0].estado !== "FINALIZADO") continue; // Mantener pausados/cancelados.
    // Current reads: no usar sumas de un snapshot anterior a los bloqueos.
    const [aplicadas] = await conn.query<RowDataPacket[]>(
      "SELECT monto_aplicado FROM rrhh_descuento_cuotas WHERE empresa_id = ? AND descuento_id = ? AND estado = 'APLICADA' FOR UPDATE",
      [empresaId, descuentoId],
    );
    const [abonos] = await conn.query<RowDataPacket[]>(
      "SELECT monto FROM rrhh_descuento_abonos WHERE empresa_id = ? AND descuento_id = ? FOR UPDATE",
      [empresaId, descuentoId],
    );
    const saldo = Number(maestros[0].monto_original)
      - aplicadas.reduce((sum, c) => sum + Number(c.monto_aplicado ?? 0), 0)
      - abonos.reduce((sum, a) => sum + Number(a.monto), 0);
    if (saldo > 0.004) {
      await conn.execute(
        "UPDATE rrhh_descuentos_maestro SET estado = 'ACTIVO' WHERE empresa_id = ? AND id = ? AND estado = 'FINALIZADO'",
        [empresaId, descuentoId],
      );
      await registrarAuditoriaTx(conn, {
        empresaId, usuario, accion: "reactivar_descuento_cancelacion", modulo: "rrhh",
        detalle: JSON.stringify({ periodoId, descuentoId, anterior: "FINALIZADO", nuevo: "ACTIVO" }),
      });
    }
  }
  const [horas] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM horas_extra_registros WHERE empresa_id = ? AND planilla_periodo_id = ? ORDER BY id FOR UPDATE",
    [empresaId, periodoId],
  );
  for (const registro of horas) {
    if (registro.estado !== "APLICADA_EN_PLANILLA") throw new Error("Horas extra vinculadas con estado inconsistente; revisar antes de cancelar.");
    const [result] = await conn.execute<ResultSetHeader>(
      `UPDATE horas_extra_registros SET estado = 'APROBADA', planilla_periodo_id = NULL, aplicado_en = NULL
       WHERE empresa_id = ? AND id = ? AND planilla_periodo_id = ? AND estado = 'APLICADA_EN_PLANILLA'`,
      [empresaId, registro.id, periodoId],
    );
    if (result.affectedRows !== 1) throw new Error("No se pudieron liberar las horas extra.");
    await registrarAuditoriaTx(conn, {
      empresaId, usuario, accion: "liberar_horas_planilla", modulo: "rrhh",
      detalle: JSON.stringify({ periodoId, registroAntes: registro }),
    });
  }
}
