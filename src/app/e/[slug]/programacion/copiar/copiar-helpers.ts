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
