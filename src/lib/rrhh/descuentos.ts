import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, getPool, query, type SqlParams } from "@/lib/db";
import { hoyLocal, toIsoDate } from "@/lib/rrhh/dates";
import { obtenerDiaCorteQuincenal, obtenerRangoPeriodo } from "@/lib/rrhh/periodos";
import { obtenerDocumento } from "@/lib/rrhh/documentos";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * Fase D1 — Motor de descuentos y cuotas (RRHH).
 *
 * Reemplaza el concepto plano de rrhh_descuentos (histórico, NO se toca ni
 * se migra) por un modelo maestro + cuotas con saldo, periodicidad, estados
 * y auditoría — para descuentos NUEVOS de aquí en adelante.
 *
 * IMPORTANTE (mismo criterio ya aprobado en RRHH P0):
 * - Las 3 tablas nuevas (rrhh_descuentos_maestro, rrhh_descuento_cuotas,
 *   rrhh_descuento_abonos) viven en sql/schema.sql + una migración manual.
 * - Este archivo NO ejecuta CREATE TABLE, ALTER TABLE, ni ningún DDL en
 *   runtime. Solo consume el schema esperado — la migración la aplica el
 *   usuario manualmente.
 *
 * D1 NO conecta con planilla: las cuotas quedan PENDIENTE, sin
 * planilla_periodo_id. Eso es D2. IGSS/ISR no se tocan — este motor es
 * exclusivamente para descuentos adicionales/manuales (clasificados como
 * LEGAL/AUTORIZADO/JUDICIAL/SISTEMA), nunca para sustituir esos cálculos.
 */

// Fase INV-1: "INVENTARIO" agregado para descuentos originados por una
// entrega de artículo (RRHH > Inventario > Entregar). Columna VARCHAR(20)
// sin lista cerrada en BD — aditivo, sin migración. generarLineasPeriodo()/
// aplicarCuotasElegibles() no filtran por clasificación, así que estas
// cuotas entran a planilla exactamente igual que cualquier otra.
export type Clasificacion = "LEGAL" | "AUTORIZADO" | "JUDICIAL" | "SISTEMA" | "INVENTARIO";
export const CLASIFICACIONES: readonly Clasificacion[] = [
  "LEGAL",
  "AUTORIZADO",
  "JUDICIAL",
  "SISTEMA",
  "INVENTARIO",
];

export type EstadoDescuento =
  | "BORRADOR"
  | "ACTIVO"
  | "PAUSADO"
  | "FINALIZADO"
  | "CANCELADO";
export const ESTADOS_DESCUENTO: readonly EstadoDescuento[] = [
  "BORRADOR",
  "ACTIVO",
  "PAUSADO",
  "FINALIZADO",
  "CANCELADO",
];

export type Periodicidad =
  | "UNA_VEZ"
  | "CADA_QUINCENA"
  | "SOLO_QUINCENA_1"
  | "SOLO_QUINCENA_2"
  | "CADA_N_QUINCENAS"
  | "MENSUAL"
  | "MANUAL";
export const PERIODICIDADES: readonly Periodicidad[] = [
  "UNA_VEZ",
  "CADA_QUINCENA",
  "SOLO_QUINCENA_1",
  "SOLO_QUINCENA_2",
  "CADA_N_QUINCENAS",
  "MENSUAL",
  "MANUAL",
];

export type EstadoCuota = "PENDIENTE" | "APLICADA" | "OMITIDA" | "CANCELADA";

/** Mismo vocabulario que TipoPeriodo de planillas.ts, sin ESPECIAL (no aplica aquí). */
export type TipoQuincenaInicio = "QUINCENA_1" | "QUINCENA_2" | "MENSUAL";

export type DescuentoMaestro = {
  id: number;
  empresaId: number;
  empleadoId: number;
  empleadoCodigo: string;
  empleadoNombre: string;
  codigo: string;
  concepto: string;
  clasificacion: Clasificacion;
  motivo: string | null;
  montoOriginal: number;
  estado: EstadoDescuento;
  periodicidad: Periodicidad;
  numeroCuotas: number;
  montoCuota: number;
  cadaNQuincenas: number | null;
  tipoQuincenaInicio: TipoQuincenaInicio | null;
  quincenaInicio: 1 | 2 | null;
  fechaInicio: string;
  documentoId: number | null;
  autorizadoPor: string | null;
  autorizadoEn: string | null;
  motivoPausa: string | null;
  motivoCancelacion: string | null;
  creadoPor: string | null;
  creadoEn: string;
};

export type CuotaDescuento = {
  id: number;
  descuentoId: number;
  numeroCuota: number;
  fechaProgramada: string;
  montoProgramado: number;
  montoAplicado: number | null;
  estado: EstadoCuota;
  planillaPeriodoId: number | null;
  aplicadoEn: string | null;
  aplicadoPor: string | null;
  motivoAjuste: string | null;
};

export type AbonoDescuento = {
  id: number;
  descuentoId: number;
  monto: number;
  fecha: string;
  motivo: string;
  registradoPor: string | null;
  creadoEn: string;
};

export type ResumenSaldo = {
  montoOriginal: number;
  pagado: number;
  saldo: number;
  cuotasTotal: number;
  cuotasAplicadas: number;
  proximaCuota: { numero: number; fecha: string; monto: number } | null;
};

export type DescuentoConSaldo = DescuentoMaestro & ResumenSaldo;

// ---------------------------------------------------------------------------
// Dinero: enteros en centavos internamente, DECIMAL(12,2)/2-decimales al
// persistir. Nunca se resta/suma en floats "a ojo".
// ---------------------------------------------------------------------------

/** Distribuye montoOriginal (Q) en N cuotas sin floats inseguros — la última absorbe el residuo de centavos. */
export function distribuirCuotas(montoOriginal: number, numeroCuotas: number): number[] {
  const n = Math.max(1, Math.trunc(numeroCuotas));
  const centavosTotal = Math.round(montoOriginal * 100);
  const base = Math.floor(centavosTotal / n);
  const montos: number[] = [];
  let acumulado = 0;
  for (let i = 0; i < n - 1; i++) {
    montos.push(base);
    acumulado += base;
  }
  montos.push(centavosTotal - acumulado);
  return montos.map((c) => c / 100);
}

function redondearCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Fechas de cuotas: reutiliza obtenerDiaCorteQuincenal/obtenerRangoPeriodo
// (ya existentes, ciclo_quincenal configurable por empresa) — no se
// reimplementa el cálculo de quincenas.
// ---------------------------------------------------------------------------

type PosicionQuincena = { anio: number; mes: number; quincena: 1 | 2 };

async function posicionQuincenaDeFecha(
  empresaId: number,
  fecha: string,
): Promise<PosicionQuincena> {
  const corte = await obtenerDiaCorteQuincenal(empresaId);
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return { anio, mes, quincena: dia <= corte ? 1 : 2 };
}

/** Avanza `pasos` quincenas (slots de 2 por mes) desde una posición dada. */
function avanzarQuincena(pos: PosicionQuincena, pasos: number): PosicionQuincena {
  const totalInicial = pos.anio * 24 + (pos.mes - 1) * 2 + (pos.quincena - 1);
  const total = totalInicial + pasos;
  const anio = Math.floor(total / 24);
  const resto = total - anio * 24;
  const mes = Math.floor(resto / 2) + 1;
  const quincena = ((resto % 2) + 1) as 1 | 2;
  return { anio, mes, quincena };
}

