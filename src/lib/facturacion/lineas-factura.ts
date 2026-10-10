import Decimal from "decimal.js";
import { calcularTotalesFactura, PORCENTAJE_IVA_FASE1 } from "@/lib/facturacion/impuestos";
import { descripcionLinea, tratamientoEncabezado } from "@/lib/facturacion/borrador-calculo";

/**
 * FACT-4 — LÍNEAS de factura (lógica PURA, sin DB), compartida por el servidor (`crearFactura`, `actualizarFacturaBorrador`,
 * `previsualizarFactura`) y por la pantalla «Preparar líneas de factura». Es un motor COMÚN para toda entidad emisora:
 * no contiene nada específico de una empresa.
 *
 * Modelo (Milenium confirmado: la factura no tiene viajes; el operador digita líneas de servicio con descripción libre):
 *   viajes seleccionados  →  líneas editables/agrupables  →  factura
 * - 1 línea = cantidad × precio unitario = valor; clasificación SERVICIO | BIEN; tratamiento de IVA PROPIO.
 * - Una línea referencia ≥ 1 viaje (trazabilidad). Un viaje puede estar en varias líneas (p. ej. flete y descarga) y TODO
 *   viaje de la factura debe estar en al menos una línea.
 * - El servidor recalcula SIEMPRE: `valor`, base, IVA y total salen de cantidad y precio unitario; nunca del cliente.
 * - La agrupación NO tiene regla automática (confirmado por Contabilidad): la decide quien factura.
 */

export const CLASIFICACIONES_LINEA = ["SERVICIO", "BIEN"] as const;
export type ClasificacionLinea = (typeof CLASIFICACIONES_LINEA)[number];

export const CONDICIONES_PAGO = ["CREDITO", "CONTADO"] as const;
export type CondicionPago = (typeof CONDICIONES_PAGO)[number];

/** Porcentajes de retención de IVA confirmados por Contabilidad (0 = el cliente no es agente de retención). */
export const RETENCIONES_IVA_PERMITIDAS = [0, 15, 30] as const;
export type RetencionIvaPct = (typeof RETENCIONES_IVA_PERMITIDAS)[number];
export function esRetencionIvaValida(v: unknown): v is RetencionIvaPct {
  return typeof v === "number" && (RETENCIONES_IVA_PERMITIDAS as readonly number[]).includes(v);
}

export const MAX_LINEAS_FACTURA = 200;
export const MAX_DESCRIPCION_LINEA = 500;
const MAX_VALOR = new Decimal("999999999999.99"); // DECIMAL(14,2)
const MAX_CANTIDAD = new Decimal("9999999999.99"); // DECIMAL(12,2)

/** Lo que el facturador define para UNA línea. */
export type LineaFacturaEntrada = {
  /** planId de los viajes de origen (≥ 1). */
  planIds: number[];
  cantidad: number;
  descripcion: string;
  precioUnitario: number;
  clasificacion: ClasificacionLinea;
  /** Tratamiento de IVA de ESTA línea: true = el valor ya incluye IVA; false = el IVA se agrega. */
  precioIncluyeIva: boolean;
};

export type LineaFacturaCalculada = LineaFacturaEntrada & {
  orden: number;
  porcentajeIva: number;
  /** ROUND(cantidad × precioUnitario, 2): lo capturado (con o sin IVA según `precioIncluyeIva`). */
  valor: number;
  base: number;
  iva: number;
  total: number;
};

export type ResultadoLineas =
  | {
      ok: true;
      lineas: LineaFacturaCalculada[];
      subtotal: number;
      iva: number;
      total: number;
      porcentajeIva: number;
      /** Resumen del encabezado: true/false si todas coinciden; null si hay mezcla. */
      precioIncluyeIva: boolean | null;
    }
  | { ok: false; error: string; status: 400 };

const err = (error: string): { ok: false; error: string; status: 400 } => ({ ok: false, error, status: 400 });

function decimalValido(v: unknown, nombre: string): { ok: true; d: Decimal } | { ok: false; error: string } {
  if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, error: `${nombre} no es un número válido.` };
  const d = new Decimal(v);
  if (d.decimalPlaces() > 2) return { ok: false, error: `${nombre} admite como máximo dos decimales.` };
  return { ok: true, d };
}

