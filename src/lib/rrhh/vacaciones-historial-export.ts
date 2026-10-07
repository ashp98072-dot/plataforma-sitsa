import {
  MAX_FILAS_ARCHIVO,
  TIPOS_RECONSTRUIBLES,
  detectarColumnas,
  llaveLogica,
  normalizarFilas,
  normalizarTexto,
  parsearDias,
  parsearFecha,
  type FilaCruda,
  type TipoVacacionImport,
} from "./vacaciones-historial-import";

/**
 * RRHH VACACIONES — EXPORTAR EL HISTORIAL ACTUAL en el formato del importador «Importar historial (solo vista previa)» (módulo PURO:
 * sin BD, sin red, sin escrituras).
 *
 * Fuente: tabla `vacaciones` (una fila «espejo» por cada incidencia con saldo: registrarVacacionesFifoEnConexion) + `empleados` +
 * `incidencias` (solo para resolver el TIPO). `vacaciones` NO guarda `incidencia_id`, así que el emparejamiento usa el criterio real
 * del sistema (el mismo de vacaciones-eliminar.ts y del preflight): empresa + empleado + fecha_inicio + fecha_fin + dias_habiles,
 * considerando únicamente incidencias de tipo 'Vacaciones' / 'A cuenta de Vacaciones'.
 *
 * Regla de certeza (NUNCA se inventa): para cada grupo de filas con la misma llave, el tipo solo se resuelve si hay EXACTAMENTE tantas
 * incidencias candidatas como filas en `vacaciones` y todas son del mismo tipo. En cualquier otro caso el grupo NO se exporta como
 * dato reimportable: se informa como ERROR administrativo (sin pareja / tipo ambiguo / cantidad distinta). Una fila sin tipo
 * resuelto jamás se escribe con tipo vacío (el importador lo leería como «Vacaciones» en silencio).
 *
 * No exporta saldos, detalle FIFO ni IDs internos como contenido del archivo.
 *
 * `resumen.completo === true` significa EXACTAMENTE: el archivo reimportable reconstruye todas las vacaciones de la empresa SIN pérdida,
 * incluida la pérdida por deduplicación del importador (llave empleado + inicio + fin + días + tipo). Por eso las filas idénticas
 * (DUPLICADO_IDENTICO) son ERROR y NO se incluyen en el archivo: reimportarlas las consolidaría en una sola. Como red de seguridad,
 * `completo` solo es verdadero si la simulación del propio importador (mismos lector, normalizador y llave lógica) devuelve
 * exactamente las mismas filas, una por vacación, sin descartar ninguna.
 */

export const COLUMNAS_EXPORT = ["codigo", "dpi", "nombre", "fecha_inicio", "fecha_fin", "dias_habiles", "tipo", "observacion"] as const;
export const ESTADO_APROBADO = "aprobado";

export type VacacionActual = { id: number; idEmpleado: number; inicio: string; fin: string; dias: number; observaciones: string | null; estado: string };
export type IncidenciaActual = { id: number; idEmpleado: number; tipo: string; inicio: string; fin: string; dias: number };
export type EmpleadoExport = { id: number; codigo: string; dpi: string | null; nombre: string };

export type FilaExport = {
  codigo: string;
  dpi: string;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  tipo: TipoVacacionImport;
  observacion: string;
};

export type CodigoProblemaExport =
  | "VACACION_SIN_INCIDENCIA"
  | "TIPO_AMBIGUO"
  | "INCIDENCIAS_CANTIDAD_DISTINTA"
  | "INCIDENCIA_SIN_VACACION"
  | "ESTADO_NO_APROBADO"
  | "EMPLEADO_NO_ENCONTRADO"
  | "FECHA_INVALIDA"
  | "DUPLICADO_IDENTICO"
  | "EMPLEADO_NO_IDENTIFICABLE"
  | "REIMPORTACION_NO_LOSSLESS";

export type ProblemaExport = {
  severidad: "ERROR" | "ADVERTENCIA";
  codigo: CodigoProblemaExport;
  mensaje: string;
  empleadoId?: number;
  empleado?: string;
  /** Referencias para que RRHH/TI localicen el registro (no forman parte del archivo exportado). */
  vacacionIds?: number[];
  incidenciaIds?: number[];
};

