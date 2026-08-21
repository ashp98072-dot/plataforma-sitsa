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
    fechaInicio: String(r.fecha_inicio).slice(0, 10),
    fechaFin: String(r.fecha_fin).slice(0, 10),
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
  codigo: string;
  fechaInicio: string;
  fechaFin: string;
  notas?: string | null;
  creadoPor: string;
  tipoPeriodo?: TipoPeriodo | null;
  numeroQuincena?: 1 | 2 | null;
  mes?: number | null;
  anio?: number | null;
};

export type ResultadoCrearPeriodo =
  | { ok: true; id: number }
  | {
      ok: false;
      motivo: "fechas_invalidas" | "solapado" | "codigo_duplicado" | "lock" | "error";
      mensaje: string;
    };

/**
 * Fase P0: crea un periodo validando fechas y solapamiento, protegido con
 * GET_LOCK por empresa (mismo patrón ya usado en flota/viajes y
 * flota/servicios) para que dos requests concurrentes no puedan crear dos
 * periodos solapados — un SELECT de verificación seguido de un INSERT
 * separado no es suficiente contra esa carrera.
 */
export async function crearPeriodo(
  empresaId: number,
  input: NuevoPeriodoInput,
): Promise<ResultadoCrearPeriodo> {
  await asegurarSchemaPlanillas();

  if (input.fechaInicio > input.fechaFin) {
    return {
      ok: false,
      motivo: "fechas_invalidas",
      mensaje: "La fecha de inicio no puede ser posterior a la fecha de fin.",
    };
  }

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

    const [overlapRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, codigo FROM rrhh_planilla_periodos
       WHERE empresa_id = ? AND estado <> 'Cancelado'
         AND fecha_inicio <= ? AND fecha_fin >= ?
       LIMIT 1`,
      [empresaId, input.fechaFin, input.fechaInicio],
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
          input.codigo,
          input.fechaInicio,
          input.fechaFin,
          input.notas ?? null,
          input.creadoPor,
          input.tipoPeriodo ?? null,
          input.numeroQuincena ?? null,
          input.mes ?? null,
          input.anio ?? null,
        ],
      );
      return { ok: true, id: Number(result.insertId) };
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
      motivo: "no_encontrado" | "motivo_requerido" | "estado_no_permite";
      mensaje: string;
    };

/**
 * Fase P0: cancela un periodo (Borrador o Generada únicamente). No borra
 * rrhh_planilla_lineas ya generadas — quedan como histórico. Un periodo
 * Cancelado queda excluido del control de solapamiento de crearPeriodo() y
 * bloqueado para generar/regenerar (ver generarLineasPeriodo).
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
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM rrhh_planilla_lineas
     WHERE empresa_id = ? AND periodo_id = ?
     ORDER BY nombre_empleado`,
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
 */
export async function generarLineasPeriodo(
  empresaId: number,
  periodoId: number,
  opts?: { conservarPagos?: boolean },
): Promise<{ generadas: number }> {
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

  const { descuentos, prestaciones } = await sumasPorEmpleado(
    empresaId,
    periodo.fechaInicio,
    periodo.fechaFin,
  );

  await execute(
    `DELETE FROM rrhh_planilla_lineas WHERE empresa_id = ? AND periodo_id = ?`,
    [empresaId, periodoId],
  );

  let generadas = 0;
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
    const otros = Number(prestaciones.get(empId) ?? 0);
    const desc = Number(descuentos.get(empId) ?? 0);
    const igssLab = out ? 0 : redondearQ(sueldo * IGSS_LABORAL_PCT);
    const igssPat = out ? 0 : redondearQ(sueldo * IGSS_PATRONAL_PCT);
    const anterior = prevMap.get(empId);
    const anioFiscal =
      Number(periodo.fechaInicio.slice(0, 4)) || new Date().getFullYear();
    const isr = out
      ? 0
      : anterior && anterior.isr != null
        ? Number(anterior.isr) || 0
        : calcularISRMensual(sueldo, bonoInc, anioFiscal);
    const forma = anterior
      ? anterior.formaPago
      : normalizarFormaPago(String(e.forma_pago ?? "transferencia"));
    const estadoPago = anterior?.estadoPago === "Pagado" ? "Pagado" : "Pendiente";
    const refPago = anterior?.refPago ?? "";
    const neto = redondearQ(
      sueldo + bonoInc + bonoHerr + otros - igssLab - desc - isr,
    );

    await execute(
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
        sueldo,
        bonoInc,
        bonoHerr,
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

  await execute(
    `UPDATE rrhh_planilla_periodos SET estado = 'Generada' WHERE id = ? AND empresa_id = ?`,
    [periodoId, empresaId],
  );

  return { generadas };
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