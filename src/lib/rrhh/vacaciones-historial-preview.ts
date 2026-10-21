import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { toIsoDate } from "./dates";
import {
  detectarColumnas,
  llaveLogica,
  normalizarFilas,
  normalizarTexto,
  type ColumnasDetectadas,
  type FilaCruda,
  type FilaNormalizada,
  type ProblemaFila,
} from "./vacaciones-historial-import";
import {
  contarDiasHabilesPuro,
  reconstruirEmpleado,
  type AdvertenciaReconstruccion,
  type EmpleadoReconstruccion,
  type ResultadoReconstruccion,
} from "./vacaciones-reconstruccion";
import { obtenerFeriadosEnRango } from "./vacaciones";
import { obtenerPoliticaVacaciones } from "./vacaciones-modo-db";

/**
 * VISTA PREVIA / SIMULACIÓN de la reconstrucción completa de vacaciones desde el historial oficial de RRHH.
 *
 * SOLO LECTURA: este módulo únicamente ejecuta SELECT (vía `query`); no importa getPool/execute, no abre transacciones y no escribe
 * en ninguna tabla. Aplicar la reconstrucción en producción es un paso posterior, controlado y fuera de este módulo
 * (ver sql/reconstruccion-vacaciones-propuesta.sql, todo comentado).
 */

export type SeveridadPreview = "BLOQUEANTE" | "ERROR" | "DECISION" | "ADVERTENCIA" | "INFO";
export type ProblemaPreview = {
  severidad: SeveridadPreview;
  codigo: string;
  mensaje: string;
  fila?: number;
  empleadoId?: number;
  empleado?: string;
};

export type ResumenEmpleadoPreview = {
  empleadoId: number;
  codigo: string;
  nombre: string;
  fechaAlta: string | null;
  fechaInicioLaboral: string | null;
  vacaciones: number;
  diasTotales: number;
  periodos: number;
  periodosVigentes: number;
  periodosVencidos: number;
  saldoFinal: number;
  /** Desglose: otorgado = consumido + recortado por tope + perdido por vencimiento + saldo utilizable. */
  resumenDias: ResultadoReconstruccion["resumenDias"];
  deficit: number;
  bloqueado: ResultadoReconstruccion["bloqueado"];
  advertencias: AdvertenciaReconstruccion[];
  /** Vacaciones que hoy existen en el sistema para este empleado y NO están en el archivo (se reemplazarían). */
  existentesNoEnArchivo: number;
};

export type ResultadoPreview = {
  modo: "PREVIEW";
  /** Siempre false: la vista previa nunca escribe. */
  escribio: false;
  columnas: ColumnasDetectadas;
  resumen: {
    filasLeidas: number;
    filasValidas: number;
    filasInvalidas: number;
    duplicadosEnArchivo: number;
    empleadosEncontrados: number;
    empleadosNoEncontrados: number;
    vacacionesSuperpuestas: number;
    diasCalculadosDistintos: number;
    anterioresAFechaBase: number;
    cruzanAniversario: number;
    futuras: number;
    empleadosBloqueados: number;
    requierenDecision: number;
    totalDiasArchivo: number;
  };
  existentes: { vacaciones: number; equivalentesEnArchivo: number; noEnArchivo: number };
  noEncontrados: { identificador: string; filas: number[] }[];
  empleados: ResumenEmpleadoPreview[];
  problemas: ProblemaPreview[];
  /** true si no hay problemas BLOQUEANTE ni ERROR (las DECISION/ADVERTENCIA no impiden, pero RRHH debe revisarlas antes de aplicar). */
  puedeAplicarse: boolean;
};

type EmpleadoDb = EmpleadoReconstruccion & { dpi: string | null; estado: string };

const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D+/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;

