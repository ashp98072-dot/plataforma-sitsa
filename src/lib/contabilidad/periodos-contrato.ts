import { z } from 'zod';

// Claves persistidas de menos de 40 caracteres; ninguna herencia de contabilidad:editar.
export const CAPACIDADES_PERIODOS = ['abrir','cerrar','reabrir_solicitar','reabrir_aprobar','diagnosticar','activar_solicitar','activar_aprobar','operadores'] as const;
export type CapacidadPeriodo = typeof CAPACIDADES_PERIODOS[number];
export const permisoPeriodo = (c: CapacidadPeriodo) => `cont_periodos_${c}`;
const id=z.number().int().positive().max(2147483647);
const version=z.number().int().nonnegative().max(2147483647);
export const motivoPeriodo=z.string().trim().min(20).max(1000).refine(s=>!/[\p{Cc}\p{Cf}]/u.test(s),'No se admiten caracteres de control o invisibles.');
const base={operacion:z.uuid(),motivo:motivoPeriodo};
export const accionPeriodo=z.discriminatedUnion('accion',[
  z.strictObject({...base,accion:z.literal('abrir'),periodoId:id,version}),
  z.strictObject({...base,accion:z.literal('cerrar'),periodoId:id,version}),
  z.strictObject({...base,accion:z.literal('reabrir_solicitar'),periodoId:id,version}),
  z.strictObject({...base,accion:z.literal('diagnosticar')}),
  z.strictObject({...base,accion:z.literal('activar_solicitar'),diagnosticoId:id,aceptaHistoria:z.boolean()}),
  z.strictObject({...base,accion:z.literal('resolver'),solicitudId:id,version,aprobar:z.boolean()}),
  z.strictObject({...base,accion:z.literal('operador'),usuarioId:id,capacidad:z.enum(CAPACIDADES_PERIODOS),activo:z.boolean()}),
]);
export type AccionPeriodo = z.infer<typeof accionPeriodo>;
export class ErrorPeriodo extends Error {
  constructor(public codigo:string,message:string,public status=409){super(message);}
}
export function exigirTransicion(estado:string,accion:'abrir'|'cerrar'|'reabrir'){
  if(estado!==({abrir:'CONFIGURADO',cerrar:'ABIERTO',reabrir:'CERRADO'}[accion]))throw new ErrorPeriodo('TRANSICION_INVALIDA','El estado del período cambió o no admite esta operación.');
}