export type ResultadoExport = {
  filas: FilaExport[];
  problemas: ProblemaExport[];
  resumen: {
    vacacionesLeidas: number;
    incidenciasVacaciones: number;
    filasExportadas: number;
    filasNoExportadas: number;
    /** Filas distintas que el importador conservaría al reimportar el archivo (debe ser = filasExportadas). */
    filasReimportables: number;
    problemasError: number;
    problemasAdvertencia: number;
    /**
     * true SOLO si el archivo reimportable reconstruye exactamente todas las vacaciones de la empresa sin pérdida (tipo resuelto, sin
     * duplicados que el importador consolidaría, sin incidencias sin pareja, reimportación 1:1). Si es false NO se puede limpiar el módulo.
     */
    completo: boolean;
  };
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const clave = (idEmpleado: number, inicio: string, fin: string, dias: number) => `${idEmpleado}|${inicio}|${fin}|${r2(dias).toFixed(2)}`;
const TIPOS = new Set<string>(TIPOS_RECONSTRUIBLES);
/** Una fecha/días son exportables solo si el propio importador los leería de vuelta idénticos. */
const fechaOk = (s: string) => parsearFecha(s) === s;
const diasOk = (n: number) => parsearDias(n) === r2(n);

export function armarHistorialExportable(
  vacaciones: readonly VacacionActual[],
  incidencias: readonly IncidenciaActual[],
  empleados: readonly EmpleadoExport[],
): ResultadoExport {
  const problemas: ProblemaExport[] = [];
  const porEmpleado = new Map(empleados.map((e) => [e.id, e]));
  // El importador identifica al empleado por código (normalizado): debe ser único en la empresa o se perdería/confundiría al reimportar
  const usoCodigo = new Map<string, number>();
  for (const e of empleados) usoCodigo.set(normalizarTexto(e.codigo), (usoCodigo.get(normalizarTexto(e.codigo)) ?? 0) + 1);
  const candidatas = incidencias.filter((i) => TIPOS.has(i.tipo));

  // Incidencias candidatas por llave
  const incPorLlave = new Map<string, IncidenciaActual[]>();
  for (const i of candidatas) incPorLlave.set(clave(i.idEmpleado, i.inicio, i.fin, i.dias), [...(incPorLlave.get(clave(i.idEmpleado, i.inicio, i.fin, i.dias)) ?? []), i]);

  // Vacaciones por llave (solo las exportables a priori: aprobadas, con empleado y fechas válidas)
  const vacPorLlave = new Map<string, VacacionActual[]>();
  // Llaves de vacaciones ya rechazadas por otro motivo: sus incidencias NO se vuelven a reportar como «sin vacación»
  const llavesRechazadas = new Set<string>();
  for (const v of vacaciones) {
    const emp = porEmpleado.get(v.idEmpleado);
    llavesRechazadas.add(clave(v.idEmpleado, v.inicio, v.fin, v.dias));
    if (!emp) {
      problemas.push({ severidad: "ERROR", codigo: "EMPLEADO_NO_ENCONTRADO", empleadoId: v.idEmpleado, vacacionIds: [v.id], mensaje: `La vacación ${v.id} pertenece a un empleado (#${v.idEmpleado}) que no existe en esta empresa: no se exporta.` });
      continue;
    }
    if (!normalizarTexto(emp.codigo) || usoCodigo.get(normalizarTexto(emp.codigo)) !== 1) {
      problemas.push({ severidad: "ERROR", codigo: "EMPLEADO_NO_IDENTIFICABLE", empleadoId: emp.id, empleado: emp.nombre, vacacionIds: [v.id], mensaje: `La vacación ${v.id} de ${emp.nombre}: el código «${emp.codigo}» está vacío o lo comparte otro empleado, así que el importador no podría identificarlo con certeza: no se exporta.` });
      continue;
    }
    if (!fechaOk(v.inicio) || !fechaOk(v.fin) || v.fin < v.inicio || !diasOk(v.dias)) {
      problemas.push({ severidad: "ERROR", codigo: "FECHA_INVALIDA", empleadoId: emp.id, empleado: emp.nombre, vacacionIds: [v.id], mensaje: `La vacación ${v.id} de ${emp.nombre} tiene fechas o días inválidos (${v.inicio} → ${v.fin}, ${v.dias}): no se exporta.` });
      continue;
    }
    if (String(v.estado ?? "").trim().toLowerCase() !== ESTADO_APROBADO) {
      problemas.push({ severidad: "ERROR", codigo: "ESTADO_NO_APROBADO", empleadoId: emp.id, empleado: emp.nombre, vacacionIds: [v.id], mensaje: `La vacación ${v.id} de ${emp.nombre} (${v.inicio} → ${v.fin}) tiene estado «${v.estado}», no «Aprobado»: no se exporta ni se asume.` });
      continue;
    }
    const k = clave(v.idEmpleado, v.inicio, v.fin, v.dias);
    llavesRechazadas.delete(k);
    vacPorLlave.set(k, [...(vacPorLlave.get(k) ?? []), v]);
  }

  const filas: FilaExport[] = [];
  const ordenGrupos = [...vacPorLlave.entries()];
  for (const [k, grupo] of ordenGrupos) {
    const emp = porEmpleado.get(grupo[0].idEmpleado)!;
    const incs = incPorLlave.get(k) ?? [];
    const base = { empleadoId: emp.id, empleado: emp.nombre, vacacionIds: grupo.map((g) => g.id), incidenciaIds: incs.map((i) => i.id) };
    const cuando = `${grupo[0].inicio} → ${grupo[0].fin}, ${r2(grupo[0].dias)} día(s)`;
    const tipos = new Set(incs.map((i) => i.tipo));
    if (incs.length === 0) {
      problemas.push({ ...base, severidad: "ERROR", codigo: "VACACION_SIN_INCIDENCIA", mensaje: `${emp.nombre}: ${grupo.length} vacación(es) (${cuando}) sin incidencia equivalente de Vacaciones / A cuenta de Vacaciones. No se puede resolver el tipo: no se exporta.` });
      continue;
    }
    if (tipos.size > 1) {
      problemas.push({ ...base, severidad: "ERROR", codigo: "TIPO_AMBIGUO", mensaje: `${emp.nombre}: ${grupo.length} vacación(es) (${cuando}) con incidencias candidatas de AMBOS tipos (Vacaciones y A cuenta de Vacaciones). El tipo es ambiguo: no se exporta.` });
      continue;
    }
    if (incs.length !== grupo.length) {
      problemas.push({ ...base, severidad: "ERROR", codigo: "INCIDENCIAS_CANTIDAD_DISTINTA", mensaje: `${emp.nombre}: ${grupo.length} vacación(es) pero ${incs.length} incidencia(s) candidata(s) (${cuando}). No se puede emparejar con certeza: no se exporta.` });
      continue;
    }
    const tipo = incs[0].tipo as TipoVacacionImport;
    if (grupo.length > 1) {
      // El importador consolidaría estas filas (misma llave empleado + fechas + días + tipo): reimportar daría 1 sola. El archivo no sería
      // una fuente sin pérdida, así que el grupo NO se incluye hasta que RRHH/TI decida si son tomas reales distintas o un duplicado de datos.
      problemas.push({
        ...base, severidad: "ERROR", codigo: "DUPLICADO_IDENTICO",
        mensaje: `Existen ${grupo.length} vacaciones idénticas. El importador las consolidaría como duplicado, por lo que no es posible reconstruirlas con certeza. Debe resolverse antes del reset. Detalle: ${emp.nombre}, ${cuando}, ${tipo} (vacaciones ${grupo.map((g) => g.id).join(", ")}); no se incluyen en el archivo reimportable.`,
      });
      continue;
    }
    const v = grupo[0];
    filas.push({
      codigo: emp.codigo, dpi: emp.dpi ?? "", nombre: emp.nombre, fecha_inicio: v.inicio, fecha_fin: v.fin, dias_habiles: r2(v.dias), tipo,
      observacion: (v.observaciones ?? "").trim(),
    });
  }

  // Incidencias de vacaciones sin ninguna fila en `vacaciones` (la fuente del archivo): NO se pueden exportar, se reportan
  for (const [k, incs] of incPorLlave) {
    if (vacPorLlave.has(k) || llavesRechazadas.has(k)) continue;
    const emp = porEmpleado.get(incs[0].idEmpleado);
    problemas.push({
      severidad: "ERROR", codigo: "INCIDENCIA_SIN_VACACION", empleadoId: incs[0].idEmpleado, empleado: emp?.nombre, incidenciaIds: incs.map((i) => i.id),
      mensaje: `${emp?.nombre ?? `Empleado #${incs[0].idEmpleado}`}: ${incs.length} incidencia(s) de ${incs[0].tipo} (${incs[0].inicio} → ${incs[0].fin}, ${r2(incs[0].dias)} día(s)) sin fila en vacaciones. No salen en el archivo: quedarían fuera del historial si se limpiara el módulo.`,
    });
  }

  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.fecha_inicio.localeCompare(b.fecha_inicio) || a.fecha_fin.localeCompare(b.fecha_fin) || a.dias_habiles - b.dias_habiles);
  // Red de seguridad: lo que el IMPORTADOR conservaría al reimportar este archivo debe ser EXACTAMENTE una fila por cada fila exportada
  const reimportables = simularReimportacion(filas);
  if (reimportables.filasUnicas !== filas.length || reimportables.invalidas > 0 || filas.length > MAX_FILAS_ARCHIVO) {
    problemas.push({
      severidad: "ERROR", codigo: "REIMPORTACION_NO_LOSSLESS",
      mensaje: `El archivo no es reimportable sin pérdida: ${filas.length} fila(s) exportadas pero el importador conservaría ${reimportables.filasUnicas} (${reimportables.invalidas} inválida(s); máximo ${MAX_FILAS_ARCHIVO} filas). Debe resolverse antes del reset.`,
    });
  }
  const errores = problemas.filter((p) => p.severidad === "ERROR").length;
  return {
    filas,
    problemas,
    resumen: {
      vacacionesLeidas: vacaciones.length,
      incidenciasVacaciones: candidatas.length,
      filasExportadas: filas.length,
      filasNoExportadas: vacaciones.length - filas.length,
      filasReimportables: reimportables.filasUnicas,
      problemasError: errores,
      problemasAdvertencia: problemas.length - errores,
      completo: errores === 0 && filas.length === vacaciones.length && reimportables.filasUnicas === vacaciones.length,
    },
  };
}

