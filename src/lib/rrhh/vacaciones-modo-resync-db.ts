import type { RowDataPacket } from "mysql2/promise";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { getPool, query } from "@/lib/db";
import { sincronizarPeriodosVacaciones } from "./vacaciones";

/**
 * RRHH VACACIONES — RESINCRONIZACIÓN ADMINISTRADA tras cambiar el modo de carga histórica. NO es un UPDATE masivo: ejecuta, colaborador por colaborador y cada uno en SU PROPIA
 * transacción, la sincronización normal de períodos (`sincronizarPeriodosVacaciones`), que ya conoce la política vigente de la empresa (NORMAL: vencimiento a 2 períodos y
 * tope de 30; CARGA HISTÓRICA: todos los períodos utilizables por lo no consumido, calculado desde el detalle FIFO). Un colaborador congelado (#417), con consumo NO verificable
 * (en modo carga no se recalcula: `CONSUMO_NO_VERIFICABLE`) o con error no impide continuar con los demás. No borra historial ni crea vacaciones/incidencias; puede completar
 * períodos faltantes mediante la sincronización normal. No toca detalle FIFO, evidencias ni fechas.
 */
export type ResultadoEmpleadoResync = { empleadoId: number; resultado: "SINCRONIZADO" | "CONGELADO" | "CONSUMO_NO_VERIFICABLE" | "ERROR" };
export type ResultadoResync = { total: number; sincronizados: number; congelados: number; consumoNoVerificable: number; errores: number; resultados: ResultadoEmpleadoResync[] };

export async function resincronizarSaldosEmpresa(empresaId: number, opciones: { usuario?: string | null; hoy?: Date } = {}): Promise<ResultadoResync> {
  const hoy = opciones.hoy ?? new Date();
  const filas = await query<RowDataPacket[]>("SELECT DISTINCT id_empleado FROM saldos_vacaciones WHERE empresa_id = ? ORDER BY id_empleado", [empresaId]);
  const resultados: ResultadoEmpleadoResync[] = [];
  for (const f of filas) {
    const empleadoId = Number(f.id_empleado);
    try {
      const r = await sincronizarPeriodosVacaciones(empresaId, empleadoId);
      resultados.push({ empleadoId, resultado: r.consumoNoVerificable ? "CONSUMO_NO_VERIFICABLE" : r.omitido || r.requiereReparacion ? "CONGELADO" : "SINCRONIZADO" });
    } catch (error) {
      console.error("[vacaciones/modo-carga-historica/resincronizar]", empleadoId, error);
      resultados.push({ empleadoId, resultado: "ERROR" });
    }
  }
  const cuenta = (x: ResultadoEmpleadoResync["resultado"]) => resultados.filter((r) => r.resultado === x).length;
  const lote: ResultadoResync = { total: resultados.length, sincronizados: cuenta("SINCRONIZADO"), congelados: cuenta("CONGELADO"), consumoNoVerificable: cuenta("CONSUMO_NO_VERIFICABLE"), errores: cuenta("ERROR"), resultados };
  try {
    const conn = await getPool().getConnection();
    try {
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: opciones.usuario ?? null, modulo: "rrhh", accion: "vacaciones_resincronizacion_modo",
        detalle: JSON.stringify({ empresaId, usuario: opciones.usuario ?? null, fecha: hoy.toISOString(), total: lote.total, sincronizados: lote.sincronizados, congelados: lote.congelados, consumoNoVerificable: lote.consumoNoVerificable, errores: lote.errores }),
      });
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("[vacaciones/modo-carga-historica/resincronizar] auditoría", error);
  }
  return lote;
}
