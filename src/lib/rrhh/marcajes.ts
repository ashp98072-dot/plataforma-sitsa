import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import {
  calcularEstadoAsistenciaSync,
  minutosRetraso,
} from "./asistencia-estado";
import {
  obtenerHoraEntradaDefault,
  obtenerMinutosTolerancia,
  obtenerParametros,
  obtenerToleranciaSemanal,
} from "./config";
import {
  ahoraLocal,
  formatearTimestampVisible,
  fmtTs,
  hoyLocal,
  normalizarHora,
} from "./dates";
import { validarGeocercaKiosko } from "./geocerca";
import { lunesDeSemana } from "./horario-teorico";

async function tieneSesionAbierta(
  empresaId: number,
  idEmpleado: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ?
       AND (estado = 'ABIERTA' OR estado = 'En curso')
     LIMIT 1`,
    [empresaId, idEmpleado],
  );
  return rows.length > 0;
}

async function tieneJornadaCompletaHoy(
  empresaId: number,
  idEmpleado: number,
  fechaJornada: string,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ? AND fecha_jornada = ?
       AND (estado = 'CERRADA' OR estado = 'Cerrada')
     LIMIT 1`,
    [empresaId, idEmpleado, fechaJornada],
  );
  return rows.length > 0;
}

export type MarcajeColaborador = {
  fecha: string;
  entrada: string;
  salida: string;
  incidencia: string;
  estado: string;
  viajeLargo: boolean;
};

/**
 * Marcajes de UN empleado en un rango de fechas, para el portal de
 * autogestión. A diferencia de listarMarcajesRango (que trae de toda la
 * empresa con un LIMIT compartido, pensado para la pantalla de staff), esta
 * función filtra por id_empleado directamente en SQL: así el colaborador
 * siempre ve su propio historial completo, sin riesgo de quedar fuera de un
 * límite pensado para el total de la empresa.
 */
export async function listarMarcajesEmpleadoRango(
  empresaId: number,
  idEmpleado: number,
  desde: string,
  hasta: string,
): Promise<MarcajeColaborador[]> {
  const p = await obtenerParametros(empresaId);
  const horaDefault = p.hora_entrada_default || "07:00:00";
  const tolerancia = Number.parseInt(p.minutos_tolerancia, 10);
  const tolSemanal = Number.parseInt(p.minutos_tolerancia_semanal, 10);
  const tol = Number.isFinite(tolerancia) ? tolerancia : 0;
  const tolSem = Number.isFinite(tolSemanal) ? tolSemanal : 20;

  const rows = await query<RowDataPacket[]>(
    `SELECT
    s.entrada_at,
    s.salida_at,
    s.estado,
    s.viaje_largo,
    DATE_FORMAT(s.fecha_jornada, '%Y-%m-%d') AS fecha_jornada,
    e.hora_entrada_teorica
     FROM sesiones_trabajo s
     INNER JOIN empleados e ON e.id = s.id_empleado
     WHERE s.empresa_id = ? AND s.id_empleado = ?
       AND s.fecha_jornada BETWEEN ? AND ?
     ORDER BY s.fecha_jornada ASC
     LIMIT 500`,
    [empresaId, idEmpleado, desde, hasta],
  );

  const acumSemana = new Map<string, number>(); // lunes -> minutos usados
  const ordered: MarcajeColaborador[] = [];
  for (const r of rows) {
    const entradaRaw = fmtTs(r.entrada_at as string | Date | null);
    const salidaRaw = fmtTs(r.salida_at as string | Date | null);
    const horaTeorica = String(r.hora_entrada_teorica || horaDefault);
    const fechaJ = String(r.fecha_jornada).slice(0, 10);
    const lunes = lunesDeSemana(fechaJ);
    const usados = acumSemana.get(lunes) ?? 0;

    const lateHoy = entradaRaw ? minutosRetraso(entradaRaw, horaTeorica) : 0;
    acumSemana.set(lunes, usados + lateHoy);

    const { estado: incidencia } = calcularEstadoAsistenciaSync(
      entradaRaw ?? "",
      horaTeorica,
      tol,
      { toleranciaSemanal: tolSem, minutosYaUsadosSemana: usados },
    );

    ordered.push({
      fecha: fechaJ,
      entrada: formatearTimestampVisible(entradaRaw),
      salida: formatearTimestampVisible(salidaRaw),
      incidencia,
      estado: String(r.estado),
      viajeLargo: Number(r.viaje_largo ?? 0) === 1,
    });
  }

  // Más reciente primero, igual que la pantalla de staff.
  ordered.reverse();
  return ordered;
}

