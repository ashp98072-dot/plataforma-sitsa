import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { execute, getPool, query } from "@/lib/db";
import {
  esOutsourcing,
  IGSS_LABORAL_PCT,
  IGSS_PATRONAL_PCT,
  normalizarFormaPago,
  normalizarTipoContrato,
  redondearQ,
  type FormaPago,
} from "@/lib/rrhh/contratos-pago";
import { calcularISRMensual } from "@/lib/rrhh/isr";
import { obtenerRangoPeriodo } from "@/lib/rrhh/periodos";
import {
  aplicarCuotasElegibles,
  sumaCuotasAplicadasPorPeriodo,
  tieneCuotasAplicadasEnPeriodo,
} from "@/lib/rrhh/descuentos";
import {
  aplicarHorasExtraElegibles,
  sumaHorasExtraAplicadasPorPeriodo,
  tieneHorasExtraAplicadasEnPeriodo,
} from "@/lib/rrhh/horas-extra";
import { registrarAuditoria } from "@/lib/auditoria";

/** Fase P0: identidad opcional de quincena/mes de un periodo. */
export type TipoPeriodo = "QUINCENA_1" | "QUINCENA_2" | "MENSUAL" | "ESPECIAL";

const TIPOS_PERIODO: readonly TipoPeriodo[] = [
  "QUINCENA_1",
  "QUINCENA_2",
  "MENSUAL",
  "ESPECIAL",
];

export type PlanillaPeriodo = {
  id: number;
  codigo: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
  notas: string | null;
  // Fase P0: aditivos, NULL en periodos históricos.
  tipoPeriodo: TipoPeriodo | null;
  numeroQuincena: 1 | 2 | null;
  mes: number | null;
  anio: number | null;
  motivoCancelacion: string | null;
};

export type PlanillaLinea = {
  id: number;
  periodoId: number;
  empleadoId: number;
  codigoEmpleado: string;
  nombreEmpleado: string;
  dpi: string;
  tipoContrato: string;
  formaPago: FormaPago;
  /**
   * Fase P1: sueldo CONTRACTUAL mensual del empleado, para mostrar junto al
   * sueldo del período — leído en vivo de `empleados.sueldo_base` (no es una
   * copia histórica: si el sueldo del empleado cambia después de generar un
   * periodo antiguo, este campo reflejará el valor actual, no el vigente en
   * ese momento). `sueldoBase` de abajo sigue siendo el valor REAL usado
   * para ese período — completo en MENSUAL/ESPECIAL/histórico, repartido en
   * QUINCENA_1/QUINCENA_2 (ver generarLineasPeriodo).
   */
  sueldoMensual: number;
  sueldoBase: number;
  bonoIncentivo: number;
  bonoHerramientas: number;
  otrosIngresos: number;
  igssLaboral: number;
  igssPatronal: number;
  descuentos: number;
  isr: number;
  neto: number;
  estadoPago: string;
  refPago: string;
  notas: string;
};

export type CuadrePlanilla = {
  porFormaPago: Record<
    FormaPago,
    {
      cantidad: number;
      neto: number;
      pagado: number;
      pendiente: number;
    }
  >;
  totales: {
    empleados: number;
    formales: number;
    outsourcing: number;
    sueldoBase: number;
    bonos: number;
    otrosIngresos: number;
    igssLaboral: number;
    igssPatronal: number;
    descuentos: number;
    isr: number;
    neto: number;
    pagado: number;
    pendiente: number;
  };
};

let schemaReady: Promise<void> | null = null;

