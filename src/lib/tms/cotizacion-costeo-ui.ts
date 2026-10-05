import type { ComponenteCosteo, ResultadoCosteoServicio } from "./cotizacion-costeo";

/**
 * COTIZACIONES-COSTEO (Fase 3) — lógica pura del formulario de costeo
 * (client-safe: sin imports de servidor ni de DB). Nada de aquí calcula
 * costos: solo convierte el formulario en el payload que el SERVIDOR
 * recalcula, y decide qué mostrar.
 */

export type PerfilOpcion = {
  id: number;
  codigo: string;
  nombre: string;
  gpsMensual: number;
  seguroVehiculoMensual: number;
  costoRefrigeracion?: unknown | null;
  /** Valor predeterminado de «Viáticos y hotel (Q)» del perfil (se muestra como sugerencia del campo). */
  viaticosHotelViaje?: number | null;
};

export type OtroCostoForm = { concepto: string; monto: string };

export type CosteoFormState = {
  precioCombustibleOverride?: string;
  incluirSeguroMercaderia?: boolean;
  perfilId: number;
  distanciaKm: string;
  diasServicio: string;
  cantidadPilotos: string;
  cantidadAuxiliares: string;
  incluirGps: boolean;
  incluirSeguroVehiculo: boolean;
  seguroMercaderia: string;
  usarRefrigeracion: boolean;
  /** «Viáticos y hotel (Q)»: UN solo monto del viaje. Vacío = valor del perfil. */
  viaticosHotelTotal: string;
  otrosCostos: OtroCostoForm[];
  /** En porcentaje (20 = 20 %). Vacío = usar el margen de los parámetros vigentes. */
  margenObjetivoPct: string;
};

export const COSTEO_FORM_VACIO: CosteoFormState = {
  precioCombustibleOverride: "",
  incluirSeguroMercaderia: true,
  perfilId: 0,
  distanciaKm: "",
  diasServicio: "1",
  cantidadPilotos: "1",
  cantidadAuxiliares: "0",
  incluirGps: false,
  incluirSeguroVehiculo: false,
  seguroMercaderia: "",
  usarRefrigeracion: false,
  viaticosHotelTotal: "",
  otrosCostos: [],
  margenObjetivoPct: "",
};

/**
 * Al elegir un perfil por PRIMERA vez se sugieren GPS/seguro según lo que
 * el perfil tenga configurado; en cambios posteriores de perfil NO se
 * pisan los campos que el usuario ya pudo editar (solo se desactiva
 * refrigeración si el nuevo perfil no la tiene). No se inventa distancia.
 */
export function aplicarPerfilCosteo(form: CosteoFormState, perfil: PerfilOpcion | null): CosteoFormState {
  if (!perfil) return { ...form, perfilId: 0, usarRefrigeracion: false };
  const primeraVez = form.perfilId === 0;
  return {
    ...form,
    perfilId: perfil.id,
    incluirGps: primeraVez ? perfil.gpsMensual > 0 : form.incluirGps,
    incluirSeguroVehiculo: primeraVez ? perfil.seguroVehiculoMensual > 0 : form.incluirSeguroVehiculo,
    usarRefrigeracion: perfil.costoRefrigeracion ? form.usarRefrigeracion : false,
  };
}

const numero = (v: string): number => (v.trim() === "" ? NaN : Number(v));

/** Payload que el servidor recalcula. Solo datos operativos: jamás parámetros económicos ni datos del perfil. */
export type PayloadCosteoCliente = {
  precioCombustibleOverride?: number;
  incluirSeguroMercaderia?: boolean;
  perfilId: number;
  distanciaKm: number;
  diasServicio: number;
  cantidadPilotos: number;
  cantidadAuxiliares: number;
  incluirGps: boolean;
  incluirSeguroVehiculo: boolean;
  usarRefrigeracion: boolean;
  seguroMercaderia?: number;
  viaticosHotelTotal?: number;
  otrosCostos?: { concepto: string; monto: number }[];
  margenObjetivo?: number;
};