export type InfoCodigoMarcaje = {
  encontrado: boolean;
  numeroEmpleado?: string;
  nombre?: string;
  empresaId?: number;
  empresaNombre?: string;
  tipoHorario?: string;
  esVariable?: boolean;
  estado?: string;
};

export async function infoCodigoParaMarcaje(
  _empresaKioskoId: number,
  numeroEmpleado: string,
): Promise<InfoCodigoMarcaje> {
  const numero = numeroEmpleado.trim();

  if (!numero) {
    return { encontrado: false };
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT
       e.numero_empleado,
       e.nombre,
       e.empresa_id,
       e.tipo_horario,
       e.estado,
       emp.nombre AS empresa_nombre
     FROM empleados e
     INNER JOIN empresas emp ON emp.id = e.empresa_id
     WHERE e.numero_empleado = ?
     LIMIT 1`,
    [numero],
  );

  if (!rows[0]) {
    return { encontrado: false };
  }

  const tipo = String(rows[0].tipo_horario ?? "Fijo");

  return {
    encontrado: true,
    numeroEmpleado: String(rows[0].numero_empleado ?? ""),
    nombre: String(rows[0].nombre),
    empresaId: Number(rows[0].empresa_id),
    empresaNombre: String(rows[0].empresa_nombre ?? ""),
    tipoHorario: tipo,
    esVariable: tipo === "Variable" || tipo.includes("Variable"),
    estado: String(rows[0].estado ?? "Activo"),
  };
}

export type MarcajeHoy = {
  id: number;
  nombre: string;
  codigo: string;
  entrada: string;
  salida: string;
  incidencia: string;
  estado: string;
  viajeLargo: boolean;
};

async function minutosRetrasoSemanaAntes(
  empresaId: number,
  idEmpleado: number,
  fechaJornada: string,
  horaTeorica: string,
): Promise<number> {
  const lunes = lunesDeSemana(fechaJornada);
  if (fechaJornada <= lunes) return 0;
  const rows = await query<RowDataPacket[]>(
    `SELECT entrada_at, fecha_jornada FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ?
       AND fecha_jornada >= ? AND fecha_jornada < ?
     ORDER BY fecha_jornada ASC`,
    [empresaId, idEmpleado, lunes, fechaJornada],
  );
  let sum = 0;
  for (const r of rows) {
    const entrada = fmtTs(r.entrada_at as string | Date | null);
    if (!entrada) continue;
    sum += minutosRetraso(entrada, horaTeorica);
  }
  return sum;
}

export async function listarMarcajesRango(
  empresaId: number,
  desde: string,
  hasta: string,
): Promise<MarcajeHoy[]> {
  const p = await obtenerParametros(empresaId);
  const horaDefault = p.hora_entrada_default || "07:00:00";
  const tolerancia = Number.parseInt(p.minutos_tolerancia, 10);
  const tolSemanal = Number.parseInt(p.minutos_tolerancia_semanal, 10);
  const tol = Number.isFinite(tolerancia) ? tolerancia : 0;
  const tolSem = Number.isFinite(tolSemanal) ? tolSemanal : 20;

  const rows = await query<RowDataPacket[]>(
`SELECT
    s.id,
    s.id_empleado,
    e.codigo,
    e.nombre,
    s.entrada_at,
    s.salida_at,
    s.estado,
    e.hora_entrada_teorica,
    s.viaje_largo,
    DATE_FORMAT(s.fecha_jornada, '%Y-%m-%d') AS fecha_jornada
 FROM sesiones_trabajo s
 INNER JOIN empleados e ON e.id = s.id_empleado
 WHERE s.empresa_id = ?
   AND s.fecha_jornada BETWEEN ? AND ?
 ORDER BY s.fecha_jornada ASC, s.entrada_at ASC
 LIMIT 500`,
    [empresaId, desde, hasta],
  );

  // Acumular minutos de retraso por empleado en la semana (sin N+1 queries)
  const acumSemana = new Map<string, number>(); // empId|lunes -> minutos

  const ordered: MarcajeHoy[] = [];
  for (const r of rows) {
    const entradaRaw = fmtTs(r.entrada_at as string | Date | null);
    const salidaRaw = fmtTs(r.salida_at as string | Date | null);
    const horaTeorica = String(r.hora_entrada_teorica || horaDefault);
    const fechaJ = String(r.fecha_jornada).slice(0, 10);
    const empId = Number(r.id_empleado);
    const lunes = lunesDeSemana(fechaJ);
    const keySem = `${empId}|${lunes}`;
    const usados = acumSemana.get(keySem) ?? 0;

    const lateHoy = entradaRaw ? minutosRetraso(entradaRaw, horaTeorica) : 0;
    acumSemana.set(keySem, usados + lateHoy);

    const { estado: incidencia } = calcularEstadoAsistenciaSync(
      entradaRaw ?? "",
      horaTeorica,
      tol,
      { toleranciaSemanal: tolSem, minutosYaUsadosSemana: usados },
    );
    ordered.push({
      id: Number(r.id),
      nombre: String(r.nombre),
      codigo: String(r.codigo),
      entrada: formatearTimestampVisible(entradaRaw),
      salida: formatearTimestampVisible(salidaRaw),
      incidencia,
      estado: String(r.estado),
      viajeLargo: Number(r.viaje_largo ?? 0) === 1,
    });
  }

  // UI espera más recientes primero
  ordered.reverse();
  return ordered;
}

export type ResultadoMarcajeKiosko =
  | {
      ok: true;
      tipo: "Entrada" | "Salida";
      nombre: string;
      hora: string;
      estadoEntrada?: string;
      minutosRetraso?: number;
      viajeLargo?: boolean;
      ubicacionId?: number;
      ubicacionNombre?: string;
      metros?: number;
    }
  | {
      ok: false;
      code: string;
      error: string;
    };

export async function registrarMarcajeKiosko(
  _empresaKioskoId: number,
  input: {
    codigo: string;
    viajeLargo?: boolean;
    latitud?: number | null;
    longitud?: number | null;
  },
): Promise<ResultadoMarcajeKiosko> {
  /*
   * Por compatibilidad con la API/UI actual el campo todavía
   * se llama "codigo", pero representa numero_empleado.
   */
  const numeroEmpleado = input.codigo.trim();

  if (!numeroEmpleado) {
    return {
      ok: false,
      code: "EMPTY",
      error: "Ingrese su número de empleado.",
    };
  }

  const fechaJornada = hoyLocal();
  const timestamp = ahoraLocal();

  /*
   * El empleado se identifica globalmente por numero_empleado.
   * La empresa real se obtiene del propio registro del empleado.
   */
  const empRows = await query<RowDataPacket[]>(
    `SELECT
       id,
       empresa_id,
       numero_empleado,
       nombre,
       estado,
       hora_entrada_teorica,
       tipo_horario
     FROM empleados
     WHERE numero_empleado = ?
     LIMIT 1`,
    [numeroEmpleado],
  );

  if (!empRows[0]) {
    return {
      ok: false,
      code: "NOT_FOUND",
      error: "No se encontró ningún empleado con ese número.",
    };
  }

  const idEmpleado = Number(empRows[0].id);
  const empresaId = Number(empRows[0].empresa_id);
  const nombre = String(empRows[0].nombre);
  const estado = String(empRows[0].estado);

  const horaTeoricaEmp = empRows[0].hora_entrada_teorica
    ? String(empRows[0].hora_entrada_teorica)
    : await obtenerHoraEntradaDefault(empresaId);

  const tipoHorario = String(empRows[0].tipo_horario ?? "Fijo");
  const esVariable =
    tipoHorario === "Variable" || tipoHorario.includes("Variable");

  if (estado === "Baja") {
    return {
      ok: false,
      code: "BAJA",
      error: `El empleado ${nombre} está de Baja.`,
    };
  }

  /*
   * Valida el GPS contra TODAS las ubicaciones autorizadas
   * del grupo.
   */
  const geo = await validarGeocercaKiosko(
    empresaId,
    idEmpleado,
    {
      lat: input.latitud,
      lng: input.longitud,
    },
  );

  if (!geo.ok) {
    return {
      ok: false,
      code: geo.code,
      error: geo.error,
    };
  }

  /*
   * Normalizamos las coordenadas recibidas.
   *
   * Si no vienen coordenadas porque el empleado está en ruta o
   * porque la geocerca está desactivada, se guardará NULL.
   */
  const latitud =
    input.latitud != null &&
    Number.isFinite(Number(input.latitud))
      ? Number(input.latitud)
      : null;

  const longitud =
    input.longitud != null &&
    Number.isFinite(Number(input.longitud))
      ? Number(input.longitud)
      : null;

  const ubicacionId = geo.ubicacionId ?? null;
  const distanciaM = geo.metros ?? null;

  /*
   * ========================================================
   * SALIDA
   * ========================================================
   *
   * Si ya existe una sesión abierta, el marcaje actual
   * corresponde a la salida.
   */
  if (await tieneSesionAbierta(empresaId, idEmpleado)) {
    const abiertas = await query<RowDataPacket[]>(
      `SELECT id
       FROM sesiones_trabajo
       WHERE empresa_id = ?
         AND id_empleado = ?
         AND (
           estado = 'ABIERTA'
           OR estado = 'En curso'
         )
       ORDER BY entrada_at DESC
       LIMIT 1`,
      [empresaId, idEmpleado],
    );

    if (!abiertas[0]) {
      return {
        ok: false,
        code: "SIN_ENTRADA",
        error: `${nombre} no tiene sesión abierta.`,
      };
    }

    await execute(
      `UPDATE sesiones_trabajo
       SET
         salida_at = ?,
         ubicacion_salida_id = ?,
         salida_lat = ?,
         salida_lng = ?,
         salida_distancia_m = ?,
         estado = 'CERRADA'
       WHERE id = ?
         AND empresa_id = ?`,
      [
        timestamp,
        ubicacionId,
        latitud,
        longitud,
        distanciaM,
        Number(abiertas[0].id),
        empresaId,
      ],
    );

    const hora =
      timestamp.split(" ")[1] ?? timestamp;

    return {
      ok: true,
      tipo: "Salida",
      nombre,
      hora,
      ubicacionId: geo.ubicacionId,
      ubicacionNombre: geo.ubicacionNombre,
      metros: geo.metros,
    };
  }

  /*
   * Evita crear otra entrada después de que el empleado
   * ya cerró su jornada del día.
   */
  if (
    await tieneJornadaCompletaHoy(
      empresaId,
      idEmpleado,
      fechaJornada,
    )
  ) {
    return {
      ok: false,
      code: "JORNADA_COMPLETA",
      error: `${nombre} ya cerró jornada hoy.`,
    };
  }

  const viajeLargo =
    esVariable && !!input.viajeLargo;

  /*
   * ========================================================
   * ENTRADA
   * ========================================================
   */
  try {
    await execute(
      `INSERT INTO sesiones_trabajo
        (
          empresa_id,
          id_empleado,
          entrada_at,
          ubicacion_entrada_id,
          entrada_lat,
          entrada_lng,
          entrada_distancia_m,
          fecha_jornada,
          estado,
          viaje_largo
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ABIERTA', ?)`,
      [
        empresaId,
        idEmpleado,
        timestamp,
        ubicacionId,
        latitud,
        longitud,
        distanciaM,
        fechaJornada,
        viajeLargo ? 1 : 0,
      ],
    );
  } catch {
    /*
     * Compatibilidad con instalaciones antiguas donde
     * viaje_largo todavía pudiera no existir.
     *
     * Las columnas de trazabilidad GPS sí forman parte de
     * la migración obligatoria de Fase 1.1.
     */
    await execute(
      `INSERT INTO sesiones_trabajo
        (
          empresa_id,
          id_empleado,
          entrada_at,
          ubicacion_entrada_id,
          entrada_lat,
          entrada_lng,
          entrada_distancia_m,
          fecha_jornada,
          estado
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ABIERTA')`,
      [
        empresaId,
        idEmpleado,
        timestamp,
        ubicacionId,
        latitud,
        longitud,
        distanciaM,
        fechaJornada,
      ],
    );
  }

  const hora =
    timestamp.split(" ")[1] ?? timestamp;

  const [tolerancia, tolSemanal] =
    await Promise.all([
      obtenerMinutosTolerancia(empresaId),
      obtenerToleranciaSemanal(empresaId),
    ]);

  const usados =
    await minutosRetrasoSemanaAntes(
      empresaId,
      idEmpleado,
      fechaJornada,
      horaTeoricaEmp,
    );

  const {
    estado: estadoEntrada,
    minutos,
  } = calcularEstadoAsistenciaSync(
    hora,
    horaTeoricaEmp,
    tolerancia,
    {
      toleranciaSemanal: tolSemanal,
      minutosYaUsadosSemana: usados,
    },
  );

  return {
    ok: true,
    tipo: "Entrada",
    nombre,
    hora,
    estadoEntrada,
    minutosRetraso: minutos,
    viajeLargo,
    ubicacionId: geo.ubicacionId,
    ubicacionNombre: geo.ubicacionNombre,
    metros: geo.metros,
  };
}