export async function asegurarSchemaPlanillas(): Promise<void> {
  if (!schemaReady) {
    schemaReady = asegurarInner().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
}

async function asegurarInner(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS rrhh_planilla_periodos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      codigo VARCHAR(40) NOT NULL,
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      estado VARCHAR(40) NOT NULL DEFAULT 'Borrador',
      notas TEXT NULL,
      creado_por VARCHAR(100) NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_planilla (empresa_id, codigo),
      INDEX idx_plan_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Fase P0: tipo_periodo/numero_quincena/mes/anio/motivo_cancelacion y los
  // índices idx_periodos_fechas/uq_planilla_identidad ya NO se crean aquí
  // en runtime — son responsabilidad exclusiva de sql/schema.sql
  // (instalaciones nuevas) y de la migración manual
  // sql/migrate-2026-08-rrhh-planilla-periodos-p0.sql (producción, ya
  // ejecutada). La aplicación solo LEE/ESCRIBE estas columnas, nunca
  // modifica la estructura de la base al entrar al módulo.

  await execute(`
    CREATE TABLE IF NOT EXISTS rrhh_planilla_lineas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      periodo_id INT NOT NULL,
      id_empleado INT NOT NULL,
      codigo_empleado VARCHAR(40) NOT NULL,
      nombre_empleado VARCHAR(200) NOT NULL,
      dpi VARCHAR(20) NULL,
      tipo_contrato VARCHAR(40) NULL,
      forma_pago VARCHAR(40) NOT NULL DEFAULT 'transferencia',
      sueldo_base DECIMAL(12,2) NOT NULL DEFAULT 0,
      bono_incentivo DECIMAL(12,2) NOT NULL DEFAULT 0,
      bono_herramientas DECIMAL(12,2) NOT NULL DEFAULT 0,
      otros_ingresos DECIMAL(12,2) NOT NULL DEFAULT 0,
      igss_laboral DECIMAL(12,2) NOT NULL DEFAULT 0,
      igss_patronal DECIMAL(12,2) NOT NULL DEFAULT 0,
      descuentos DECIMAL(12,2) NOT NULL DEFAULT 0,
      isr DECIMAL(12,2) NOT NULL DEFAULT 0,
      neto DECIMAL(12,2) NOT NULL DEFAULT 0,
      estado_pago VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
      ref_pago VARCHAR(120) NULL,
      notas TEXT NULL,
      UNIQUE KEY uq_plan_linea (periodo_id, id_empleado),
      INDEX idx_plan_lineas_periodo (empresa_id, periodo_id),
      INDEX idx_plan_lineas_pago (empresa_id, forma_pago, estado_pago)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function mapPeriodo(r: RowDataPacket): PlanillaPeriodo {
  const tipo = r.tipo_periodo != null ? String(r.tipo_periodo) : null;
  return {
    id: Number(r.id),
    codigo: String(r.codigo),
    // DATE no representa una hora local. Si mysql2 lo entrega como Date,
    // conservar el calendario UTC evita que Guatemala reste un día.
    fechaInicio: fechaSql(r.fecha_inicio),
    fechaFin: fechaSql(r.fecha_fin),
    estado: String(r.estado),
    notas: r.notas != null ? String(r.notas) : null,
    tipoPeriodo: (TIPOS_PERIODO as readonly string[]).includes(tipo ?? "")
      ? (tipo as TipoPeriodo)
      : null,
    numeroQuincena:
      r.numero_quincena === 1 || r.numero_quincena === 2
        ? (r.numero_quincena as 1 | 2)
        : null,
    mes: r.mes != null ? Number(r.mes) : null,
    anio: r.anio != null ? Number(r.anio) : null,
    motivoCancelacion:
      r.motivo_cancelacion != null ? String(r.motivo_cancelacion) : null,
  };
}

function fechaSql(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function mapLinea(r: RowDataPacket): PlanillaLinea {
  return {
    id: Number(r.id),
    periodoId: Number(r.periodo_id),
    empleadoId: Number(r.id_empleado),
    codigoEmpleado: String(r.codigo_empleado ?? ""),
    nombreEmpleado: String(r.nombre_empleado ?? ""),
    dpi: r.dpi ? String(r.dpi) : "",
    tipoContrato: String(r.tipo_contrato ?? "fijo"),
    formaPago: normalizarFormaPago(String(r.forma_pago ?? "transferencia")),
    sueldoMensual: Number(r.sueldo_mensual ?? r.sueldo_base ?? 0),
    sueldoBase: Number(r.sueldo_base ?? 0),
    bonoIncentivo: Number(r.bono_incentivo ?? 0),
    bonoHerramientas: Number(r.bono_herramientas ?? 0),
    otrosIngresos: Number(r.otros_ingresos ?? 0),
    igssLaboral: Number(r.igss_laboral ?? 0),
    igssPatronal: Number(r.igss_patronal ?? 0),
    descuentos: Number(r.descuentos ?? 0),
    isr: Number(r.isr ?? 0),
    neto: Number(r.neto ?? 0),
    estadoPago: String(r.estado_pago ?? "Pendiente"),
    refPago: r.ref_pago ? String(r.ref_pago) : "",
    notas: r.notas ? String(r.notas) : "",
  };
}

export async function listarPeriodos(
  empresaId: number,
): Promise<PlanillaPeriodo[]> {
  await asegurarSchemaPlanillas();
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_planilla_periodos
     WHERE empresa_id = ? ORDER BY fecha_inicio DESC, id DESC LIMIT 100`,
    [empresaId],
  );
  return rows.map(mapPeriodo);
}

export async function obtenerPeriodo(
  empresaId: number,
  id: number,
): Promise<PlanillaPeriodo | null> {
  await asegurarSchemaPlanillas();
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_planilla_periodos
     WHERE empresa_id = ? AND id = ? LIMIT 1`,
    [empresaId, id],
  );
  return rows[0] ? mapPeriodo(rows[0]) : null;
}

export type NuevoPeriodoInput = {
  /**
   * Fase P1: opcional. Si se omite y hay identidad de quincena completa
   * (tipoPeriodo QUINCENA_1/QUINCENA_2 + mes + anio + numeroQuincena), se
   * genera automáticamente como YYYY-MM-Q1/YYYY-MM-Q2 (ver
   * generarCodigoPeriodoQuincenal). MENSUAL/ESPECIAL siguen requiriendo
   * código manual, igual que antes.
   */
  codigo?: string;
  /**
   * Fase P1: opcional. Si se omiten y hay identidad de quincena/mes
   * (tipoPeriodo + mes + anio), se calculan automáticamente con
   * obtenerRangoPeriodo() — mismo cálculo ya usado por /planillas/sugerir,
   * respetando ciclo_quincenal configurado por empresa y el último día
   * real del mes (28/29/30/31).
   */
  fechaInicio?: string;
  fechaFin?: string;
  notas?: string | null;
  creadoPor: string;
  tipoPeriodo?: TipoPeriodo | null;
  numeroQuincena?: 1 | 2 | null;
  mes?: number | null;
  anio?: number | null;
};

export type ResultadoCrearPeriodo =
  | { ok: true; id: number; codigo: string; fechaInicio: string; fechaFin: string }
  | {
      ok: false;
      motivo: "fechas_invalidas" | "solapado" | "codigo_duplicado" | "lock" | "error";
      mensaje: string;
    };

/**
 * Código legible determinístico para una quincena: YYYY-MM-Q1 / YYYY-MM-Q2.
 * Verifica colisión contra códigos ya existentes de la empresa (poco
 * probable — solo ocurriría si algún periodo anterior ya usó manualmente
 * ese mismo texto) y agrega un sufijo numérico como salida seguras. Se
 * llama SIEMPRE dentro del GET_LOCK de crearPeriodo, así que no hay carrera
 * posible entre dos altas concurrentes de la misma empresa.
 */
async function generarCodigoPeriodoQuincenal(
  empresaId: number,
  anio: number,
  mes: number,
  quincena: 1 | 2,
): Promise<string | null> {
  const base = `${anio}-${String(mes).padStart(2, "0")}-Q${quincena}`;
  for (let intento = 0; intento < 6; intento++) {
    const candidato = intento === 0 ? base : `${base}-${intento + 1}`;
    const rows = await query<RowDataPacket[]>(
      `SELECT id FROM rrhh_planilla_periodos WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
      [empresaId, candidato],
    );
    if (!rows[0]) return candidato;
  }
  return null;
}

/**
 * Fase P0: crea un periodo validando fechas y solapamiento, protegido con
 * GET_LOCK por empresa (mismo patrón ya usado en flota/viajes y
 * flota/servicios) para que dos requests concurrentes no puedan crear dos
 * periodos solapados — un SELECT de verificación seguido de un INSERT
 * separado no es suficiente contra esa carrera.
 *
 * Fase P1: código y fechas ahora son opcionales en el input — si hay
 * identidad de quincena completa (tipoPeriodo QUINCENA_1/QUINCENA_2 + mes +
 * anio + numeroQuincena), ambos se calculan/generan automáticamente DENTRO
 * del mismo GET_LOCK, antes de la verificación de solapamiento. MENSUAL,
 * ESPECIAL, y cualquier llamador que ya envíe código/fechas manualmente
 * (compatibilidad con clientes existentes) siguen funcionando exactamente
 * igual que antes.
 */
