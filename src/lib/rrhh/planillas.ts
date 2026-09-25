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
import type { DevengoSnapshot } from "./planilla-conceptos";
import { aplicarConceptosSnapshot, leerConceptosSnapshot, obtenerConceptosPendientes, pendientesVacios, totalesConceptos, validarSnapshotContraPendientes, type ConceptosSnapshot } from "./planilla-conceptos";
import type { PoolConnection } from "mysql2/promise";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { bloquearPeriodosPlanilla, conPeriodoBloqueado, exigirPrimeraQuincenaSinDependientes } from "./planilla-control";
import { liberarReservasPeriodo } from "./planilla-reversion";
import { toIsoDate } from "./dates";
import {
  calcularDevengoPeriodo,
  diasDevengadosQuincenas,
  empleadoEntraEnPeriodo,
  importePorDias,
  repartirConceptoMensual,
  diasBase30EnMes,
  BASE_DIAS_MES,
} from "./planilla-devengo";
import { calcularFiscal2026Empleado } from "./planilla-fiscal-2026";

/**
 * RRHH-PLANILLAS-ISR-2026-INTEGRACION: único ejercicio con motor propio por
 * ahora — ver planilla-fiscal-2026.ts y fiscal-isr-2026.ts. Cualquier otro
 * ejercicio conserva el cálculo de isr.ts sin cambios (calcularISRMensual).
 */