function avanzarMes(anio: number, mes: number, pasos: number): { anio: number; mes: number } {
  const totalInicial = anio * 12 + (mes - 1);
  const total = totalInicial + pasos;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
}

async function fechaFinDeQuincena(
  empresaId: number,
  anio: number,
  mes: number,
  quincena: 1 | 2,
): Promise<string> {
  const etiqueta = quincena === 1 ? "Quincena 1" : "Quincena 2";
  const rango = await obtenerRangoPeriodo(empresaId, etiqueta, new Date(anio, mes - 1, 1));
  return rango?.hasta ?? `${anio}-${String(mes).padStart(2, "0")}-28`;
}

async function fechaFinDeMes(empresaId: number, anio: number, mes: number): Promise<string> {
  const rango = await obtenerRangoPeriodo(empresaId, "Mes actual", new Date(anio, mes - 1, 1));
  return rango?.hasta ?? `${anio}-${String(mes).padStart(2, "0")}-28`;
}

/**
 * Calcula las fechas programadas de `numeroCuotas` cuotas según periodicidad.
 * `fechaInicio` es la fuente de verdad de la posición de arranque (no
 * quincenaInicio/tipoQuincenaInicio, que son solo informativos). Cada fecha
 * es el fin de la quincena/mes correspondiente (cuándo "cierra" ese ciclo).
 * MANUAL no genera fechas — sin calendario automático, por diseño.
 */
export async function calcularFechasCuotas(
  empresaId: number,
  periodicidad: Periodicidad,
  fechaInicio: string,
  numeroCuotas: number,
  cadaNQuincenas: number | null,
): Promise<string[]> {
  // MANUAL no crea un calendario recurrente, pero sí necesita una cuota
  // inicial para que el descuento autorizado pueda llegar a planilla. Sin
  // ella el maestro quedaba ACTIVO con cero cuotas y jamás aparecía en la
  // columna Descuentos.
  if (periodicidad === "MANUAL") return [fechaInicio];
  if (periodicidad === "UNA_VEZ") return [fechaInicio];

  const posInicial = await posicionQuincenaDeFecha(empresaId, fechaInicio);

  if (periodicidad === "MENSUAL") {
    const fechas: string[] = [];
    for (let i = 0; i < numeroCuotas; i++) {
      const { anio, mes } = avanzarMes(posInicial.anio, posInicial.mes, i);
      fechas.push(await fechaFinDeMes(empresaId, anio, mes));
    }
    return fechas;
  }

  let paso: number;
  let posBase = posInicial;
  if (periodicidad === "CADA_QUINCENA") {
    paso = 1;
  } else if (periodicidad === "SOLO_QUINCENA_1") {
    paso = 2;
    posBase = { ...posInicial, quincena: 1 };
  } else if (periodicidad === "SOLO_QUINCENA_2") {
    paso = 2;
    posBase = { ...posInicial, quincena: 2 };
  } else {
    // CADA_N_QUINCENAS: aplica y luego espera (N-1) quincenas antes de la
    // siguiente == distancia de N "slots" entre cuota y cuota.
    paso = Math.max(1, Math.trunc(cadaNQuincenas ?? 1));
  }

  const fechas: string[] = [];
  for (let i = 0; i < numeroCuotas; i++) {
    const pos = avanzarQuincena(posBase, i * paso);
    fechas.push(await fechaFinDeQuincena(empresaId, pos.anio, pos.mes, pos.quincena));
  }
  return fechas;
}

// ---------------------------------------------------------------------------
// Código legible, único por empresa: DES-{anio}-{secuencia}. Mismo patrón
// (buscar máximo existente + reintento) que src/lib/tms/codigo-plan.ts.
// ---------------------------------------------------------------------------

function prefijoCodigoDescuento(anio: number): string {
  return `DES-${anio}-`;
}

