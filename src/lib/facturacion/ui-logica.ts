/**
 * FACT-1-UI — lógica PURA compartida por los componentes de Facturación
 * clientes (factura-borrador-form.tsx, viajes-pendientes-panel.tsx,
 * facturas-panel.tsx). Extraída para poder probarla sin un harness de
 * componentes React (no existe en este proyecto — ver vitest.config,
 * environment: "node") — mismo criterio ya usado en TMS-REPORTES-1 con
 * `pasosStepper`/`resumenCierre`.
 *
 * La AUTORIDAD real de cada regla sigue siendo el backend
 * (src/lib/facturacion/facturas.ts) — estas funciones solo evitan que la
 * UI ofrezca una acción que el backend rechazaría, y decoran estados ya
 * derivados por el backend (nunca inventan un estado nuevo).
 */

export type EstadoAdmin = "Borrador" | "Emitida" | "Anulada";
export type EstadoFinanciero = "Sin pagos" | "Pago parcial" | "Cobrado";

type ViajeConCliente = { planId: number; clienteId: number | null; cliente?: string | null };

/**
 * Fase D — un viaje solo puede agregarse a la selección si no hay
 * selección previa, o si pertenece al MISMO cliente que la selección
 * actual. Deseleccionar siempre está permitido.
 */
export function evaluarSeleccion<T extends ViajeConCliente>(
  viaje: T,
  seleccionActual: Map<number, T>,
): { accion: "agregar" | "quitar" } | { accion: "rechazar"; mensaje: string } {
  if (seleccionActual.has(viaje.planId)) return { accion: "quitar" };
  const primero = seleccionActual.values().next().value as T | undefined;
  if (primero && primero.clienteId !== viaje.clienteId) {
    return {
      accion: "rechazar",
      mensaje: `Ya seleccionaste viajes de "${primero.cliente ?? "otro cliente"}". Solo puedes facturar viajes de un mismo cliente a la vez — deselecciona esos viajes primero.`,
    };
  }
  return { accion: "agregar" };
}

/** Fase E — total de la factura: SUM de monto_asignado, solo lectura. */
export function calcularTotalLineas(lineas: { montoAsignado: number }[]): number {
  return lineas.reduce((s, l) => s + (Number.isFinite(l.montoAsignado) ? l.montoAsignado : 0), 0);
}

/** Fase E — se muestra la diferencia cuando el monto a facturar se editó respecto a tarifa_comercial. */
export function lineaDifiereDeTarifa(linea: { tarifaComercial: number | null; montoAsignado: number }): boolean {
  return linea.tarifaComercial != null && linea.montoAsignado !== linea.tarifaComercial;
}

/**
 * HOTFIX PRE-MERGE PR #114 (Hallazgo 2) — segunda defensa contra mostrar
 * el detalle de UNA factura bajo la fila de OTRA: incluso si `detalle`
 * quedó en memoria por una carrera entre dos aperturas, esto exige que
 * corresponda exactamente a la factura que está expandida en pantalla.
 * La primera defensa (limpiar `detalle` a `null` ANTES del fetch) vive en
 * facturas-panel.tsx (`cargarDetalle`).
 */
export function detalleCorrespondeAFactura(
  detalle: { factura: { id: number } } | null,
  facturaEsperadaId: number,
): boolean {
  return detalle != null && detalle.factura.id === facturaEsperadaId;
}

/** Fase H — Borrador editable; Emitida/Anulada congeladas. */
export function esBorrador(estadoAdmin: EstadoAdmin): boolean {
  return estadoAdmin === "Borrador";
}

/** Fase J — pagos solo contra una factura Emitida. */
export function esEmitida(estadoAdmin: EstadoAdmin): boolean {
  return estadoAdmin === "Emitida";
}

/**
 * HOTFIX PRE-MERGE PR #114 (Hallazgo 3) — no ofrecer "Registrar pago"
 * cuando el saldo ya es 0: el backend rechaza correctamente el sobrepago,
 * pero la UI no debe ofrecer una acción que ya sabe que es imposible.
 * Autoridad final sigue siendo el backend (registrarPago en
 * src/lib/facturacion/facturas.ts).
 */
export function puedeRegistrarOtroPago(estadoAdmin: EstadoAdmin, saldo: number): boolean {
  return esEmitida(estadoAdmin) && saldo > 0;
}

/** Fase K — se puede pedir anular mientras no esté ya Anulada (el backend decide si hay pagos que lo bloqueen). */
export function puedeOfrecerAnular(estadoAdmin: EstadoAdmin): boolean {
  return estadoAdmin !== "Anulada";
}

/**
 * Fase I — validación de UI ANTES del POST /emitir (el backend sigue
 * siendo la autoridad final: esto solo evita un viaje redondo innecesario
 * cuando falta un dato obviamente requerido).
 */
export function validarEmision(numeroFinal: string, fechaFinal: string): string | null {
  if (!numeroFinal.trim()) return "El número de factura es obligatorio.";
  if (!fechaFinal) return "La fecha de emisión es obligatoria.";
  return null;
}

/** Paginación — mismo cálculo que ya usa TMS-REPORTES-1 (desdeFila/hastaFila/totalPaginas). */
export function calcularTotalPaginas(totalReal: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalReal / pageSize));
}

/** Fase M — badges de relleno SÓLIDO + texto blanco: iguales en claro y oscuro. */
export function badgeAdminClase(estado: EstadoAdmin): string {
  if (estado === "Borrador") return "bg-slate-600";
  if (estado === "Emitida") return "bg-sky-600";
  return "bg-rose-600"; // Anulada
}
export function badgeFinancieroClase(estado: EstadoFinanciero | null): string {
  if (estado === "Cobrado") return "bg-emerald-600";
  if (estado === "Pago parcial") return "bg-amber-600";
  return "bg-slate-500"; // "Sin pagos" o null (Borrador/Anulada — se muestra "—")
}

/**
 * Respuesta uniforme fetch → { error } — usada por crear/editar/emitir/
 * anular/pago para decidir qué mensaje mostrar. El backend sigue siendo
 * la autoridad (status code real, p.ej. 409); esto solo decide el TEXTO.
 */
export function interpretarError(data: { error?: string } | null | undefined, fallback: string): string {
  return (data && typeof data.error === "string" && data.error) || fallback;
}