export async function crearPeriodo(
  empresaId: number,
  input: NuevoPeriodoInput,
): Promise<ResultadoCrearPeriodo> {
  await asegurarSchemaPlanillas();

  const esQuincenal =
    input.tipoPeriodo === "QUINCENA_1" || input.tipoPeriodo === "QUINCENA_2";
  const numeroQuincenaEsperado: 1 | 2 | null =
    input.tipoPeriodo === "QUINCENA_1" ? 1 : input.tipoPeriodo === "QUINCENA_2" ? 2 : null;
  const tieneIdentidadQuincenal =
    esQuincenal &&
    input.mes != null &&
    input.anio != null &&
    (input.numeroQuincena == null || input.numeroQuincena === numeroQuincenaEsperado);

  const lockKey = `rrhh_planilla_periodo_${empresaId}`;
  const conn = await getPool().getConnection();
  try {
    let bloqueado = false;
    try {
      const [lockRows] = await conn.query<RowDataPacket[]>(
        "SELECT GET_LOCK(?, 8) AS l",
        [lockKey],
      );
      bloqueado = Number(lockRows[0]?.l ?? 0) === 1;
    } catch {
      /* bloqueado sigue en false → se rechaza abajo, no se sigue sin lock */
    }
    if (!bloqueado) {
      return {
        ok: false,
        motivo: "lock",
        mensaje:
          "El sistema está ocupado creando otro periodo de esta empresa. Intenta de nuevo en unos segundos.",
      };
    }

    // Fase P1: resolver fechas automáticamente (dentro del lock, mismo
    // cálculo que /planillas/sugerir) si el llamador no las envió.
    let fechaInicio = input.fechaInicio;
    let fechaFin = input.fechaFin;
    if ((!fechaInicio || !fechaFin) && tieneIdentidadQuincenal) {
      const etiqueta = input.tipoPeriodo === "QUINCENA_1" ? "Quincena 1" : "Quincena 2";
      const rango = await obtenerRangoPeriodo(
        empresaId,
        etiqueta,
        new Date(input.anio!, input.mes! - 1, 1),
      );
      if (rango) {
        fechaInicio = rango.desde;
        fechaFin = rango.hasta;
      }
    }
    if (!fechaInicio || !fechaFin) {
      return {
        ok: false,
        motivo: "fechas_invalidas",
        mensaje:
          "Indica fecha de inicio y fin, o año/mes/quincena para calcularlas automáticamente.",
      };
    }
    if (fechaInicio > fechaFin) {
      return {
        ok: false,
        motivo: "fechas_invalidas",
        mensaje: "La fecha de inicio no puede ser posterior a la fecha de fin.",
      };
    }

    // Fase P1: generar código automáticamente si no vino en el input.
    let codigo = input.codigo?.trim() || "";
    if (!codigo && tieneIdentidadQuincenal) {
      const generado = await generarCodigoPeriodoQuincenal(
        empresaId,
        input.anio!,
        input.mes!,
        numeroQuincenaEsperado as 1 | 2,
      );
      if (!generado) {
        return {
          ok: false,
          motivo: "error",
          mensaje: "No se pudo generar un código único para este periodo.",
        };
      }
      codigo = generado;
    }
    if (!codigo) {
      return {
        ok: false,
        motivo: "fechas_invalidas",
        mensaje: "Indica un código, o tipo de periodo + año + mes + quincena para generarlo.",
      };
    }

    const [overlapRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, codigo FROM rrhh_planilla_periodos
       WHERE empresa_id = ? AND estado <> 'Cancelado'
         AND fecha_inicio <= ? AND fecha_fin >= ?
       LIMIT 1`,
      [empresaId, fechaFin, fechaInicio],
    );
    if (overlapRows[0]) {
      return {
        ok: false,
        motivo: "solapado",
        mensaje: `El rango de fechas se solapa con el periodo "${String(overlapRows[0].codigo)}" (id ${Number(overlapRows[0].id)}).`,
      };
    }

    try {
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO rrhh_planilla_periodos
          (empresa_id, codigo, fecha_inicio, fecha_fin, estado, notas, creado_por,
           tipo_periodo, numero_quincena, mes, anio)
         VALUES (?, ?, ?, ?, 'Borrador', ?, ?, ?, ?, ?, ?)`,
        [
          empresaId,
          codigo,
          fechaInicio,
          fechaFin,
          input.notas ?? null,
          input.creadoPor,
          input.tipoPeriodo ?? null,
          input.numeroQuincena ?? numeroQuincenaEsperado ?? null,
          input.mes ?? null,
          input.anio ?? null,
        ],
      );
      return { ok: true, id: Number(result.insertId), codigo, fechaInicio, fechaFin };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/Duplicate|uq_planilla/i.test(msg)) {
        return {
          ok: false,
          motivo: "codigo_duplicado",
          mensaje:
            "Ya existe un periodo con ese código, o ya existe esa misma quincena/mes para esta empresa.",
        };
      }
      return {
        ok: false,
        motivo: "error",
        mensaje: "No se pudo crear el periodo de planilla.",
      };
    }
  } finally {
    try {
      await conn.query("SELECT RELEASE_LOCK(?) AS l", [lockKey]);
    } catch {
      /* ok */
    }
    conn.release();
  }
}

export type ResultadoCancelarPeriodo =
  | { ok: true }
  | {
      ok: false;
      motivo:
        | "no_encontrado"
        | "motivo_requerido"
        | "estado_no_permite"
        | "cuotas_aplicadas"
        | "horas_extra_aplicadas";
      mensaje: string;
    };

/**
 * Fase P0: cancela un periodo (Borrador o Generada únicamente). No borra
 * rrhh_planilla_lineas ya generadas — quedan como histórico. Un periodo
 * Cancelado queda excluido del control de solapamiento de crearPeriodo() y
 * bloqueado para generar/regenerar (ver generarLineasPeriodo).
 *
 * Fase D2: si el periodo ya tiene cuotas D1 APLICADA vinculadas, se bloquea
 * la cancelación — no dejamos descuentos cobrados contra una planilla
 * cancelada. La reversión explícita de cuotas no está implementada todavía.
 *
 * Fase H2: mismo criterio para horas extra APLICADA_EN_PLANILLA — no
 * dejamos horas extra pagadas contra una planilla cancelada.
 */