async function cargarEmpleados(empresaId: number): Promise<EmpleadoDb[]> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre, estado, fecha_alta, fecha_inicio_laboral FROM empleados WHERE empresa_id = ?",
    [empresaId],
  );
  let dpis = new Map<number, string>();
  try {
    const d = await query<RowDataPacket[]>("SELECT id, dpi FROM empleados WHERE empresa_id = ?", [empresaId]);
    dpis = new Map(d.filter((r) => r.dpi).map((r) => [Number(r.id), String(r.dpi)]));
  } catch {
    /* la columna dpi aún no existe en esta base: se identifica por código o nombre */
  }
  return rows.map((r) => ({
    id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre), estado: String(r.estado ?? ""),
    fechaAlta: toIsoDate(r.fecha_alta as string | Date | null), fechaInicioLaboral: toIsoDate(r.fecha_inicio_laboral as string | Date | null),
    dpi: dpis.get(Number(r.id)) ?? null,
  }));
}

export async function previsualizarHistorial(
  empresaId: number,
  archivo: { encabezados: readonly string[]; filas: readonly FilaCruda[] },
  hoy: Date = new Date(),
): Promise<ResultadoPreview> {
  const columnas = detectarColumnas(archivo.encabezados);
  const { validas, invalidas } = normalizarFilas(archivo.filas, columnas);
  const problemas: ProblemaPreview[] = invalidas.map((p: ProblemaFila) => ({
    severidad: p.codigo === "COLUMNAS_FALTANTES" || p.codigo === "EXCESO_DE_FILAS" ? "BLOQUEANTE" : "ERROR", codigo: p.codigo, mensaje: p.mensaje, fila: p.fila,
  }));

  const empleados = await cargarEmpleados(empresaId);
  const indexar = (clave: (e: EmpleadoDb) => string) => {
    const m = new Map<string, EmpleadoDb[]>();
    for (const e of empleados) { const k = clave(e); if (k) m.set(k, [...(m.get(k) ?? []), e]); }
    return m;
  };
  const porCodigo = indexar((e) => normalizarTexto(e.codigo));
  const porDpi = indexar((e) => soloDigitos(e.dpi));
  const porNombre = indexar((e) => normalizarTexto(e.nombre));

  // Estrategia: código exacto > DPI exacto > nombre SOLO si la fila no trae código ni DPI y el nombre es único. Nunca se elige entre
  // coincidencias múltiples (ambiguo) ni entre un código y un DPI que apuntan a empleados distintos (conflicto).
  const resolver = (f: FilaNormalizada): { emp: EmpleadoDb | null; etiqueta: string; ambiguo?: boolean; conflicto?: boolean } => {
    const porId = f.codigo ? porCodigo.get(normalizarTexto(f.codigo)) ?? [] : null;
    const porDocumento = f.dpi && soloDigitos(f.dpi) ? porDpi.get(soloDigitos(f.dpi)) ?? [] : null;
    if (porId || porDocumento) {
      const etiqueta = f.codigo ? `código ${f.codigo}` : `DPI ${f.dpi}`;
      if (porId && porDocumento && porId.length === 1 && porDocumento.length === 1 && porId[0].id !== porDocumento[0].id) return { emp: null, etiqueta, conflicto: true };
      const c = porId && porId.length ? porId : porDocumento ?? [];
      return { emp: c.length === 1 ? c[0] : null, etiqueta, ambiguo: c.length > 1 };
    }
    const c = porNombre.get(normalizarTexto(f.nombre)) ?? [];
    return { emp: c.length === 1 ? c[0] : null, etiqueta: `nombre ${f.nombre}`, ambiguo: c.length > 1 };
  };

  // Resolución de empleados, duplicados y días calculados vs informados
  const noEncontrados = new Map<string, number[]>();
  const vistos = new Set<string>();
  const porEmpleado = new Map<number, FilaNormalizada[]>();
  let duplicados = 0;
  const feriados = validas.length
    ? await obtenerFeriadosEnRango(empresaId, validas.reduce((m, f) => (f.inicio < m ? f.inicio : m), validas[0].inicio), validas.reduce((m, f) => (f.fin > m ? f.fin : m), validas[0].fin))
    : new Set<string>();
  let diasDistintos = 0;
  for (const f of validas) {
    const { emp, etiqueta, ambiguo, conflicto } = resolver(f);
    if (!emp) {
      if (conflicto) problemas.push({ severidad: "ERROR", codigo: "EMPLEADO_CONFLICTO", fila: f.fila, mensaje: `El código y el DPI de la fila ${f.fila} apuntan a empleados distintos; corrija el archivo.` });
      else if (ambiguo) problemas.push({ severidad: "ERROR", codigo: "EMPLEADO_AMBIGUO", fila: f.fila, mensaje: `El ${etiqueta} coincide con más de un empleado; use el código o el DPI.` });
      else { noEncontrados.set(etiqueta, [...(noEncontrados.get(etiqueta) ?? []), f.fila]); }
      continue;
    }
    const llave = llaveLogica(emp.id, f);
    if (vistos.has(llave)) {
      duplicados += 1;
      problemas.push({ severidad: "ADVERTENCIA", codigo: "DUPLICADO_EN_ARCHIVO", fila: f.fila, empleadoId: emp.id, empleado: emp.nombre, mensaje: `La fila ${f.fila} repite otra (mismo empleado, fechas, días y tipo): se ignora.` });
      continue;
    }
    vistos.add(llave);
    const calculados = contarDiasHabilesPuro(f.inicio, f.fin, feriados);
    if (Math.abs(calculados - f.dias) > 0.001) {
      diasDistintos += 1;
      problemas.push({ severidad: "ADVERTENCIA", codigo: "DIAS_DISTINTOS", fila: f.fila, empleadoId: emp.id, empleado: emp.nombre, mensaje: `Fila ${f.fila}: días informados ${f.dias} ≠ días hábiles calculados ${calculados} (domingos y feriados excluidos). Se usan los informados.` });
    }
    porEmpleado.set(emp.id, [...(porEmpleado.get(emp.id) ?? []), f]);
  }
  for (const [identificador, filas] of noEncontrados) {
    problemas.push({ severidad: "ERROR", codigo: "EMPLEADO_NO_ENCONTRADO", mensaje: `Empleado no encontrado (${identificador}) — filas ${filas.slice(0, 10).join(", ")}${filas.length > 10 ? "…" : ""}.` });
  }

  // Vacaciones actuales (solo para INFORMAR: en una reconstrucción completa NO se suman al archivo oficial)
  const actuales = await query<RowDataPacket[]>(
    "SELECT id, id_empleado, fecha_inicio, fecha_fin, dias_habiles FROM vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  const llavesArchivo = new Set<string>();
  for (const [id, filas] of porEmpleado) for (const f of filas) llavesArchivo.add(llaveLogica(id, f));
  let equivalentes = 0;
  const actualesNoEnArchivoPorEmpleado = new Map<number, number>();
  for (const a of actuales) {
    const llave = llaveLogica(Number(a.id_empleado), { inicio: toIsoDate(a.fecha_inicio as string | Date) ?? "", fin: toIsoDate(a.fecha_fin as string | Date) ?? "", dias: Number(a.dias_habiles), tipo: "Vacaciones" });
    const llaveCuenta = llaveLogica(Number(a.id_empleado), { inicio: toIsoDate(a.fecha_inicio as string | Date) ?? "", fin: toIsoDate(a.fecha_fin as string | Date) ?? "", dias: Number(a.dias_habiles), tipo: "A cuenta de Vacaciones" });
    if (llavesArchivo.has(llave) || llavesArchivo.has(llaveCuenta)) equivalentes += 1;
    else actualesNoEnArchivoPorEmpleado.set(Number(a.id_empleado), (actualesNoEnArchivoPorEmpleado.get(Number(a.id_empleado)) ?? 0) + 1);
  }

  // Simulación por empleado (con la política de la empresa: NORMAL o CARGA HISTÓRICA)
  const politica = await obtenerPoliticaVacaciones(empresaId);
  const resumenEmpleados: ResumenEmpleadoPreview[] = [];
  let superpuestas = 0, anteriores = 0, cruzan = 0, futuras = 0, bloqueados = 0, decision = 0, totalDias = 0;
  const porId = new Map(empleados.map((e) => [e.id, e]));
  for (const [id, filas] of porEmpleado) {
    const emp = porId.get(id)!;
    const r = reconstruirEmpleado(emp, filas.map((f) => ({ origen: f.fila, inicio: f.inicio, fin: f.fin, dias: f.dias, tipo: f.tipo, observacion: f.observacion })), hoy, feriados, politica);
    if (r.bloqueado) bloqueados += 1;
    for (const w of r.advertencias) {
      if (w.codigo === "VACACIONES_SUPERPUESTAS") superpuestas += 1;
      if (w.codigo === "VACACION_ANTERIOR_A_FECHA_BASE") anteriores += 1;
      if (w.codigo === "VACACION_FUTURA") futuras += 1;
      if (w.codigo === "VACACION_CRUZA_ANIVERSARIO") cruzan += 1;
      if (w.severidad === "DECISION") decision += 1;
      problemas.push({ severidad: w.severidad, codigo: w.codigo, mensaje: w.mensaje, fila: w.origen, empleadoId: emp.id, empleado: emp.nombre });
    }
    totalDias = r2(totalDias + r.totalDiasHistorial);
    resumenEmpleados.push({
      empleadoId: emp.id, codigo: emp.codigo, nombre: emp.nombre, fechaAlta: emp.fechaAlta, fechaInicioLaboral: emp.fechaInicioLaboral,
      vacaciones: r.vacaciones.length, diasTotales: r.totalDiasHistorial, periodos: r.periodos.length,
      periodosVigentes: r.periodos.filter((p) => p.estado === "Vigente").length, periodosVencidos: r.periodos.filter((p) => p.estado === "Vencido").length,
      saldoFinal: r.saldoFinal, resumenDias: r.resumenDias, deficit: r2(r.vacaciones.reduce((s, v) => s + v.deficit, 0)), bloqueado: r.bloqueado, advertencias: r.advertencias,
      existentesNoEnArchivo: actualesNoEnArchivoPorEmpleado.get(emp.id) ?? 0,
    });
  }

  // Empleados con vacaciones ACTUALES que el archivo no trae: la reconstrucción completa las reemplazaría
  for (const [id, n] of actualesNoEnArchivoPorEmpleado) {
    const emp = porId.get(id);
    if (!emp) continue;
    if (!porEmpleado.has(id)) {
      problemas.push({ severidad: "DECISION", codigo: "VACACIONES_ACTUALES_SIN_HISTORIAL_EN_ARCHIVO", empleadoId: id, empleado: emp.nombre, mensaje: `${emp.nombre} tiene ${n} vacación(es) en el sistema y NINGUNA en el archivo: una reconstrucción completa las eliminaría.` });
      decision += 1;
    }
  }

  const noEnArchivo = actuales.length - equivalentes;
  const conteo = (s: SeveridadPreview) => problemas.filter((p) => p.severidad === s).length;
  return {
    modo: "PREVIEW",
    escribio: false,
    columnas,
    resumen: {
      filasLeidas: archivo.filas.length, filasValidas: validas.length, filasInvalidas: invalidas.length, duplicadosEnArchivo: duplicados,
      empleadosEncontrados: porEmpleado.size, empleadosNoEncontrados: noEncontrados.size, vacacionesSuperpuestas: superpuestas,
      diasCalculadosDistintos: diasDistintos, anterioresAFechaBase: anteriores, cruzanAniversario: cruzan, futuras, empleadosBloqueados: bloqueados, requierenDecision: decision, totalDiasArchivo: totalDias,
    },
    existentes: { vacaciones: actuales.length, equivalentesEnArchivo: equivalentes, noEnArchivo },
    noEncontrados: [...noEncontrados].map(([identificador, filas]) => ({ identificador, filas })),
    empleados: resumenEmpleados.sort((a, b) => a.nombre.localeCompare(b.nombre)),
    problemas,
    puedeAplicarse: conteo("BLOQUEANTE") === 0 && conteo("ERROR") === 0,
  };
}