/** `valor` de una línea: ROUND(cantidad × precio unitario, 2) con aritmética decimal. */
export function valorLinea(cantidad: number, precioUnitario: number): number {
  return new Decimal(cantidad).times(precioUnitario).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Valida y calcula las líneas. `planIdsFactura` = viajes de la factura (ya validados como facturables por el caller).
 * Reglas: cada línea con ≥ 1 viaje de la factura (sin repetir dentro de la línea), cantidad > 0, precio unitario > 0,
 * descripción no vacía (≤ 500), clasificación válida; todo viaje de la factura en ≥ 1 línea; total > 0.
 */
export function calcularLineasFactura(input: { lineas: LineaFacturaEntrada[]; planIdsFactura: number[] }): ResultadoLineas {
  const { lineas, planIdsFactura } = input;
  if (!lineas.length) return err("Agrega al menos una línea a la factura.");
  if (lineas.length > MAX_LINEAS_FACTURA) return err(`Una factura admite como máximo ${MAX_LINEAS_FACTURA} líneas.`);
  const validos = new Set(planIdsFactura);
  const cubiertos = new Set<number>();

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const n = i + 1;
    if (!Array.isArray(l.planIds) || !l.planIds.length) return err(`La línea ${n} debe tener al menos un viaje de origen.`);
    const vistos = new Set<number>();
    for (const id of l.planIds) {
      if (!Number.isInteger(id) || id <= 0) return err(`La línea ${n} tiene un viaje inválido.`);
      if (!validos.has(id)) return err(`La línea ${n} referencia un viaje (#${id}) que no pertenece a esta factura.`);
      if (vistos.has(id)) return err(`La línea ${n} repite el viaje #${id}.`);
      vistos.add(id);
      cubiertos.add(id);
    }
    const c = decimalValido(l.cantidad, `La cantidad de la línea ${n}`);
    if (!c.ok) return err(c.error);
    if (c.d.lte(0)) return err(`La cantidad de la línea ${n} debe ser mayor que cero.`);
    if (c.d.gt(MAX_CANTIDAD)) return err(`La cantidad de la línea ${n} es demasiado grande.`);
    const p = decimalValido(l.precioUnitario, `El precio unitario de la línea ${n}`);
    if (!p.ok) return err(p.error);
    if (p.d.lte(0)) return err(`El precio unitario de la línea ${n} debe ser mayor que cero.`);
    if (new Decimal(valorLinea(l.cantidad, l.precioUnitario)).gt(MAX_VALOR)) return err(`El valor de la línea ${n} es demasiado grande.`);
    const desc = typeof l.descripcion === "string" ? l.descripcion.trim() : "";
    if (!desc) return err(`La descripción de la línea ${n} es obligatoria.`);
    if (desc.length > MAX_DESCRIPCION_LINEA) return err(`La descripción de la línea ${n} excede ${MAX_DESCRIPCION_LINEA} caracteres.`);
    if (!(CLASIFICACIONES_LINEA as readonly string[]).includes(l.clasificacion)) {
      return err(`La clasificación de la línea ${n} debe ser SERVICIO o BIEN.`);
    }
    if (typeof l.precioIncluyeIva !== "boolean") return err(`Define el tratamiento de IVA de la línea ${n}.`);
  }
  const sinLinea = planIdsFactura.filter((id) => !cubiertos.has(id));
  if (sinLinea.length) {
    return err(`Hay viajes sin línea de factura (#${sinLinea.join(", #")}): cada viaje debe estar en al menos una línea.`);
  }

  const valores = lineas.map((l) => valorLinea(l.cantidad, l.precioUnitario));
  const t = calcularTotalesFactura({
    porcentajeIva: PORCENTAJE_IVA_FASE1,
    lineas: lineas.map((l, i) => ({ montoLinea: valores[i], precioIncluyeIva: l.precioIncluyeIva })),
  });
  if (t.total <= 0) return err("El total de la factura debe ser mayor que cero.");
  return {
    ok: true,
    lineas: lineas.map((l, i) => ({
      ...l,
      descripcion: l.descripcion.trim(),
      orden: i + 1,
      porcentajeIva: PORCENTAJE_IVA_FASE1,
      valor: valores[i],
      base: t.lineas[i].base,
      iva: t.lineas[i].iva,
      total: t.lineas[i].total,
    })),
    subtotal: t.subtotal,
    iva: t.iva,
    total: t.total,
    porcentajeIva: PORCENTAJE_IVA_FASE1,
    precioIncluyeIva: tratamientoEncabezado(lineas.map((l) => l.precioIncluyeIva)),
  };
}

// ── Operaciones de la pantalla «Preparar líneas de factura» (puras, sin estado) ─────────────────────────────────────────

