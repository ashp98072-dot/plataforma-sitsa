import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

/**
 * FONDOS FASE 1 — validaciones REUTILIZABLES para líneas de solicitud de fondo de origen AUTOMÁTICO (p. ej. un viático que algún día
 * generará Programación). Módulo PURO: sin acceso a base de datos ni al cliente HTTP.
 *
 * Esta fase NO crea líneas automáticas ni cambia el esquema. Solo deja lista la regla para que, cuando exista el origen, no se pueda eludir:
 *   · En una línea automática el beneficiario y el monto original NO se pueden modificar manualmente; solo el método de pago y la
 *     cuenta/teléfono de destino son editables.
 *   · Una línea automática no se elimina por la edición manual de la solicitud (solo la retira quien la generó).
 *   · El ORIGEN nunca lo decide el cliente: se lee SIEMPRE de la fila ya guardada (`origenDeFila`). Una entrada HTTP que intente declarar un
 *     origen se rechaza (`rechazarOrigenDeCliente`), y una fila con un origen desconocido se trata como PROTEGIDA (falla cerrado).
 *   · Una línea nueva creada por una edición manual nace SIEMPRE manual: no hay camino para que un cliente cree o convierta una línea automática.
 */

export type OrigenLinea = "MANUAL" | "AUTO_VIATICO";

/** Orígenes conocidos que son automáticos (cuando exista la columna). Cualquier valor no vacío distinto de MANUAL también se protege. */
export const ORIGENES_AUTOMATICOS: readonly OrigenLinea[] = ["AUTO_VIATICO"];

/** Campos de una línea automática que SÍ se pueden editar a mano. */
export const CAMPOS_EDITABLES_LINEA_AUTOMATICA = ["metodoPago", "cuenta"] as const;

/** Campos protegidos: beneficiario, monto original y la trazabilidad con el viaje. */
export const CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA = [
  "categoria", "descripcion", "cantidad", "monto", "fechaViaje", "empleadoId", "empleadoNombre", "cargo", "vehiculoId", "clienteId", "planId",
] as const;
export type CampoProtegido = (typeof CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA)[number];

const ETIQUETA_CAMPO: Record<CampoProtegido, string> = {
  categoria: "categoría", descripcion: "descripción", cantidad: "cantidad", monto: "monto", fechaViaje: "fecha del viaje",
  empleadoId: "beneficiario", empleadoNombre: "nombre del beneficiario", cargo: "cargo", vehiculoId: "unidad", clienteId: "cliente", planId: "viaje",
};

export type ValoresLinea = {
  categoria?: string | null;
  descripcion?: string | null;
  cantidad?: number | string | null;
  monto?: number | string | null;
  fechaViaje?: string | Date | null;
  empleadoId?: number | string | null;
  empleadoNombre?: string | null;
  cargo?: string | null;
  vehiculoId?: number | string | null;
  clienteId?: number | string | null;
  planId?: number | string | null;
};

/** Origen persistido de una fila. Ausente/NULL = MANUAL (así son todas las líneas actuales). Un valor desconocido NO se interpreta como manual. */
export function origenDeFila(fila: Record<string, unknown>): OrigenLinea | "DESCONOCIDO" {
  const o = fila.origen;
  if (o === undefined || o === null || o === "" || o === "MANUAL") return "MANUAL";
  return (ORIGENES_AUTOMATICOS as readonly unknown[]).includes(o) ? (o as OrigenLinea) : "DESCONOCIDO";
}

/** ¿La línea está protegida? Todo lo que no sea explícitamente MANUAL lo está (falla cerrado). */
export function esLineaProtegida(origen: OrigenLinea | "DESCONOCIDO"): boolean {
  return origen !== "MANUAL";
}

/** El cliente HTTP no puede declarar, cambiar ni quitar el origen de una línea. */
export function rechazarOrigenDeCliente(entrada: unknown, numeroLinea: number): void {
  if (entrada && typeof entrada === "object" && "origen" in entrada) {
    throw new ErrorDominioFormulario(`Línea ${numeroLinea}: el origen de una línea no se puede enviar ni modificar manualmente.`);
  }
}

const texto = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
};
const numero = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};
const entero = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(Number(v)));
const fecha = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const NORMALIZADOR: Record<CampoProtegido, (v: unknown) => string | null> = {
  categoria: texto, descripcion: texto, cantidad: numero, monto: numero, fechaViaje: fecha, empleadoId: entero, empleadoNombre: texto, cargo: texto,
  vehiculoId: entero, clienteId: entero, planId: entero,
};

/**
 * Campos PROTEGIDOS que la propuesta intenta cambiar. `undefined` en la propuesta significa «no enviado» y conserva el valor guardado (no es un
 * cambio); `null` explícito sí es un valor y se compara. Comparación normalizada (espacios, decimales, fechas), nunca por referencia.
 */
export function camposProtegidosModificados(actual: ValoresLinea, propuesta: ValoresLinea): CampoProtegido[] {
  const cambiados: CampoProtegido[] = [];
  for (const campo of CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA) {
    const nuevo = propuesta[campo];
    if (nuevo === undefined) continue;
    const f = NORMALIZADOR[campo];
    if (f(actual[campo]) !== f(nuevo)) cambiados.push(campo);
  }
  return cambiados;
}

/** Lanza si se intenta cambiar algo protegido de una línea automática. Una línea manual no tiene restricciones adicionales. */
export function validarEdicionLinea(origen: OrigenLinea | "DESCONOCIDO", actual: ValoresLinea, propuesta: ValoresLinea, numeroLinea: number): void {
  if (!esLineaProtegida(origen)) return;
  const cambios = camposProtegidosModificados(actual, propuesta);
  if (cambios.length) {
    throw new ErrorDominioFormulario(
      `Línea ${numeroLinea}: es una línea automática; solo se puede editar el método de pago y la cuenta o teléfono de destino (no se puede cambiar: ${cambios.map((c) => ETIQUETA_CAMPO[c]).join(", ")}).`,
    );
  }
}

/** Lanza si se intenta retirar una línea automática con la edición manual. */
export function validarEliminacionLinea(origen: OrigenLinea | "DESCONOCIDO", numeroLinea: number): void {
  if (esLineaProtegida(origen)) {
    throw new ErrorDominioFormulario(`Línea ${numeroLinea}: es una línea automática y no se puede eliminar manualmente.`);
  }
}