export async function cancelarPeriodo(
  empresaId: number,
  periodoId: number,
  motivoCancelacion: string,
): Promise<ResultadoCancelarPeriodo> {
  await asegurarSchemaPlanillas();

  if (!motivoCancelacion?.trim()) {
    return {
      ok: false,
      motivo: "motivo_requerido",
      mensaje: "Debes indicar un motivo para cancelar el periodo.",
    };
  }

  const periodo = await obtenerPeriodo(empresaId, periodoId);
  if (!periodo) {
    return { ok: false, motivo: "no_encontrado", mensaje: "Periodo no encontrado." };
  }
  if (periodo.estado !== "Borrador" && periodo.estado !== "Generada") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede cancelar un periodo en estado "${periodo.estado}".`,
    };
  }
  if (await tieneCuotasAplicadasEnPeriodo(empresaId, periodoId)) {
    return {
      ok: false,
      motivo: "cuotas_aplicadas",
      mensaje: "El periodo tiene descuentos aplicados. Debe revertirse antes de cancelarlo.",
    };
  }
  if (await tieneHorasExtraAplicadasEnPeriodo(empresaId, periodoId)) {
    return {
      ok: false,
      motivo: "horas_extra_aplicadas",
      mensaje: "El periodo tiene horas extra aplicadas. Debe revertirse antes de cancelarlo.",
    };
  }

  await execute(
    `UPDATE rrhh_planilla_periodos
     SET estado = 'Cancelado', motivo_cancelacion = ?
     WHERE id = ? AND empresa_id = ?`,
    [motivoCancelacion.trim(), periodoId, empresaId],
  );
  return { ok: true };
}

export async function listarLineas(
  empresaId: number,
  periodoId: number,
): Promise<PlanillaLinea[]> {
  await asegurarSchemaPlanillas();
  // Fase P1: sueldo mensual leído en vivo del empleado (LEFT JOIN — nunca
  // bloquea la lectura de la línea si el empleado ya no existe/cambió de
  // empresa; COALESCE cae de vuelta al sueldo_base ya persistido en la
  // línea en ese caso).
  const rows = await query<RowDataPacket[]>(
    `SELECT l.*, COALESCE(e.sueldo_base, l.sueldo_base) AS sueldo_mensual
     FROM rrhh_planilla_lineas l
     LEFT JOIN empleados e ON e.id = l.id_empleado AND e.empresa_id = l.empresa_id
     WHERE l.empresa_id = ? AND l.periodo_id = ?
     ORDER BY l.nombre_empleado`,
    [empresaId, periodoId],
  );
  return rows.map(mapLinea);
}

export function calcularCuadre(lineas: PlanillaLinea[]): CuadrePlanilla {
  const empty = () => ({
    cantidad: 0,
    neto: 0,
    pagado: 0,
    pendiente: 0,
  });
  const porFormaPago: CuadrePlanilla["porFormaPago"] = {
    efectivo: empty(),
    cheque: empty(),
    transferencia: empty(),
  };
  const totales: CuadrePlanilla["totales"] = {
    empleados: lineas.length,
    formales: 0,
    outsourcing: 0,
    sueldoBase: 0,
    bonos: 0,
    otrosIngresos: 0,
    igssLaboral: 0,
    igssPatronal: 0,
    descuentos: 0,
    isr: 0,
    neto: 0,
    pagado: 0,
    pendiente: 0,
  };

  for (const l of lineas) {
    const forma = normalizarFormaPago(l.formaPago);
    const bucket = porFormaPago[forma];
    bucket.cantidad += 1;
    bucket.neto = redondearQ(bucket.neto + l.neto);
    if (l.estadoPago === "Pagado") {
      bucket.pagado = redondearQ(bucket.pagado + l.neto);
      totales.pagado = redondearQ(totales.pagado + l.neto);
    } else {
      bucket.pendiente = redondearQ(bucket.pendiente + l.neto);
      totales.pendiente = redondearQ(totales.pendiente + l.neto);
    }
    if (esOutsourcing(l.tipoContrato)) totales.outsourcing += 1;
    else totales.formales += 1;
    totales.sueldoBase = redondearQ(totales.sueldoBase + l.sueldoBase);
    totales.bonos = redondearQ(
      totales.bonos + l.bonoIncentivo + l.bonoHerramientas,
    );
    totales.otrosIngresos = redondearQ(totales.otrosIngresos + l.otrosIngresos);
    totales.igssLaboral = redondearQ(totales.igssLaboral + l.igssLaboral);
    totales.igssPatronal = redondearQ(totales.igssPatronal + l.igssPatronal);
    totales.descuentos = redondearQ(totales.descuentos + l.descuentos);
    totales.isr = redondearQ(totales.isr + l.isr);
    totales.neto = redondearQ(totales.neto + l.neto);
  }

  return { porFormaPago, totales };
}

async function sumasPorEmpleado(
  empresaId: number,
  desde: string,
  hasta: string,
): Promise<{
  descuentos: Map<number, number>;
  prestaciones: Map<number, number>;
}> {
  const descuentos = new Map<number, number>();
  const prestaciones = new Map<number, number>();
  try {
    const dRows = await query<RowDataPacket[]>(
      `SELECT id_empleado, SUM(monto) AS total
       FROM rrhh_descuentos
       WHERE empresa_id = ? AND fecha BETWEEN ? AND ?
       GROUP BY id_empleado`,
      [empresaId, desde, hasta],
    );
    for (const r of dRows) {
      descuentos.set(Number(r.id_empleado), Number(r.total ?? 0));
    }
  } catch {
    /* tabla ausente */
  }
  try {
    const pRows = await query<RowDataPacket[]>(
      `SELECT id_empleado, SUM(monto) AS total
       FROM rrhh_prestaciones
       WHERE empresa_id = ? AND fecha BETWEEN ? AND ?
       GROUP BY id_empleado`,
      [empresaId, desde, hasta],
    );
    for (const r of pRows) {
      prestaciones.set(Number(r.id_empleado), Number(r.total ?? 0));
    }
  } catch {
    /* tabla ausente */
  }
  return { descuentos, prestaciones };
}

export type ItemDetalle = {
  concepto: string;
  monto: number;
  fecha: string;
  notas: string;
};

/** Detalle itemizado de descuentos de un empleado en un rango de fechas (para la boleta). */
export async function listarDescuentosDetalle(
  empresaId: number,
  empleadoId: number,
  desde: string,
  hasta: string,
): Promise<ItemDetalle[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT concepto, monto, fecha, notas
       FROM rrhh_descuentos
       WHERE empresa_id = ? AND id_empleado = ? AND fecha BETWEEN ? AND ?
       ORDER BY fecha`,
      [empresaId, empleadoId, desde, hasta],
    );
    return rows.map((r) => ({
      concepto: String(r.concepto ?? "Descuento"),
      monto: Number(r.monto ?? 0),
      fecha: String(r.fecha).slice(0, 10),
      notas: r.notas ? String(r.notas) : "",
    }));
  } catch {
    return []; // tabla ausente
  }
}

