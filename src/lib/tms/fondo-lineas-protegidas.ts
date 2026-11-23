import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

/**
 * FONDOS FASE 1 — validaciones REUTILIZABLES de edición de líneas de solicitud de fondo con protección. Módulo PURO: sin base de datos ni HTTP.
 *
 * Hay dos niveles de protección (ambos se aplican en el servidor, dentro de la transacción, sobre la fila GUARDADA):
 *
 *  · AUTOMÁTICA — línea de origen automático (p. ej. un viático que algún día generará Programación; hoy no existen). Solo se pueden editar
 *    manualmente el método de pago y la cuenta/teléfono de destino. Beneficiario, monto, categoría, viaje, unidad, cliente, fecha y descripción
 *    son inmodificables, y la línea no se puede retirar ni reordenar a mano.
 *
 *  · VINCULADA — línea con vales de Combustible o vínculos CB2. Su significado financiero depende de: la categoría (el vínculo exige «Combustible»),
 *    el monto y la cantidad (el vale se concilia contra monto×cantidad y CB2 congeló ese contraste), el beneficiario (la persona del contraste) y la
 *    unidad/placa (el vale debe coincidir con la unidad de la línea) y el viaje de origen. Esos campos se bloquean; siguen siendo editables la
 *    descripción, la fecha del viaje, el cliente, el cargo, el método de pago, la cuenta/teléfono y la posición. La línea no se puede retirar.
 *
 *    FECHA DEL VIAJE (`fecha_viaje`) — verificada en el código real: ni Combustible (`combustible-fondos.ts`: valida categoría, estado de la solicitud y unidad) ni CB2
 *    (`cb2/fondos.ts`: contrasta y congela el monto, la persona, la placa y la fecha de la SOLICITUD, `fecha_requerimiento`) leen la fecha de la LÍNEA. Solo la usan los
 *    reportes de gastos como dimensión de filtro/periodo, igual que cliente, cargo y descripción (que también siguen editables). Por eso NO se bloquea; la prueba
 *    `fondos-edicion-lineas.db.test.ts` fija esa premisa (y falla si algún día un lector de Flota empieza a depender de ella: habría que protegerla).
 *
 * El ORIGEN nunca lo decide el cliente: se lee SIEMPRE de la fila guardada (`origenDeFila`); una entrada que intente declarar un origen se rechaza
 * (`rechazarOrigenDeCliente`), y un origen desconocido se trata como PROTEGIDO (falla cerrado). Una línea nueva creada a mano nace SIEMPRE manual.
 */

export type OrigenLinea = "MANUAL" | "AUTO_VIATICO" | "AUTO_OTRO";
export type NivelProteccion = "NINGUNA" | "AUTOMATICA" | "VINCULADA";

/** Orígenes conocidos que son automáticos (cuando exista la columna). Cualquier valor no vacío distinto de MANUAL también se protege. */
export const ORIGENES_AUTOMATICOS: readonly OrigenLinea[] = ["AUTO_VIATICO", "AUTO_OTRO"];

/** Campos de una línea automática que SÍ se pueden editar a mano. */
export const CAMPOS_EDITABLES_LINEA_AUTOMATICA = ["metodoPago", "cuenta"] as const;

export const CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA = [
  "categoria", "descripcion", "cantidad", "monto", "fechaViaje", "empleadoId", "empleadoNombre", "cargo", "vehiculoId", "clienteId", "planId",
] as const;
export type CampoProtegido = (typeof CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA)[number];

/** Campos que NO pueden cambiar en una línea vinculada a Combustible/CB2 (ver el encabezado del módulo). */
export const CAMPOS_PROTEGIDOS_LINEA_VINCULADA: readonly CampoProtegido[] = ["categoria", "cantidad", "monto", "empleadoId", "empleadoNombre", "vehiculoId", "planId"];

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

/** ¿La línea es automática (o de origen desconocido)? Todo lo que no sea explícitamente MANUAL lo es (falla cerrado). */
export function esLineaProtegida(origen: OrigenLinea | "DESCONOCIDO"): boolean {
  return origen !== "MANUAL";
}

/** Nivel de protección: una línea automática manda sobre una vinculada (más estricta). */
export function nivelDeProteccion(origen: OrigenLinea | "DESCONOCIDO", vinculada: boolean): NivelProteccion {
  if (esLineaProtegida(origen)) return "AUTOMATICA";
  return vinculada ? "VINCULADA" : "NINGUNA";
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
 * Campos de `campos` (por omisión, todos los protegidos de una línea automática) que la propuesta intenta cambiar. `undefined` en la propuesta
 * significa «no enviado» y conserva el valor guardado; `null` explícito sí es un valor y se compara. Comparación normalizada, nunca por referencia.
 */
export function camposProtegidosModificados(
  actual: ValoresLinea, propuesta: ValoresLinea, campos: readonly CampoProtegido[] = CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA,
): CampoProtegido[] {
  const cambiados: CampoProtegido[] = [];
  for (const campo of campos) {
    const nuevo = propuesta[campo];
    if (nuevo === undefined) continue;
    const f = NORMALIZADOR[campo];
    if (f(actual[campo]) !== f(nuevo)) cambiados.push(campo);
  }
  return cambiados;
}

/** Lanza si la propuesta cambia algo protegido para el nivel indicado. Una línea sin protección no tiene restricciones adicionales. */
export function validarEdicionLinea(nivel: NivelProteccion, actual: ValoresLinea, propuesta: ValoresLinea, numeroLinea: number): void {
  if (nivel === "NINGUNA") return;
  const campos = nivel === "AUTOMATICA" ? CAMPOS_PROTEGIDOS_LINEA_AUTOMATICA : CAMPOS_PROTEGIDOS_LINEA_VINCULADA;
  const cambios = camposProtegidosModificados(actual, propuesta, campos);
  if (!cambios.length) return;
  const lista = cambios.map((c) => ETIQUETA_CAMPO[c]).join(", ");
  throw new ErrorDominioFormulario(
    nivel === "AUTOMATICA"
      ? `Línea ${numeroLinea}: es una línea automática; solo se puede editar el método de pago y la cuenta o teléfono de destino (no se puede cambiar: ${lista}).`
      : `Línea ${numeroLinea}: tiene vales de Combustible o vínculos CB2; no se puede cambiar ${lista} porque alteraría el significado de esos vínculos. Sí se puede editar descripción, fecha del viaje, cliente, cargo, método de pago y cuenta.`,
  );
}

/** Lanza si se intenta retirar una línea protegida con la edición manual. */
export function validarEliminacionLinea(nivel: NivelProteccion, numeroLinea: number): void {
  if (nivel === "AUTOMATICA") throw new ErrorDominioFormulario(`Línea ${numeroLinea}: es una línea automática y no se puede eliminar manualmente.`);
  if (nivel === "VINCULADA") {
    throw new ErrorDominioFormulario(`No se puede eliminar la línea ${numeroLinea}: tiene vales de Combustible o vínculos CB2 asociados. Conserva la línea o quita primero el vínculo.`);
  }
}