const EJERCICIO_MOTOR_ISR_2026 = 2026;

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
  autorizadoPor?: string | null;
  autorizadoEn?: string | null;
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
  conceptosSnapshot?: ConceptosSnapshot | null;
  /** Desglose del devengo (días pagados, ingreso/egreso). Ausente en líneas anteriores a este cálculo. */
  devengo?: DevengoSnapshot | null;
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
      autorizado_por VARCHAR(100) NULL,
      autorizado_en DATETIME NULL,
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
      conceptos_snapshot JSON NULL,
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
    autorizadoPor: r.autorizado_por != null ? String(r.autorizado_por) : null,
    autorizadoEn: r.autorizado_en != null ? (r.autorizado_en instanceof Date ? r.autorizado_en.toISOString() : String(r.autorizado_en)) : null,
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
  const snapshot = leerConceptosSnapshot(r.conceptos_snapshot);
  return {
    id: Number(r.id),
    periodoId: Number(r.periodo_id),
    empleadoId: Number(r.id_empleado),
    codigoEmpleado: String(r.codigo_empleado ?? ""),
    nombreEmpleado: String(r.nombre_empleado ?? ""),
    dpi: r.dpi ? String(r.dpi) : "",
    tipoContrato: String(r.tipo_contrato ?? "fijo"),
    formaPago: normalizarFormaPago(String(r.forma_pago ?? "transferencia")),
    sueldoMensual: snapshot?.sueldoMensual ?? Number(r.sueldo_mensual ?? r.sueldo_base ?? 0),
    conceptosSnapshot: snapshot,
    devengo: snapshot?.devengo ?? null,
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
 * Libera cuotas y horas reservadas únicamente cuando no hay pagos.
 * Conserva las líneas históricas y audita la reversión en la misma transacción.
 */
export async function cancelarPeriodo(
  empresaId: number,
  periodoId: number,
  motivoCancelacion: string,
  usuario: string,
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
  return conPeriodoBloqueado<ResultadoCancelarPeriodo>(empresaId, periodoId, async (conn, estado) => {
  if (await tieneAutorizacion(conn, empresaId, periodoId)) throw new Error("La planilla autorizada no puede cancelarse; requiere una reversión explícita no disponible en este flujo.");
  if (estado !== "Borrador" && estado !== "Generada") {
    return {
      ok: false,
      motivo: "estado_no_permite",
      mensaje: `No se puede cancelar un periodo en estado "${estado}".`,
    };
  }
  const [pagos] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ? AND estado_pago = 'Pagado' LIMIT 1 FOR UPDATE",
    [empresaId, periodoId],
  );
  if (pagos.length) return { ok: false, motivo: "estado_no_permite", mensaje: "No se puede cancelar una planilla con pagos registrados." };
  await exigirPrimeraQuincenaSinDependientes(conn, empresaId, periodoId);
  await liberarReservasPeriodo(conn, empresaId, periodoId, usuario);

  await conn.execute(
    `UPDATE rrhh_planilla_periodos
     SET estado = 'Cancelado', motivo_cancelacion = ?
     WHERE id = ? AND empresa_id = ?`,
    [motivoCancelacion.trim(), periodoId, empresaId],
  );
  await registrarAuditoriaTx(conn, {
    empresaId, usuario, accion: "cancelar_periodo_planilla", modulo: "rrhh",
    detalle: JSON.stringify({ periodoId, estadoAnterior: estado, motivo: motivoCancelacion.trim() }),
  });
  return { ok: true };
  });
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
 * Conserva ID, referencias, notas, ISR y forma de pago de líneas existentes.
 * Rechaza regenerar si hay pagos registrados. conservarPagos se acepta por
 * compatibilidad, pero ya no permite descartar datos persistidos.
 *
 * Solo calcula y captura conceptos pendientes. Nunca aplica cuotas ni horas
 * extra: esa transición pertenece exclusivamente a autorizarPeriodoPlanilla.
 * Los conceptos legados mantienen su semántica existente y se capturan por ID.
 * Un período histórico con aplicaciones existentes requiere revisión explícita.
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
    periodo.autorizadoEn != null || periodo.estado === "Cerrada" ||
    periodo.estado === "Pagada" ||
    periodo.estado === "Cancelado"
  ) {
    throw new Error(
      periodo.estado === "Cancelado"
        ? "El periodo está cancelado; no se puede generar."
        : "La planilla ya está cerrada; no se puede regenerar.",
    );
  }

  // Inclusión por RELACIÓN LABORAL (no solo `estado = 'Activo'`): un empleado dado de baja que trabajó parte del período
  // sigue apareciendo en la planilla que le corresponde. Ver planilla-devengo.ts (empleadoEntraEnPeriodo).
  const empleadosCandidatos = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, dpi, tipo_contrato, forma_pago, estado,
            sueldo_base, bono_incentivo, bono_herramientas,
            fecha_alta, fecha_inicio_laboral, fecha_egreso
     FROM empleados
     WHERE empresa_id = ? AND estado IN ('Activo', 'Baja')
     ORDER BY nombre`,
    [empresaId],
  );
  const vigenciaDe = (e: RowDataPacket) => ({
    // Se paga desde que se EMPIEZA a trabajar (fecha entrada laboral); la fecha de contratación es el respaldo.
    inicioLaboral: toIsoDate(e.fecha_inicio_laboral as string | Date | null) ?? toIsoDate(e.fecha_alta as string | Date | null),
    finLaboral: toIsoDate(e.fecha_egreso as string | Date | null),
  });
  const empleados = empleadosCandidatos.filter((e) =>
    empleadoEntraEnPeriodo(
      { estado: String(e.estado ?? "Activo"), ...vigenciaDe(e) },
      { tipoPeriodo: periodo.tipoPeriodo, fechaInicio: periodo.fechaInicio, fechaFin: periodo.fechaFin },
    ),
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
  const cuotasAplicadas = 0;
  const totalCuotasAplicado = 0;
  let empleadosSinIgssQ1 = 0;
  const horasExtraAplicadas = 0;
  const totalHorasExtraHoras = 0;
  const totalHorasExtraMonto = 0;
  try {
    await conn.beginTransaction();

    // Serializa regeneraciones y vuelve a validar el estado tras esperar el lock.
    const periodoBloqueado = await bloquearPeriodosPlanilla(conn, empresaId, periodoId);
    if (!periodoBloqueado || !["Borrador", "Generada"].includes(String(periodoBloqueado.estado))) {
      throw new Error("El periodo ya no está abierto para generar. Actualiza la pantalla.");
    }
    if (await tieneAutorizacion(conn, empresaId, periodoId)) throw new Error("La planilla ya está autorizada; no se puede regenerar.");
    await exigirPrimeraQuincenaSinDependientes(conn, empresaId, periodoId);
    const [prevRows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ? FOR UPDATE`,
      [empresaId, periodoId],
    );
    const prev = prevRows.map(mapLinea);
    if (prev.some((linea) => linea.estadoPago === "Pagado")) {
      throw new Error("No se puede regenerar una planilla con pagos registrados. Debe revisarse antes de modificar importes.");
    }
    const empleadosIncluidos = new Set(empleados.map((e) => Number(e.id)));
    if (prev.some((linea) => !empleadosIncluidos.has(linea.empleadoId))) {
      throw new Error("Hay empleados de esta planilla que ya no están activos. No se eliminaron sus líneas; revisa sus movimientos antes de regenerar.");
    }
    // Nunca descartar referencias/notas ni ajustes al regenerar, incluso si un
    // cliente antiguo envía conservarPagos=false.
    const prevMap = new Map(prev.map((l) => [l.empleadoId, l]));

    const pendientes = await obtenerConceptosPendientes(conn, empresaId, periodo);
    if ([...pendientes.keys()].some((id) => !empleadosIncluidos.has(id))) throw new Error("Hay conceptos pendientes de un empleado no incluido. No se modificó ningún concepto; revisa sus movimientos antes de generar.");

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
           AND p.mes = ? AND p.anio = ? AND p.estado <> 'Cancelado'
         FOR UPDATE`,
        [empresaId, periodo.mes, periodo.anio],
      );
      for (const r of q1Rows) {
        if (datosQ1PorEmpleado.has(Number(r.id_empleado))) {
          throw new Error("Hay más de una primera quincena para el mismo empleado. Revisa los períodos antes de generar.");
        }
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
      // Vista previa: fuentes independientes capturadas sin consumirlas.
      const conceptosEmpleado = pendientes.get(empId) ?? pendientesVacios();
      const { otrosIngresos: otros, descuentos: desc } = totalesConceptos(conceptosEmpleado);

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

      // RRHH-PLANILLAS-ISR-2026-INTEGRACION: ejercicio 2026 usa el motor
      // puro (vía adapter) a nivel MENSUAL equivalente; el reparto de
      // quincenas de más abajo queda intacto, solo cambia la FUENTE de
      // isrMensual. Outsourcing nunca pasa por el adapter (nunca paga ISR).
      // Cualquier otro ejercicio conserva isr.ts sin cambios.
      let isrMensual: number;
      let fiscal2026: Awaited<ReturnType<typeof calcularFiscal2026Empleado>> | null = null;
      if (out) {
        isrMensual = 0;
      } else if (anioFiscal === EJERCICIO_MOTOR_ISR_2026) {
        fiscal2026 = await calcularFiscal2026Empleado(
          conn, empresaId, anioFiscal,
          { id: periodoId, mes: periodo.mes, fechaInicio: periodo.fechaInicio },
          { id: empId, codigo: String(e.codigo ?? ""), sueldo, bonoIncentivo: bonoInc, bonoHerramientas: bonoHerr, ...vigenciaDe(e) },
          conceptosEmpleado,
        );
        isrMensual = Number(fiscal2026.resultado.retencionSugerida);
      } else {
        isrMensual = calcularISRMensual(sueldo, bonoInc, anioFiscal);
      }

      let sueldoLinea: number;
      let bonoIncLinea: number;
      let bonoHerrLinea: number;
      let igssLab: number;
      let igssPat: number;
      let isr: number;

      // DEVENGO: período ∩ relación laboral, en base 30 (ver planilla-devengo.ts). Solo QUINCENA_1/QUINCENA_2/MENSUAL se
      // prorratean; ESPECIAL e históricos (sin tipo) conservan su regla anterior.
      const vigencia = vigenciaDe(e);
      const devengo = calcularDevengoPeriodo(
        { tipoPeriodo: periodo.tipoPeriodo, fechaInicio: periodo.fechaInicio, fechaFin: periodo.fechaFin },
        vigencia,
      );
      const IGSS_LAB_BASE = out ? 0 : sueldo * IGSS_LABORAL_PCT;
      const IGSS_PAT_BASE = out ? 0 : sueldo * IGSS_PATRONAL_PCT;

      if (periodo.tipoPeriodo === "MENSUAL") {
        // Mes completo = 30 días; ingreso/egreso dentro del mes = proporcional (mensual × días / 30).
        const d = devengo.diasDevengados;
        sueldoLinea = importePorDias(sueldo, d);
        bonoIncLinea = importePorDias(bonoInc, d);
        bonoHerrLinea = importePorDias(bonoHerr, d);
        igssLab = importePorDias(IGSS_LAB_BASE, d);
        igssPat = importePorDias(IGSS_PAT_BASE, d);
        isr = isrMensual;
      } else if (periodo.tipoPeriodo == null) {
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
      } else {
        // QUINCENA_1 / QUINCENA_2: el mes real devengado = días(Q1) + días(Q2) en base 30. Q1 y Q2 nunca suman más
        // que ese mes (ni 31 días en meses de 31). Q2 se concilia contra lo que Q1 REALMENTE tiene persistido.
        const quincena: 1 | 2 = periodo.tipoPeriodo === "QUINCENA_1" ? 1 : 2;
        const { diasQ1, diasQ2 } = diasDevengadosQuincenas(
          { tipoPeriodo: periodo.tipoPeriodo, fechaInicio: periodo.fechaInicio, fechaFin: periodo.fechaFin },
          vigencia,
        );
        const q1 = quincena === 2 && necesitaIgssQ1 ? datosQ1PorEmpleado.get(empId) : undefined;
        if (quincena === 2 && q1 == null && diasQ1 > 0) empleadosSinIgssQ1 += 1; // Q2 generada sin Q1 válida para quien sí trabajó en Q1
        const parte = (mensualBase: number, q1Valor: number | undefined) =>
          repartirConceptoMensual({ mensualBase, diasQ1, diasQ2, quincena, q1Persistido: q1Valor ?? null });
        sueldoLinea = parte(sueldo, q1?.sueldoBase);
        bonoIncLinea = parte(bonoInc, q1?.bonoIncentivo);
        bonoHerrLinea = parte(bonoHerr, q1?.bonoHerramientas);
        igssLab = parte(IGSS_LAB_BASE, q1?.igssLaboral);
        igssPat = parte(IGSS_PAT_BASE, q1?.igssPatronal);
        // ISR (ejercicios sin motor propio): reparto a la mitad + conciliación, como siempre; 2026 se decide abajo.
        isr = quincena === 1 ? redondearQ(isrMensual / 2) : q1 == null ? redondearQ(isrMensual / 2) : redondearQ(isrMensual - q1.isr);
      }

      // CORRECCIÓN DE REGLA DE NEGOCIO (2026): el ISR NO se reparte entre
      // quincenas — en esta operación se descuenta UNA SOLA VEZ AL MES.
      // QUINCENA_1 siempre aplica Q0.00 de ISR; QUINCENA_2 aplica el ISR
      // completo del mes (el adapter ya no resta ISR de Q1 al calcularlo:
      // Q1 nunca aporta ISR retenido, ver planilla-fiscal-2026.ts). MENSUAL
      // y ESPECIAL ya cobran el mes completo sin repartir (isr = isrMensual
      // arriba), así que no necesitan ajuste adicional. Esto SOLO aplica al
      // ejercicio 2026 (motor nuevo); otros ejercicios conservan el reparto
      // a la mitad + reconciliación de siempre, sin ningún cambio.
      if (anioFiscal === EJERCICIO_MOTOR_ISR_2026 && !out) {
        if (periodo.tipoPeriodo === "QUINCENA_1") {
          isr = 0;
        } else if (periodo.tipoPeriodo === "QUINCENA_2") {
          isr = isrMensual;
        }
      }

      const forma = anterior
        ? anterior.formaPago
        : normalizarFormaPago(String(e.forma_pago ?? "transferencia"));
      const estadoPago = anterior?.estadoPago === "Pagado" ? "Pagado" : "Pendiente";
      const refPago = anterior?.refPago ?? "";
      // El ISR persistido ya es del período, no un importe mensual a dividir
      // — EXCEPTO en 2026, donde el ticket pide recalcular en cada generar/
      // regenerar con el motor puro (ver docblock de planilla-fiscal-2026.ts).
      // Esto también significa que un ajuste manual de ISR hecho vía
      // actualizarLinea() en un período 2026 se pierde al regenerar — mismo
      // comportamiento que ya tenían sueldo/bonos/IGSS antes de este cambio,
      // ahora extendido a ISR solo para este ejercicio.
      if (anterior && anioFiscal !== EJERCICIO_MOTOR_ISR_2026) isr = anterior.isr;

      // RRHH-PLANILLAS-ISR-2026-INTEGRACION: el snapshot se arma AQUÍ, ya
      // con `isr` resuelto (Q0.00 en QUINCENA_1; completo del mes en
      // QUINCENA_2/MENSUAL/ESPECIAL — ver corrección de regla de negocio
      // arriba) — nunca antes. `isrAplicadoPeriodo` guarda ESE valor final,
      // distinto de `fiscal2026.resultado.retencionSugerida` (el cálculo
      // mensual del motor, antes de decidir en qué período del mes se
      // cobra) — es contra `isrAplicadoPeriodo` que autorizarPeriodoPlanilla
      // debe comparar para detectar un ajuste manual, no contra
      // retencionSugerida (eso marcaría falso positivo en QUINCENA_1, cuyo
      // ISR automático legítimamente vale 0, no el mensual completo).
      const devengoSnapshot: DevengoSnapshot = {
        estadoEmpleado: String(e.estado ?? "Activo"),
        fechaInicioLaboral: vigencia.inicioLaboral,
        fechaEgreso: vigencia.finLaboral,
        inicioDevengo: devengo.inicioDevengo,
        finDevengo: devengo.finDevengo,
        diasPeriodoNominales: devengo.diasPeriodoNominales,
        diasDevengados: devengo.prorrateado ? devengo.diasDevengados : devengo.diasPeriodoNominales,
        baseDiasMensual: BASE_DIAS_MES,
        prorrateado: devengo.prorrateado,
        sueldoMensual: sueldo,
        salarioDiario: Math.round((sueldo / BASE_DIAS_MES) * 10000) / 10000,
        sueldoPeriodo: sueldoLinea,
        bonoIncentivoMensual: bonoInc,
        bonoIncentivoPeriodo: bonoIncLinea,
        bonoHerramientasMensual: bonoHerr,
        bonoHerramientasPeriodo: bonoHerrLinea,
      };
      const snapshot: ConceptosSnapshot = fiscal2026
        ? {
            version: 2, empresaId, periodoId, empleadoId: empId, sueldoMensual: sueldo, ...conceptosEmpleado, devengo: devengoSnapshot,
            fiscal: {
              motor: "ISR_TRABAJO_2026", ejercicio: EJERCICIO_MOTOR_ISR_2026,
              antecedenteRevision: fiscal2026.antecedenteRevision,
              parametrosRevision: fiscal2026.resultado.parametrosRevision,
              fechaCorte: periodo.fechaInicio,
              inputUsado: fiscal2026.input,
              resultado: fiscal2026.resultado,
              isrAplicadoPeriodo: isr.toFixed(2),
              configuracionConceptosRevision: fiscal2026.configuracionConceptosRevision,
            },
          }
        : { version: 1, empresaId, periodoId, empleadoId: empId, sueldoMensual: sueldo, ...conceptosEmpleado, devengo: devengoSnapshot };

      // No convertir una diferencia inconsistente en retención negativa
      // (o devolución automática). Requiere revisión explícita de RRHH.
      const conceptos = {
        sueldo: sueldoLinea, bonoIncentivo: bonoIncLinea,
        bonoHerramientas: bonoHerrLinea, igssLaboral: igssLab,
        igssPatronal: igssPat, isr,
      };
      for (const [concepto, importe] of Object.entries(conceptos)) {
        if (!Number.isFinite(importe) || importe < 0) {
          throw new Error(`El concepto ${concepto} del empleado #${empId} resulta negativo o inválido. Revisa la primera quincena y los importes mensuales; no se guardó la generación.`);
        }
      }
      const neto = redondearQ(
        sueldoLinea + bonoIncLinea + bonoHerrLinea + otros - igssLab - desc - isr,
      );

      await conn.execute(
        `INSERT INTO rrhh_planilla_lineas
          (empresa_id, periodo_id, id_empleado, codigo_empleado, nombre_empleado,
           dpi, tipo_contrato, forma_pago, sueldo_base, bono_incentivo, bono_herramientas,
           otros_ingresos, igss_laboral, igss_patronal, descuentos, isr, neto,
           estado_pago, ref_pago, conceptos_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           codigo_empleado = VALUES(codigo_empleado), nombre_empleado = VALUES(nombre_empleado),
           dpi = VALUES(dpi), tipo_contrato = VALUES(tipo_contrato),
           sueldo_base = VALUES(sueldo_base), bono_incentivo = VALUES(bono_incentivo),
           bono_herramientas = VALUES(bono_herramientas), otros_ingresos = VALUES(otros_ingresos),
           igss_laboral = VALUES(igss_laboral), igss_patronal = VALUES(igss_patronal),
           descuentos = VALUES(descuentos), neto = VALUES(neto), conceptos_snapshot = VALUES(conceptos_snapshot)`,
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
          JSON.stringify(snapshot),
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

  const candidatos = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, tipo_contrato, sueldo_base, estado, fecha_alta, fecha_inicio_laboral, fecha_egreso
     FROM empleados WHERE empresa_id = ? AND estado IN ('Activo', 'Baja') ORDER BY nombre`,
    [empresaId],
  );
  // El IGSS esperado del mes es sobre lo REALMENTE devengado (base 30): quien ingresó o se dio de baja a mitad de mes no
  // cotiza como si hubiera trabajado el mes completo; quien salió antes del mes no aparece.
  const vigenciaMes = (e: RowDataPacket) => ({
    inicioLaboral: toIsoDate(e.fecha_inicio_laboral as string | Date | null) ?? toIsoDate(e.fecha_alta as string | Date | null),
    finLaboral: toIsoDate(e.fecha_egreso as string | Date | null),
  });
  const diasMes = (e: RowDataPacket) => diasBase30EnMes(anio, mes, vigenciaMes(e));
  const empleados = candidatos.filter((e) => {
    const estado = String(e.estado ?? "Activo");
    if (estado === "Baja" && !e.fecha_egreso) return false;
    return diasMes(e) > 0;
  });

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
    const igssMensualEsperado = out ? 0 : importePorDias(sueldo * IGSS_LABORAL_PCT, diasMes(e));
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
  periodoId: number,
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
  return conPeriodoBloqueado(empresaId, periodoId, async (conn, estadoPeriodo) => {
  if (!["Generada", "Cerrada"].includes(estadoPeriodo)) throw new Error("El periodo no permite cambios de líneas.");
  const autorizada = await tieneAutorizacion(conn, empresaId, periodoId);
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ? AND id = ? FOR UPDATE`,
    [empresaId, periodoId, lineaId],
  );
  if (!rows[0]) return null;
  const cur = mapLinea(rows[0]);
  if (patch.isr != null && (!Number.isFinite(patch.isr) || patch.isr < 0)) throw new Error("El ISR debe ser un importe no negativo.");
  const cambiaImporte = patch.isr != null && redondearQ(patch.isr) !== cur.isr;
  if (cambiaImporte) await exigirPrimeraQuincenaSinDependientes(conn, empresaId, periodoId);
  const cambiaForma = patch.formaPago != null && normalizarFormaPago(patch.formaPago) !== cur.formaPago;
  if ((autorizada || estadoPeriodo === "Cerrada" || cur.estadoPago === "Pagado") && (cambiaImporte || cambiaForma)) {
    throw new Error("No se pueden cambiar importes ni forma de pago de una planilla cerrada o una línea pagada.");
  }
  if (cur.estadoPago === "Pagado" && patch.estadoPago === "Pendiente") {
    throw new Error("Un pago registrado requiere una reversión explícita; no puede volver a pendiente desde esta edición.");
  }
  if (patch.estadoPago === "Pagado" && cur.estadoPago !== "Pagado" && !autorizada) throw new Error("La planilla no está autorizada; no se pueden registrar pagos.");
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

  await conn.execute(
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
  return { ...cur, formaPago: forma, isr, neto, estadoPago, refPago, notas };
  });
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
  return conPeriodoBloqueado(empresaId, periodoId, async (conn, estado) => {
  if (!["Generada", "Cerrada"].includes(estado)) throw new Error("El periodo no permite registrar pagos.");
  if (opts.estadoPago === "Pendiente") throw new Error("Los pagos requieren una reversión explícita; no se pueden desmarcar en lote.");
  if (!await tieneAutorizacion(conn, empresaId, periodoId)) throw new Error("La planilla no está autorizada; no se pueden registrar pagos.");
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
  const [r] = await conn.execute<ResultSetHeader>(sql, params);
  return Number((r as ResultSetHeader).affectedRows ?? 0);
  });
}