async function generarCodigoDescuento(empresaId: number, anio: number): Promise<string> {
  const prefix = prefijoCodigoDescuento(anio);
  const rows = await query<RowDataPacket[]>(
    `SELECT codigo FROM rrhh_descuentos_maestro
     WHERE empresa_id = ? AND codigo LIKE ? ORDER BY id DESC LIMIT 40`,
    [empresaId, `${prefix}%`],
  );
  let max = 0;
  for (const r of rows) {
    const m = String(r.codigo ?? "").match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Mapeo de filas
// ---------------------------------------------------------------------------

function mapMaestro(r: RowDataPacket): DescuentoMaestro {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    empleadoId: Number(r.empleado_id),
    empleadoCodigo: r.empleado_codigo != null ? String(r.empleado_codigo) : "",
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : "",
    codigo: String(r.codigo),
    concepto: String(r.concepto),
    clasificacion: String(r.clasificacion) as Clasificacion,
    motivo: r.motivo != null ? String(r.motivo) : null,
    montoOriginal: Number(r.monto_original),
    estado: String(r.estado) as EstadoDescuento,
    periodicidad: String(r.periodicidad) as Periodicidad,
    numeroCuotas: Number(r.numero_cuotas),
    montoCuota: Number(r.monto_cuota),
    cadaNQuincenas: r.cada_n_quincenas != null ? Number(r.cada_n_quincenas) : null,
    tipoQuincenaInicio:
      r.tipo_quincena_inicio != null ? (String(r.tipo_quincena_inicio) as TipoQuincenaInicio) : null,
    quincenaInicio:
      r.quincena_inicio === 1 || r.quincena_inicio === 2 ? (r.quincena_inicio as 1 | 2) : null,
    fechaInicio: toIsoDate(r.fecha_inicio) ?? "",
    documentoId: r.documento_id != null ? Number(r.documento_id) : null,
    autorizadoPor: r.autorizado_por != null ? String(r.autorizado_por) : null,
    autorizadoEn: r.autorizado_en != null ? String(r.autorizado_en) : null,
    motivoPausa: r.motivo_pausa != null ? String(r.motivo_pausa) : null,
    motivoCancelacion: r.motivo_cancelacion != null ? String(r.motivo_cancelacion) : null,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: String(r.creado_en ?? ""),
  };
}

function mapCuota(r: RowDataPacket): CuotaDescuento {
  return {
    id: Number(r.id),
    descuentoId: Number(r.descuento_id),
    numeroCuota: Number(r.numero_cuota),
    fechaProgramada: toIsoDate(r.fecha_programada) ?? "",
    montoProgramado: Number(r.monto_programado),
    montoAplicado: r.monto_aplicado != null ? Number(r.monto_aplicado) : null,
    estado: String(r.estado) as EstadoCuota,
    planillaPeriodoId: r.planilla_periodo_id != null ? Number(r.planilla_periodo_id) : null,
    aplicadoEn: r.aplicado_en != null ? String(r.aplicado_en) : null,
    aplicadoPor: r.aplicado_por != null ? String(r.aplicado_por) : null,
    motivoAjuste: r.motivo_ajuste != null ? String(r.motivo_ajuste) : null,
  };
}

function mapAbono(r: RowDataPacket): AbonoDescuento {
  return {
    id: Number(r.id),
    descuentoId: Number(r.descuento_id),
    monto: Number(r.monto),
    fecha: toIsoDate(r.fecha) ?? "",
    motivo: String(r.motivo),
    registradoPor: r.registrado_por != null ? String(r.registrado_por) : null,
    creadoEn: String(r.creado_en ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

const SELECT_MAESTRO = `
  SELECT d.*, e.codigo AS empleado_codigo, e.nombre AS empleado_nombre
  FROM rrhh_descuentos_maestro d
  INNER JOIN empleados e ON e.id = d.empleado_id`;

export type FiltrosDescuentos = {
  empleadoId?: number;
  estado?: EstadoDescuento;
  clasificacion?: Clasificacion;
  concepto?: string;
  fechaDesde?: string;
  fechaHasta?: string;
};

/** Saldo/pagado/cuotas — calculado siempre (nunca cacheado), en lote para N descuentos. */
async function resumenesPorDescuento(
  empresaId: number,
  descuentoIds: number[],
): Promise<Map<number, ResumenSaldo & { montoOriginal: number }>> {
  const map = new Map<number, ResumenSaldo & { montoOriginal: number }>();
  if (!descuentoIds.length) return map;
  const ph = descuentoIds.map(() => "?").join(",");

  const cuotasRows = await query<RowDataPacket[]>(
    `SELECT descuento_id, numero_cuota, fecha_programada, monto_programado,
            monto_aplicado, estado
     FROM rrhh_descuento_cuotas
     WHERE empresa_id = ? AND descuento_id IN (${ph})
     ORDER BY descuento_id, numero_cuota`,
    [empresaId, ...descuentoIds],
  );
  const abonosRows = await query<RowDataPacket[]>(
    `SELECT descuento_id, SUM(monto) AS total
     FROM rrhh_descuento_abonos
     WHERE empresa_id = ? AND descuento_id IN (${ph})
     GROUP BY descuento_id`,
    [empresaId, ...descuentoIds],
  );

  const cuotasPorDescuento = new Map<number, RowDataPacket[]>();
  for (const r of cuotasRows) {
    const id = Number(r.descuento_id);
    const list = cuotasPorDescuento.get(id) ?? [];
    list.push(r);
    cuotasPorDescuento.set(id, list);
  }
  const abonosPorDescuento = new Map<number, number>();
  for (const r of abonosRows) {
    abonosPorDescuento.set(Number(r.descuento_id), Number(r.total ?? 0));
  }

  const montosRows = await query<RowDataPacket[]>(
    `SELECT id, monto_original FROM rrhh_descuentos_maestro
     WHERE empresa_id = ? AND id IN (${ph})`,
    [empresaId, ...descuentoIds],
  );

  const hoy = hoyLocal();
  for (const mr of montosRows) {
    const id = Number(mr.id);
    const montoOriginal = Number(mr.monto_original);
    const cuotas = cuotasPorDescuento.get(id) ?? [];
    let pagadoCuotas = 0;
    let cuotasAplicadas = 0;
    let proxima: ResumenSaldo["proximaCuota"] = null;
    for (const c of cuotas) {
      if (String(c.estado) === "APLICADA") {
        pagadoCuotas += Number(c.monto_aplicado ?? c.monto_programado ?? 0);
        cuotasAplicadas += 1;
      }
      if (!proxima && String(c.estado) === "PENDIENTE") {
        const fecha = toIsoDate(c.fecha_programada) ?? "";
        proxima = {
          numero: Number(c.numero_cuota),
          fecha,
          monto: Number(c.monto_programado),
        };
      }
    }
    const abonos = abonosPorDescuento.get(id) ?? 0;
    const pagado = redondearCentavos(pagadoCuotas + abonos);
    const saldo = redondearCentavos(Math.max(0, montoOriginal - pagado));
    map.set(id, {
      montoOriginal,
      pagado,
      saldo,
      cuotasTotal: cuotas.length,
      cuotasAplicadas,
      proximaCuota: proxima,
    });
    void hoy; // reservado: no se usa todavía para marcar cuotas vencidas en D1
  }
  return map;
}

export async function listarDescuentos(
  empresaId: number,
  filtros: FiltrosDescuentos = {},
): Promise<DescuentoConSaldo[]> {
  const where: string[] = ["d.empresa_id = ?"];
  const params: SqlParams = [empresaId];
  if (filtros.empleadoId) {
    where.push("d.empleado_id = ?");
    params.push(filtros.empleadoId);
  }
  if (filtros.estado) {
    where.push("d.estado = ?");
    params.push(filtros.estado);
  }
  if (filtros.clasificacion) {
    where.push("d.clasificacion = ?");
    params.push(filtros.clasificacion);
  }
  if (filtros.concepto?.trim()) {
    where.push("d.concepto LIKE ?");
    params.push(`%${filtros.concepto.trim()}%`);
  }
  if (filtros.fechaDesde) {
    where.push("d.fecha_inicio >= ?");
    params.push(filtros.fechaDesde);
  }
  if (filtros.fechaHasta) {
    where.push("d.fecha_inicio <= ?");
    params.push(filtros.fechaHasta);
  }
  const rows = await query<RowDataPacket[]>(
    `${SELECT_MAESTRO} WHERE ${where.join(" AND ")} ORDER BY d.creado_en DESC LIMIT 300`,
    params,
  );
  const maestros = rows.map(mapMaestro);
  const resumenes = await resumenesPorDescuento(empresaId, maestros.map((m) => m.id));
  return maestros.map((m) => {
    const r = resumenes.get(m.id);
    return {
      ...m,
      pagado: r?.pagado ?? 0,
      saldo: r?.saldo ?? m.montoOriginal,
      cuotasTotal: r?.cuotasTotal ?? 0,
      cuotasAplicadas: r?.cuotasAplicadas ?? 0,
      proximaCuota: r?.proximaCuota ?? null,
    };
  });
}

export async function obtenerDescuento(
  empresaId: number,
  id: number,
): Promise<DescuentoConSaldo | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_MAESTRO} WHERE d.id = ? AND d.empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  if (!rows[0]) return null;
  const m = mapMaestro(rows[0]);
  const resumenes = await resumenesPorDescuento(empresaId, [m.id]);
  const r = resumenes.get(m.id);
  return {
    ...m,
    pagado: r?.pagado ?? 0,
    saldo: r?.saldo ?? m.montoOriginal,
    cuotasTotal: r?.cuotasTotal ?? 0,
    cuotasAplicadas: r?.cuotasAplicadas ?? 0,
    proximaCuota: r?.proximaCuota ?? null,
  };
}

export async function listarCuotas(
  empresaId: number,
  descuentoId: number,
): Promise<CuotaDescuento[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_descuento_cuotas
     WHERE empresa_id = ? AND descuento_id = ? ORDER BY numero_cuota`,
    [empresaId, descuentoId],
  );
  return rows.map(mapCuota);
}

export async function listarAbonos(
  empresaId: number,
  descuentoId: number,
): Promise<AbonoDescuento[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_descuento_abonos
     WHERE empresa_id = ? AND descuento_id = ? ORDER BY fecha DESC, id DESC`,
    [empresaId, descuentoId],
  );
  return rows.map(mapAbono);
}

// ---------------------------------------------------------------------------
// Validación de empleado (mismo criterio que el resto de RRHH/TMS: nunca se
// confía en que un id pertenezca a la empresa solo porque llegó del cliente).
// ---------------------------------------------------------------------------

/** Exportada (Fase INV-1) para que inventario.ts valide el empleado de una entrega sin duplicar esta consulta. */
export async function validarEmpleado(
  empresaId: number,
  empleadoId: number,
): Promise<{ id: number; codigo: string; nombre: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM empleados
     WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
    [empleadoId, empresaId],
  );
  return rows[0]
    ? { id: Number(rows[0].id), codigo: String(rows[0].codigo), nombre: String(rows[0].nombre) }
    : null;
}

// ---------------------------------------------------------------------------
// Crear (BORRADOR) — no genera cuotas todavía.
// ---------------------------------------------------------------------------

