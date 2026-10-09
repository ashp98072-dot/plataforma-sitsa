import {
  calcularTotalesFactura,
  calcularTotalesLinea,
  POLITICA_IVA_FACTURACION,
  type PoliticaIva,
} from "@/lib/facturacion/impuestos";

/**
 * FACT-2 — lógica PURA del borrador de factura (sin DB): elegibilidad de un
 * viaje, descripción/snapshot de cada línea y totales. La comparten
 * `crearFactura`, `actualizarFacturaBorrador` y `previsualizarFactura`
 * (src/lib/facturacion/facturas.ts) para que la vista previa y el guardado
 * NUNCA puedan divergir.
 */

export const MONEDA_POR_DEFECTO = "GTQ";

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
  if (!m || m === "Q" || m === "QTZ") return MONEDA_POR_DEFECTO;
  return m;
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
  /** Monto capturado de la línea (con o sin IVA según la política). Es fact_factura_viajes.monto_asignado. */
  montoAsignado: number;
  base: number;
  iva: number;
  total: number;
};

export type BorradorCalculado = {
  moneda: string;
  politica: PoliticaIva;
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

export function construirBorrador(
  planes: { plan: PlanParaFactura; montoAsignado: number; snapshotPrevio?: SnapshotLineaPrevio | null }[],
  politica: PoliticaIva = POLITICA_IVA_FACTURACION,
): { ok: true; borrador: BorradorCalculado } | { ok: false; error: string; status: number } {
  const monedas = new Set(planes.map((p) => normalizarMoneda(p.plan.monedaRaw)));
  if (monedas.size > 1) {
    return {
      ok: false,
      error: `Los viajes seleccionados tienen monedas distintas (${Array.from(monedas).sort().join(", ")}); una factura admite una sola moneda.`,
      status: 409,
    };
  }
  const moneda = monedas.values().next().value ?? MONEDA_POR_DEFECTO;

  const lineas: LineaBorradorCalculada[] = planes.map(({ plan, montoAsignado, snapshotPrevio }) => {
    const t = calcularTotalesLinea({ montoLinea: montoAsignado, ...politica });
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
      base: t.base,
      iva: t.iva,
      total: t.total,
    };
  });

  const totales = calcularTotalesFactura({ montosLinea: planes.map((p) => p.montoAsignado), ...politica });
  return { ok: true, borrador: { moneda, politica, lineas, ...totales } };
}
