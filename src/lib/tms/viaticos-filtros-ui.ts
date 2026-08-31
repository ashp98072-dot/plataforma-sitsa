/**
 * VIATICOS-BANDEJAS-1 — filtros client-side de las bandejas de viáticos
 * (ViaticosControlPanel / ViaticosPorPagarPanel). Funciones puras,
 * extraídas para poder probarlas con vitest (el proyecto no tiene
 * infraestructura de pruebas de componentes React — mismo criterio que
 * src/lib/tms/viaticos-exportar-banco.ts, lógica pura fuera del
 * componente, ejercida por él pero probada independiente).
 *
 * NO agrega filtro en el backend: estos filtros se aplican sobre las
 * filas ya traídas por los endpoints existentes (mismo patrón que el
 * filtro "Viaje" ya existente en ambos paneles, que tampoco viaja al
 * servidor).
 */

/** Valores REALES de tms_viaticos.metodo_pago (ver MetodoPagoViatico en src/lib/tms/viaticos.ts) — "" = sin filtrar. */
export type FiltroMetodoPago = "" | "TRANSFERENCIA" | "CHEQUE" | "EFECTIVO";

/** "" = sin filtrar, "CON" = con cuenta bancaria registrada, "SIN" = sin cuenta. */
export type FiltroCuentaBancaria = "" | "CON" | "SIN";

/**
 * Definición de "con cuenta bancaria": exactamente el mismo criterio ya
 * usado por aptosBanco/sinCuentaBanco en viaticos-por-pagar-panel.tsx y
 * por validarParaBiBanking() en viaticos-exportar-banco.ts — un string no
 * vacío tras trim(). No se inventa ninguna validación bancaria nueva
 * (formato de cuenta, dígito verificador, etc.).
 */
export function tieneCuentaBancariaValida(cuentaBancaria: string | null | undefined): boolean {
  return Boolean(cuentaBancaria?.trim());
}

/** true si el método de pago de la fila coincide con el filtro (filtro "" = todos). */
export function coincideMetodoPago(
  metodoPago: string | null | undefined,
  filtro: FiltroMetodoPago,
): boolean {
  if (!filtro) return true;
  return metodoPago === filtro;
}

/** true si la fila coincide con el filtro de cuenta bancaria (filtro "" = todos). */
export function coincideCuentaBancaria(
  cuentaBancaria: string | null | undefined,
  filtro: FiltroCuentaBancaria,
): boolean {
  if (!filtro) return true;
  const tiene = tieneCuentaBancariaValida(cuentaBancaria);
  return filtro === "CON" ? tiene : !tiene;
}

/**
 * Totales de la selección — SOLO sobre `filtrados` (nunca sobre
 * `seleccionados` en crudo): si un id seleccionado quedó fuera del
 * filtro/bandeja actual, no debe sumar ni contar. Mismo criterio de
 * seguridad que "nunca actuar sobre registros fuera del filtro actual".
 */
export function totalSeleccionado<T extends { id: number; montoAsignado: number }>(
  filtrados: T[],
  seleccionados: Set<number>,
): { cantidad: number; monto: number } {
  let cantidad = 0;
  let monto = 0;
  for (const r of filtrados) {
    if (seleccionados.has(r.id)) {
      cantidad++;
      monto += r.montoAsignado;
    }
  }
  return { cantidad, monto };
}
