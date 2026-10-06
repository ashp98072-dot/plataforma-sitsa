import { differenceInYears, format, parseISO } from "date-fns";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { hoyLocal, toIsoDate } from "./dates";
import { contarEvidenciasPorIncidencia } from "./evidencias";
import {
  MAX_PERIODOS_VIGENTES,
  analizarTraslapes,
  calcularDiasAcumuladosProporcional,
  estadoVisualPeriodo,
  fechaLaboralSospechosa,
  planificarSincronizacion,
  type AdvertenciaPeriodos,
  type EstadoVisualPeriodo,
  type FilaSaldo,
  type MotivoOmision,
} from "./vacaciones-periodos";

// La fórmula proporcional vive ahora en vacaciones-periodos.ts (módulo puro); se re-exporta para no romper a nadie.
export { calcularDiasAcumuladosProporcional };

function toDate(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  return parseISO(String(value).slice(0, 10));
}

function toIso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export async function obtenerFeriadosEnRango(
  empresaId: number,
  fInicio: string,
  fFin: string,
): Promise<Set<string>> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT fecha FROM feriados
       WHERE empresa_id = ? AND activo = 1 AND fecha BETWEEN ? AND ?`,
      [empresaId, fInicio, fFin],
    );
    return new Set(
      rows.map((r) =>
        String(r.fecha instanceof Date ? toIso(r.fecha) : r.fecha).slice(0, 10),
      ),
    );
  } catch {
    return new Set();
  }
}

export async function contarDiasHabiles(
  empresaId: number,
  fInicio: string,
  fFin: string,
): Promise<number> {
  const inicio = toDate(fInicio);
  const fin = toDate(fFin);
  if (inicio > fin) return 0;
  const feriados = await obtenerFeriadosEnRango(empresaId, fInicio, fFin);
  let dias = 0;
  const dia = new Date(inicio);
  while (dia <= fin) {
    const fechaStr = toIso(dia);
    const weekdayPy = (dia.getDay() + 6) % 7;
    if (weekdayPy !== 6 && !feriados.has(fechaStr)) dias += 1;
    dia.setDate(dia.getDate() + 1);
  }
  return dias;
}

type ResultadoSincronizacionEmpresa = {
  empleados: number;
  errores: number;
};

/**
 * Mantiene al día los saldos de todos los colaboradores activos sin exigir
 * que RRHH abra primero la ficha de cada uno. La campana y el panel de
 * alertas llaman esta función antes de consultar quién alcanzó 15 días.
 *
 * Se deduplica por empresa y día de Guatemala para que el polling de la
 * campana siga siendo barato: como máximo se recalcula una vez al día por
 * proceso de servidor. Las promesas concurrentes comparten el mismo trabajo.
 */
const sincronizacionesEmpresa = new Map<
  number,
  { fecha: string; promesa: Promise<ResultadoSincronizacionEmpresa> }
>();

export async function sincronizarVacacionesEmpleadosActivos(
  empresaId: number,
): Promise<ResultadoSincronizacionEmpresa> {
  const fecha = hoyLocal();
  const vigente = sincronizacionesEmpresa.get(empresaId);
  if (vigente?.fecha === fecha) return vigente.promesa;

  const promesa = (async () => {
    const empleados = await query<RowDataPacket[]>(
      `SELECT id
       FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo' AND fecha_alta IS NOT NULL
       ORDER BY id`,
      [empresaId],
    );
    let errores = 0;
    for (const empleado of empleados) {
      try {
        await sincronizarPeriodosVacaciones(empresaId, Number(empleado.id));
      } catch (error) {
        errores += 1;
        console.error(
          `[vacaciones] No se pudo sincronizar empleado ${Number(empleado.id)}:`,
          error,
        );
      }
    }
    return { empleados: empleados.length, errores };
  })();

  sincronizacionesEmpresa.set(empresaId, { fecha, promesa });
  try {
    return await promesa;
  } catch (error) {
    sincronizacionesEmpresa.delete(empresaId);
    throw error;
  }
}

async function fechaBaseAntiguedad(
  conn: PoolConnection,
  empresaId: number,
  idEmpleado: number,
): Promise<Date | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT fecha_alta FROM empleados
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [idEmpleado, empresaId],
  );
  if (!rows[0]?.fecha_alta) return null;
  return toDate(rows[0].fecha_alta as string | Date);
}

export type ResultadoSincronizacionPeriodos = {
  advertencias: AdvertenciaPeriodos[];
  /** true = el empleado quedó CONGELADO (REQUIERE_REPARACION_ADMINISTRADA): no se escribió nada (ni períodos, ni vencimientos, ni tope). */
  requiereReparacion: boolean;
  omitido: MotivoOmision | null;
};

/** Ids de saldos del empleado referenciados por detalle FIFO (tolerante a que la tabla aún no exista). */
async function saldosConConsumo(conn: PoolConnection, empresaId: number, idEmpleado: number): Promise<Set<number>> {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT DISTINCT d.saldo_id
       FROM detalle_consumo_vacaciones d
       INNER JOIN saldos_vacaciones s ON s.id = d.saldo_id
       WHERE s.empresa_id = ? AND s.id_empleado = ?`,
      [empresaId, idEmpleado],
    );
    return new Set((rows ?? []).map((r) => Number(r.saldo_id)));
  } catch (error) {
    if ((error as { errno?: number } | null)?.errno === 1146) return new Set();
    throw error;
  }
}