export function construirPayloadCosteo(form: CosteoFormState): { ok: true; payload: PayloadCosteoCliente } | { ok: false; error: string } {
  if (!form.perfilId) return { ok: false, error: "Selecciona un perfil de unidad." };
  const distanciaKm = numero(form.distanciaKm);
  if (!(distanciaKm >= 0)) return { ok: false, error: "Indica la distancia en km (0 o más)." };
  const diasServicio = numero(form.diasServicio);
  if (!(diasServicio > 0)) return { ok: false, error: "Los días de servicio deben ser mayores a cero." };
  const cantidades = { cantidadPilotos: numero(form.cantidadPilotos), cantidadAuxiliares: numero(form.cantidadAuxiliares) };
  if (Object.values(cantidades).some((c) => !(c >= 0))) return { ok: false, error: "Las cantidades de personal deben ser 0 o más." };

  const payload: PayloadCosteoCliente = {
    incluirSeguroMercaderia: form.incluirSeguroMercaderia ?? true,
    perfilId: form.perfilId,
    distanciaKm,
    diasServicio,
    ...cantidades,
    incluirGps: form.incluirGps,
    incluirSeguroVehiculo: form.incluirSeguroVehiculo,
    usarRefrigeracion: form.usarRefrigeracion,
  };
  // Vacío = no informado (nunca 0 implícito): los overrides solo viajan si el usuario los escribió.
  const opcionales = [
    ["precioCombustibleOverride", form.precioCombustibleOverride ?? ""],
    ["seguroMercaderia", form.seguroMercaderia], ["viaticosHotelTotal", form.viaticosHotelTotal],
  ] as const;
  for (const [clave, texto] of opcionales) {
    if (texto.trim() === "") continue;
    const n = numero(texto);
    if (!(n >= 0)) return { ok: false, error: "Los montos opcionales deben ser 0 o más." };
    payload[clave] = n;
  }
  const otros = form.otrosCostos.filter((o) => o.concepto.trim() !== "" || o.monto.trim() !== "");
  for (const o of otros) {
    if (o.concepto.trim() === "" || !(numero(o.monto) >= 0)) return { ok: false, error: "Cada otro costo necesita concepto y un monto de 0 o más." };
  }
  if (otros.length) payload.otrosCostos = otros.map((o) => ({ concepto: o.concepto.trim(), monto: numero(o.monto) }));
  if (form.margenObjetivoPct.trim() !== "") {
    const pct = numero(form.margenObjetivoPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 500) return { ok: false, error: "El margen objetivo debe estar entre 0 y 500 %." };
    payload.margenObjetivo = pct / 100;
  }
  return { ok: true, payload };
}

/**
 * Huella de lo que se calculó: si cambia cualquier dato operativo o
 * comercial (fecha, tarifa, IVA) el resultado mostrado queda obsoleto y NO
 * se guarda hasta recalcular.
 */
export function huellaCosteo(payload: PayloadCosteoCliente, contexto: { fechaEmision: string; tarifaCotizada: string; incluyeIva: boolean }): string {
  return JSON.stringify([payload, contexto.fechaEmision, contexto.tarifaCotizada.trim(), contexto.incluyeIva]);
}

/**
 * "Usar precio sugerido": SOLO se aplica por acción explícita del usuario.
 * El precio sugerido parte del costo CON IVA, así que la tarifa queda como
 * total con IVA incluido (incluyeIva = true).
 */
export function aplicarPrecioSugerido<T extends { tarifaCotizada: string; incluyeIva: boolean }>(form: T, precioSugerido: number): T {
  return { ...form, tarifaCotizada: (Math.round(precioSugerido * 100) / 100).toFixed(2), incluyeIva: true };
}

export const monedaCosteo = (n: number | null | undefined) => (n == null ? "—" : `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const porcentajeCosteo = (fraccion: number | null | undefined) => (fraccion == null ? "—" : `${(fraccion * 100).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);

/** Datos que muestra el resumen: mismos para un cálculo nuevo y para un snapshot registrado. */
export type ResumenCosteoDatos = {
  margenObjetivoMonto?: number;
  advertencias?: string[];
  subtotalComercial?: number;
  precioPorKm?: number | null;
  costoOperativo: number;
  iva: number;
  costoConIva: number;
  margenObjetivo: number;
  precioSugerido: number;
  precioVenta: number | null;
  utilidadEstimada: number | null;
  margenReal: number | null;
  componentes: ComponenteCosteo[];
};

/**
 * Motores que guardan un `resultado_snapshot` completo (subtotal, margen, IVA, precio/km). V1 no lo tiene y se muestra con su
 * formato original; tanto los snapshots del PR #406 como los nuevos del Cotizador 2026 usan el resumen detallado.
 */
export const motorConResultadoCompleto = (version: string | undefined | null): boolean => version === "COSTEO_EXCEL_2026" || version === "COSTEO_COTIZADOR_2026";

export function resumenDesdeResultado(r: ResultadoCosteoServicio): ResumenCosteoDatos {
  return {
    advertencias: r.advertencias,
    margenObjetivoMonto: r.margenObjetivoMonto,
    subtotalComercial: r.subtotalComercial, precioPorKm: r.precioPorKm,
    costoOperativo: r.costoOperativo, iva: r.iva, costoConIva: r.costoConIva, margenObjetivo: r.margenObjetivoAplicado,
    precioSugerido: r.precioSugerido, precioVenta: r.precioVenta, utilidadEstimada: r.utilidadEstimada, margenReal: r.margenReal,
    componentes: r.componentes,
  };
}

/** En pantalla se omiten renglones en 0 (el snapshot guarda todos los componentes). */
export function componentesVisibles(componentes: ComponenteCosteo[]): ComponenteCosteo[] {
  return componentes.filter((c) => c.monto !== 0);
}
