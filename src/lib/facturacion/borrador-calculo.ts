import { calcularTotalesFactura, PORCENTAJE_IVA_FASE1 } from "@/lib/facturacion/impuestos";

/**
 * FACT-2 — lógica PURA del borrador de factura (sin DB): elegibilidad de un
 * viaje, descripción/snapshot de cada línea y totales. La comparten
 * `crearFactura`, `actualizarFacturaBorrador` y `previsualizarFactura`
 * (src/lib/facturacion/facturas.ts) para que la vista previa y el guardado
 * NUNCA puedan divergir.
 */

export const MONEDA_POR_DEFECTO = "GTQ";

/**
 * FASE 1: la ÚNICA moneda soportada es GTQ. Contabilidad no ha definido el tratamiento de moneda extranjera
 * (IVA, tipo de cambio, documento), así que cualquier otra moneda se rechaza en el servidor y no aparece en
 * «Viajes por facturar». Cuando se defina, se levanta esta restricción en UN solo lugar.
 */
export const MONEDA_SOPORTADA = "GTQ";
export const MENSAJE_MONEDA_NO_SOPORTADA =
  "Esta fase de Facturación solo admite GTQ. La facturación en moneda extranjera está pendiente de definición contable.";

/** Valores crudos (ya en mayúsculas y sin espacios) que equivalen a GTQ. Vacío/null también equivale a GTQ. */
export const EQUIVALENTES_GTQ: readonly string[] = ["", "Q", "QTZ", "GTQ"];

/** Datos de `tms_planes_viaje` (+ nombres de lugares) que necesita el borrador. */
export type PlanParaFactura = {
  id: number;
  codigo: string;
  empresaId: number;
  /** tms_clientes.id (NO clientes.id). */
  clienteTmsId: number | null;
  estado: string;
  /** YYYY-MM-DD. */
  fechaPlan: string;
  tarifaComercial: number | null;
  /** Moneda tal como está en el viaje (tarifa_moneda_historico); null = no registrada. */
  monedaRaw: string | null;
  rutaCodigo: string | null;
  origen: string | null;
  destino: string | null;
};

export type ResultadoValidacion = { ok: true } | { ok: false; error: string; status: number };

/** Normaliza el código de moneda del viaje; vacío/null se considera quetzales (como el resto de TMS). */
export function normalizarMoneda(raw: string | null | undefined): string {
  const m = (raw ?? "").trim().toUpperCase();
  if (EQUIVALENTES_GTQ.includes(m)) return MONEDA_POR_DEFECTO;
  return m;
}

export function esMonedaSoportada(raw: string | null | undefined): boolean {
  return normalizarMoneda(raw) === MONEDA_SOPORTADA;
}

/**
 * Un viaje es facturable si pertenece a la empresa, es del cliente, está
 * Cerrado, tiene tarifa comercial > 0, una ruta/destino identificable y no
 * está vinculado a otra factura viva. Orden y códigos de estado conservan los
 * de FACT-1 para los casos que ya existían.
 */
export function evaluarPlanFacturable(
  plan: PlanParaFactura,
  ctx: { empresaId: number; tmsClienteId: number; vinculoFacturaId: number | null; facturaIdExcluir: number | null },
): ResultadoValidacion {
  if (plan.empresaId !== ctx.empresaId) {
    return { ok: false, error: `Viaje #${plan.id} no encontrado.`, status: 404 };
  }
  if (plan.clienteTmsId !== ctx.tmsClienteId) {
    return { ok: false, error: `El viaje ${plan.codigo} no pertenece al cliente seleccionado.`, status: 400 };
  }
  if (plan.estado !== "Cerrado") {
    return { ok: false, error: `El viaje ${plan.codigo} no está Cerrado (estado actual: ${plan.estado}).`, status: 409 };
  }
  if (ctx.vinculoFacturaId != null && ctx.vinculoFacturaId !== ctx.facturaIdExcluir) {
    return { ok: false, error: `El viaje ${plan.codigo} ya está vinculado a otra factura.`, status: 409 };
  }
  if (!esMonedaSoportada(plan.monedaRaw)) {
    return { ok: false, error: MENSAJE_MONEDA_NO_SOPORTADA, status: 409 };
  }
  if (plan.tarifaComercial == null || !Number.isFinite(plan.tarifaComercial) || plan.tarifaComercial <= 0) {
    return { ok: false, error: `El viaje ${plan.codigo} no tiene una tarifa comercial válida (mayor que cero).`, status: 409 };
  }
  if (!plan.rutaCodigo?.trim() && !plan.destino?.trim()) {
    return { ok: false, error: `El viaje ${plan.codigo} no tiene ruta ni destino identificable.`, status: 409 };
  }
  return { ok: true };
}

function fechaDdMmYyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** «Servicio de transporte – {origen} → {destino} – {fecha}». Lo desconocido se muestra como «—». */
export function descripcionLinea(input: { origen: string | null; destino: string | null; fechaPlan: string }): string {
  const origen = input.origen?.trim() || "—";
  const destino = input.destino?.trim() || "—";
  return `Servicio de transporte – ${origen} → ${destino} – ${fechaDdMmYyyy(input.fechaPlan)}`;
}

/** Fotografía de una línea (lo que se congela en fact_factura_viajes). */
export type LineaBorradorCalculada = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  rutaCodigo: string | null;
  origen: string | null;
  destino: string | null;
  descripcion: string;
  cantidad: 1;
  tarifaComercial: number | null;
  /** Monto capturado de la línea (con o sin IVA según SU tratamiento). Es fact_factura_viajes.monto_asignado. */
  montoAsignado: number;
  /** Tratamiento de IVA de ESTA línea: true = ya incluido en la tarifa; false = se agrega a la tarifa. */
  precioIncluyeIva: boolean;
  porcentajeIva: number;
  base: number;
  iva: number;
  total: number;
};

export type BorradorCalculado = {
  moneda: string;
  /** Porcentaje de IVA de la fase (todas las líneas usan el mismo). */
  porcentajeIva: number;
  /**
   * RESUMEN del encabezado, NUNCA la fuente de verdad (esa son las líneas): `true`/`false` solo si TODAS las líneas
   * tienen el mismo tratamiento; `null` cuando hay MEZCLA (no puede mentir indicando una sola política).
   */
  precioIncluyeIva: boolean | null;
  lineas: LineaBorradorCalculada[];
  subtotal: number;
  iva: number;
  total: number;
};

/** Textos ya congelados de una línea existente; se conservan al editar el borrador. */
export type SnapshotLineaPrevio = {
  fechaPlan: string;
  rutaCodigo: string | null;
  origen: string | null;
  destino: string | null;
  descripcion: string;
};

/** Resumen de encabezado: el tratamiento común de las líneas, o `null` si hay mezcla (o ninguna línea). */
export function tratamientoEncabezado(tratamientos: boolean[]): boolean | null {
  if (!tratamientos.length) return null;
  return tratamientos.every((t) => t === tratamientos[0]) ? tratamientos[0] : null;
}

export type EntradaLineaBorrador = {
  plan: PlanParaFactura;
  montoAsignado: number;
  /** Tratamiento de IVA de ESTA línea, elegido explícitamente (nunca inferido). */
  precioIncluyeIva: boolean;
  snapshotPrevio?: SnapshotLineaPrevio | null;
};

export function construirBorrador(
  planes: EntradaLineaBorrador[],
): { ok: true; borrador: BorradorCalculado } | { ok: false; error: string; status: number } {
  // Defensa en profundidad: `evaluarPlanFacturable` ya rechaza cada viaje que no es GTQ; aquí nunca se construye
  // un documento (ni se le aplica IVA) con una moneda que no sea la soportada.
  if (planes.some((p) => !esMonedaSoportada(p.plan.monedaRaw))) {
    return { ok: false, error: MENSAJE_MONEDA_NO_SOPORTADA, status: 409 };
  }
  const moneda = MONEDA_SOPORTADA;

  // Cada línea se calcula con SU política (impuestos.ts); el documento es la suma de las líneas.
  const totales = calcularTotalesFactura({
    porcentajeIva: PORCENTAJE_IVA_FASE1,
    lineas: planes.map((p) => ({ montoLinea: p.montoAsignado, precioIncluyeIva: p.precioIncluyeIva })),
  });

  const lineas: LineaBorradorCalculada[] = planes.map(({ plan, montoAsignado, precioIncluyeIva, snapshotPrevio }, i) => {
    const t = totales.lineas[i];
    const textos = snapshotPrevio ?? {
      fechaPlan: plan.fechaPlan,
      rutaCodigo: plan.rutaCodigo,
      origen: plan.origen,
      destino: plan.destino,
      descripcion: descripcionLinea({ origen: plan.origen, destino: plan.destino, fechaPlan: plan.fechaPlan }),
    };
    return {
      planId: plan.id,
      codigo: plan.codigo,
      fechaPlan: textos.fechaPlan,
      rutaCodigo: textos.rutaCodigo,
      origen: textos.origen,
      destino: textos.destino,
      descripcion: textos.descripcion,
      cantidad: 1,
      tarifaComercial: plan.tarifaComercial,
      montoAsignado,
      precioIncluyeIva,
      porcentajeIva: PORCENTAJE_IVA_FASE1,
      base: t.base,
      iva: t.iva,
      total: t.total,
    };
  });

  return {
    ok: true,
    borrador: {
      moneda,
      porcentajeIva: PORCENTAJE_IVA_FASE1,
      precioIncluyeIva: tratamientoEncabezado(planes.map((p) => p.precioIncluyeIva)),
      lineas,
      subtotal: totales.subtotal,
      iva: totales.iva,
      total: totales.total,
    },
  };
}