export async function registrarMarcajeManual(
  empresaId: number,
  input: {
    empleadoId?: number;
    codigo?: string;
    fechaJornada: string;
    hora: string;
    correccion?: "entrada" | "salida" | null;
    comentarios?: string;
  },
): Promise<{
  ok: boolean;
  mensaje: string;
  id?: number;
  code?: string;
  tipoMarcaje?: string;
  nombre?: string;
  entradaActual?: string;
  salidaActual?: string;
}> {
  const horaNorm = normalizarHora(input.hora);
  if (!horaNorm) {
    return { ok: false, mensaje: "Hora inválida. Use HH:MM o HH:MM:SS." };
  }
  const ts = `${input.fechaJornada} ${horaNorm}`;

  let empRows: RowDataPacket[];
  if (input.empleadoId) {
    empRows = await query<RowDataPacket[]>(
      `SELECT id, nombre, estado FROM empleados
       WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [input.empleadoId, empresaId],
    );
  } else if (input.codigo?.trim()) {
    empRows = await query<RowDataPacket[]>(
      `SELECT id, nombre, estado FROM empleados
       WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
      [empresaId, input.codigo.trim()],
    );
  } else {
    return { ok: false, mensaje: "Indica empleado o código." };
  }

  if (!empRows[0]) {
    return { ok: false, mensaje: "Empleado no encontrado.", code: "NOT_FOUND" };
  }
  const idEmpleado = Number(empRows[0].id);
  const nombre = String(empRows[0].nombre);
  if (String(empRows[0].estado) === "Baja") {
    return {
      ok: false,
      mensaje: `No se puede registrar. ${nombre} está de Baja.`,
      code: "BAJA",
    };
  }

  const existing = await query<RowDataPacket[]>(
    `SELECT id, entrada_at, salida_at, estado FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ? AND fecha_jornada = ?
     ORDER BY id DESC LIMIT 1`,
    [empresaId, idEmpleado, input.fechaJornada],
  );

  if (!existing[0]) {
    const r = await execute(
      `INSERT INTO sesiones_trabajo
        (empresa_id, id_empleado, fecha_jornada, entrada_at, estado, comentarios_rrhh)
       VALUES (?, ?, ?, ?, 'ABIERTA', ?)`,
      [
        empresaId,
        idEmpleado,
        input.fechaJornada,
        ts,
        input.comentarios ?? null,
      ],
    );
    return {
      ok: true,
      mensaje: `Entrada de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
      id: r.insertId,
      tipoMarcaje: "Entrada",
      nombre,
    };
  }

  const estado = String(existing[0].estado || "");
  const abierta = /abierta|en curso/i.test(estado) && !existing[0].salida_at;

  if (abierta && !input.correccion) {
    await execute(
      `UPDATE sesiones_trabajo
       SET salida_at = ?, estado = 'CERRADA',
           comentarios_rrhh = COALESCE(?, comentarios_rrhh)
       WHERE id = ? AND empresa_id = ?`,
      [ts, input.comentarios ?? null, existing[0].id, empresaId],
    );
    return {
      ok: true,
      mensaje: `Salida de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
      id: Number(existing[0].id),
      tipoMarcaje: "Salida",
      nombre,
    };
  }

  if (!input.correccion) {
    return {
      ok: false,
      code: "NEEDS_CORRECTION",
      mensaje: `${nombre} ya tiene registro completo ese día. Indique si corrige Entrada o Salida.`,
      entradaActual: formatearTimestampVisible(fmtTs(existing[0].entrada_at)),
      salidaActual: formatearTimestampVisible(fmtTs(existing[0].salida_at)),
    };
  }

  if (input.correccion === "entrada") {
    await execute(
      `UPDATE sesiones_trabajo
       SET entrada_at = ?,
           comentarios_rrhh = COALESCE(?, comentarios_rrhh)
       WHERE id = ? AND empresa_id = ?`,
      [ts, input.comentarios ?? null, existing[0].id, empresaId],
    );
    return {
      ok: true,
      mensaje: `Entrada corregida de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
      id: Number(existing[0].id),
      tipoMarcaje: "Entrada (corregida)",
      nombre,
    };
  }

  await execute(
    `UPDATE sesiones_trabajo
     SET salida_at = ?, estado = 'CERRADA',
         comentarios_rrhh = COALESCE(?, comentarios_rrhh)
     WHERE id = ? AND empresa_id = ?`,
    [ts, input.comentarios ?? null, existing[0].id, empresaId],
  );
  return {
    ok: true,
    mensaje: `Salida corregida de ${nombre} a las ${horaNorm.slice(0, 5)}.`,
    id: Number(existing[0].id),
    tipoMarcaje: "Salida (corregida)",
    nombre,
  };
}