export type NuevoDescuentoInput = {
  empleadoId: number;
  concepto: string;
  clasificacion: Clasificacion;
  motivo?: string | null;
  montoOriginal: number;
  periodicidad: Periodicidad;
  numeroCuotas: number;
  cadaNQuincenas?: number | null;
  tipoQuincenaInicio?: TipoQuincenaInicio | null;
  quincenaInicio?: 1 | 2 | null;
  fechaInicio: string;
  documentoId?: number | null;
  creadoPor: string;
};

export type ResultadoDescuento =
  | { ok: true; id: number }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Núcleo del INSERT en BORRADOR (Fase INV-1, exportada). Asume que el
 * llamador YA validó `input` (clasificación, periodicidad, monto, cuotas,
 * empleado, documento) — no repite esas validaciones. Recibe `conn`: si el
 * llamador tiene una transacción abierta (p.ej. la entrega de inventario),
 * este INSERT participa en ella. Lanza en caso de error de BD (incluido
 * ER_DUP_ENTRY de código, extremadamente improbable) — el llamador decide
 * cómo traducirlo.
 */
export async function crearDescuentoInterno(
  conn: PoolConnection,
  empresaId: number,
  input: NuevoDescuentoInput,
): Promise<{ id: number; codigo: string }> {
  const numeroCuotas =
    input.periodicidad === "UNA_VEZ" || input.periodicidad === "MANUAL"
      ? 1
      : Math.max(1, Math.trunc(input.numeroCuotas || 1));
  const anio = Number(input.fechaInicio.slice(0, 4)) || new Date().getFullYear();
  const codigo = await generarCodigoDescuento(empresaId, anio);
  const [montoCuota] = distribuirCuotas(input.montoOriginal, numeroCuotas);

  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO rrhh_descuentos_maestro
      (empresa_id, empleado_id, codigo, concepto, clasificacion, motivo,
       monto_original, estado, periodicidad, numero_cuotas, monto_cuota,
       cada_n_quincenas, tipo_quincena_inicio, quincena_inicio, fecha_inicio,
       documento_id, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'BORRADOR', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      input.empleadoId,
      codigo,
      input.concepto.trim(),
      input.clasificacion,
      input.motivo?.trim() || null,
      input.montoOriginal,
      input.periodicidad,
      numeroCuotas,
      montoCuota,
      input.periodicidad === "CADA_N_QUINCENAS" ? Math.trunc(Number(input.cadaNQuincenas)) : null,
      input.tipoQuincenaInicio ?? null,
      input.quincenaInicio ?? null,
      input.fechaInicio,
      input.documentoId ?? null,
      input.creadoPor,
    ],
  );
  return { id: Number(r.insertId), codigo };
}

export async function crearDescuento(
  empresaId: number,
  input: NuevoDescuentoInput,
): Promise<ResultadoDescuento> {
  if (!CLASIFICACIONES.includes(input.clasificacion)) {
    return { ok: false, motivo: "clasificacion_invalida", mensaje: "Clasificación inválida." };
  }
  if (!PERIODICIDADES.includes(input.periodicidad)) {
    return { ok: false, motivo: "periodicidad_invalida", mensaje: "Periodicidad inválida." };
  }
  if (!(input.montoOriginal > 0)) {
    return { ok: false, motivo: "monto_invalido", mensaje: "El monto original debe ser mayor a cero." };
  }
  const numeroCuotas =
    input.periodicidad === "UNA_VEZ" || input.periodicidad === "MANUAL"
      ? 1
      : Math.max(1, Math.trunc(input.numeroCuotas || 1));
  if (numeroCuotas > 60) {
    return { ok: false, motivo: "cuotas_invalidas", mensaje: "Máximo 60 cuotas por descuento." };
  }
  if (input.periodicidad === "CADA_N_QUINCENAS" && !(Number(input.cadaNQuincenas) > 0)) {
    return {
      ok: false,
      motivo: "periodicidad_incompleta",
      mensaje: "Indica cada cuántas quincenas se aplica.",
    };
  }

  const empleado = await validarEmpleado(empresaId, input.empleadoId);
  if (!empleado) {
    return {
      ok: false,
      motivo: "empleado_invalido",
      mensaje: "El colaborador no existe o no pertenece a esta empresa.",
    };
  }

  if (input.documentoId != null) {
    const doc = await obtenerDocumento(empresaId, input.documentoId);
    if (!doc || doc.idEmpleado !== empleado.id) {
      return {
        ok: false,
        motivo: "documento_invalido",
        mensaje: "El documento indicado no existe o no pertenece a este colaborador.",
      };
    }
  }

  const conn = await getPool().getConnection();
  try {
    const { id, codigo } = await crearDescuentoInterno(conn, empresaId, {
      ...input,
      numeroCuotas,
    });
    await registrarAuditoria({
      empresaId,
      usuario: input.creadoPor,
      accion: "crear_descuento",
      modulo: "rrhh",
      detalle: `Descuento #${id} ${codigo} · ${empleado.nombre} · ${input.concepto.trim()} · Q${input.montoOriginal.toFixed(2)} · ${numeroCuotas} cuota(s) · ${input.periodicidad}`,
    });
    return { ok: true, id };
  } catch {
    return { ok: false, motivo: "error", mensaje: "No se pudo crear el descuento." };
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Autorizar: BORRADOR -> ACTIVO, genera cuotas (transacción).
// ---------------------------------------------------------------------------

/**
 * Núcleo de la autorización (Fase INV-1, exportada): genera las cuotas
 * PENDIENTE y pasa el descuento a ACTIVO. Recibe `conn` — no abre ni
 * confirma ninguna transacción propia, participa en la del llamador. No
 * repite las validaciones de estado/JUDICIAL — eso lo hace autorizarDescuento
 * (o, en el caso de una entrega de inventario, el llamador ya construyó el
 * descuento con clasificación INVENTARIO, que nunca exige documento).
 */
export async function autorizarDescuentoInterno(
  conn: PoolConnection,
  empresaId: number,
  descuentoId: number,
  autorizadoPor: string,
  descuento: {
    periodicidad: Periodicidad;
    fechaInicio: string;
    numeroCuotas: number;
    cadaNQuincenas: number | null;
    montoOriginal: number;
  },
): Promise<{ cuotasGeneradas: number }> {
  const fechas = await calcularFechasCuotas(
    empresaId,
    descuento.periodicidad,
    descuento.fechaInicio,
    descuento.numeroCuotas,
    descuento.cadaNQuincenas,
  );
  const montos = distribuirCuotas(descuento.montoOriginal, descuento.numeroCuotas);

  for (let i = 0; i < fechas.length; i++) {
    await conn.execute<ResultSetHeader>(
      `INSERT INTO rrhh_descuento_cuotas
        (empresa_id, descuento_id, numero_cuota, fecha_programada, monto_programado, estado)
       VALUES (?, ?, ?, ?, ?, 'PENDIENTE')`,
      [empresaId, descuentoId, i + 1, fechas[i], montos[i]],
    );
  }

  await conn.execute(
    `UPDATE rrhh_descuentos_maestro
     SET estado = 'ACTIVO', autorizado_por = ?, autorizado_en = NOW()
     WHERE id = ? AND empresa_id = ?`,
    [autorizadoPor, descuentoId, empresaId],
  );

  return { cuotasGeneradas: fechas.length };
}

export async function autorizarDescuento(
  empresaId: number,
  descuentoId: number,
  autorizadoPor: string,
): Promise<ResultadoDescuento> {
  const descuento = await obtenerDescuento(empresaId, descuentoId);
  if (!descuento) {
    return { ok: false, motivo: "no_encontrado", mensaje: "Descuento no encontrado." };
  }
  if (descuento.estado !== "BORRADOR") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede autorizar un descuento en estado "${descuento.estado}".`,
    };
  }
  if (descuento.clasificacion === "JUDICIAL" && descuento.documentoId == null) {
    return {
      ok: false,
      motivo: "documento_requerido",
      mensaje:
        "Un descuento JUDICIAL requiere un documento/respaldo vinculado antes de autorizarse.",
    };
  }

  const conn = await getPool().getConnection();
  let cuotasGeneradas = 0;
  try {
    await conn.beginTransaction();
    const r = await autorizarDescuentoInterno(conn, empresaId, descuentoId, autorizadoPor, {
      periodicidad: descuento.periodicidad,
      fechaInicio: descuento.fechaInicio,
      numeroCuotas: descuento.numeroCuotas,
      cadaNQuincenas: descuento.cadaNQuincenas,
      montoOriginal: descuento.montoOriginal,
    });
    cuotasGeneradas = r.cuotasGeneradas;
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("[descuentos] autorizarDescuento", e);
    return { ok: false, motivo: "error", mensaje: "No se pudo autorizar el descuento." };
  } finally {
    conn.release();
  }

  await registrarAuditoria({
    empresaId,
    usuario: autorizadoPor,
    accion: "autorizar_descuento",
    modulo: "rrhh",
    detalle: `Descuento #${descuentoId} ${descuento.codigo} · BORRADOR → ACTIVO · ${cuotasGeneradas} cuota(s) generada(s)`,
  });
  return { ok: true, id: descuentoId };
}

