import type { ResultadoFilaLote, TarifaResuelta } from "@/lib/tms/programacion-lote";

/**
 * Diagnóstico SEGURO de «Copiar programación»: puro (sin base de datos), solo cuenta motivos y números de fila.
 * Nunca incluye nombres de personas, placas, rutas, montos ni identificadores de empresa: es apto para pantalla, bitácora y reportes.
 * No afirma la causa en producción: describe qué condiciones del lote producen los bloqueos y cuántas filas afecta cada una.
 */
export type MotivoBloqueo = "hora_o_regreso_ausente" | "solape_real" | "identidad_unidad" | "tarifa" | "disponibilidad" | "otro";

export const MOTIVOS_BLOQUEO: readonly MotivoBloqueo[] = ["hora_o_regreso_ausente", "solape_real", "identidad_unidad", "tarifa", "disponibilidad", "otro"];

export const ETIQUETA_MOTIVO: Record<MotivoBloqueo, string> = {
  hora_o_regreso_ausente: "Sin hora o regreso válido (reserva todo el día)",
  solape_real: "Horarios que se solapan de verdad",
  identidad_unidad: "Identidad de unidad TMS",
  tarifa: "Tarifa no vigente",
  disponibilidad: "Disponibilidad (personal, unidad o TC)",
  otro: "Otros motivos",
};

export type OrigenDeBloqueo = { fila: number; falta: "hora" | "regreso" | "hora_y_regreso"; afecta: number };

export type DiagnosticoBloqueos = {
  total: number;
  bloqueadas: number;
  porMotivo: Record<MotivoBloqueo, number>;
  /** Filas bloqueadas ÚNICAMENTE por conflictos con filas sin hora/regreso válido: se liberan al corregir esos orígenes. */
  derivadas: number;
  /** Filas sin hora/regreso válido que bloquean a otras, de mayor a menor alcance. */
  origenes: OrigenDeBloqueo[];
};

/** Clasificación de los errores que NO son choques dentro del lote (los choques se clasifican con los datos estructurados). */
function motivoDeMensaje(m: string): MotivoBloqueo {
  if (/conflicto de identidad|identidad tms|placa ambigua|identidad f[ií]sica|representante can[oó]nic/i.test(m)) return "identidad_unidad";
  if (/tarifa/i.test(m)) return "tarifa";
  if (/est[aá] asignad|no est[aá] disponible|viaje en curso|ocupad|taller|incapacidad|vacaciones|conflicto con|ya tiene un viaje|disponib/i.test(m)) return "disponibilidad";
  return "otro";
}

/** Motivos de bloqueo de UNA fila (sin duplicados). Una fila sin errores devuelve []. */
export function motivosDeFila(r: Pick<ResultadoFilaLote, "errores" | "conflictos">): MotivoBloqueo[] {
  const motivos = new Set<MotivoBloqueo>();
  for (const c of r.conflictos ?? []) motivos.add(c.causa === "dia_completo" ? "hora_o_regreso_ausente" : "solape_real");
  const colisiones = (r.conflictos ?? []).length;
  // Los mensajes de choque dentro del lote ya están representados por `conflictos`: se excluyen para no contarlos como «disponibilidad».
  const otros = r.errores.filter((e) => !/de este mismo lote\./.test(e));
  if (colisiones === 0 || otros.length) for (const e of otros) motivos.add(motivoDeMensaje(e));
  return [...motivos];
}

export function diagnosticarBloqueos(resultados: readonly (ResultadoFilaLote | null | undefined)[]): DiagnosticoBloqueos {
  const porMotivo = Object.fromEntries(MOTIVOS_BLOQUEO.map((m) => [m, 0])) as Record<MotivoBloqueo, number>;
  let bloqueadas = 0;
  let derivadas = 0;
  const origenes: OrigenDeBloqueo[] = [];
  const validas = resultados.filter((r): r is ResultadoFilaLote => !!r);
  for (const r of validas) {
    if (r.estado !== "error") continue;
    bloqueadas++;
    for (const m of motivosDeFila(r)) porMotivo[m]++;
    if (r.derivada) derivadas++;
    const d = r.diagnostico;
    if (d && (d.horaInvalida || d.regresoInvalido) && d.filasAfectadas.length) origenes.push({ fila: r.fila, falta: d.horaInvalida && d.regresoInvalido ? "hora_y_regreso" : d.horaInvalida ? "hora" : "regreso", afecta: d.filasAfectadas.length });
  }
  origenes.sort((a, b) => b.afecta - a.afecta || a.fila - b.fila);
  return { total: validas.length, bloqueadas, porMotivo, derivadas, origenes };
}