async function tieneAutorizacion(conn: PoolConnection, empresaId: number, periodoId: number): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT autorizado_en FROM rrhh_planilla_periodos WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, periodoId]);
  return rows[0]?.autorizado_en != null;
}

export async function autorizarPeriodoPlanilla(empresaId: number, periodoId: number, usuario: string): Promise<void> {
  if (!usuario.trim()) throw new Error("Se requiere el usuario responsable.");
  await asegurarSchemaPlanillas();
  await conPeriodoBloqueado(empresaId, periodoId, async (conn, estado) => {
    if (await tieneAutorizacion(conn, empresaId, periodoId)) throw new Error("La planilla ya está autorizada.");
    if (estado !== "Generada") throw new Error("Solo se puede autorizar una planilla Generada.");
    const [periodos] = await conn.query<RowDataPacket[]>("SELECT * FROM rrhh_planilla_periodos WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, periodoId]);
    if (!periodos[0]) throw new Error("Periodo no encontrado.");
    const periodo = mapPeriodo(periodos[0]);
    const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ? ORDER BY id FOR UPDATE", [empresaId, periodoId]);
    if (!rows.length) throw new Error("No se puede autorizar una planilla sin líneas.");
    if (rows.some((l) => l.estado_pago === "Pagado")) throw new Error("Este período tiene pagos históricos; requiere revisión explícita y no puede autorizarse retroactivamente.");
    const pendientes = await obtenerConceptosPendientes(conn, empresaId, periodo);
    const snapshots = rows.map((l) => validarSnapshotContraPendientes(l.conceptos_snapshot, pendientes.get(Number(l.id_empleado)) ?? pendientesVacios(), {
      empresaId, periodoId, empleadoId: Number(l.id_empleado), descuentos: Number(l.descuentos), otrosIngresos: Number(l.otros_ingresos),
    }));
    for (const l of rows) {
      const ingresos = Number(l.sueldo_base) + Number(l.bono_incentivo) + Number(l.bono_herramientas) + Number(l.otros_ingresos);
      const retenciones = Number(l.igss_laboral) + Number(l.descuentos) + Number(l.isr);
      if (!Number.isFinite(ingresos) || !Number.isFinite(retenciones) || Number(l.neto) !== redondearQ(ingresos - retenciones)) throw new Error("Los importes de la vista previa son inconsistentes. Regenera la planilla.");
    }
    const empleados = new Set(snapshots.map((s) => s.empleadoId));
    if (empleados.size !== snapshots.length) throw new Error("La planilla contiene empleados duplicados.");
    const [salarios] = await conn.query<RowDataPacket[]>(
      `SELECT id, codigo, sueldo_base, bono_incentivo, bono_herramientas, fecha_alta, fecha_inicio_laboral, fecha_egreso FROM empleados WHERE empresa_id = ? AND id IN (${snapshots.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
      [empresaId, ...snapshots.map((s) => s.empleadoId)],
    );
    const empleadoActualPorId = new Map(salarios.map((e) => [Number(e.id), {
      codigo: String(e.codigo ?? ""),
      sueldo: Number(e.sueldo_base ?? 0) || 0,
      bonoIncentivo: e.bono_incentivo != null && e.bono_incentivo !== "" ? Number(e.bono_incentivo) : 250,
      bonoHerramientas: Number(e.bono_herramientas ?? 0) || 0,
      inicioLaboral: toIsoDate(e.fecha_inicio_laboral as string | Date | null) ?? toIsoDate(e.fecha_alta as string | Date | null),
      finLaboral: toIsoDate(e.fecha_egreso as string | Date | null),
    }]));
    for (const s of snapshots) {
      const sueldoActual = empleadoActualPorId.get(s.empleadoId)?.sueldo;
      if (sueldoActual == null || !Number.isFinite(sueldoActual) || redondearQ(sueldoActual) !== redondearQ(s.sueldoMensual)) {
        throw new Error("La información salarial cambió. Debe regenerarse la planilla antes de autorizar.");
      }
    }
    // RRHH-PLANILLAS-ISR-2026-INTEGRACION: revalida que el input fiscal
    // (antecedentes confirmados, acumulados de períodos ya autorizados,
    // sueldo/bonos vigentes, parámetros 2026) siga siendo EXACTAMENTE el
    // usado al generar/regenerar — igual de estricto que la revalidación de
    // sueldo de arriba. Cualquier diferencia, o que el cálculo ahora
    // bloquee (antecedentes ya no confirmados, concepto ahora PENDIENTE),
    // exige regenerar la planilla; nunca autoriza con un fiscal desactualizado
    // ni recalcula/aplica nada por su cuenta. Líneas sin `fiscal` (snapshot
    // v1, ejercicio distinto de 2026) no pasan por aquí.
    for (const s of snapshots) {
      if (!s.fiscal) continue;
      const actual = empleadoActualPorId.get(s.empleadoId);
      if (!actual) throw new Error("La información salarial cambió. Debe regenerarse la planilla antes de autorizar.");
      const recalculo = await calcularFiscal2026Empleado(
        conn, empresaId, s.fiscal.ejercicio,
        { id: s.periodoId, mes: periodo.mes, fechaInicio: periodo.fechaInicio },
        { id: s.empleadoId, codigo: actual.codigo, sueldo: actual.sueldo, bonoIncentivo: actual.bonoIncentivo, bonoHerramientas: actual.bonoHerramientas, inicioLaboral: actual.inicioLaboral, finLaboral: actual.finLaboral },
        { cuotas: s.cuotas, manuales: s.manuales, horasExtra: s.horasExtra, descuentosLegado: s.descuentosLegado, prestacionesLegado: s.prestacionesLegado },
      );
      // Corrección de revisión externa (segunda ronda, punto 2):
      // `parametrosRevision` vive en `resultado`, no en `input` — si solo
      // se comparara `input`, un cambio de versión de parámetros 2026 entre
      // generar y autorizar (p.ej. un despliegue que cambia
      // PARAMETROS_ISR_2026 sin que cambie el ejercicio) pasaría
      // desapercibido. calcularIsrTrabajo2026 es puro y determinista: si el
      // input es idéntico, el resultado DEBE serlo también bajo la MISMA
      // versión de código — comparar el `resultado` completo (que incluye
      // parametrosRevision, isrAnual, rentaImponible, retencionSugerida...)
      // detecta tanto ese caso como cualquier otro desvío, sin depender
      // únicamente de la igualdad de `input`.
      // RRHH-FISCAL-CONCEPTOS-2026: también revalida la revisión de la
      // configuración de conceptos (sueldo/bono incentivo/bono herramientas/
      // horas extra) — mismo motivo que parametrosRevision: si cambió entre
      // generar y autorizar (p.ej. bono_herramientas pasó de PENDIENTE a
      // GRAVADO en una revisión publicada después), el input recalculado
      // podría coincidir por casualidad para ESTE empleado puntual aunque la
      // configuración real haya cambiado — comparar la revisión explícita lo
      // detecta siempre, no solo cuando cambia el resultado numérico.
      if (
        JSON.stringify(recalculo.input) !== JSON.stringify(s.fiscal.inputUsado) ||
        JSON.stringify(recalculo.resultado) !== JSON.stringify(s.fiscal.resultado) ||
        recalculo.antecedenteRevision !== s.fiscal.antecedenteRevision ||
        recalculo.configuracionConceptosRevision !== s.fiscal.configuracionConceptosRevision
      ) {
        throw new Error("La información fiscal (antecedentes, acumulados, configuración de conceptos o parámetros 2026) cambió. Debe regenerarse la planilla antes de autorizar.");
      }
    }
    for (const s of snapshots) await aplicarConceptosSnapshot(conn, s, usuario);
    const [r] = await conn.execute<ResultSetHeader>(`UPDATE rrhh_planilla_periodos SET estado = 'Cerrada', autorizado_por = ?, autorizado_en = NOW()
      WHERE empresa_id = ? AND id = ? AND estado = 'Generada' AND autorizado_en IS NULL`, [usuario, empresaId, periodoId]);
    if (r.affectedRows !== 1) throw new Error("No se pudo confirmar la autorización.");
    // RRHH-PLANILLAS-ISR-2026-INTEGRACION: no hay isrCalculado/isrAplicado
    // separados todavía (ver planilla-fiscal-2026.ts — documentado como gap
    // pendiente, no se implementa en este PR para no ampliar demasiado el
    // alcance). Como mínimo, un ajuste manual del ISR vía actualizarLinea()
    // que sobreviva la revalidación de arriba (porque el INPUT fiscal no
    // cambió, solo el importe persistido) queda visible en la auditoría en
    // vez de invisible. Comparar contra `isrAplicadoPeriodo` (el valor
    // REALMENTE aplicado a esta línea al generar — Q0.00 en QUINCENA_1, el
    // mensual completo en QUINCENA_2/MENSUAL/ESPECIAL), NUNCA contra
    // `resultado.retencionSugerida` (el cálculo mensual del motor, antes de
    // decidir en qué período del mes se cobra) — así no se marca falso
    // positivo en QUINCENA_1, cuyo ISR automático legítimamente vale 0.
    const empleadosConIsrSobrescrito = snapshots
      .map((s, i) => ({ empleadoId: s.empleadoId, isrPersistido: Number(rows[i].isr), fiscal: s.fiscal }))
      .filter(({ isrPersistido, fiscal }) => fiscal
        && redondearQ(isrPersistido) !== redondearQ(Number(fiscal.isrAplicadoPeriodo)))
      .map(({ empleadoId }) => empleadoId);
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion: "autorizar_periodo_planilla", modulo: "rrhh", detalle: JSON.stringify({ periodoId, codigo: periodo.codigo, empleados: snapshots.length,
      cuotas: snapshots.reduce((sum, s) => sum + s.cuotas.length + s.manuales.length, 0), horasExtra: snapshots.reduce((sum, s) => sum + s.horasExtra.length, 0),
      ...(snapshots.some((s) => s.faltas?.length) ? { faltas: snapshots.reduce((sum, s) => sum + (s.faltas?.length ?? 0), 0) } : {}),
      ...(empleadosConIsrSobrescrito.length ? { isrSobrescritoManualmente: empleadosConIsrSobrescrito } : {}) }) });
  });
}

export async function actualizarEstadoPeriodo(
  empresaId: number,
  periodoId: number,
  estado: string,
  contexto: { usuario: string; motivo?: string },
): Promise<void> {
  if (estado === "Cerrada") return autorizarPeriodoPlanilla(empresaId, periodoId, contexto.usuario);
  const motivo = contexto.motivo?.trim() ?? "";
  if (!contexto.usuario.trim()) throw new Error("Se requiere el usuario responsable.");
  if (estado === "Generada" && !motivo) throw new Error("Debes indicar un motivo para reabrir la planilla.");
  if (motivo.length > 1000) throw new Error("El motivo no debe exceder 1000 caracteres.");
  await asegurarSchemaPlanillas();
  await conPeriodoBloqueado(empresaId, periodoId, async (conn, actual) => {
  if (await tieneAutorizacion(conn, empresaId, periodoId)) throw new Error("No se permite reabrir una planilla autorizada. Requiere una reversión explícita.");
  if (!((actual === "Generada" && estado === "Cerrada") || (actual === "Cerrada" && estado === "Generada"))) {
    throw new Error(`Transición de planilla no permitida: ${actual} → ${estado}.`);
  }
  const [lineas] = await conn.query<RowDataPacket[]>(
    "SELECT id, estado_pago FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ? FOR UPDATE",
    [empresaId, periodoId],
  );
  if (!lineas.length) throw new Error("No se puede cerrar o reabrir una planilla sin líneas.");
  if (estado === "Generada" && lineas.some((l) => l.estado_pago === "Pagado")) {
    throw new Error("No se puede reabrir una planilla con pagos registrados.");
  }
  if (estado === "Generada") await exigirPrimeraQuincenaSinDependientes(conn, empresaId, periodoId);
  await conn.execute(
    `UPDATE rrhh_planilla_periodos SET estado = ? WHERE id = ? AND empresa_id = ?`,
    [estado, periodoId, empresaId],
  );
  await registrarAuditoriaTx(conn, {
    empresaId, usuario: contexto.usuario,
    accion: estado === "Cerrada" ? "cerrar_periodo_planilla" : "reabrir_periodo_planilla",
    modulo: "rrhh",
    detalle: JSON.stringify({ periodoId, estadoAnterior: actual, estadoNuevo: estado, motivo: motivo || null }),
  });
  });
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