// ---------------------------------------------------------------------------
// Pausar / reanudar
// ---------------------------------------------------------------------------

export async function pausarDescuento(
  empresaId: number,
  descuentoId: number,
  motivo: string,
  usuario: string,
): Promise<ResultadoDescuento> {
  if (!motivo?.trim()) {
    return { ok: false, motivo: "motivo_requerido", mensaje: "Debes indicar un motivo para pausar." };
  }
  const descuento = await obtenerDescuento(empresaId, descuentoId);
  if (!descuento) return { ok: false, motivo: "no_encontrado", mensaje: "Descuento no encontrado." };
  if (descuento.estado !== "ACTIVO") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede pausar un descuento en estado "${descuento.estado}".`,
    };
  }
  await execute(
    `UPDATE rrhh_descuentos_maestro SET estado = 'PAUSADO', motivo_pausa = ?
     WHERE id = ? AND empresa_id = ?`,
    [motivo.trim(), descuentoId, empresaId],
  );
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "pausar_descuento",
    modulo: "rrhh",
    detalle: `Descuento #${descuentoId} ${descuento.codigo} · ACTIVO → PAUSADO · motivo: ${motivo.trim()}`,
  });
  return { ok: true, id: descuentoId };
}

export async function reanudarDescuento(
  empresaId: number,
  descuentoId: number,
  usuario: string,
): Promise<ResultadoDescuento> {
  const descuento = await obtenerDescuento(empresaId, descuentoId);
  if (!descuento) return { ok: false, motivo: "no_encontrado", mensaje: "Descuento no encontrado." };
  if (descuento.estado !== "PAUSADO") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede reanudar un descuento en estado "${descuento.estado}".`,
    };
  }

  const hoy = hoyLocal();
  const conn = await getPool().getConnection();
  let reprogramadas = 0;
  try {
    await conn.beginTransaction();

    const [vencidas] = await conn.query<RowDataPacket[]>(
      `SELECT id, numero_cuota FROM rrhh_descuento_cuotas
       WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE' AND fecha_programada < ?
       ORDER BY numero_cuota`,
      [empresaId, descuentoId, hoy],
    );
    if (vencidas.length) {
      // Próxima quincena válida a partir de hoy — mismas fechas de "fin de
      // periodo" que calcularFechasCuotas, reutilizando la posición de hoy
      // como nuevo punto de partida para las cuotas atrasadas.
      const nuevasFechas = await calcularFechasCuotas(
        empresaId,
        descuento.periodicidad === "MANUAL" ? "CADA_QUINCENA" : descuento.periodicidad,
        hoy,
        vencidas.length,
        descuento.cadaNQuincenas,
      );
      for (let i = 0; i < vencidas.length; i++) {
        await conn.execute(
          `UPDATE rrhh_descuento_cuotas SET fecha_programada = ? WHERE id = ?`,
          [nuevasFechas[i], Number(vencidas[i].id)],
        );
      }
      reprogramadas = vencidas.length;
    }

    await conn.execute(
      `UPDATE rrhh_descuentos_maestro SET estado = 'ACTIVO', motivo_pausa = NULL
       WHERE id = ? AND empresa_id = ?`,
      [descuentoId, empresaId],
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("[descuentos] reanudarDescuento", e);
    return { ok: false, motivo: "error", mensaje: "No se pudo reanudar el descuento." };
  } finally {
    conn.release();
  }

  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "reanudar_descuento",
    modulo: "rrhh",
    detalle: `Descuento #${descuentoId} ${descuento.codigo} · PAUSADO → ACTIVO${reprogramadas ? ` · ${reprogramadas} cuota(s) reprogramada(s)` : ""}`,
  });
  return { ok: true, id: descuentoId };
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

export async function cancelarDescuento(
  empresaId: number,
  descuentoId: number,
  motivo: string,
  usuario: string,
): Promise<ResultadoDescuento> {
  if (!motivo?.trim()) {
    return { ok: false, motivo: "motivo_requerido", mensaje: "Debes indicar un motivo para cancelar." };
  }
  const descuento = await obtenerDescuento(empresaId, descuentoId);
  if (!descuento) return { ok: false, motivo: "no_encontrado", mensaje: "Descuento no encontrado." };
  if (!["BORRADOR", "ACTIVO", "PAUSADO"].includes(descuento.estado)) {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede cancelar un descuento en estado "${descuento.estado}".`,
    };
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE rrhh_descuento_cuotas SET estado = 'CANCELADA'
       WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE'`,
      [empresaId, descuentoId],
    );
    await conn.execute(
      `UPDATE rrhh_descuentos_maestro SET estado = 'CANCELADO', motivo_cancelacion = ?
       WHERE id = ? AND empresa_id = ?`,
      [motivo.trim(), descuentoId, empresaId],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("[descuentos] cancelarDescuento", e);
    return { ok: false, motivo: "error", mensaje: "No se pudo cancelar el descuento." };
  } finally {
    conn.release();
  }

  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "cancelar_descuento",
    modulo: "rrhh",
    detalle: `Descuento #${descuentoId} ${descuento.codigo} · ${descuento.estado} → CANCELADO · motivo: ${motivo.trim()}`,
  });
  return { ok: true, id: descuentoId };
}

// ---------------------------------------------------------------------------
// Recalcular cuotas futuras (solo PENDIENTE; nunca toca APLICADA/OMITIDA/CANCELADA)
// ---------------------------------------------------------------------------

export type RecalculoInput = {
  numeroCuotas?: number;
  montoCuota?: number; // informativo/objetivo — el reparto real sigue siendo exacto (distribuirCuotas)
};

