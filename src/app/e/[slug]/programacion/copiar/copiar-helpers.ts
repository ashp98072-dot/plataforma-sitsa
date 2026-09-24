import type { BorradorLote, ResultadoFilaLote } from "@/lib/tms/programacion-lote";
import type { EdicionFilaCopia, OrigenFila } from "@/lib/tms/programacion-copia";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — lógica PURA de la vista previa editable de "Copiar programación"
 * (sin React, para poder probarla). El servidor es la autoridad: esto solo decide qué se muestra y qué se envía.
 */
export type FilaEditable = {
  incluida: boolean;
  origen: OrigenFila;
  advertencias: string[];
  borrador: BorradorLote;
  validacion: ResultadoFilaLote | null;
  /** Editada desde la última validación: no se puede confirmar hasta revalidar. */
  sucia: boolean;
};

export type CambiosFila = Partial<Pick<BorradorLote, "horaCarga" | "unidadPlaca" | "tcVehiculoId" | "pilotoEmpleadoId" | "auxiliarEmpleadoIds" | "tarifaId">>;

export const MAX_AUXILIARES_UI = 8;

/**
 * Fila recién cargada del origen: nace DESMARCADA (`incluida: false`). El usuario va MARCANDO solo lo que quiere
 * copiar; la validación que trae la carga (calculada para todo el origen) se muestra como información, pero no cuenta
 * hasta que la fila se marca y se revalida junto con la selección.
 */
export function filaDesdeCarga(f: { origen: OrigenFila; advertencias: string[]; borrador: BorradorLote; validacion: ResultadoFilaLote | null }): FilaEditable {
  return { incluida: false, origen: f.origen, advertencias: f.advertencias, borrador: f.borrador, validacion: f.validacion, sucia: false };
}

/** ¿Alguna fila SELECCIONADA depende de las demás (colisión dentro del lote)? Su resultado quedó viejo al cambiar la selección. */
const dependeDelLote = (f: FilaEditable) => f.validacion?.errores.some((e) => e.includes("de este mismo lote")) ?? false;

/**
 * Marca/desmarca UNA fila. Marcar: la fila entra a la siguiente validación (y las ya seleccionadas se revalidan, porque
 * pueden chocar con la nueva). Desmarcar: la fila deja de afectar el estado global INMEDIATAMENTE (puedeConfirmar solo
 * mira las seleccionadas); su información visual no se borra; las demás solo se revalidan si sus errores venían de
 * chocar dentro del lote (podrían haber sido con la fila que se quitó).
 */
export function alternarSeleccion(filas: FilaEditable[], indice: number): FilaEditable[] {
  const marcando = !filas[indice].incluida;
  return filas.map((f, i) => {
    if (i === indice) return marcando ? { ...f, incluida: true, sucia: true } : { ...f, incluida: false, sucia: false };
    if (!f.incluida) return f;
    return marcando || dependeDelLote(f) ? { ...f, sucia: true, validacion: null } : f;
  });
}

/** Marca TODAS las filas (no filtra por válidas: el usuario decide y luego la validación muestra los errores). */
export function seleccionarTodos(filas: FilaEditable[]): FilaEditable[] {
  return filas.map((f) => ({ ...f, incluida: true, sucia: true, validacion: f.incluida ? null : f.validacion }));
}

/** Deja 0 seleccionadas sin borrar ni recargar la programación (la información visual de cada fila se conserva). */
export function limpiarSeleccion(filas: FilaEditable[]): FilaEditable[] {
  return filas.map((f) => ({ ...f, incluida: false, sucia: false }));
}

export function filasIncluidas(filas: FilaEditable[]): FilaEditable[] {
  return filas.filter((f) => f.incluida);
}

/** Edita SOLO los campos permitidos (unidad, TC, piloto, auxiliares, hora, tarifa) y marca la fila como pendiente de revalidar. */
export function editarFila(f: FilaEditable, cambios: CambiosFila): FilaEditable {
  const aux = cambios.auxiliarEmpleadoIds ? [...new Set(cambios.auxiliarEmpleadoIds)].slice(0, MAX_AUXILIARES_UI) : f.borrador.auxiliarEmpleadoIds;
  return { ...f, sucia: true, validacion: null, borrador: { ...f.borrador, ...cambios, auxiliarEmpleadoIds: aux } };
}

/** Aplica el resultado del servidor (por número de fila) y limpia la marca de "sucia". */
export function aplicarValidacion(filas: FilaEditable[], validacion: ResultadoFilaLote[]): FilaEditable[] {
  const porFila = new Map(validacion.map((v) => [v.fila, v]));
  return filas.map((f) => (porFila.has(f.borrador.fila) ? { ...f, validacion: porFila.get(f.borrador.fila)!, sucia: false } : f));
}

/** Se puede confirmar solo con ≥1 fila incluida, TODAS las incluidas validadas sin errores y ninguna pendiente de revalidar. */
export function puedeConfirmar(filas: FilaEditable[], ocupado: boolean): boolean {
  const incluidas = filasIncluidas(filas);
  return !ocupado && incluidas.length > 0 && incluidas.every((f) => !f.sucia && f.validacion?.estado === "ok");
}

export function resumenFilas(filas: FilaEditable[]) {
  const incluidas = filasIncluidas(filas);
  return {
    total: filas.length,
    incluidas: incluidas.length,
    excluidas: filas.length - incluidas.length,
    conError: incluidas.filter((f) => f.validacion?.estado === "error").length,
    pendientes: incluidas.filter((f) => f.sucia || !f.validacion).length,
    ok: incluidas.filter((f) => !f.sucia && f.validacion?.estado === "ok").length,
  };
}

/** Cuerpo para validar/confirmar: solo filas incluidas y solo los campos editables (sin paradas, sin empresa, sin montos). */
export function cuerpoLote(fechaOrigen: string, fechaDestino: string, filas: FilaEditable[]) {
  const edicion: EdicionFilaCopia[] = filasIncluidas(filas).map((f) => {
    const { paradas: _paradas, ...resto } = f.borrador;
    void _paradas;
    return resto;
  });
  return { fechaOrigen, fechaDestino, filas: edicion };
}

/** Errores devueltos por el servidor al confirmar (por número de fila) -> se muestran en la fila y bloquean reconfirmar sin corregir. */
export function aplicarErroresConfirmacion(filas: FilaEditable[], errores: { fila: number; errores: string[] }[] | undefined): FilaEditable[] {
  if (!errores?.length) return filas;
  const porFila = new Map(errores.map((e) => [e.fila, e.errores]));
  return filas.map((f) => {
    const e = porFila.get(f.borrador.fila);
    return e ? { ...f, sucia: false, validacion: { fila: f.borrador.fila, estado: "error" as const, errores: e, tarifa: null } } : f;
  });
}

export function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export const fechaVisible = (iso: string) => iso.split("-").reverse().join("/");