/** Texto corto y accionable para el usuario (sin datos personales). null si no hay nada que destacar. */
export function sugerenciaDeDiagnostico(d: DiagnosticoBloqueos): string | null {
  if (!d.origenes.length) return null;
  const primero = d.origenes[0];
  const que = primero.falta === "hora" ? "sin hora de carga" : primero.falta === "regreso" ? "sin regreso estimado" : "sin hora de carga ni regreso estimado";
  if (d.origenes.length === 1) return `La fila ${primero.fila} está ${que} y reserva todo el día: bloquea a ${primero.afecta} fila${primero.afecta === 1 ? "" : "s"}. Corrígela para liberar ${d.derivadas ? `${d.derivadas} fila${d.derivadas === 1 ? "" : "s"}` : "las demás"}.`;
  const afectadas = d.origenes.reduce((n, o) => n + o.afecta, 0);
  return `${d.origenes.length} filas sin hora o regreso válido reservan todo el día y bloquean a otras (${afectadas} bloqueos en total); la de mayor alcance es la fila ${primero.fila} (${que}, bloquea a ${primero.afecta}).`;
}

/** Bitácora del servidor: SOLO conteos y números de fila (nunca nombres, placas, montos ni empresa). No escribe en la base de datos. */
export function registrarDiagnosticoBloqueo(d: DiagnosticoBloqueos): void {
  if (!d.bloqueadas) return;
  console.info("copiar-programacion: lote con filas bloqueadas", {
    total: d.total, bloqueadas: d.bloqueadas, derivadas: d.derivadas, porMotivo: d.porMotivo,
    origenes: d.origenes.slice(0, 5).map((o) => ({ fila: o.fila, falta: o.falta, afecta: o.afecta })),
  });
}

// ---------------------------------------------------------------- Tarifas: origen vs destino

/** Tarifa del viaje ORIGEN solo para MOSTRAR (informativa): nunca se copia ni se usa como importe. */
export type TarifaOrigen = { nombre?: string | null; monto: number | null; moneda: string | null };

export type ComparacionTarifa =
  | { estado: "sin_tarifa" }
  | { estado: "igual"; origen: TarifaOrigen; destino: TarifaResuelta }
  | { estado: "distinta"; origen: TarifaOrigen; destino: TarifaResuelta; diferencia: number | null }
  | { estado: "asignada"; destino: TarifaResuelta }     // el origen no tenía tarifa y el destino sí
  | { estado: "perdida"; origen: TarifaOrigen };        // el origen tenía tarifa y el destino no

const EPS = 0.005;
const tieneTarifa = (o: TarifaOrigen | null | undefined): o is TarifaOrigen => !!o && o.monto != null;

/** Compara lo que tenía el origen con lo que REALMENTE se usará en destino (la tarifa vigente del catálogo). Sin tolerancia para monedas distintas. */
export function compararTarifa(origen: TarifaOrigen | null | undefined, destino: TarifaResuelta | null | undefined): ComparacionTarifa {
  const o = tieneTarifa(origen) ? origen : null;
  if (!o && !destino) return { estado: "sin_tarifa" };
  if (!o && destino) return { estado: "asignada", destino };
  if (o && !destino) return { estado: "perdida", origen: o };
  const dest = destino as TarifaResuelta;
  const mismaMoneda = !o!.moneda || o!.moneda.toUpperCase() === dest.moneda.toUpperCase();
  const mismoMonto = o!.monto != null && Math.abs(o!.monto - dest.monto) < EPS;
  if (mismaMoneda && mismoMonto) return { estado: "igual", origen: o!, destino: dest };
  return { estado: "distinta", origen: o!, destino: dest, diferencia: o!.monto != null && mismaMoneda ? Math.round((dest.monto - o!.monto) * 100) / 100 : null };
}

/** ¿Hay que advertir antes de confirmar? Todo lo que no sea «igual» o «sin tarifa». */
export const comparacionRequiereAviso = (c: ComparacionTarifa) => c.estado === "distinta" || c.estado === "asignada" || c.estado === "perdida";

export function resumenComparacionesTarifa(items: { fila: number; comparacion: ComparacionTarifa }[]) {
  const conAviso = items.filter((i) => comparacionRequiereAviso(i.comparacion));
  return { conAviso: conAviso.length, filas: conAviso.map((i) => i.fila) };
}