export async function recalcularCuotasFuturas(
  empresaId: number,
  descuentoId: number,
  input: RecalculoInput,
  usuario: string,
): Promise<ResultadoDescuento> {
  const descuento = await obtenerDescuento(empresaId, descuentoId);
  if (!descuento) return { ok: false, motivo: "no_encontrado", mensaje: "Descuento no encontrado." };
  if (descuento.estado !== "ACTIVO" && descuento.estado !== "PAUSADO") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se pueden recalcular cuotas en estado "${descuento.estado}".`,
    };
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [pendientesRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, numero_cuota, fecha_programada FROM rrhh_descuento_cuotas
       WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE'
       ORDER BY numero_cuota`,
      [empresaId, descuentoId],
    );
    if (!pendientesRows.length) {
      await conn.rollback();
      return {
        ok: false,
        motivo: "sin_pendientes",
        mensaje: "Este descuento no tiene cuotas pendientes para recalcular.",
      };
    }

    const numeroBase = Number(pendientesRows[0].numero_cuota) - 1;
    const nuevasCuotas = Math.max(1, Math.trunc(input.numeroCuotas ?? pendientesRows.length));

    const [resumenRows] = await conn.query<RowDataPacket[]>(
      `SELECT
         COALESCE((SELECT SUM(monto_aplicado) FROM rrhh_descuento_cuotas
                    WHERE empresa_id = ? AND descuento_id = ? AND estado = 'APLICADA'), 0) AS aplicado,
         COALESCE((SELECT SUM(monto) FROM rrhh_descuento_abonos
                    WHERE empresa_id = ? AND descuento_id = ?), 0) AS abonado`,
      [empresaId, descuentoId, empresaId, descuentoId],
    );
    const pagado = Number(resumenRows[0]?.aplicado ?? 0) + Number(resumenRows[0]?.abonado ?? 0);
    const saldoPendiente = redondearCentavos(Math.max(0, descuento.montoOriginal - pagado));

    await conn.execute(
      `DELETE FROM rrhh_descuento_cuotas
       WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE'`,
      [empresaId, descuentoId],
    );

    const primeraFecha = String(pendientesRows[0].fecha_programada).slice(0, 10);
    const nuevasFechas = await calcularFechasCuotas(
      empresaId,
      descuento.periodicidad,
      toIsoDate(primeraFecha) ?? primeraFecha,
      nuevasCuotas,
      descuento.cadaNQuincenas,
    );
    const nuevosMontos = distribuirCuotas(saldoPendiente, nuevasCuotas);

    for (let i = 0; i < nuevasCuotas; i++) {
      await conn.execute(
        `INSERT INTO rrhh_descuento_cuotas
          (empresa_id, descuento_id, numero_cuota, fecha_programada, monto_programado, estado)
         VALUES (?, ?, ?, ?, ?, 'PENDIENTE')`,
        [empresaId, descuentoId, numeroBase + 1 + i, nuevasFechas[i], nuevosMontos[i]],
      );
    }

    await conn.execute(
      `UPDATE rrhh_descuentos_maestro
       SET numero_cuotas = ?, monto_cuota = ?
       WHERE id = ? AND empresa_id = ?`,
      [numeroBase + nuevasCuotas, nuevosMontos[0] ?? descuento.montoCuota, descuentoId, empresaId],
    );

    await conn.commit();

    await registrarAuditoria({
      empresaId,
      usuario,
      accion: "cambiar_cuotas_futuras",
      modulo: "rrhh",
      detalle: `Descuento #${descuentoId} ${descuento.codigo} · cuotas pendientes ${pendientesRows.length} → ${nuevasCuotas} · monto cuota ${descuento.montoCuota.toFixed(2)} → ${(nuevosMontos[0] ?? 0).toFixed(2)}`,
    });
    return { ok: true, id: descuentoId };
  } catch (e) {
    await conn.rollback();
    console.error("[descuentos] recalcularCuotasFuturas", e);
    return { ok: false, motivo: "error", mensaje: "No se pudieron recalcular las cuotas." };
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Abono extraordinario (solo RRHH/admin — nunca Portal)
// ---------------------------------------------------------------------------

export type AbonoInput = {
  monto: number;
  fecha: string;
  motivo: string;
  registradoPor: string;
};

export async function registrarAbonoExtraordinario(
  empresaId: number,
  descuentoId: number,
  input: AbonoInput,
): Promise<ResultadoDescuento> {
  if (!input.motivo?.trim()) {
    return { ok: false, motivo: "motivo_requerido", mensaje: "Debes indicar un motivo para el abono." };
  }
  if (!(input.monto > 0)) {
    return { ok: false, motivo: "monto_invalido", mensaje: "El monto del abono debe ser mayor a cero." };
  }
  const descuento = await obtenerDescuento(empresaId, descuentoId);
  if (!descuento) return { ok: false, motivo: "no_encontrado", mensaje: "Descuento no encontrado." };
  if (descuento.estado !== "ACTIVO" && descuento.estado !== "PAUSADO") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede abonar a un descuento en estado "${descuento.estado}".`,
    };
  }
  if (input.monto > descuento.saldo + 0.005) {
    return {
      ok: false,
      motivo: "monto_excede_saldo",
      mensaje: `El abono (Q${input.monto.toFixed(2)}) no puede ser mayor al saldo actual (Q${descuento.saldo.toFixed(2)}).`,
    };
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO rrhh_descuento_abonos
        (empresa_id, descuento_id, monto, fecha, motivo, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, descuentoId, input.monto, input.fecha, input.motivo.trim(), input.registradoPor],
    );

    const nuevoSaldo = redondearCentavos(descuento.saldo - input.monto);

    if (nuevoSaldo <= 0.004) {
      await conn.execute(
        `UPDATE rrhh_descuento_cuotas SET estado = 'OMITIDA'
         WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE'`,
        [empresaId, descuentoId],
      );
      await conn.execute(
        `UPDATE rrhh_descuentos_maestro SET estado = 'FINALIZADO' WHERE id = ? AND empresa_id = ?`,
        [descuentoId, empresaId],
      );
    } else {
      const [pendientesRows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM rrhh_descuento_cuotas
         WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE'
         ORDER BY numero_cuota`,
        [empresaId, descuentoId],
      );
      if (pendientesRows.length) {
        const nuevosMontos = distribuirCuotas(nuevoSaldo, pendientesRows.length);
        for (let i = 0; i < pendientesRows.length; i++) {
          await conn.execute(
            `UPDATE rrhh_descuento_cuotas SET monto_programado = ? WHERE id = ?`,
            [nuevosMontos[i], Number(pendientesRows[i].id)],
          );
        }
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error("[descuentos] registrarAbonoExtraordinario", e);
    return { ok: false, motivo: "error", mensaje: "No se pudo registrar el abono." };
  } finally {
    conn.release();
  }

  await registrarAuditoria({
    empresaId,
    usuario: input.registradoPor,
    accion: "abono_extraordinario",
    modulo: "rrhh",
    detalle: `Descuento #${descuentoId} ${descuento.codigo} · abono Q${input.monto.toFixed(2)} · saldo ${descuento.saldo.toFixed(2)} → ${Math.max(0, descuento.saldo - input.monto).toFixed(2)} · motivo: ${input.motivo.trim()}`,
  });
  return { ok: true, id: descuentoId };
}

export type { PoolConnection };

// ---------------------------------------------------------------------------
// Fase D2 — integración con generación de planilla. Vive aquí (no en
// planillas.ts) porque descuentos.ts es el dueño del modelo de cuotas; el
// generador de planilla solo llama a estas funciones dentro de SU MISMA
// transacción (recibe `conn`), sin conocer los detalles internos.
// ---------------------------------------------------------------------------