/**
 * Sincroniza los períodos de UN empleado dentro de la transacción del llamador.
 *
 * RRHH-VACACIONES-HISTORIAL: la generación de períodos la decide `planificarSincronizacion` (módulo puro y probado):
 * períodos esperados siempre desde la fecha base (sin traslape), sin insertar nunca un período que se superponga con otro,
 * sin reescribir fechas de un saldo con consumo FIFO, y sin generar nada si la fecha laboral es sospechosa (< 1980).
 * Las reglas de vencimiento y tope de 30 días (2 períodos completos utilizables) NO cambian: el historial completo se
 * conserva en BD y se consulta con `obtenerHistorialPeriodos`; el saldo UTILIZABLE sigue siendo el de los períodos vigentes.
 */
export async function sincronizarPeriodosVacacionesEnConexion(
  conn: PoolConnection,
  empresaId: number,
  idEmpleado: number,
): Promise<ResultadoSincronizacionPeriodos> {
    const fechaAlta = await fechaBaseAntiguedad(conn, empresaId, idEmpleado);
    if (!fechaAlta) return { advertencias: [], requiereReparacion: false, omitido: null };

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (fechaAlta > hoy) return { advertencias: [], requiereReparacion: false, omitido: null };

    const [existentesRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, anio_laboral, periodo_inicio, periodo_fin,
              dias_otorgados, dias_disponibles, estado
       FROM saldos_vacaciones
       WHERE empresa_id = ? AND id_empleado = ?
       FOR UPDATE`,
      [empresaId, idEmpleado],
    );
    const consumidos = await saldosConConsumo(conn, empresaId, idEmpleado);
    const existentes: FilaSaldo[] = (existentesRows ?? []).map((r) => ({
      id: Number(r.id),
      anioLaboral: r.anio_laboral != null ? Number(r.anio_laboral) : null,
      inicio: String(toIsoDate(r.periodo_inicio) ?? ""),
      fin: String(toIsoDate(r.periodo_fin) ?? ""),
      otorgados: Number(r.dias_otorgados),
      disponibles: Number(r.dias_disponibles),
      estado: String(r.estado),
      conConsumo: consumidos.has(Number(r.id)),
    }));

    const plan = planificarSincronizacion(fechaAlta, hoy, existentes);
    // Fecha sospechosa / futura / serie histórica con consumo / estructura inconsistente: NO se escribe nada
    // (ni INSERT ni UPDATE de períodos, ni vencimientos, ni reducción a 0, ni tope de 30). La lectura/historial sigue funcionando.
    if (plan.omitido) return { advertencias: plan.advertencias, requiereReparacion: plan.requiereReparacion, omitido: plan.omitido };

    for (const ins of plan.inserts) {
      await conn.execute(
        `INSERT IGNORE INTO saldos_vacaciones
          (empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin,
           dias_otorgados, dias_disponibles, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Vigente')`,
        [empresaId, idEmpleado, ins.anioLaboral, ins.inicio, ins.fin, ins.otorgados, ins.otorgados],
      );
    }
    for (const upd of plan.updates) {
      await conn.execute(
        `UPDATE saldos_vacaciones
         SET periodo_inicio = ?, periodo_fin = ?,
             dias_otorgados = ?, dias_disponibles = ?
         WHERE id = ?`,
        [upd.inicio, upd.fin, upd.otorgados, upd.disponibles, upd.id],
      );
    }

    const aniosCompletos = differenceInYears(hoy, fechaAlta);
    const periodoEnCursoN = aniosCompletos + 1;
    const [periodosTodos] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado, anio_laboral, dias_otorgados, dias_disponibles
       FROM saldos_vacaciones
       WHERE empresa_id = ? AND id_empleado = ?
       ORDER BY anio_laboral DESC
       FOR UPDATE`,
      [empresaId, idEmpleado],
    );
    // Un saldo sin año laboral no participa en vencimiento ni tope (queda como advertencia del plan).
    const periodos = (periodosTodos ?? []).filter((p) => p.anio_laboral != null);
    const completados = periodos.filter(
      (p) => Number(p.anio_laboral) !== periodoEnCursoN,
    );
    for (let idx = 0; idx < completados.length; idx++) {
      if (idx < MAX_PERIODOS_VIGENTES) continue;
      const p = completados[idx];
      if (String(p.estado) !== "Vencido") {
        await conn.execute(
          `UPDATE saldos_vacaciones
           SET estado = 'Vencido', dias_disponibles = 0 WHERE id = ?`,
          [Number(p.id)],
        );
      }
    }

    /**
     * Tope 30 días (2 periodos × 15): al acumular el periodo en curso,
     * el excedente se descuenta FIFO del periodo completo más viejo.
     * Ej.: 15 + 15 + 2.49 → 12.51 + 15 + 2.49 = 30.
     */
    const completadosVigentes = completados
      .filter(
        (p, idx) =>
          idx < MAX_PERIODOS_VIGENTES && String(p.estado) !== "Vencido",
      )
      .sort((a, b) => Number(a.anio_laboral) - Number(b.anio_laboral));

    // El descuento por exceso solo tiene sentido cuando YA existen 2 periodos
    // completos vigentes. Si todavía no se completa el segundo periodo, la
    // suma de ambos nunca puede superar el tope (15 + hasta 15 = 30 como
    // máximo), así que no hay excedente real que descontar todavía.
    if (completadosVigentes.length >= MAX_PERIODOS_VIGENTES) {
      const capTotal = completadosVigentes.reduce(
        (s, p) => s + Number(p.dias_otorgados),
        0,
      );
      const enCurso = periodos.find(
        (p) => Number(p.anio_laboral) === periodoEnCursoN,
      );
      const dispEnCurso = enCurso ? Number(enCurso.dias_disponibles) : 0;
      const totalActual =
        completadosVigentes.reduce(
          (s, p) => s + Number(p.dias_disponibles),
          0,
        ) + dispEnCurso;
      let excedente = Math.round((totalActual - capTotal) * 100) / 100;

      if (excedente > 0) {
        for (const p of completadosVigentes) {
          if (excedente <= 0) break;
          const disp = Number(p.dias_disponibles);
          const recorte = Math.min(disp, excedente);
          if (recorte <= 0) continue;
          const nuevoDisp = Math.round((disp - recorte) * 100) / 100;
          await conn.execute(
            "UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ?",
            [nuevoDisp, Number(p.id)],
          );
          p.dias_disponibles = nuevoDisp;
          excedente = Math.round((excedente - recorte) * 100) / 100;
        }
      }
    }
    return { advertencias: plan.advertencias, requiereReparacion: false, omitido: null };
}

export async function sincronizarPeriodosVacaciones(
  empresaId: number,
  idEmpleado: number,
): Promise<ResultadoSincronizacionPeriodos> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await sincronizarPeriodosVacacionesEnConexion(conn, empresaId, idEmpleado);
    await conn.commit();
    return resultado;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export type PeriodoVacaciones = {
  id: number;
  anioLaboral: number;
  periodoInicio: string;
  periodoFin: string;
  diasOtorgados: number;
  diasDisponibles: number;
};

export async function obtenerPeriodosDisponibles(
  empresaId: number,
  idEmpleado: number,
): Promise<PeriodoVacaciones[]> {
  await sincronizarPeriodosVacaciones(empresaId, idEmpleado);
  const rows = await query<RowDataPacket[]>(
    `SELECT id, anio_laboral, periodo_inicio, periodo_fin,
            dias_otorgados, dias_disponibles
     FROM saldos_vacaciones
     WHERE empresa_id = ? AND id_empleado = ? AND estado = 'Vigente'
     ORDER BY anio_laboral ASC`,
    [empresaId, idEmpleado],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    anioLaboral: Number(r.anio_laboral),
    periodoInicio: toIsoDate(r.periodo_inicio) ?? "",
    periodoFin: toIsoDate(r.periodo_fin) ?? "",
    diasOtorgados: Number(r.dias_otorgados),
    diasDisponibles: Number(r.dias_disponibles),
  }));
}

export async function calcularSaldoTotalDisponible(
  empresaId: number,
  idEmpleado: number,
): Promise<number> {
  const periodos = await obtenerPeriodosDisponibles(empresaId, idEmpleado);
  return (
    Math.round(periodos.reduce((s, p) => s + p.diasDisponibles, 0) * 100) / 100
  );
}

export type HistorialPeriodo = {
  id: number;
  anioLaboral: number | null;
  periodoInicio: string;
  periodoFin: string;
  diasOtorgados: number;
  diasConsumidos: number;
  diasDisponibles: number;
  /** Estado de BD (Vigente | Vencido). */
  estado: string;
  /** Estado para mostrar: En curso | Vigente | Consumido | Vencido. */
  estadoVisual: EstadoVisualPeriodo;
};

export type HistorialVacaciones = {
  /** Saldo UTILIZABLE actual (solo períodos Vigentes; el tope de 30 días sigue vigente). NO es la suma del historial. */
  saldoActual: number;
  /** TODOS los períodos del empleado, del más antiguo al más reciente (nunca se borran ni se ocultan por antigüedad). */
  periodos: HistorialPeriodo[];
  fechaLaboral: string | null;
  fechaLaboralSospechosa: boolean;
  /** true si la ficha tiene una fecha laboral sospechosa y NO se muestran como válidos los períodos que generó. */
  historialOculto: boolean;
  /** true = el motor no sincroniza a este empleado (fecha sospechosa, serie histórica con consumo o estructura inconsistente): requiere reparación administrada. */
  requiereReparacion: boolean;
  advertencias: AdvertenciaPeriodos[];
};

/**
 * Historial COMPLETO de períodos de un empleado: período, otorgados, consumidos (suma del detalle FIFO), disponibles y estado.
 * Los períodos vencidos o consumidos siguen siendo parte del historial. No altera FIFO ni el saldo utilizable.
 * Con fecha laboral sospechosa (< 1980) solo se devuelven los períodos con consumo o Vigentes y `historialOculto = true`,
 * en vez de presentar decenas de períodos inválidos como si fueran reales.
 */
export async function obtenerHistorialPeriodos(
  empresaId: number,
  idEmpleado: number,
): Promise<HistorialVacaciones> {
  const sync = await sincronizarPeriodosVacaciones(empresaId, idEmpleado);
  const [empRows, rows] = await Promise.all([
    query<RowDataPacket[]>(
      "SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1",
      [idEmpleado, empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT s.id, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado,
              COALESCE((SELECT SUM(d.dias_tomados) FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id), 0) AS dias_consumidos
       FROM saldos_vacaciones s
       WHERE s.empresa_id = ? AND s.id_empleado = ?
       ORDER BY COALESCE(s.anio_laboral, 99999), s.periodo_inicio, s.id`,
      [empresaId, idEmpleado],
    ),
  ]);
  const base = empRows[0]?.fecha_alta ? toDate(empRows[0].fecha_alta as string | Date) : null;
  const sospechosa = base ? fechaLaboralSospechosa(base) : false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const anioEnCurso = base && !sospechosa && base <= hoy ? differenceInYears(hoy, base) + 1 : null;

  const todos: HistorialPeriodo[] = rows.map((r) => {
    const base2 = {
      estado: String(r.estado),
      anioLaboral: r.anio_laboral != null ? Number(r.anio_laboral) : null,
      disponibles: Number(r.dias_disponibles),
      consumidos: Math.round(Number(r.dias_consumidos) * 100) / 100,
    };
    return {
      id: Number(r.id),
      anioLaboral: base2.anioLaboral,
      periodoInicio: toIsoDate(r.periodo_inicio) ?? "",
      periodoFin: toIsoDate(r.periodo_fin) ?? "",
      diasOtorgados: Number(r.dias_otorgados),
      diasConsumidos: base2.consumidos,
      diasDisponibles: base2.disponibles,
      estado: base2.estado,
      estadoVisual: estadoVisualPeriodo(base2, anioEnCurso),
    };
  });

  const advertencias: AdvertenciaPeriodos[] = [...sync.advertencias];
  advertencias.push(
    ...analizarTraslapes(
      todos.map((p) => ({
        id: p.id, anioLaboral: p.anioLaboral, inicio: p.periodoInicio, fin: p.periodoFin,
        otorgados: p.diasOtorgados, disponibles: p.diasDisponibles, estado: p.estado, conConsumo: p.diasConsumidos > 0,
      })),
    ),
  );
  const periodos = sospechosa ? todos.filter((p) => p.estado === "Vigente" || p.diasConsumidos > 0) : todos;
  if (sospechosa && !advertencias.some((a) => a.codigo === "FECHA_LABORAL_SOSPECHOSA")) {
    advertencias.unshift({ codigo: "FECHA_LABORAL_SOSPECHOSA", mensaje: "Fecha laboral inválida o anterior a 1980: no se generan períodos; requiere el dato real de RRHH." });
  }
  const saldoActual = Math.round(todos.filter((p) => p.estado === "Vigente").reduce((s, p) => s + p.diasDisponibles, 0) * 100) / 100;
  return {
    saldoActual,
    periodos,
    fechaLaboral: base ? toIso(base) : null,
    fechaLaboralSospechosa: sospechosa,
    historialOculto: sospechosa && periodos.length < todos.length,
    requiereReparacion: sync.requiereReparacion || sospechosa,
    advertencias,
  };
}

