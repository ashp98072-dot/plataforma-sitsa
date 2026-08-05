import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { obtenerMinutosTolerancia } from "./config";
import { obtenerFeriadosEnRango } from "./vacaciones";

function formatearFechaVisible(fechaIso: string): string {
  const [y, m, d] = fechaIso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : fechaIso;
}

function toIso(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function fmtTs(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    const ss = String(value.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
  return String(value).replace("T", " ").slice(0, 19);
}

function parseHora(hora: string | null | undefined): { h: number; m: number; s: number } | null {
  if (!hora) return null;
  const parte = (hora.includes(" ") ? hora.split(" ").pop() : hora)?.trim() ?? "";
  const match = parte.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return { h: Number(match[1]), m: Number(match[2]), s: Number(match[3] ?? "0") };
}

function horaToStr(hora: { h: number; m: number; s: number } | null): string | null {
  if (!hora) return null;
  return `${String(hora.h).padStart(2, "0")}:${String(hora.m).padStart(2, "0")}:${String(hora.s).padStart(2, "0")}`;
}

function fmtDm(fechaStr: string): string {
  const p = fechaStr.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : fechaStr;
}

export async function generarDiasLaborables(
  empresaId: number,
  fInicio: string,
  fFin: string,
): Promise<string[]> {
  const inicio = new Date(fInicio + "T00:00:00");
  const fin = new Date(fFin + "T00:00:00");
  if (inicio > fin) return [];
  const feriados = await obtenerFeriadosEnRango(empresaId, fInicio, fFin);
  const dias: string[] = [];
  const dia = new Date(inicio);
  while (dia <= fin) {
    const y = dia.getFullYear();
    const m = String(dia.getMonth() + 1).padStart(2, "0");
    const d = String(dia.getDate()).padStart(2, "0");
    const fechaStr = `${y}-${m}-${d}`;
    const weekdayPy = (dia.getDay() + 6) % 7;
    if (weekdayPy !== 6 && !feriados.has(fechaStr)) {
      dias.push(fechaStr);
    }
    dia.setDate(dia.getDate() + 1);
  }
  return dias;
}

export function detectarEstadoEntrada(
  entradaAt: string | null,
  horaEntradaTeorica: string,
  tolerancia: number,
): string {
  if (!entradaAt) return "Falta";
  const horaEntrada = parseHora(entradaAt);
  const horaTeorica = parseHora(horaEntradaTeorica);
  if (!horaEntrada) return "Falta";
  if (horaTeorica) {
    const entMin = horaEntrada.h * 60 + horaEntrada.m;
    const teoMin = horaTeorica.h * 60 + horaTeorica.m;
    if (entMin > teoMin + tolerancia) return "Retraso";
  }
  return "A tiempo";
}

export function detectarEstadoSalida(
  salidaAt: string | null,
  horaSalidaTeorica: string,
): string {
  if (!salidaAt) return "Pendiente";
  const horaSalida = parseHora(salidaAt);
  const horaTeorica = parseHora(horaSalidaTeorica);
  if (!horaSalida) return "Pendiente";
  if (
    horaTeorica &&
    (horaSalida.h * 60 + horaSalida.m < horaTeorica.h * 60 + horaTeorica.m)
  ) {
    return "Salida Temprana";
  }
  return "Completa";
}

async function mapaIncidenciasPorEmpleadoFecha(
  empresaId: number,
  fechaInicio: string,
  fechaFin: string,
): Promise<Map<string, { tipo: string; incidenciaId: number }>> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, id_empleado, tipo, fecha_inicio, fecha_fin
     FROM incidencias
     WHERE empresa_id = ? AND fecha_fin >= ? AND fecha_inicio <= ?`,
    [empresaId, fechaInicio, fechaFin],
  );
  const map = new Map<string, { tipo: string; incidenciaId: number }>();
  for (const r of rows) {
    const idEmp = Number(r.id_empleado);
    const tipo = String(r.tipo);
    const incidenciaId = Number(r.id);
    const fin = toIso(r.fecha_fin as string | Date);
    const cur = new Date(toIso(r.fecha_inicio as string | Date) + "T00:00:00");
    const end = new Date(fin + "T00:00:00");
    while (cur <= end) {
      const key = `${idEmp}|${toIso(cur)}`;
      if (!map.has(key)) map.set(key, { tipo, incidenciaId });
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

async function setEnRuta(
  empresaId: number,
  fechaInicio: string,
  fechaFin: string,
): Promise<Set<string>> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id_empleado, fecha_inicio, fecha_fin FROM marcajes_en_ruta
     WHERE empresa_id = ? AND fecha_fin >= ? AND fecha_inicio <= ?`,
    [empresaId, fechaInicio, fechaFin],
  );
  const set = new Set<string>();
  for (const r of rows) {
    const idEmp = Number(r.id_empleado);
    const cur = new Date(toIso(r.fecha_inicio as string | Date) + "T00:00:00");
    const end = new Date(toIso(r.fecha_fin as string | Date) + "T00:00:00");
    while (cur <= end) {
      set.add(`${idEmp}|${toIso(cur)}`);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return set;
}

export type FilaReporteAsistencia = {
  idSesion: number;
  fecha: string;
  fechaUi: string;
  codigo: string;
  nombre: string;
  horaEntrada: string | null;
  horaSalida: string | null;
  estadoEntrada: string;
  estadoSalida: string;
  comentarios: string;
  motivo: string;
  tipoHorario: string;
};

export async function obtenerReporteAsistencias(
  empresaId: number,
  fechaInicio: string,
  fechaFin: string,
  filtros?: { tipo?: string; horario?: string },
): Promise<FilaReporteAsistencia[]> {
  const tolerancia = await obtenerMinutosTolerancia(empresaId);

  const sesiones = await query<RowDataPacket[]>(
    `SELECT s.id, s.id_empleado, s.fecha_jornada, e.codigo, e.nombre,
            s.entrada_at, s.salida_at,
            e.hora_entrada_teorica, e.hora_salida_teorica,
            s.comentarios_rrhh, e.tipo_horario
     FROM sesiones_trabajo s
     JOIN empleados e ON s.id_empleado = e.id AND e.empresa_id = ?
     WHERE s.empresa_id = ? AND s.fecha_jornada BETWEEN ? AND ?
       AND e.estado = 'Activo'
     ORDER BY s.fecha_jornada DESC, e.nombre ASC`,
    [empresaId, empresaId, fechaInicio, fechaFin],
  );

  const empleados = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, fecha_alta,
            hora_entrada_teorica, hora_salida_teorica, tipo_horario
     FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre ASC`,
    [empresaId],
  );

  const sesionesPorDia = new Map<string, RowDataPacket>();
  for (const fila of sesiones) {
    const key = `${Number(fila.id_empleado)}|${toIso(fila.fecha_jornada as string | Date)}`;
    sesionesPorDia.set(key, fila);
  }

  const diasCubiertosViaje = new Map<string, string>();
  for (const fila of sesiones) {
    const idEmp = Number(fila.id_empleado);
    const fechaJornada = toIso(fila.fecha_jornada as string | Date);
    const salidaAt = fmtTs(fila.salida_at as string | Date | null);
    if (!salidaAt) continue;
    const fechaFinReal = salidaAt.split(" ")[0];
    if (fechaFinReal === fechaJornada) continue;
    const rangoTxt = `Inició ${fmtDm(fechaJornada)} — Terminó ${fmtDm(fechaFinReal)}`;
    const cur = new Date(fechaJornada + "T00:00:00");
    cur.setDate(cur.getDate() + 1);
    const finDt = new Date(fechaFinReal + "T00:00:00");
    while (cur <= finDt) {
      diasCubiertosViaje.set(`${idEmp}|${toIso(cur)}`, rangoTxt);
      cur.setDate(cur.getDate() + 1);
    }
  }

  const [diasLaborables, incidencias, enRuta] = await Promise.all([
    generarDiasLaborables(empresaId, fechaInicio, fechaFin),
    mapaIncidenciasPorEmpleadoFecha(empresaId, fechaInicio, fechaFin),
    setEnRuta(empresaId, fechaInicio, fechaFin),
  ]);

  const resultado: FilaReporteAsistencia[] = [];

  for (const emp of empleados) {
    const idEmp = Number(emp.id);
    const codigo = String(emp.codigo);
    const nombre = String(emp.nombre);
    const fechaAlta = toIso(emp.fecha_alta as string | Date);
    const hEnt = String(emp.hora_entrada_teorica || "08:00:00");
    const hSal = String(emp.hora_salida_teorica || "17:00:00");
    const tipoHorario = String(emp.tipo_horario || "Fijo");

    for (const fecha of diasLaborables) {
      if (fecha < fechaAlta) continue;
      const clave = `${idEmp}|${fecha}`;

      if (sesionesPorDia.has(clave)) {
        const s = sesionesPorDia.get(clave)!;
        const entradaAt = fmtTs(s.entrada_at as string | Date | null);
        const salidaAt = fmtTs(s.salida_at as string | Date | null);
        const fechaJornada = toIso(s.fecha_jornada as string | Date);
        const esMultidia =
          !!salidaAt && salidaAt.split(" ")[0] !== fechaJornada;
        resultado.push({
          idSesion: Number(s.id),
          fecha,
          fechaUi: formatearFechaVisible(fecha),
          codigo,
          nombre,
          horaEntrada: horaToStr(parseHora(entradaAt)),
          horaSalida: horaToStr(parseHora(salidaAt)),
          estadoEntrada: detectarEstadoEntrada(entradaAt, hEnt, tolerancia),
          estadoSalida: detectarEstadoSalida(salidaAt, hSal),
          comentarios: String(s.comentarios_rrhh || ""),
          motivo: esMultidia
            ? `Inició ${fmtDm(fechaJornada)} — Terminó ${fmtDm(salidaAt!.split(" ")[0])}`
            : "Trabajando",
          tipoHorario,
        });
      } else if (diasCubiertosViaje.has(clave)) {
        resultado.push({
          idSesion: 0,
          fecha,
          fechaUi: formatearFechaVisible(fecha),
          codigo,
          nombre,
          horaEntrada: null,
          horaSalida: null,
          estadoEntrada: "En viaje",
          estadoSalida: "—",
          comentarios: "",
          motivo: diasCubiertosViaje.get(clave)!,
          tipoHorario,
        });
      } else if (enRuta.has(clave)) {
        resultado.push({
          idSesion: 0,
          fecha,
          fechaUi: formatearFechaVisible(fecha),
          codigo,
          nombre,
          horaEntrada: null,
          horaSalida: null,
          estadoEntrada: "En Ruta",
          estadoSalida: "—",
          comentarios: "",
          motivo: "En Ruta",
          tipoHorario,
        });
      } else {
        const tipoInc = incidencias.get(clave);
        if (tipoInc) {
          resultado.push({
            idSesion: 0,
            fecha,
            fechaUi: formatearFechaVisible(fecha),
            codigo,
            nombre,
            horaEntrada: null,
            horaSalida: null,
            estadoEntrada: tipoInc.tipo,
            estadoSalida: "—",
            comentarios: "",
            motivo: tipoInc.tipo,
            tipoHorario,
          });
        } else {
          resultado.push({
            idSesion: 0,
            fecha,
            fechaUi: formatearFechaVisible(fecha),
            codigo,
            nombre,
            horaEntrada: null,
            horaSalida: null,
            estadoEntrada: "Falta",
            estadoSalida: "—",
            comentarios: "",
            motivo: "Falta",
            tipoHorario,
          });
        }
      }
    }
  }

  resultado.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  let filtrado = resultado;
  if (filtros?.tipo && filtros.tipo !== "Todos") {
    filtrado = filtrado.filter(
      (r) =>
        r.estadoEntrada === filtros.tipo ||
        r.motivo === filtros.tipo ||
        r.estadoEntrada.includes(filtros.tipo!),
    );
  }
  if (filtros?.horario && filtros.horario !== "Todos") {
    const h = filtros.horario;
    filtrado = filtrado.filter((r) =>
      h === "Variable"
        ? r.tipoHorario.includes("Variable")
        : !r.tipoHorario.includes("Variable"),
    );
  }

  return filtrado;
}

export type ResumenIncidencia = {
  idEmpleado: number;
  codigo: string;
  empleado: string;
  totalRetrasos: number;
  totalSalidasTempranas: number;
  totalFaltas: number;
  totalDiasAsistidos: number;
  detalle: {
    fecha: string;
    fechaUi: string;
    tipo: string;
    incidenciaId: number | null;
  }[];
};

export async function obtenerResumenIncidenciasDetallado(
  empresaId: number,
  fechaInicio: string,
  fechaFin: string,
): Promise<ResumenIncidencia[]> {
  const tolerancia = await obtenerMinutosTolerancia(empresaId);
  const empleados = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, fecha_alta,
            hora_entrada_teorica, hora_salida_teorica
     FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre ASC`,
    [empresaId],
  );
  const sesiones = await query<RowDataPacket[]>(
    `SELECT id_empleado, fecha_jornada, entrada_at, salida_at
     FROM sesiones_trabajo
     WHERE empresa_id = ? AND fecha_jornada BETWEEN ? AND ?`,
    [empresaId, fechaInicio, fechaFin],
  );
  const sesionesPorDia = new Map<string, RowDataPacket>();
  for (const row of sesiones) {
    sesionesPorDia.set(
      `${Number(row.id_empleado)}|${toIso(row.fecha_jornada as string | Date)}`,
      row,
    );
  }

  const [diasLaborables, incidencias] = await Promise.all([
    generarDiasLaborables(empresaId, fechaInicio, fechaFin),
    mapaIncidenciasPorEmpleadoFecha(empresaId, fechaInicio, fechaFin),
  ]);

  const resumen: ResumenIncidencia[] = [];

  for (const emp of empleados) {
    const idEmp = Number(emp.id);
    const fechaAlta = toIso(emp.fecha_alta as string | Date);
    const hEnt = String(emp.hora_entrada_teorica || "08:00:00");
    const hSal = String(emp.hora_salida_teorica || "17:00:00");

    let retrasos = 0;
    let salidasTempranas = 0;
    let faltas = 0;
    let diasAsistidos = 0;
    const detalle: ResumenIncidencia["detalle"] = [];

    for (const fecha of diasLaborables) {
      if (fecha < fechaAlta) continue;
      const clave = `${idEmp}|${fecha}`;

      if (sesionesPorDia.has(clave)) {
        const s = sesionesPorDia.get(clave)!;
        const entradaAt = fmtTs(s.entrada_at as string | Date | null);
        const salidaAt = fmtTs(s.salida_at as string | Date | null);
        const estEntrada = detectarEstadoEntrada(entradaAt, hEnt, tolerancia);
        const estSalida = detectarEstadoSalida(salidaAt, hSal);

        if (estEntrada === "Retraso") retrasos += 1;
        if (estEntrada !== "Falta") diasAsistidos += 1;
        if (estSalida === "Salida Temprana") salidasTempranas += 1;

        const tipos: string[] = [];
        if (estEntrada === "Retraso") tipos.push("Retraso");
        if (estSalida === "Salida Temprana") tipos.push("Salida Temprana");
        if (tipos.length) {
          detalle.push({
            fecha,
            fechaUi: formatearFechaVisible(fecha),
            tipo: tipos.join(" + "),
            incidenciaId: incidencias.get(clave)?.incidenciaId ?? null,
          });
        }
      } else if (!incidencias.has(clave)) {
        faltas += 1;
        detalle.push({
          fecha,
          fechaUi: formatearFechaVisible(fecha),
          tipo: "Falta",
          incidenciaId: null,
        });
      } else {
        const inc = incidencias.get(clave)!;
        detalle.push({
          fecha,
          fechaUi: formatearFechaVisible(fecha),
          tipo: inc.tipo || "Incidencia",
          incidenciaId: inc.incidenciaId,
        });
      }
    }

    resumen.push({
      idEmpleado: idEmp,
      codigo: String(emp.codigo),
      empleado: String(emp.nombre),
      totalRetrasos: retrasos,
      totalSalidasTempranas: salidasTempranas,
      totalFaltas: faltas,
      totalDiasAsistidos: diasAsistidos,
      detalle,
    });
  }

  return resumen;
}

export async function registrarIncidenciaFalta(
  empresaId: number,
  codigo: string,
  fecha: string,
  tipo: string,
): Promise<{ ok: boolean; mensaje: string }> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id, nombre FROM empleados WHERE empresa_id = ? AND codigo = ? LIMIT 1",
    [empresaId, codigo.trim()],
  );
  if (!rows[0]) {
    return { ok: false, mensaje: `No se encontró el empleado con código '${codigo}'.` };
  }
  const idEmpleado = Number(rows[0].id);
  const nombre = String(rows[0].nombre);

  const existentes = await query<RowDataPacket[]>(
    `SELECT id FROM incidencias
     WHERE empresa_id = ? AND id_empleado = ? AND ? BETWEEN fecha_inicio AND fecha_fin
     LIMIT 1`,
    [empresaId, idEmpleado, fecha],
  );

  if (existentes[0]) {
    await execute(
      "UPDATE incidencias SET tipo = ? WHERE id = ? AND empresa_id = ?",
      [tipo, Number(existentes[0].id), empresaId],
    );
  } else {
    try {
      await execute(
        `INSERT INTO incidencias
          (empresa_id, id_empleado, tipo, subtipo, fecha_inicio, fecha_fin, dias_habiles)
         VALUES (?, ?, ?, NULL, ?, ?, 1)`,
        [empresaId, idEmpleado, tipo, fecha, fecha],
      );
    } catch {
      await execute(
        `INSERT INTO incidencias
          (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [empresaId, idEmpleado, tipo, fecha, fecha],
      );
    }
  }

  return {
    ok: true,
    mensaje: `La falta de ${nombre} el ${formatearFechaVisible(fecha)} se justificó como '${tipo}'.`,
  };
}

export async function guardarComentarioSesion(
  empresaId: number,
  idSesion: number,
  comentario: string,
): Promise<boolean> {
  const result = await execute(
    "UPDATE sesiones_trabajo SET comentarios_rrhh = ? WHERE id = ? AND empresa_id = ?",
    [comentario, idSesion, empresaId],
  );
  return result.affectedRows > 0;
}