/** Detalle itemizado de prestaciones/devengados de un empleado en un rango de fechas (para la boleta). */
export async function listarPrestacionesDetalle(
  empresaId: number,
  empleadoId: number,
  desde: string,
  hasta: string,
): Promise<ItemDetalle[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT tipo AS concepto, monto, fecha, notas
       FROM rrhh_prestaciones
       WHERE empresa_id = ? AND id_empleado = ? AND fecha BETWEEN ? AND ?
       ORDER BY fecha`,
      [empresaId, empleadoId, desde, hasta],
    );
    return rows.map((r) => ({
      concepto: String(r.concepto ?? "Otro ingreso"),
      monto: Number(r.monto ?? 0),
      fecha: String(r.fecha).slice(0, 10),
      notas: r.notas ? String(r.notas) : "",
    }));
  } catch {
    return []; // tabla ausente
  }
}

/**
 * Genera (o regenera) líneas de nómina del periodo.
 * Conserva estado_pago / ref_pago / isr / forma_pago si la línea ya existía
 * y se pide conservarPagos.
 *
 * Fase D2: además de los descuentos legado (rrhh_descuentos, sin cambios),
 * aplica dentro de la MISMA transacción las cuotas D1 (rrhh_descuento_cuotas)
 * elegibles para este periodo — transición PENDIENTE→APLICADA atómica y
 * verificada (ver aplicarCuotasElegibles en descuentos.ts) — y las suma al
 * campo agregado `descuentos` de cada línea junto con el legado, sin doblar
 * ninguna de las dos fuentes. Al regenerar, las cuotas ya APLICADA de este
 * mismo periodo no se vuelven a tocar (ya no son PENDIENTE) pero SÍ se
 * vuelven a sumar en el total (sumaCuotasAplicadasPorPeriodo cubre ambas).
 * Todo — aplicar cuotas, calcular líneas, escribir rrhh_planilla_lineas,
 * marcar el periodo Generada — ocurre en una única transacción: si algo
 * falla, se revierte todo (nunca queda una cuota APLICADA sin su línea).
 *
 * Fase H2 — horas extra APROBADA se aplican dentro de la MISMA transacción
 * (mismo patrón exacto que D2 para cuotas D1 — ver aplicarHorasExtraElegibles
 * en horas-extra.ts): transición APROBADA→APLICADA_EN_PLANILLA atómica y
 * verificada, sumadas a `otros_ingresos` de cada línea junto con las
 * prestaciones legado (fuente distinta, sin solape — H1/H2 ya no escriben en
 * rrhh_prestaciones). Al regenerar, las horas ya APLICADA_EN_PLANILLA de este
 * mismo periodo no se vuelven a tocar pero sí se vuelven a sumar (mismo
 * criterio que las cuotas D1).
 *
 * Fase D3 / Fase P1 — reparto quincenal. `sueldo`/`bonoInc`/`bonoHerr` leídos
 * de `empleados` siguen siendo los valores CONTRACTUALES MENSUALES completos
 * (nunca se sobreescriben ahí) — lo que cambia según el tipo de periodo es
 * cuánto de ese valor mensual entra en CADA línea:
 * - tipoPeriodo NULL (histórico, sin metadatos de P0): comportamiento EXACTO
 *   de siempre — todo el valor mensual completo. Ningún periodo histórico
 *   cambia de valor (y no puede regenerarse: generarLineasPeriodo ya rechaza
 *   periodos Cerrada/Pagada/Cancelado, así que esta fórmula nueva nunca
 *   toca una planilla histórica ya cerrada).
 * - MENSUAL: valor mensual completo para sueldo/bono/IGSS laboral/IGSS
 *   patronal/ISR (sin cambios respecto a antes).
 * - ESPECIAL: igual que MENSUAL salvo igss_laboral = 0 (no se asume que un
 *   periodo especial siempre cotiza IGSS) — se conserva la regla existente,
 *   no se tocó nada más aquí por decisión explícita.
 * - QUINCENA_1: cada uno de sueldo_base, bono_incentivo, bono_herramientas,
 *   igss_laboral, igss_patronal e ISR = redondearQ(valor mensual / 2).
 * - QUINCENA_2: busca la línea de QUINCENA_1 del mismo empresa/mes/año/
 *   empleado (misma conexión/transacción, sin congelar un valor viejo si Q1
 *   fue regenerada después) y cada uno de esos 6 conceptos = redondearQ(valor
 *   mensual − lo que Q1 REALMENTE tiene persistido) — no un recálculo
 *   teórico, así Q1+Q2 cuadra exacto con el mensual incluso si alguien
 *   editó el ISR de Q1 a mano. Si no existe Q1 válida (periodo cancelado o
 *   no generado todavía), Q2 usa la mitad mensual de los 6 conceptos. Esto
 *   evita que una segunda quincena independiente muestre/pague el sueldo
 *   mensual completo; si Q1 existe, se conserva la conciliación exacta.
 * - Horas extra, descuentos/cuotas y prestaciones/otros ingresos NO se
 *   reparten — ya llegan acotados por rango de fecha o por
 *   planilla_periodo_id (D1/D2/H2), así que cada uno cae naturalmente en su
 *   propia quincena sin ningún cambio adicional aquí.
 * - Outsourcing: igss_laboral/igss_patronal/isr siempre 0 (como antes);
 *   sueldo/bono_incentivo/bono_herramientas SÍ se reparten igual que un
 *   empleado formal en QUINCENA_1/QUINCENA_2, por consistencia con la regla
 *   general — no había ninguna excepción documentada para outsourcing en
 *   estos tres conceptos.
 */
export async function generarLineasPeriodo(
  empresaId: number,
  periodoId: number,
  opts: { conservarPagos?: boolean; usuario: string },
): Promise<{
  generadas: number;
  cuotasAplicadas: number;
  totalCuotasAplicado: number;
  empleadosSinIgssQ1: number;
  horasExtraAplicadas: number;
  totalHorasExtraHoras: number;
  totalHorasExtraMonto: number;
}> {
  await asegurarSchemaPlanillas();
  const periodo = await obtenerPeriodo(empresaId, periodoId);
  if (!periodo) throw new Error("Periodo no encontrado.");
  if (
    periodo.estado === "Cerrada" ||
    periodo.estado === "Pagada" ||
    periodo.estado === "Cancelado"
  ) {
    throw new Error(
      periodo.estado === "Cancelado"
        ? "El periodo está cancelado; no se puede generar."
        : "La planilla ya está cerrada; no se puede regenerar.",
    );
  }

  const prev = opts?.conservarPagos
    ? await listarLineas(empresaId, periodoId)
    : [];
  const prevMap = new Map(prev.map((l) => [l.empleadoId, l]));

  const empleados = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, dpi, tipo_contrato, forma_pago,
            sueldo_base, bono_incentivo, bono_herramientas
     FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'
     ORDER BY nombre`,
    [empresaId],
  );

  const { descuentos: descuentosLegado, prestaciones } = await sumasPorEmpleado(
    empresaId,
    periodo.fechaInicio,
    periodo.fechaFin,
  );

  // Fase D3: solo relevante para QUINCENA_2 — IGSS ya retenido en QUINCENA_1
  // del mismo empresa/mes/año, por empleado. Se consulta DENTRO de la misma
  // conexión/transacción (más abajo) para no congelar un valor viejo si Q1
  // se regeneró justo antes de generar Q2, y para no abrir una segunda
  // transacción en paralelo.
  const necesitaIgssQ1 =
    periodo.tipoPeriodo === "QUINCENA_2" && periodo.mes != null && periodo.anio != null;

  const conn = await getPool().getConnection();
  let generadas = 0;
  let cuotasAplicadas = 0;
  let totalCuotasAplicado = 0;
  let empleadosSinIgssQ1 = 0;
  let horasExtraAplicadas = 0;
  let totalHorasExtraHoras = 0;
  let totalHorasExtraMonto = 0;
  try {
    await conn.beginTransaction();

    const aplicado = await aplicarCuotasElegibles(
      conn,
      empresaId,
      { id: periodo.id, fechaInicio: periodo.fechaInicio, fechaFin: periodo.fechaFin },
      opts.usuario,
    );
    cuotasAplicadas = aplicado.aplicadas;
    totalCuotasAplicado = aplicado.totalAplicado;

    // Incluye tanto las recién aplicadas arriba como las que ya estaban
    // APLICADA de una generación anterior de este mismo periodo — ambas
    // comparten planilla_periodo_id = periodo.id en este punto.
    const descuentosD1 = await sumaCuotasAplicadasPorPeriodo(conn, empresaId, periodoId);

    // Fase H2: mismo patrón exacto que las cuotas D1 justo arriba.
    const aplicadoHoras = await aplicarHorasExtraElegibles(conn, empresaId, {
      id: periodo.id,
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
    });
    horasExtraAplicadas = aplicadoHoras.aplicadas;
    totalHorasExtraHoras = aplicadoHoras.totalHoras;
    totalHorasExtraMonto = aplicadoHoras.totalMonto;
    const horasExtraPorEmpleado = await sumaHorasExtraAplicadasPorPeriodo(
      conn,
      empresaId,
      periodoId,
    );

    // Fase P1: se amplía de "solo igss_laboral" a los 6 conceptos que ahora
    // se reparten entre Q1/Q2 (sueldo, bono incentivo, bono herramientas,
    // IGSS laboral, IGSS patronal, ISR) — mismo mecanismo, misma garantía de
    // no congelar un valor viejo si Q1 se regeneró justo antes.
    const datosQ1PorEmpleado = new Map<
      number,
      {
        sueldoBase: number;
        bonoIncentivo: number;
        bonoHerramientas: number;
        igssLaboral: number;
        igssPatronal: number;
        isr: number;
      }
    >();
    if (necesitaIgssQ1) {
      const [q1Rows] = await conn.query<RowDataPacket[]>(
        `SELECT l.id_empleado, l.sueldo_base, l.bono_incentivo, l.bono_herramientas,
                l.igss_laboral, l.igss_patronal, l.isr
         FROM rrhh_planilla_periodos p
         INNER JOIN rrhh_planilla_lineas l ON l.periodo_id = p.id AND l.empresa_id = p.empresa_id
         WHERE p.empresa_id = ? AND p.tipo_periodo = 'QUINCENA_1'
           AND p.mes = ? AND p.anio = ? AND p.estado <> 'Cancelado'`,
        [empresaId, periodo.mes, periodo.anio],
      );
      for (const r of q1Rows) {
        datosQ1PorEmpleado.set(Number(r.id_empleado), {
          sueldoBase: Number(r.sueldo_base ?? 0),
          bonoIncentivo: Number(r.bono_incentivo ?? 0),
          bonoHerramientas: Number(r.bono_herramientas ?? 0),
          igssLaboral: Number(r.igss_laboral ?? 0),
          igssPatronal: Number(r.igss_patronal ?? 0),
          isr: Number(r.isr ?? 0),
        });
      }
    }

    await conn.execute(
      `DELETE FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ?`,
      [empresaId, periodoId],
    );

    for (const e of empleados) {
      const empId = Number(e.id);
      const tipo = normalizarTipoContrato(String(e.tipo_contrato ?? "fijo"));
      const out = esOutsourcing(tipo);
      const sueldo = Number(e.sueldo_base ?? 0) || 0;
      const bonoInc =
        e.bono_incentivo != null && e.bono_incentivo !== ""
          ? Number(e.bono_incentivo)
          : out
            ? 0
            : 250;
      const bonoHerr = Number(e.bono_herramientas ?? 0) || 0;
      // Fase H2: prestaciones legado (incluye horas extra históricas
      // pre-H1, ya insertadas ahí bajo el modelo anterior) + horas extra
      // H2 aplicadas a este periodo (fuente nueva y separada — H1/H2 ya no
      // escriben en rrhh_prestaciones, así que no hay solape/doble conteo
      // entre ambas fuentes).
      const otros = redondearQ(
        Number(prestaciones.get(empId) ?? 0) + Number(horasExtraPorEmpleado.get(empId) ?? 0),
      );
      const desc = redondearQ(
        Number(descuentosLegado.get(empId) ?? 0) + Number(descuentosD1.get(empId) ?? 0),
      );

      // Fase D3 / P1: valores mensuales esperados — siempre sobre los
      // campos CONTRACTUALES completos del empleado (nunca se sobreescriben
      // aquí). igssMensual/igssPatMensual/isrMensual ya quedan en 0 para
      // outsourcing (out), así que la repartición 50/50 de más abajo
      // produce 0/0 en ambas quincenas para esos tres conceptos sin
      // necesitar una rama aparte.
      const igssMensual = out ? 0 : redondearQ(sueldo * IGSS_LABORAL_PCT);
      const igssPatMensual = out ? 0 : redondearQ(sueldo * IGSS_PATRONAL_PCT);
      const anterior = prevMap.get(empId);
      const anioFiscal =
        Number(periodo.fechaInicio.slice(0, 4)) || new Date().getFullYear();
      const isrMensual = out
        ? 0
        : anterior && anterior.isr != null
          ? Number(anterior.isr) || 0
          : calcularISRMensual(sueldo, bonoInc, anioFiscal);

      let sueldoLinea: number;
      let bonoIncLinea: number;
      let bonoHerrLinea: number;
      let igssLab: number;
      let igssPat: number;
      let isr: number;

      if (periodo.tipoPeriodo == null || periodo.tipoPeriodo === "MENSUAL") {
        sueldoLinea = sueldo;
        bonoIncLinea = bonoInc;
        bonoHerrLinea = bonoHerr;
        igssLab = igssMensual;
        igssPat = igssPatMensual;
        isr = isrMensual;
      } else if (periodo.tipoPeriodo === "ESPECIAL") {
        // Regla existente conservada tal cual: solo igss_laboral = 0 aquí.
        sueldoLinea = sueldo;
        bonoIncLinea = bonoInc;
        bonoHerrLinea = bonoHerr;
        igssLab = 0;
        igssPat = igssPatMensual;
        isr = isrMensual;
      } else if (periodo.tipoPeriodo === "QUINCENA_1") {
        sueldoLinea = redondearQ(sueldo / 2);
        bonoIncLinea = redondearQ(bonoInc / 2);
        bonoHerrLinea = redondearQ(bonoHerr / 2);
        igssLab = redondearQ(igssMensual / 2);
        igssPat = redondearQ(igssPatMensual / 2);
        isr = redondearQ(isrMensual / 2);
      } else {
        // QUINCENA_2 — reconcilia contra lo que Q1 REALMENTE tiene
        // persistido (ver JSDoc de la función).
        const q1 = necesitaIgssQ1 ? datosQ1PorEmpleado.get(empId) : undefined;
        if (q1 == null) {
          // Q2 puede generarse antes que Q1. Aun así sigue siendo una
          // quincena: nunca debe cargar el valor mensual completo.
          sueldoLinea = redondearQ(sueldo / 2);
          bonoIncLinea = redondearQ(bonoInc / 2);
          bonoHerrLinea = redondearQ(bonoHerr / 2);
          igssLab = redondearQ(igssMensual / 2);
          igssPat = redondearQ(igssPatMensual / 2);
          isr = redondearQ(isrMensual / 2);
          empleadosSinIgssQ1 += 1;
        } else {
          sueldoLinea = redondearQ(sueldo - q1.sueldoBase);
          bonoIncLinea = redondearQ(bonoInc - q1.bonoIncentivo);
          bonoHerrLinea = redondearQ(bonoHerr - q1.bonoHerramientas);
          igssLab = redondearQ(igssMensual - q1.igssLaboral);
          igssPat = redondearQ(igssPatMensual - q1.igssPatronal);
          isr = redondearQ(isrMensual - q1.isr);
        }
      }

      const forma = anterior
        ? anterior.formaPago
        : normalizarFormaPago(String(e.forma_pago ?? "transferencia"));
      const estadoPago = anterior?.estadoPago === "Pagado" ? "Pagado" : "Pendiente";
      const refPago = anterior?.refPago ?? "";
      const neto = redondearQ(
        sueldoLinea + bonoIncLinea + bonoHerrLinea + otros - igssLab - desc - isr,
      );

      await conn.execute(
        `INSERT INTO rrhh_planilla_lineas
          (empresa_id, periodo_id, id_empleado, codigo_empleado, nombre_empleado,
           dpi, tipo_contrato, forma_pago, sueldo_base, bono_incentivo, bono_herramientas,
           otros_ingresos, igss_laboral, igss_patronal, descuentos, isr, neto,
           estado_pago, ref_pago)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId,
          periodoId,
          empId,
          String(e.codigo ?? ""),
          String(e.nombre ?? ""),
          e.dpi ? String(e.dpi) : null,
          tipo,
          forma,
          sueldoLinea,
          bonoIncLinea,
          bonoHerrLinea,
          otros,
          igssLab,
          igssPat,
          desc,
          isr,
          neto,
          estadoPago,
          refPago || null,
        ],
      );
      generadas += 1;
    }

    await conn.execute(
      `UPDATE rrhh_planilla_periodos SET estado = 'Generada' WHERE id = ? AND empresa_id = ?`,
      [periodoId, empresaId],
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  if (cuotasAplicadas > 0) {
    await registrarAuditoria({
      empresaId,
      usuario: opts.usuario,
      accion: "aplicar_descuentos_planilla",
      modulo: "rrhh",
      detalle: `Periodo #${periodoId} ${periodo.codigo} · ${cuotasAplicadas} cuota(s) nueva(s) aplicada(s) · Q${totalCuotasAplicado.toFixed(2)}`,
    });
  }
  // Fase D3: un solo resumen por periodo, no una entrada por empleado.
  if (empleadosSinIgssQ1 > 0) {
    await registrarAuditoria({
      empresaId,
      usuario: opts.usuario,
      accion: "igss_quincena2_sin_q1",
      modulo: "rrhh",
      detalle: `Periodo #${periodoId} ${periodo.codigo} (Q2) · ${empleadosSinIgssQ1} empleado(s) sin Q1 válida · se aplicó la mitad mensual (sueldo, bonos, IGSS e ISR).`,
    });
  }
  // Fase H2: un solo resumen por periodo, no una entrada por registro.
  if (horasExtraAplicadas > 0) {
    await registrarAuditoria({
      empresaId,
      usuario: opts.usuario,
      accion: "aplicar_horas_extra_planilla",
      modulo: "rrhh",
      detalle: `Periodo #${periodoId} ${periodo.codigo} · ${horasExtraAplicadas} registro(s) de horas extra aplicado(s) · ${totalHorasExtraHoras.toFixed(2)}h · Q${totalHorasExtraMonto.toFixed(2)}`,
    });
  }

  return {
    generadas,
    cuotasAplicadas,
    totalCuotasAplicado,
    empleadosSinIgssQ1,
    horasExtraAplicadas,
    totalHorasExtraHoras,
    totalHorasExtraMonto,
  };
}

