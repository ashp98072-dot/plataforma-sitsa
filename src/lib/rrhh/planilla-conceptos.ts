import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";
import { redondearQ } from "./contratos-pago";
import { toIsoDate } from "./dates";
import { finalizarSiCorresponde } from "./descuentos";
import { obtenerFaltasPlanilla } from "./planilla-faltas";

const id = z.number().int().positive();
const monto = z.number().finite().nonnegative();
const item = z.object({ id, monto, concepto: z.string(), fecha: z.string(), notas: z.string() }).strict();
const cuota = item.extend({ descuentoId: id, saldoDescuento: monto }).strict();
const hora = item.extend({ horas: monto }).strict();
// `faltas` (RRHH-TOMAR-ASISTENCIA-2) es OPCIONAL: los snapshots históricos no la traen y siguen siendo válidos.
const pendientesSchema = z.object({ cuotas: z.array(cuota), manuales: z.array(item), horasExtra: z.array(hora),
  descuentosLegado: z.array(item), prestacionesLegado: z.array(item), faltas: z.array(item).optional() }).strict();
// RRHH-PLANILLAS-ISR-2026-INTEGRACION: snapshot v2 amplía v1 con `fiscal`
// (resultado reproducible del motor puro de ISR — ver planilla-fiscal-2026.ts
// y fiscal-isr-2026.ts). v1 sigue leyéndose exactamente igual que antes
// (histórico intacto, nunca reescrito); `fiscal` es OBLIGATORIO en v2 y
// PROHIBIDO en v1, para que nunca quede ambiguo si una línea pasó por el
// motor 2026 o no. inputUsado/resultado quedan sin tipar aquí a propósito
// (z.unknown): su forma exacta la valida `calcularIsrTrabajo2026` al
// calcularlos; este schema solo necesita saber que el snapshot los trae,
// para poder guardarlos y compararlos tal cual al autorizar.
const fiscalSnapshotSchema = z.object({
  motor: z.literal("ISR_TRABAJO_2026"),
  ejercicio: z.literal(2026),
  antecedenteRevision: z.number().int(),
  parametrosRevision: z.object({ ejercicio: z.number(), version: z.string() }),
  fechaCorte: z.string(),
  inputUsado: z.unknown(),
  resultado: z.unknown(),
  // Corrección de regla de negocio + revisión externa (segunda ronda,
  // punto 3): valor de ISR REALMENTE aplicado a ESTA línea. En 2026 el ISR
  // NO se reparte entre quincenas — se cobra una sola vez al mes: Q0.00 en
  // QUINCENA_1, el ISR completo del mes en QUINCENA_2/MENSUAL/ESPECIAL.
  // Distinto de `resultado.retencionSugerida` (el cálculo mensual del
  // motor, antes de decidir en qué período del mes se cobra). Comparar
  // `isr` persistido contra ESTE campo (no contra retencionSugerida) es lo
  // único que detecta correctamente un ajuste manual, sin marcar falso
  // positivo en QUINCENA_1 (cuyo automático legítimamente vale 0.00).
  // Formato "0.00" — mismo criterio que el resto de montos fiscales.
  isrAplicadoPeriodo: z.string().regex(/^\d+\.\d{2}$/),
  // RRHH-FISCAL-CONCEPTOS-2026: revisión de la configuración fiscal de
  // conceptos (ver fiscal-conceptos-2026.ts) usada para clasificar
  // sueldo/bono incentivo/bono herramientas/horas extra de esta línea.
  // autorizarPeriodoPlanilla exige que coincida con la recalculada al
  // autorizar — si cambió, exige regenerar (mismo patrón que
  // antecedenteRevision/parametrosRevision).
  configuracionConceptosRevision: z.string().min(1),
}).strict();
export type FiscalSnapshot2026 = z.infer<typeof fiscalSnapshotSchema>;
// RRHH-PLANILLA-PROPORCIONAL: explica CÓMO se calculó el sueldo/bono del período (relación laboral ∩ período, base 30).
// OPCIONAL: los snapshots históricos no lo traen y siguen siendo válidos (sin migración: es JSON).
const fechaOpt = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const devengoSnapshotSchema = z.object({
  estadoEmpleado: z.string(),
  fechaInicioLaboral: fechaOpt,
  fechaEgreso: fechaOpt,
  inicioDevengo: fechaOpt,
  finDevengo: fechaOpt,
  diasPeriodoNominales: z.number().finite().nonnegative(),
  diasDevengados: z.number().finite().nonnegative(),
  baseDiasMensual: z.literal(30),
  prorrateado: z.boolean(),
  sueldoMensual: z.number().finite().nonnegative(),
  salarioDiario: z.number().finite().nonnegative(),
  sueldoPeriodo: z.number().finite().nonnegative(),
  bonoIncentivoMensual: z.number().finite().nonnegative(),
  bonoIncentivoPeriodo: z.number().finite().nonnegative(),
  bonoHerramientasMensual: z.number().finite().nonnegative(),
  bonoHerramientasPeriodo: z.number().finite().nonnegative(),
}).strict();
export type DevengoSnapshot = z.infer<typeof devengoSnapshotSchema>;
export const snapshotSchema = pendientesSchema.extend({
  version: z.union([z.literal(1), z.literal(2)]),
  empresaId: id, periodoId: id, empleadoId: id, sueldoMensual: monto,
  devengo: devengoSnapshotSchema.optional(),
  fiscal: fiscalSnapshotSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.version === 1 && v.fiscal !== undefined) ctx.addIssue({ code: "custom", message: "snapshot v1 no debe incluir fiscal" });
  if (v.version === 2 && v.fiscal === undefined) ctx.addIssue({ code: "custom", message: "snapshot v2 requiere fiscal" });
});
export type PendientesPlanilla = z.infer<typeof pendientesSchema>;
export type ConceptosSnapshot = z.infer<typeof snapshotSchema>;
export const pendientesVacios = (): PendientesPlanilla => ({ cuotas: [], manuales: [], horasExtra: [], descuentosLegado: [], prestacionesLegado: [] });
const cambió = () => new Error("Los conceptos de la vista previa cambiaron o el snapshot es inválido. Regenera la planilla antes de autorizar.");