/** Simula la reimportación con el MISMO lector, normalizador y llave lógica del importador (#418): cuántas filas distintas se conservarían. */
export function simularReimportacion(filas: readonly FilaExport[]): { filasLeidas: number; filasUnicas: number; invalidas: number } {
  const archivo = filasComoArchivo(filas);
  const { validas, invalidas } = normalizarFilas(archivo.filas, detectarColumnas(archivo.encabezados));
  const vistos = new Set<string>();
  for (const f of validas) vistos.add(llaveLogica(normalizarTexto(f.codigo), f));
  return { filasLeidas: filas.length, filasUnicas: vistos.size, invalidas: invalidas.length };
}

/** Las mismas filas, tal como las entregaría el lector de CSV/XLSX del importador (para la vista previa del historial actual). */
export function filasComoArchivo(filas: readonly FilaExport[]): { encabezados: string[]; filas: FilaCruda[] } {
  return {
    encabezados: [...COLUMNAS_EXPORT],
    filas: filas.map((f, i) => ({
      fila: i + 2,
      valores: {
        codigo: f.codigo, dpi: f.dpi, nombre: f.nombre, fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_fin,
        dias_habiles: String(f.dias_habiles), tipo: f.tipo, observacion: f.observacion,
      },
    })),
  };
}

/** Evita que una celda de texto empiece como fórmula al abrir el CSV en Excel; el importador recorta espacios, así que se reimporta igual. */
const neutralizar = (s: string) => (/^[=+\-@\t\r]/.test(s) ? ` ${s}` : s);
const celdaCsv = (s: string) => (/[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV UTF-8 (con BOM para Excel), separador coma, fin de línea CRLF. Fechas ISO exactas y días como número. */
export function construirCsvHistorial(filas: readonly FilaExport[]): string {
  const lineas = [COLUMNAS_EXPORT.join(",")];
  for (const f of filas) {
    lineas.push([
      neutralizar(f.codigo), f.dpi, neutralizar(f.nombre), f.fecha_inicio, f.fecha_fin, String(f.dias_habiles), f.tipo, neutralizar(f.observacion),
    ].map(celdaCsv).join(","));
  }
  return `﻿${lineas.join("\r\n")}\r\n`;
}