/** Un viaje tal como lo necesita la pantalla para sugerir textos y montos. */
export type ViajeBaseLinea = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  origen?: string | null;
  destino?: string | null;
  /** Monto con el que se creó la línea por defecto (tarifa comercial o monto ajustado). */
  montoAsignado: number;
  /** Tratamiento de IVA por defecto de este viaje. */
  precioIncluyeIva: boolean;
};

export type LineaEditable = LineaFacturaEntrada & { clave: string };

let secuencia = 0;
const claveNueva = (): string => `l${++secuencia}`;

function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}-${Number(m[2])}-${m[1]}` : iso;
}

/** Texto sugerido para una línea que agrupa varios viajes. Es solo una sugerencia: el facturador lo edita. */
export function descripcionSugerida(viajes: ViajeBaseLinea[]): string {
  if (viajes.length === 1) {
    const v = viajes[0];
    return descripcionLinea({ origen: v.origen ?? null, destino: v.destino ?? null, fechaPlan: v.fechaPlan });
  }
  const destinos = [...new Set(viajes.map((v) => v.destino?.trim()).filter((d): d is string => !!d))];
  const fechas = [...new Set(viajes.map((v) => v.fechaPlan))].sort().map(fechaCorta);
  const partes = [`${viajes.length} servicios de transporte`];
  if (destinos.length) partes.push(destinos.join(", "));
  if (fechas.length) partes.push(`fecha${fechas.length > 1 ? "s" : ""} ${fechas.join(", ")}`);
  return partes.join(" – ");
}

/** Línea inicial por viaje (1 viaje = 1 línea): solo el PUNTO DE PARTIDA, nunca una regla. */
export function lineasPorDefecto(viajes: ViajeBaseLinea[], nuevaClave: () => string = claveNueva): LineaEditable[] {
  return viajes.map((v) => ({
    clave: nuevaClave(),
    planIds: [v.planId],
    cantidad: 1,
    descripcion: descripcionSugerida([v]),
    precioUnitario: v.montoAsignado,
    clasificacion: "SERVICIO" as const,
    precioIncluyeIva: v.precioIncluyeIva,
  }));
}

export type ResultadoOperacion = { ok: true; lineas: LineaEditable[]; claveNueva?: string } | { ok: false; error: string };

/**
 * Agrupa varias líneas en UNA (queda en el lugar de la primera). Exige el mismo tratamiento de IVA y la misma
 * clasificación: mezclarlos cambiaría el significado fiscal de la línea. Cantidad y precio:
 * - mismo precio unitario → cantidad = suma de cantidades;
 * - precios distintos → cantidad 1 y precio = suma de valores (el facturador puede ajustarlo).
 */
export function agruparLineas(
  lineas: LineaEditable[],
  claves: string[],
  viajes: Map<number, ViajeBaseLinea>,
  nuevaClave: () => string = claveNueva,
): ResultadoOperacion {
  const elegidas = lineas.filter((l) => claves.includes(l.clave));
  if (elegidas.length < 2) return { ok: false, error: "Selecciona al menos dos líneas para agrupar." };
  if (new Set(elegidas.map((l) => l.precioIncluyeIva)).size > 1) {
    return { ok: false, error: "No se pueden agrupar líneas con distinto tratamiento de IVA." };
  }
  if (new Set(elegidas.map((l) => l.clasificacion)).size > 1) {
    return { ok: false, error: "No se pueden agrupar líneas de distinta clasificación (SERVICIO / BIEN)." };
  }
  const planIds = [...new Set(elegidas.flatMap((l) => l.planIds))];
  const mismoPrecio = new Set(elegidas.map((l) => l.precioUnitario)).size === 1;
  const cantidad = mismoPrecio ? elegidas.reduce((s, l) => s + l.cantidad, 0) : 1;
  const precioUnitario = mismoPrecio
    ? elegidas[0].precioUnitario
    : elegidas.reduce((s, l) => new Decimal(s).plus(valorLinea(l.cantidad, l.precioUnitario)).toNumber(), 0);
  const base = planIds.map((id) => viajes.get(id)).filter((v): v is ViajeBaseLinea => !!v);
  const clave = nuevaClave();
  const nueva: LineaEditable = {
    clave,
    planIds,
    cantidad,
    descripcion: base.length ? descripcionSugerida(base) : elegidas[0].descripcion,
    precioUnitario,
    clasificacion: elegidas[0].clasificacion,
    precioIncluyeIva: elegidas[0].precioIncluyeIva,
  };
  // La línea agrupada queda en el lugar de la primera seleccionada.
  const salida: LineaEditable[] = [];
  let colocada = false;
  for (const l of lineas) {
    if (claves.includes(l.clave)) {
      if (!colocada) { salida.push(nueva); colocada = true; }
      continue;
    }
    salida.push(l);
  }
  return { ok: true, lineas: salida, claveNueva: clave };
}

/** Desagrupa una línea de varios viajes en una línea por viaje (cantidad 1, precio = monto del viaje). */
export function desagruparLinea(
  lineas: LineaEditable[],
  clave: string,
  viajes: Map<number, ViajeBaseLinea>,
  nuevaClave: () => string = claveNueva,
): ResultadoOperacion {
  const i = lineas.findIndex((l) => l.clave === clave);
  if (i < 0) return { ok: false, error: "Línea no encontrada." };
  const l = lineas[i];
  if (l.planIds.length < 2) return { ok: false, error: "La línea ya tiene un solo viaje." };
  const nuevas: LineaEditable[] = l.planIds.map((id) => {
    const v = viajes.get(id);
    return {
      clave: nuevaClave(),
      planIds: [id],
      cantidad: 1,
      descripcion: v ? descripcionSugerida([v]) : l.descripcion,
      precioUnitario: v ? v.montoAsignado : l.precioUnitario,
      clasificacion: l.clasificacion,
      precioIncluyeIva: l.precioIncluyeIva,
    };
  });
  return { ok: true, lineas: [...lineas.slice(0, i), ...nuevas, ...lineas.slice(i + 1)] };
}

/**
 * Agrega una línea de DESCARGA (servicio aparte) ligada a los mismos viajes de la línea indicada, justo debajo.
 * Nace con precio 0: el facturador debe capturarlo (la validación exige > 0). Si la descarga va integrada en la
 * descripción del flete, simplemente no se agrega esta línea.
 */
export function agregarLineaDescarga(
  lineas: LineaEditable[],
  claveBase: string,
  nuevaClave: () => string = claveNueva,
): ResultadoOperacion {
  const i = lineas.findIndex((l) => l.clave === claveBase);
  if (i < 0) return { ok: false, error: "Línea no encontrada." };
  const base = lineas[i];
  const clave = nuevaClave();
  const nueva: LineaEditable = {
    clave,
    planIds: [...base.planIds],
    cantidad: base.cantidad,
    descripcion: "Servicio de descarga",
    precioUnitario: 0,
    clasificacion: "SERVICIO",
    precioIncluyeIva: base.precioIncluyeIva,
  };
  return { ok: true, lineas: [...lineas.slice(0, i + 1), nueva, ...lineas.slice(i + 1)], claveNueva: clave };
}

/** Reordena una línea hacia arriba (delta −1) o abajo (+1). */
export function moverLinea(lineas: LineaEditable[], clave: string, delta: -1 | 1): LineaEditable[] {
  const i = lineas.findIndex((l) => l.clave === clave);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= lineas.length) return lineas;
  const copia = [...lineas];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

/** Quita un viaje de TODAS las líneas; las que se quedan sin viajes desaparecen. */
export function quitarViajeDeLineas(lineas: LineaEditable[], planId: number): LineaEditable[] {
  return lineas
    .map((l) => ({ ...l, planIds: l.planIds.filter((id) => id !== planId) }))
    .filter((l) => l.planIds.length > 0);
}

/** Viajes que aún no están en ninguna línea (la factura no se puede guardar así). */
export function viajesSinLinea(lineas: LineaEditable[], planIdsFactura: number[]): number[] {
  const usados = new Set(lineas.flatMap((l) => l.planIds));
  return planIdsFactura.filter((id) => !usados.has(id));
}

/** Entrada de servidor desde líneas de pantalla (sin `clave`). */
export function aEntradaServidor(lineas: LineaEditable[]): LineaFacturaEntrada[] {
  return lineas.map(({ planIds, cantidad, descripcion, precioUnitario, clasificacion, precioIncluyeIva }) => ({
    planIds, cantidad, descripcion, precioUnitario, clasificacion, precioIncluyeIva,
  }));
}

/** Huella de las líneas: forma parte de la huella de la vista previa. */
export function firmaLineasFactura(lineas: LineaFacturaEntrada[]): string {
  return lineas
    .map((l) => [[...l.planIds].sort((a, b) => a - b).join(","), l.cantidad, l.precioUnitario, l.clasificacion, l.precioIncluyeIva ? "i" : "a", l.descripcion.trim()].join(":"))
    .join("|");
}
