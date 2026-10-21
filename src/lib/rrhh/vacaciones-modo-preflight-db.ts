import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { toIsoDate } from "./dates";
import { TIPOS, cargarHechos, type Consulta } from "./vacaciones-rebase-db";
import { evaluarConsumoVerificable, type EmpleadoNoVerificable, type MotivoNoVerificable, type ResultadoPreflight } from "./vacaciones-modo-preflight";

/**
 * RRHH VACACIONES — PREFLIGHT del modo de carga histórica (capa de BD, SOLO LECTURA: únicamente SELECT; no abre transacciones de escritura ni modifica nada).
 * Reutiliza los hechos y validaciones de #421/#423 (`cargarHechos`: incidencias, detalle FIFO, dueño real de cada saldo) y suma la verificación de la tabla simple
 * `vacaciones`. Evidencias no intervienen (no son fuente de saldo). Todas las consultas van acotadas por `empresa_id` (y `id_empleado`).
 */
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const ids = (rows: RowDataPacket[], campo: string) => rows.map((r) => Number(r[campo]));

/** Motivos por los que el consumo de UN colaborador no se puede reconstruir de forma verificable (vacío = apto). */
export async function verificarConsumoEmpleado(consulta: Consulta, empresaId: number, idEmpleado: number): Promise<MotivoNoVerificable[]> {
  const h = await cargarHechos(consulta, empresaId, idEmpleado, false);

  // Detalle sobre SUS saldos que no proviene de SUS vacaciones: ¿de otra persona (ajeno) o sin incidencia (huérfano)?
  let ajenos: { detalleId: number; incidenciaId: number | null; existeIncidencia: boolean }[] = [];
  if (h.ajenos.length) {
    const det = await consulta(`SELECT id, incidencia_id FROM detalle_consumo_vacaciones WHERE id IN (${ph(h.ajenos.length)})`, h.ajenos);
    const incIds = [...new Set(det.map((d) => Number(d.incidencia_id)).filter((x) => Number.isFinite(x)))];
    const existentes = new Set<number>();
    if (incIds.length) for (const r of await consulta(`SELECT id, empresa_id, id_empleado FROM incidencias WHERE id IN (${ph(incIds.length)})`, incIds)) existentes.add(Number(r.id));
    ajenos = h.ajenos.map((id) => {
      const d = det.find((x) => Number(x.id) === id);
      const inc = d?.incidencia_id != null ? Number(d.incidencia_id) : null;
      return { detalleId: id, incidenciaId: inc, existeIncidencia: inc != null && existentes.has(inc) };
    });
  }

  const espejos = (await consulta("SELECT fecha_inicio, fecha_fin, dias_habiles FROM vacaciones WHERE empresa_id = ? AND id_empleado = ? AND estado = 'Aprobado'", [empresaId, idEmpleado]))
    .map((r) => ({ inicio: String(toIsoDate(r.fecha_inicio as string | Date) ?? ""), fin: String(toIsoDate(r.fecha_fin as string | Date) ?? ""), dias: Number(r.dias_habiles) }));

  return evaluarConsumoVerificable({ hechos: h.hechos, cruzados: h.cruzados.map((c) => ({ incidenciaId: c.incidenciaId, saldoId: c.saldoId })), ajenos, espejos });
}

/**
 * PREFLIGHT por empresa: revisa a TODO colaborador con saldos, vacaciones o historial simple. `puedeActivar` solo si ninguno tiene consumo no verificable.
 * Falla cerrado: cualquier error al consultar se propaga (nunca se asume que el consumo es verificable).
 */
export async function ejecutarPreflightModoHistorico(consulta: Consulta, empresaId: number): Promise<ResultadoPreflight> {
  const conjunto = new Set<number>();
  for (const id of ids(await consulta("SELECT DISTINCT id_empleado FROM saldos_vacaciones WHERE empresa_id = ?", [empresaId]), "id_empleado")) conjunto.add(id);
  for (const id of ids(await consulta(`SELECT DISTINCT id_empleado FROM incidencias WHERE empresa_id = ? AND tipo IN ${TIPOS}`, [empresaId]), "id_empleado")) conjunto.add(id);
  for (const id of ids(await consulta("SELECT DISTINCT id_empleado FROM vacaciones WHERE empresa_id = ?", [empresaId]), "id_empleado")) conjunto.add(id);
  const nombres = new Map<number, { codigo: string; nombre: string }>();
  for (const r of await consulta("SELECT id, codigo, nombre FROM empleados WHERE empresa_id = ?", [empresaId])) nombres.set(Number(r.id), { codigo: String(r.codigo ?? ""), nombre: String(r.nombre ?? "") });

  const motivos: EmpleadoNoVerificable[] = [];
  for (const empleadoId of [...conjunto].sort((a, b) => a - b)) {
    const m = await verificarConsumoEmpleado(consulta, empresaId, empleadoId);
    if (m.length) motivos.push({ empleadoId, codigo: nombres.get(empleadoId)?.codigo ?? "", nombre: nombres.get(empleadoId)?.nombre ?? `Colaborador #${empleadoId}`, motivos: m });
  }
  return { puedeActivar: motivos.length === 0, revisados: conjunto.size, aptos: conjunto.size - motivos.length, bloqueados: motivos.length, motivos };
}

/** Preflight con el pool (SOLO LECTURA), para mostrarlo ANTES de confirmar la activación. */
export async function previsualizarActivacionModoHistorico(empresaId: number): Promise<ResultadoPreflight> {
  return ejecutarPreflightModoHistorico((sql, p) => query<RowDataPacket[]>(sql, p), empresaId);
}