/**
 * Marca FINALIZADO un descuento ACTIVO si ya no tiene saldo cobrable ni
 * cuotas PENDIENTES. Nunca fuerza FINALIZADO con saldo pendiente. Debe
 * llamarse con la misma `conn` de la transacción que aplicó la cuota/abono.
 */
async function finalizarSiCorresponde(
  conn: PoolConnection,
  empresaId: number,
  descuentoId: number,
): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT
       d.estado,
       d.monto_original,
       COALESCE((SELECT SUM(monto_aplicado) FROM rrhh_descuento_cuotas
                  WHERE empresa_id = ? AND descuento_id = ? AND estado = 'APLICADA'), 0) AS aplicado,
       COALESCE((SELECT SUM(monto) FROM rrhh_descuento_abonos
                  WHERE empresa_id = ? AND descuento_id = ?), 0) AS abonado,
       (SELECT COUNT(*) FROM rrhh_descuento_cuotas
         WHERE empresa_id = ? AND descuento_id = ? AND estado = 'PENDIENTE') AS pendientes
     FROM rrhh_descuentos_maestro d
     WHERE d.id = ? AND d.empresa_id = ? LIMIT 1`,
    [empresaId, descuentoId, empresaId, descuentoId, empresaId, descuentoId, descuentoId, empresaId],
  );
  const r = rows[0];
  if (!r || String(r.estado) !== "ACTIVO") return;
  const saldo =
    Number(r.monto_original) - Number(r.aplicado ?? 0) - Number(r.abonado ?? 0);
  if (saldo <= 0.004 && Number(r.pendientes) === 0) {
    await conn.execute(
      `UPDATE rrhh_descuentos_maestro SET estado = 'FINALIZADO' WHERE id = ? AND empresa_id = ?`,
      [descuentoId, empresaId],
    );
  }
}

export type PeriodoParaCuotas = { id: number; fechaInicio: string; fechaFin: string };

/**
 * Aplica, dentro de la transacción `conn` del llamador (generarLineasPeriodo),
 * A LO SUMO UNA cuota PENDIENTE por descuento — la siguiente en la
 * secuencia (MIN(numero_cuota) entre las PENDIENTE de ese descuento) —
 * elegible para `periodo`:
 * - descuento maestro ACTIVO (nunca BORRADOR/PAUSADO/CANCELADO/FINALIZADO);
 * - es la cuota siguiente pendiente de su descuento (no salta cuotas ni
 *   aplica dos en la misma pasada, ver nota de semántica abajo);
 * - esa cuota siguiente tiene fecha_programada <= periodo.fechaFin (SIN
 *   piso en periodo.fechaInicio — ver nota de corrección de bug abajo);
 * - fecha_programada es la fuente de verdad — D2 NO recalcula periodicidad.
 *
 * CORRECCIÓN 1 (bug confirmado en producción): antes se exigía
 * `fecha_programada BETWEEN periodo.fechaInicio AND periodo.fechaFin`. Una
 * cuota con fecha_programada anterior a fechaInicio (p.ej. vencida en un
 * periodo que nunca se generó, o de una quincena anterior saltada) nunca
 * volvía a aparecer como elegible en NINGÚN periodo futuro, aunque
 * estuviera PENDIENTE — quedaba huérfana indefinidamente. La regla de
 * negocio correcta es que una cuota vencida y pendiente se arrastre y se
 * aplique en el primer periodo que se genere después de su fecha, no que
 * se pierda.
 *
 * CORRECCIÓN 2 (semántica de periodicidad, segundo bug confirmado): quitar
 * el piso de fechaInicio por sí solo permitía que, si dos o más cuotas del
 * MISMO descuento quedaban vencidas y pendientes a la vez (p.ej. cuota 1 de
 * agosto y cuota 2 de la quincena de septiembre, ambas <= fechaFin de un
 * único periodo), TODAS calificaran como elegibles y se aplicaran juntas en
 * una sola planilla — cobrando de una vez varias cuotas de un descuento
 * pensado como "cada quincena". Eso rompe la periodicidad del descuento.
 * La corrección: el filtro ahora exige que la cuota sea la MIN(numero_cuota)
 * entre las PENDIENTE de ese descuento_id — es decir, siempre avanza
 * exactamente una cuota por descuento en cada llamada, en orden estricto,
 * sin importar cuántas queden vencidas acumuladas. Si quedan varias
 * vencidas, la siguiente se recupera en la próxima generación (de este
 * periodo o del que sea), nunca dos juntas en la misma planilla. Aplica
 * igual para cualquier descuento D1/D2, sin importar su clasificación.
 *
 * Cada cuota se transiciona con un UPDATE condicional
 * (WHERE estado='PENDIENTE' AND planilla_periodo_id IS NULL) y se verifica
 * affectedRows === 1 antes de contarla — si otra ejecución concurrente ya la
 * aplicó, esta pasada la ignora en vez de reintentar; esto también es lo
 * que impide aplicar la misma cuota dos veces si dos periodos se generan
 * casi al mismo tiempo — el primero que la reclame gana, el resto ve
 * affectedRows=0. Al regenerar el mismo periodo, las cuotas ya APLICADA con
 * planilla_periodo_id = periodo.id NO vuelven a aparecer en el SELECT de
 * elegibles (ya no son PENDIENTE, y tampoco son ya la "siguiente pendiente"
 * de su descuento) — nunca se reprocesan ni se duplican.
 */
export async function aplicarCuotasElegibles(
  conn: PoolConnection,
  empresaId: number,
  periodo: PeriodoParaCuotas,
  usuario: string,
): Promise<{ aplicadas: number; totalAplicado: number }> {
  // Recupera descuentos MANUAL autorizados con la implementación anterior,
  // que los dejaba ACTIVO pero sin ninguna cuota y por eso nunca aparecían
  // en planilla. INSERT IGNORE + la llave (descuento_id, numero_cuota) hace
  // esta reparación idempotente incluso ante generaciones concurrentes.
  await conn.execute(
    `INSERT IGNORE INTO rrhh_descuento_cuotas
       (empresa_id, descuento_id, numero_cuota, fecha_programada, monto_programado, estado)
     SELECT d.empresa_id, d.id, 1, d.fecha_inicio,
            d.monto_original - COALESCE((
              SELECT SUM(a.monto) FROM rrhh_descuento_abonos a
              WHERE a.empresa_id = d.empresa_id AND a.descuento_id = d.id
            ), 0),
            'PENDIENTE'
     FROM rrhh_descuentos_maestro d
     WHERE d.empresa_id = ? AND d.estado = 'ACTIVO' AND d.periodicidad = 'MANUAL'
       AND NOT EXISTS (
         SELECT 1 FROM rrhh_descuento_cuotas c0
         WHERE c0.empresa_id = d.empresa_id AND c0.descuento_id = d.id
       )
       AND d.monto_original - COALESCE((
         SELECT SUM(a2.monto) FROM rrhh_descuento_abonos a2
         WHERE a2.empresa_id = d.empresa_id AND a2.descuento_id = d.id
       ), 0) > 0.004`,
    [empresaId],
  );

  const [elegibles] = await conn.query<RowDataPacket[]>(
    `SELECT c.id, c.descuento_id, c.monto_programado
     FROM rrhh_descuento_cuotas c
     INNER JOIN rrhh_descuentos_maestro d ON d.id = c.descuento_id AND d.empresa_id = c.empresa_id
     INNER JOIN (
       SELECT empresa_id, descuento_id, MIN(numero_cuota) AS numero_cuota
       FROM rrhh_descuento_cuotas
       WHERE empresa_id = ? AND estado = 'PENDIENTE' AND planilla_periodo_id IS NULL
       GROUP BY empresa_id, descuento_id
     ) siguiente ON siguiente.empresa_id = c.empresa_id
       AND siguiente.descuento_id = c.descuento_id
       AND siguiente.numero_cuota = c.numero_cuota
     WHERE c.empresa_id = ?
       AND c.estado = 'PENDIENTE' AND c.planilla_periodo_id IS NULL
       AND d.estado = 'ACTIVO'
       AND c.fecha_programada <= ?
       AND NOT EXISTS (
         SELECT 1 FROM rrhh_descuento_cuotas aplicada
         WHERE aplicada.empresa_id = c.empresa_id
           AND aplicada.descuento_id = c.descuento_id
           AND aplicada.planilla_periodo_id = ?
           AND aplicada.estado = 'APLICADA'
       )
     ORDER BY c.id`,
    [empresaId, empresaId, periodo.fechaFin, periodo.id],
  );

  let aplicadas = 0;
  let totalAplicado = 0;
  const descuentosAfectados = new Set<number>();

  for (const c of elegibles) {
    const monto = Number(c.monto_programado);
    const [r] = await conn.execute<ResultSetHeader>(
      `UPDATE rrhh_descuento_cuotas
       SET estado = 'APLICADA', planilla_periodo_id = ?, monto_aplicado = ?,
           aplicado_en = NOW(), aplicado_por = ?
       WHERE id = ? AND empresa_id = ? AND estado = 'PENDIENTE' AND planilla_periodo_id IS NULL`,
      [periodo.id, monto, usuario, Number(c.id), empresaId],
    );
    if (r.affectedRows === 1) {
      aplicadas += 1;
      totalAplicado += monto;
      descuentosAfectados.add(Number(c.descuento_id));
    }
    // affectedRows === 0: otra ejecución ya la aplicó — no se reintenta.
  }

  for (const descuentoId of descuentosAfectados) {
    await finalizarSiCorresponde(conn, empresaId, descuentoId);
  }

  return { aplicadas, totalAplicado: redondearCentavos(totalAplicado) };
}

/**
 * Suma, por empleado, TODAS las cuotas APLICADA vinculadas a este periodo —
 * tanto las recién aplicadas en esta misma generación como las que ya
 * estaban aplicadas de una generación/regeneración anterior del mismo
 * periodo. Debe llamarse DESPUÉS de aplicarCuotasElegibles(), en la misma
 * transacción, para que el resultado incluya ambos casos.
 */
export async function sumaCuotasAplicadasPorPeriodo(
  conn: PoolConnection,
  empresaId: number,
  periodoId: number,
): Promise<Map<number, number>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT d.empleado_id, SUM(c.monto_aplicado) AS total
     FROM rrhh_descuento_cuotas c
     INNER JOIN rrhh_descuentos_maestro d ON d.id = c.descuento_id AND d.empresa_id = c.empresa_id
     WHERE c.empresa_id = ? AND c.planilla_periodo_id = ? AND c.estado = 'APLICADA'
     GROUP BY d.empleado_id`,
    [empresaId, periodoId],
  );
  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(Number(r.empleado_id), Number(r.total ?? 0));
  }
  return map;
}