export function leerConceptosSnapshot(value: unknown): ConceptosSnapshot | null {
  if (value == null) return null;
  try { return snapshotSchema.parse(typeof value === "string" ? JSON.parse(value) : value); }
  catch { throw cambió(); }
}

/** Current reads bajo los bloqueos de períodos. No aplica, reserva ni crea conceptos. */
export async function obtenerConceptosPendientes(conn: PoolConnection, empresaId: number,
  periodo: { id: number; fechaInicio: string; fechaFin: string }): Promise<Map<number, PendientesPlanilla>> {
  const [maestros] = await conn.query<RowDataPacket[]>("SELECT * FROM rrhh_descuentos_maestro WHERE empresa_id = ? ORDER BY id FOR UPDATE", [empresaId]);
  const [cuotas] = await conn.query<RowDataPacket[]>("SELECT * FROM rrhh_descuento_cuotas WHERE empresa_id = ? ORDER BY descuento_id, numero_cuota, id FOR UPDATE", [empresaId]);
  const [abonos] = await conn.query<RowDataPacket[]>("SELECT * FROM rrhh_descuento_abonos WHERE empresa_id = ? ORDER BY id FOR UPDATE", [empresaId]);
  const [horas] = await conn.query<RowDataPacket[]>("SELECT * FROM horas_extra_registros WHERE empresa_id = ? ORDER BY id FOR UPDATE", [empresaId]);
  if (cuotas.some((c) => Number(c.planilla_periodo_id) === periodo.id) || horas.some((h) => Number(h.planilla_periodo_id) === periodo.id)) {
    throw new Error("Este período tiene conceptos históricos ya aplicados. Requiere revisión explícita; no se liberaron ni modificaron.");
  }
  const resultado = new Map<number, PendientesPlanilla>();
  const de = (empleadoId: number) => {
    if (!resultado.has(empleadoId)) resultado.set(empleadoId, pendientesVacios());
    return resultado.get(empleadoId)!;
  };
  for (const d of maestros) {
    if (d.estado !== "ACTIVO") continue;
    const propias = cuotas.filter((c) => Number(c.descuento_id) === Number(d.id));
    const saldoDescuento = redondearQ(Number(d.monto_original) - propias.filter((c) => c.estado === "APLICADA").reduce((sum, c) => sum + Number(c.monto_aplicado ?? 0), 0)
      - abonos.filter((a) => Number(a.descuento_id) === Number(d.id)).reduce((sum, a) => sum + Number(a.monto), 0));
    const siguiente = propias.find((c) => c.estado === "PENDIENTE" && c.planilla_periodo_id == null);
    if (siguiente && (toIsoDate(siguiente.fecha_programada) ?? "") <= periodo.fechaFin) {
      if (Number(siguiente.monto_programado) > saldoDescuento) throw new Error("Una cuota supera el saldo del descuento. Revisa sus cuotas antes de generar o autorizar.");
      de(Number(d.empleado_id)).cuotas.push({ id: Number(siguiente.id), descuentoId: Number(d.id), saldoDescuento, monto: Number(siguiente.monto_programado),
        concepto: String(d.concepto), fecha: toIsoDate(siguiente.fecha_programada) ?? "", notas: String(d.motivo ?? "") });
    } else if (!propias.length && d.periodicidad === "MANUAL" && (toIsoDate(d.fecha_inicio) ?? "") <= periodo.fechaFin) {
      const saldo = redondearQ(Number(d.monto_original) - abonos.filter((a) => Number(a.descuento_id) === Number(d.id)).reduce((sum, a) => sum + Number(a.monto), 0));
      if (saldo > 0.004) de(Number(d.empleado_id)).manuales.push({ id: Number(d.id), monto: saldo, concepto: String(d.concepto), fecha: toIsoDate(d.fecha_inicio) ?? "", notas: String(d.motivo ?? "") });
    }
  }
  for (const h of horas) {
    const fecha = toIsoDate(h.fecha) ?? "";
    if (h.estado === "APROBADA" && h.planilla_periodo_id == null && fecha >= periodo.fechaInicio && fecha <= periodo.fechaFin) {
      de(Number(h.id_empleado)).horasExtra.push({ id: Number(h.id), monto: Number(h.monto), horas: Number(h.horas), concepto: "Horas extra", fecha, notas: String(h.motivo ?? "") });
    }
  }
  for (const [tabla, campo] of [["rrhh_descuentos", "descuentosLegado"], ["rrhh_prestaciones", "prestacionesLegado"]] as const) {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${tabla} WHERE empresa_id = ? AND fecha BETWEEN ? AND ? ORDER BY id FOR UPDATE`, [empresaId, periodo.fechaInicio, periodo.fechaFin]);
    for (const row of rows) de(Number(row.id_empleado))[campo].push({ id: Number(row.id), monto: Number(row.monto), concepto: String(row.concepto ?? row.tipo ?? ""), fecha: toIsoDate(row.fecha) ?? "", notas: String(row.notas ?? "") });
  }
  // Faltas confirmadas por RRHH (revalidadas contra vacaciones/permisos/ruta/etc.); solo empleados Activos, igual que la planilla.
  for (const [empleadoId, faltas] of await obtenerFaltasPlanilla(conn, empresaId, periodo)) de(empleadoId).faltas = faltas;
  for (const conceptos of resultado.values()) pendientesSchema.parse(conceptos);
  return resultado;
}

export function totalesConceptos(p: PendientesPlanilla) {
  const suma = (items: { monto: number }[]) => redondearQ(items.reduce((sum, i) => sum + i.monto, 0));
  return { descuentos: suma([...p.cuotas, ...p.manuales, ...p.descuentosLegado, ...(p.faltas ?? [])]), otrosIngresos: suma([...p.horasExtra, ...p.prestacionesLegado]) };
}

export function validarSnapshotContraPendientes(snapshot: unknown, actual: PendientesPlanilla,
  contexto: { empresaId: number; periodoId: number; empleadoId: number; descuentos: number; otrosIngresos: number }): ConceptosSnapshot {
  const s = leerConceptosSnapshot(snapshot);
  if (!s || s.empresaId !== contexto.empresaId || s.periodoId !== contexto.periodoId || s.empleadoId !== contexto.empleadoId) throw cambió();
  // Normalizar también las filas actuales: JSON puede reordenar las claves en MariaDB.
  const validacionActual = pendientesSchema.safeParse(actual);
  if (!validacionActual.success) throw cambió();
  const normalizado = validacionActual.data;
  for (const campo of ["cuotas", "manuales", "horasExtra", "descuentosLegado", "prestacionesLegado"] as const) {
    if (JSON.stringify(s[campo]) !== JSON.stringify(normalizado[campo])) throw cambió();
    if (new Set(s[campo].map((i) => i.id)).size !== s[campo].length) throw cambió();
  }
  if (JSON.stringify(s.faltas ?? []) !== JSON.stringify(normalizado.faltas ?? [])) throw cambió();
  if (new Set((s.faltas ?? []).map((i) => i.id)).size !== (s.faltas ?? []).length) throw cambió();
  const totales = totalesConceptos(s);
  if (totales.descuentos !== contexto.descuentos || totales.otrosIngresos !== contexto.otrosIngresos) throw cambió();
  return s;
}

/** Solo después de revalidar TODOS los snapshots. La transacción es del caller. */
export async function aplicarConceptosSnapshot(conn: PoolConnection, s: ConceptosSnapshot, usuario: string) {
  const maestros = new Set<number>();
  for (const c of s.cuotas) {
    const [r] = await conn.execute<ResultSetHeader>(`UPDATE rrhh_descuento_cuotas SET estado = 'APLICADA', planilla_periodo_id = ?, monto_aplicado = ?, aplicado_en = NOW(), aplicado_por = ?
      WHERE empresa_id = ? AND id = ? AND descuento_id = ? AND estado = 'PENDIENTE' AND planilla_periodo_id IS NULL AND monto_programado = ?`,
    [s.periodoId, c.monto, usuario, s.empresaId, c.id, c.descuentoId, c.monto]);
    if (r.affectedRows !== 1) throw cambió();
    maestros.add(c.descuentoId);
  }
  for (const d of s.manuales) {
    // Caso legado MANUAL sin cuota: crearla únicamente al autorizar, nunca en la vista previa.
    await conn.execute(`INSERT INTO rrhh_descuento_cuotas (empresa_id, descuento_id, numero_cuota, fecha_programada, monto_programado, estado, planilla_periodo_id, monto_aplicado, aplicado_en, aplicado_por)
      VALUES (?, ?, 1, ?, ?, 'APLICADA', ?, ?, NOW(), ?)`, [s.empresaId, d.id, d.fecha, d.monto, s.periodoId, d.monto, usuario]);
    maestros.add(d.id);
  }
  for (const h of s.horasExtra) {
    const [r] = await conn.execute<ResultSetHeader>(`UPDATE horas_extra_registros SET estado = 'APLICADA_EN_PLANILLA', planilla_periodo_id = ?, aplicado_en = NOW()
      WHERE empresa_id = ? AND id = ? AND id_empleado = ? AND estado = 'APROBADA' AND planilla_periodo_id IS NULL AND monto = ? AND horas = ?`, [s.periodoId, s.empresaId, h.id, s.empleadoId, h.monto, h.horas]);
    if (r.affectedRows !== 1) throw cambió();
  }
  for (const f of s.faltas ?? []) {
    const [r] = await conn.execute<ResultSetHeader>(`UPDATE rrhh_asistencia_ausencias SET planilla_periodo_id = ?, monto_aplicado = ?, aplicado_en = NOW(), aplicado_por = ?
      WHERE empresa_id = ? AND id = ? AND empleado_id = ? AND estado = 'CONFIRMADA' AND planilla_periodo_id IS NULL`,
    [s.periodoId, f.monto, usuario, s.empresaId, f.id, s.empleadoId]);
    if (r.affectedRows !== 1) throw cambió();
  }
  for (const d of maestros) await finalizarSiCorresponde(conn, s.empresaId, d);
}