export type DesgloseConsumo = {
  periodoInicio: string;
  periodoFin: string;
  diasTomados: number;
  diasRestantes: number;
};

export type VacacionesFifoInput = {
  empresaId: number;
  idEmpleado: number;
  fechaInicio: string;
  fechaFin: string;
  diasATomar: number;
  tipo?: string;
  subtipo?: string | null;
};

export type ResultadoVacacionesFifo = {
  ok: boolean;
  mensaje: string;
  desglose: DesgloseConsumo[];
  incidenciaId: number | null;
};

/**
 * Consume saldo y crea el historial usando una transacción que ya pertenece
 * al llamador. No confirma ni revierte la conexión: así la aprobación de una
 * solicitud puede bloquear la solicitud, descontar FIFO y resolverla como
 * una sola operación atómica.
 */
export async function registrarVacacionesFifoEnConexion(
  conn: PoolConnection,
  input: VacacionesFifoInput,
): Promise<ResultadoVacacionesFifo> {
  const diasATomar = input.diasATomar;
  if (diasATomar <= 0) {
    return {
      ok: false,
      mensaje: "Los días a descontar deben ser mayores que cero.",
      desglose: [],
      incidenciaId: null,
    };
  }

  const [periodos] = await conn.query<RowDataPacket[]>(
    `SELECT id, periodo_inicio, periodo_fin, dias_disponibles
     FROM saldos_vacaciones
     WHERE empresa_id = ? AND id_empleado = ?
       AND estado = 'Vigente' AND dias_disponibles > 0
     ORDER BY anio_laboral ASC
     FOR UPDATE`,
    [input.empresaId, input.idEmpleado],
  );
  const saldoTotal = periodos.reduce(
    (s, p) => s + Number(p.dias_disponibles),
    0,
  );

  if (saldoTotal < diasATomar) {
    return {
      ok: false,
      mensaje: `Saldo insuficiente. Disponible: ${saldoTotal.toFixed(2)} día(s).`,
      desglose: [],
      incidenciaId: null,
    };
  }

  let incidenciaId: number;
  try {
    const [insertResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO incidencias
        (empresa_id, id_empleado, tipo, subtipo, fecha_inicio, fecha_fin, dias_habiles)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.empresaId,
        input.idEmpleado,
        input.tipo ?? "Vacaciones",
        input.subtipo ?? null,
        input.fechaInicio,
        input.fechaFin,
        diasATomar,
      ],
    );
    incidenciaId = Number(insertResult.insertId);
  } catch {
    const [insertResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO incidencias
        (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.empresaId,
        input.idEmpleado,
        input.tipo ?? "Vacaciones",
        input.fechaInicio,
        input.fechaFin,
        diasATomar,
      ],
    );
    incidenciaId = Number(insertResult.insertId);
  }

  // También en tabla vacaciones (historial simple)
  await conn.execute(
    `INSERT INTO vacaciones
      (empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, estado)
     VALUES (?, ?, ?, ?, ?, 'Aprobado')`,
    [
      input.empresaId,
      input.idEmpleado,
      input.fechaInicio,
      input.fechaFin,
      diasATomar,
    ],
  );

  let restante = diasATomar;
  const desglose: DesgloseConsumo[] = [];

  for (const p of periodos) {
    if (restante <= 0) break;
    const disponibles = Number(p.dias_disponibles);
    const tomar = Math.min(disponibles, restante);
    if (tomar <= 0) continue;
    const nuevoDisponible = disponibles - tomar;
    await conn.execute(
      "UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ?",
      [nuevoDisponible, Number(p.id)],
    );
    await conn.execute(
      `INSERT INTO detalle_consumo_vacaciones
        (incidencia_id, saldo_id, dias_tomados) VALUES (?, ?, ?)`,
      [incidenciaId, Number(p.id), tomar],
    );
    desglose.push({
      periodoInicio: String(p.periodo_inicio).slice(0, 10),
      periodoFin: String(p.periodo_fin).slice(0, 10),
      diasTomados: tomar,
      diasRestantes: nuevoDisponible,
    });
    restante -= tomar;
  }

  return {
    ok: true,
    mensaje: "Vacaciones registradas (FIFO).",
    desglose,
    incidenciaId,
  };
}