/**
 * Detalle itemizado de cuotas D1 aplicadas a un empleado en un periodo
 * específico — para la boleta, mismo formato (concepto/monto/fecha/notas)
 * que ItemDetalle de planillas.ts (no se importa el tipo para evitar un
 * ciclo de imports entre descuentos.ts y planillas.ts; es estructuralmente
 * compatible, se concatena sin problema en el consumidor).
 */
export async function listarCuotasAplicadasDetalle(
  empresaId: number,
  empleadoId: number,
  periodoId: number,
): Promise<{ concepto: string; monto: number; fecha: string; notas: string }[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT d.codigo, d.concepto, d.motivo, d.numero_cuotas, c.numero_cuota, c.monto_aplicado, c.aplicado_en
     FROM rrhh_descuento_cuotas c
     INNER JOIN rrhh_descuentos_maestro d ON d.id = c.descuento_id AND d.empresa_id = c.empresa_id
     WHERE c.empresa_id = ? AND c.planilla_periodo_id = ? AND c.estado = 'APLICADA'
       AND d.empleado_id = ?
     ORDER BY d.codigo, c.numero_cuota`,
    [empresaId, periodoId, empleadoId],
  );
  return rows.map((r) => ({
    concepto: `${String(r.concepto)} · Cuota ${Number(r.numero_cuota)} de ${Number(r.numero_cuotas)}`,
    monto: Number(r.monto_aplicado ?? 0),
    fecha: toIsoDate(r.aplicado_en) ?? "",
    notas: [r.motivo ? String(r.motivo) : "", `Descuento ${String(r.codigo)}`]
      .filter(Boolean)
      .join(" · "),
  }));
}

export async function listarCuotasAplicadasPeriodoDetalle(
  empresaId: number,
  periodoId: number,
): Promise<Record<number, { concepto: string; monto: number; fecha: string; notas: string }[]>> {
  const rows = await query<RowDataPacket[]>(
    `SELECT d.empleado_id, d.codigo, d.concepto, d.motivo, d.numero_cuotas,
            c.numero_cuota, c.monto_aplicado, c.aplicado_en
     FROM rrhh_descuento_cuotas c
     INNER JOIN rrhh_descuentos_maestro d ON d.id = c.descuento_id AND d.empresa_id = c.empresa_id
     WHERE c.empresa_id = ? AND c.planilla_periodo_id = ? AND c.estado = 'APLICADA'
     ORDER BY d.empleado_id, d.codigo, c.numero_cuota`,
    [empresaId, periodoId],
  );
  const detalle: Record<number, { concepto: string; monto: number; fecha: string; notas: string }[]> = {};
  for (const r of rows) {
    const empleadoId = Number(r.empleado_id);
    (detalle[empleadoId] ??= []).push({
      concepto: `${String(r.concepto)} · Cuota ${Number(r.numero_cuota)} de ${Number(r.numero_cuotas)}`,
      monto: Number(r.monto_aplicado ?? 0),
      fecha: toIsoDate(r.aplicado_en) ?? "",
      notas: [r.motivo ? String(r.motivo) : "", `Descuento ${String(r.codigo)}`]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return detalle;
}

/**
 * Fase D2: si el periodo tiene cuotas D1 ya APLICADA vinculadas
 * (planilla_periodo_id = periodo.id), no se puede cancelar sin antes
 * revertirlas — la reversión explícita no está implementada todavía. Se
 * llama desde cancelarPeriodo() de planillas.ts antes de cambiar el estado.
 */
export async function tieneCuotasAplicadasEnPeriodo(
  empresaId: number,
  periodoId: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM rrhh_descuento_cuotas
     WHERE empresa_id = ? AND planilla_periodo_id = ? AND estado = 'APLICADA'
     LIMIT 1`,
    [empresaId, periodoId],
  );
  return rows.length > 0;
}

/** Mapea el `motivo` de un ResultadoDescuento fallido a un status HTTP. Reutilizado por ambos endpoints. */
const MOTIVOS_CONFLICTO = new Set([
  "estado_no_permite",
  "documento_requerido",
  "sin_pendientes",
  "monto_excede_saldo",
]);
export function statusParaMotivo(motivo: string): number {
  if (motivo === "no_encontrado") return 404;
  if (motivo === "error") return 500;
  if (MOTIVOS_CONFLICTO.has(motivo)) return 409;
  return 400;
}
