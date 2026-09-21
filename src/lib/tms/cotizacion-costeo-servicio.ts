import { z } from "zod";
import { calcularIva } from "./cotizaciones";
import { calcularCosteoServicio, ErrorCosteo, type InputCosteoServicio, type ResultadoCosteoServicio } from "./cotizacion-costeo";
import {
  ErrorCosteoConfig,
  obtenerParametrosCosteoVigentes,
  obtenerPerfilCosteo,
  type CosteoPreparado,
} from "./cotizacion-costeo-db";

/**
 * COTIZACIONES-COSTEO (Fase 3) — arma y ejecuta el cálculo EN SERVIDOR.
 *
 * El cliente solo envía los datos operativos del servicio. Perfil (por id,
 * revalidado contra la empresa) y parámetros económicos (vigentes por
 * fecha) salen SIEMPRE de la base: el esquema es `.strict()`, así que
 * cualquier intento de mandar gpsMensual, combustible, salarios, IVA,
 * llantas, aceite, depreciación o rendimiento se rechaza con 400.
 */

const monto = z.number().finite().min(0).max(1_000_000_000);
const opcional = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

export const costeoPayloadSchema = z.object({
  perfilId: z.number().int().positive(),
  distanciaKm: z.number().finite().min(0).max(100_000),
  diasServicio: z.number().finite().positive().max(365),
  cantidadPilotos: z.number().finite().min(0).max(100),
  cantidadAuxiliares: z.number().finite().min(0).max(100),
  cantidadGuias: opcional(z.number().finite().min(0).max(100)),
  incluirGps: z.boolean(),
  incluirSeguroVehiculo: z.boolean(),
  seguroMercaderia: opcional(monto),
  usarRefrigeracion: opcional(z.boolean()),
  viaticoPilotoTotal: opcional(monto),
  viaticoAuxiliarTotal: opcional(monto),
  viaticoGuiaTotal: opcional(monto),
  hotelTotal: opcional(monto),
  otrosCostos: z.array(z.object({ concepto: z.string().trim().min(1).max(120), monto }).strict()).max(50).optional(),
  // Fracción (0.2 = 20 %). Tope de negocio de 5 (500 %); el snapshot lo guarda en DECIMAL(10,6).
  margenObjetivo: opcional(z.number().finite().min(0).max(5)),
}).strict();
export type CosteoPayload = z.infer<typeof costeoPayloadSchema>;

/**
 * POST .../costeo/calcular: el payload del costeo + el contexto comercial
 * mínimo (fecha de emisión para la vigencia de parámetros, y la tarifa
 * comercial para utilidad/margen). El precio de venta NO llega del
 * cliente: se deriva en servidor de tarifaCotizada/incluyeIva.
 */
export const calcularCosteoSchema = costeoPayloadSchema.extend({
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tarifaCotizada: opcional(z.number().finite().positive().max(9_999_999_999.99)),
  incluyeIva: opcional(z.boolean()),
}).strict();
export type CalcularCosteoPayload = z.infer<typeof calcularCosteoSchema>;

export type ContextoComercialCosteo = {
  fechaEmision: string;
  tarifaCotizada?: number | null;
  incluyeIva?: boolean | null;
};

/**
 * Precio de venta = tarifa comercial TOTAL CON IVA. incluyeIva=true: la
 * tarifa ya es el total; incluyeIva=false: tarifa × (1 + IVA comercial) —
 * calcularIva() del módulo comercial. Es el IVA de la TARIFA, no el IVA del
 * costo interno (ivaTasa de los parámetros): no se mezclan.
 */
export function precioVentaDesdeTarifa(tarifaCotizada: number | null | undefined, incluyeIva: boolean | null | undefined): number | null {
  if (tarifaCotizada == null || !(tarifaCotizada > 0)) return null;
  return calcularIva(tarifaCotizada, Boolean(incluyeIva)).total;
}

function construirInput(payload: CosteoPayload, perfil: InputCosteoServicio["perfil"], parametros: InputCosteoServicio["parametros"], precioVenta: number | null): InputCosteoServicio {
  const input: InputCosteoServicio = {
    perfil,
    parametros,
    distanciaKm: payload.distanciaKm,
    diasServicio: payload.diasServicio,
    cantidadPilotos: payload.cantidadPilotos,
    cantidadAuxiliares: payload.cantidadAuxiliares,
    incluirGps: payload.incluirGps,
    incluirSeguroVehiculo: payload.incluirSeguroVehiculo,
    precioVenta,
  };
  // Solo las claves presentes: null/ausente = "no informado", nunca 0 implícito.
  if (payload.cantidadGuias != null) input.cantidadGuias = payload.cantidadGuias;
  if (payload.seguroMercaderia != null) input.seguroMercaderia = payload.seguroMercaderia;
  if (payload.usarRefrigeracion != null) input.usarRefrigeracion = payload.usarRefrigeracion;
  if (payload.viaticoPilotoTotal != null) input.viaticoPilotoTotal = payload.viaticoPilotoTotal;
  if (payload.viaticoAuxiliarTotal != null) input.viaticoAuxiliarTotal = payload.viaticoAuxiliarTotal;
  if (payload.viaticoGuiaTotal != null) input.viaticoGuiaTotal = payload.viaticoGuiaTotal;
  if (payload.hotelTotal != null) input.hotelTotal = payload.hotelTotal;
  if (payload.otrosCostos?.length) input.otrosCostos = payload.otrosCostos;
  if (payload.margenObjetivo != null) input.margenObjetivo = payload.margenObjetivo;
  return input;
}

/**
 * 1) revalida el perfil por empresa; 2) parámetros vigentes a la fecha;
 * 3) construye InputCosteoServicio; 4) calcularCosteoServicio().
 * Lanza ErrorCosteoConfig (perfil/parámetros) o ErrorCosteo (datos inválidos).
 */
export async function prepararCosteo(
  empresaId: number,
  payload: CosteoPayload,
  contexto: ContextoComercialCosteo,
): Promise<CosteoPreparado & { parametrosVigenteDesde: string }> {
  const perfil = await obtenerPerfilCosteo(empresaId, payload.perfilId);
  if (!perfil) throw new ErrorCosteoConfig("El perfil de unidad indicado no existe en esta empresa.");
  const { vigenteDesde, parametros } = await obtenerParametrosCosteoVigentes(empresaId, contexto.fechaEmision);
  const { id: _id, ...perfilMotor } = perfil;
  void _id;
  const input = construirInput(payload, perfilMotor, parametros, precioVentaDesdeTarifa(contexto.tarifaCotizada, contexto.incluyeIva));
  const resultado: ResultadoCosteoServicio = calcularCosteoServicio(input);
  return { perfil, input, resultado, parametrosVigenteDesde: vigenteDesde };
}

/** Errores de configuración/validación del costeo => mensaje seguro para el cliente (400); cualquier otro se relanza. */
export function mensajeErrorCosteo(error: unknown): string | null {
  if (error instanceof ErrorCosteoConfig || error instanceof ErrorCosteo) return error.message;
  return null;
}