export type CuadreIgssEmpleado = {
  empleadoId: number;
  codigoEmpleado: string;
  nombreEmpleado: string;
  igssMensualEsperado: number;
  igssQ1: number | null;
  igssQ2: number | null;
  totalRetenido: number;
  diferencia: number;
  cuadra: boolean;
};

export type CuadreIgssMensual = {
  mes: number;
  anio: number;
  empleados: CuadreIgssEmpleado[];
  totales: {
    igssMensualEsperado: number;
    totalRetenido: number;
    diferencia: number;
    cuadra: boolean;
  };
};

/**
 * Fase D3 — conciliación de IGSS quincenal. Para un mes/año, compara el
 * IGSS mensual esperado (sueldo_base × IGSS_LABORAL_PCT = 4.83%) contra lo
 * realmente retenido en las líneas de QUINCENA_1 + QUINCENA_2 de ese mes.
 * Detecta el caso "Q1 se corrigió después de generar Q2" (diferencia != 0)
 * sin corregir nada automáticamente — es solo lectura/diagnóstico, nunca
 * modifica una línea ya generada.
 */
export async function calcularCuadreIgssMensual(
  empresaId: number,
  mes: number,
  anio: number,
): Promise<CuadreIgssMensual> {
  await asegurarSchemaPlanillas();

  const empleados = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, tipo_contrato, sueldo_base
     FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`,
    [empresaId],
  );

  const periodosRows = await query<RowDataPacket[]>(
    `SELECT id, tipo_periodo FROM rrhh_planilla_periodos
     WHERE empresa_id = ? AND mes = ? AND anio = ?
       AND tipo_periodo IN ('QUINCENA_1','QUINCENA_2') AND estado <> 'Cancelado'`,
    [empresaId, mes, anio],
  );
  const periodoQ1Id = periodosRows.find((r) => r.tipo_periodo === "QUINCENA_1")?.id;
  const periodoQ2Id = periodosRows.find((r) => r.tipo_periodo === "QUINCENA_2")?.id;

  const q1Map = new Map<number, number>();
  const q2Map = new Map<number, number>();
  if (periodoQ1Id) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id_empleado, igss_laboral FROM rrhh_planilla_lineas
       WHERE empresa_id = ? AND periodo_id = ?`,
      [empresaId, Number(periodoQ1Id)],
    );
    for (const r of rows) q1Map.set(Number(r.id_empleado), Number(r.igss_laboral ?? 0));
  }
  if (periodoQ2Id) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id_empleado, igss_laboral FROM rrhh_planilla_lineas
       WHERE empresa_id = ? AND periodo_id = ?`,
      [empresaId, Number(periodoQ2Id)],
    );
    for (const r of rows) q2Map.set(Number(r.id_empleado), Number(r.igss_laboral ?? 0));
  }

  let totalEsperado = 0;
  let totalRetenidoGlobal = 0;
  const filas: CuadreIgssEmpleado[] = empleados.map((e) => {
    const empId = Number(e.id);
    const out = esOutsourcing(String(e.tipo_contrato ?? "fijo"));
    const sueldo = Number(e.sueldo_base ?? 0) || 0;
    const igssMensualEsperado = out ? 0 : redondearQ(sueldo * IGSS_LABORAL_PCT);
    const igssQ1 = q1Map.has(empId) ? (q1Map.get(empId) as number) : null;
    const igssQ2 = q2Map.has(empId) ? (q2Map.get(empId) as number) : null;
    const totalRetenido = redondearQ((igssQ1 ?? 0) + (igssQ2 ?? 0));
    const diferencia = redondearQ(igssMensualEsperado - totalRetenido);
    totalEsperado = redondearQ(totalEsperado + igssMensualEsperado);
    totalRetenidoGlobal = redondearQ(totalRetenidoGlobal + totalRetenido);
    return {
      empleadoId: empId,
      codigoEmpleado: String(e.codigo ?? ""),
      nombreEmpleado: String(e.nombre ?? ""),
      igssMensualEsperado,
      igssQ1,
      igssQ2,
      totalRetenido,
      diferencia,
      cuadra: Math.abs(diferencia) < 0.01,
    };
  });

  const diferenciaTotal = redondearQ(totalEsperado - totalRetenidoGlobal);
  return {
    mes,
    anio,
    empleados: filas,
    totales: {
      igssMensualEsperado: totalEsperado,
      totalRetenido: totalRetenidoGlobal,
      diferencia: diferenciaTotal,
      cuadra: Math.abs(diferenciaTotal) < 0.01,
    },
  };
}

export async function actualizarLinea(
  empresaId: number,
  lineaId: number,
  patch: {
    formaPago?: FormaPago;
    isr?: number;
    estadoPago?: string;
    refPago?: string | null;
    notas?: string | null;
  },
): Promise<PlanillaLinea | null> {
  await asegurarSchemaPlanillas();
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_planilla_lineas WHERE empresa_id = ? AND id = ? LIMIT 1`,
    [empresaId, lineaId],
  );
  if (!rows[0]) return null;
  const cur = mapLinea(rows[0]);
  const forma = patch.formaPago
    ? normalizarFormaPago(patch.formaPago)
    : cur.formaPago;
  const isr =
    patch.isr != null && Number.isFinite(patch.isr) ? redondearQ(patch.isr) : cur.isr;
  const estadoPago =
    patch.estadoPago === "Pagado" || patch.estadoPago === "Pendiente"
      ? patch.estadoPago
      : cur.estadoPago;
  const refPago =
    patch.refPago !== undefined ? patch.refPago || "" : cur.refPago;
  const notas = patch.notas !== undefined ? patch.notas || "" : cur.notas;
  const neto = redondearQ(
    cur.sueldoBase +
      cur.bonoIncentivo +
      cur.bonoHerramientas +
      cur.otrosIngresos -
      cur.igssLaboral -
      cur.descuentos -
      isr,
  );

  await execute(
    `UPDATE rrhh_planilla_lineas SET
      forma_pago = ?, isr = ?, neto = ?, estado_pago = ?, ref_pago = ?, notas = ?
     WHERE id = ? AND empresa_id = ?`,
    [
      forma,
      isr,
      neto,
      estadoPago,
      refPago || null,
      notas || null,
      lineaId,
      empresaId,
    ],
  );
  return obtenerLinea(empresaId, lineaId);
}

