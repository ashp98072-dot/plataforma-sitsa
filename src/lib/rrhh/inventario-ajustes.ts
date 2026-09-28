/**
 * RRHH-INVENTARIO-CAMBIOS-1 — reglas PURAS (sin BD) de devolución/cambio de
 * artículo sobre una entrega ya realizada. Ver discovery en
 * sql/discovery-2026-09-rrhh-inventario-cambios.sql para el porqué del
 * diseño (ninguna tabla existente se altera; inventario_rrhh_entregas nunca
 * se actualiza — el estado se deriva siempre desde estos cálculos).
 */

export type TipoAjusteInventario = "DEVOLUCION" | "CAMBIO";

export type EstadoEntregaDerivado =
  | "ENTREGADO"
  | "PARCIALMENTE DEVUELTO"
  | "DEVUELTO"
  | "CAMBIADO PARCIAL"
  | "CAMBIADO";

export type ValidacionAjuste =
  | { ok: true }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Cuánto de una entrega sigue disponible para devolver/cambiar —
 * cantidadOriginal menos lo ya devuelto/cambiado en ajustes previos. Nunca
 * negativo (protección defensiva; la invariante real la garantiza la
 * validación en cada operación, esto es solo el cálculo).
 */
export function cantidadDisponibleParaAjuste(
  cantidadOriginal: number,
  ajustesPrevios: { cantidad: number }[],
): number {
  const usado = ajustesPrevios.reduce((acc, a) => acc + a.cantidad, 0);
  return Math.max(0, cantidadOriginal - usado);
}

/**
 * Estado visual de una entrega — SIEMPRE calculado, nunca almacenado (la
 * fila de inventario_rrhh_entregas original nunca se actualiza). Si hay al
 * menos un ajuste tipo CAMBIO, prevalece "CAMBIADO(...)" sobre "DEVUELTO"
 * aunque también existan devoluciones puras — es la lectura más informativa
 * para RRHH ("algo de esto se cambió", no solo "algo se devolvió").
 */
export function calcularEstadoEntrega(
  cantidadOriginal: number,
  ajustes: { tipo: TipoAjusteInventario; cantidad: number }[],
): EstadoEntregaDerivado {
  if (ajustes.length === 0) return "ENTREGADO";
  const usado = ajustes.reduce((acc, a) => acc + a.cantidad, 0);
  const restante = Math.max(0, cantidadOriginal - usado);
  const huboCambio = ajustes.some((a) => a.tipo === "CAMBIO");
  if (restante === 0) return huboCambio ? "CAMBIADO" : "DEVUELTO";
  return huboCambio ? "CAMBIADO PARCIAL" : "PARCIALMENTE DEVUELTO";
}

/** Cantidad > 0, entera, y que no exceda lo disponible. */
export function validarCantidadAjuste(
  cantidadSolicitada: number,
  cantidadDisponible: number,
): ValidacionAjuste {
  const cantidad = Math.trunc(cantidadSolicitada);
  if (!(cantidad > 0)) {
    return { ok: false, motivo: "cantidad_invalida", mensaje: "La cantidad debe ser mayor a cero." };
  }
  if (cantidad > cantidadDisponible) {
    return {
      ok: false,
      motivo: "cantidad_excede_disponible",
      mensaje: `No se puede procesar ${cantidad}: solo hay ${cantidadDisponible} disponible(s) de esta entrega para devolver/cambiar.`,
    };
  }
  return { ok: true };
}

/**
 * Compatibilidad de precio para un CAMBIO — ver sección 8 del ticket
 * (RRHH-INVENTARIO-CAMBIOS-1). Sin cobro asociado: siempre compatible (no
 * hay dinero de por medio). Con cobro: solo compatible si el costo unitario
 * del artículo nuevo es EXACTAMENTE igual al histórico de la entrega
 * original (tolerancia de medio centavo por redondeo) — así el descuento ya
 * activo sigue cubriendo exactamente lo que el empleado tiene ahora, sin
 * tocar rrhh_descuentos_maestro/rrhh_descuento_cuotas. Una diferencia real
 * de precio queda deliberadamente FUERA de este PR (ver discovery): no
 * existe hoy un mecanismo seguro para cambiar el monto_original de un
 * descuento ACTIVO sin arriesgar cuotas ya aplicadas.
 */
export function validarCompatibilidadPrecioCambio(input: {
  huboCobro: boolean;
  costoUnitarioOriginal: number;
  costoUnitarioNuevo: number;
}): ValidacionAjuste {
  if (!input.huboCobro) return { ok: true };
  const diferencia = Math.round((input.costoUnitarioNuevo - input.costoUnitarioOriginal) * 100) / 100;
  if (Math.abs(diferencia) > 0.005) {
    return {
      ok: false,
      motivo: "diferencia_precio_no_soportada",
      mensaje:
        `El artículo nuevo cuesta Q${input.costoUnitarioNuevo.toFixed(2)} y el original Q${input.costoUnitarioOriginal.toFixed(2)} ` +
        `(diferencia Q${Math.abs(diferencia).toFixed(2)}). Un cambio con cobro asociado y diferencia de precio requiere ajustar ` +
        `manualmente el descuento en RRHH > Descuentos antes de continuar — no se modificó nada.`,
    };
  }
  return { ok: true };
}