export async function registrarVacacionesFifo(
  input: VacacionesFifoInput,
): Promise<ResultadoVacacionesFifo> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await sincronizarPeriodosVacacionesEnConexion(
      conn,
      input.empresaId,
      input.idEmpleado,
    );
    const resultado = await registrarVacacionesFifoEnConexion(conn, input);
    if (!resultado.ok) {
      await conn.rollback();
      return resultado;
    }
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    return {
      ok: false,
      mensaje:
        err instanceof Error
          ? err.message
          : "Error al registrar. ¿Importaste migrate-2026-08-rrhh-core.sql?",
      desglose: [],
      incidenciaId: null,
    };
  } finally {
    conn.release();
  }
}

/**
 * RRHH-VACACIONES-FILTROS-HISTORIAL-1 — filtros OPCIONALES del historial, independientes del empleado del
 * formulario de registro (ver route.ts): sin empleadoId = todos los colaboradores; sin tipo = todos los tipos; sin
 * desde/hasta = sin restricción de fecha. `empresaId` sigue siendo obligatorio y es SIEMPRE la autoridad del tenant
 * (nunca se filtra solo por lo que llega en `filtros`).
 */
export type FiltrosVacaciones = {
  empleadoId?: number | null;
  tipo?: string | null;
  desde?: string | null;
  hasta?: string | null;
};