async function obtenerLinea(
  empresaId: number,
  lineaId: number,
): Promise<PlanillaLinea | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_planilla_lineas WHERE empresa_id = ? AND id = ? LIMIT 1`,
    [empresaId, lineaId],
  );
  return rows[0] ? mapLinea(rows[0]) : null;
}

export async function marcarPagos(
  empresaId: number,
  periodoId: number,
  opts: {
    formaPago?: FormaPago | "todas";
    estadoPago: "Pagado" | "Pendiente";
    soloPendientes?: boolean;
  },
): Promise<number> {
  await asegurarSchemaPlanillas();
  const params: (string | number)[] = [opts.estadoPago, empresaId, periodoId];
  let sql = `UPDATE rrhh_planilla_lineas SET estado_pago = ?
              WHERE empresa_id = ? AND periodo_id = ?`;
  if (opts.formaPago && opts.formaPago !== "todas") {
    sql += ` AND forma_pago = ?`;
    params.push(opts.formaPago);
  }
  if (opts.soloPendientes && opts.estadoPago === "Pagado") {
    sql += ` AND estado_pago = 'Pendiente'`;
  }
  const r = await execute(sql, params);
  return Number((r as ResultSetHeader).affectedRows ?? 0);
}

export async function actualizarEstadoPeriodo(
  empresaId: number,
  periodoId: number,
  estado: string,
): Promise<void> {
  await asegurarSchemaPlanillas();
  await execute(
    `UPDATE rrhh_planilla_periodos SET estado = ? WHERE id = ? AND empresa_id = ?`,
    [estado, periodoId, empresaId],
  );
}

export async function contarEmpleadosActivos(
  empresaId: number,
): Promise<{ total: number; outsourcing: number; formales: number }> {
  await asegurarSchemaPlanillas().catch(() => undefined);
  const rows = await query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN LOWER(COALESCE(tipo_contrato,'')) = 'outsourcing' THEN 1 ELSE 0 END) AS outsourcing
     FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'`,
    [empresaId],
  );
  const total = Number(rows[0]?.total ?? 0);
  const outsourcing = Number(rows[0]?.outsourcing ?? 0);
  return { total, outsourcing, formales: Math.max(total - outsourcing, 0) };
}