export async function listarVacaciones(
  empresaId: number,
  filtros: FiltrosVacaciones = {},
): Promise<RowDataPacket[]> {
  // Historial desde incidencias (como Control de Asistencias) para poder
  // adjuntar evidencias por incidencia_id.
  const empleadoId = filtros.empleadoId ?? null;
  const tipo = filtros.tipo ?? null;
  const desde = filtros.desde ?? null;
  const hasta = filtros.hasta ?? null;
  const rows = await query<RowDataPacket[]>(
    `SELECT i.id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin,
            i.dias_habiles, e.codigo AS emp_codigo, e.nombre AS emp_nombre,
            'Aprobado' AS estado
     FROM incidencias i
     INNER JOIN empleados e ON e.id = i.id_empleado AND e.empresa_id = i.empresa_id
     WHERE i.empresa_id = ?
       AND (? IS NULL OR i.id_empleado = ?)
       AND (? IS NULL OR i.tipo = ?)
       AND (? IS NULL OR i.fecha_inicio >= ?)
       AND (? IS NULL OR i.fecha_inicio <= ?)
     ORDER BY i.fecha_inicio DESC, i.id DESC
     LIMIT 300`,
    [empresaId, empleadoId, empleadoId, tipo, tipo, desde, desde, hasta, hasta],
  );
  const counts = await contarEvidenciasPorIncidencia(
    empresaId,
    rows.map((r) => Number(r.id)),
  );
  return rows.map((r) => ({
    ...r,
    evidencias: counts.get(Number(r.id)) ?? 0,
  }));
}

/** Permisos / incidencias que NO descuentan saldo de vacaciones. */
export async function registrarIncidenciaSinSaldo(input: {
  empresaId: number;
  idEmpleado: number;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
}): Promise<{ ok: boolean; mensaje: string; incidenciaId: number | null }> {
  try {
    const pool = getPool();
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO incidencias
        (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.empresaId,
        input.idEmpleado,
        input.tipo,
        input.fechaInicio,
        input.fechaFin,
        input.dias,
      ],
    );
    return {
      ok: true,
      mensaje: `${input.tipo} registrado.`,
      incidenciaId: Number(r.insertId),
    };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al registrar",
      incidenciaId: null,
    };
  }
}
