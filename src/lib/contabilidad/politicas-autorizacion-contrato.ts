import {z} from 'zod';

export const idContable=z.number().int().positive().max(2147483647);
const hash=z.string().regex(/^[0-9a-f]{64}$/);
const clave=z.uuid().transform(s=>s.toLowerCase());
const codigo=z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/);
const nota=z.string().trim().min(10).max(1000);
export const politicaEntrada=z.strictObject({operacion:z.literal('POLITICA'),codigo,versionEsperada:z.number().int().min(0).max(2147483646),
 huellaCondiciones:hash,cuentasNominales:z.array(idContable).min(1).max(2000).refine(a=>new Set(a).size===a.length,'Cuentas duplicadas').transform(a=>a.sort((a,b)=>a-b)),
 cuentaResultadoId:idContable,tratamientoSignos:z.literal('INVERSION_SALDO_EJERCICIO'),reglasVigencia:nota,justificacion:nota,
 revisorId:idContable,resolutorId:idContable,claveIdempotencia:clave,
 confirmacion:z.literal('PROPUESTA_DE_POLITICA_SIN_APROBACION_FORMAL')});
export const solicitudEntrada=z.strictObject({operacion:z.literal('SOLICITUD'),codigo,politicaVersion:idContable,borradorVersion:idContable,
 huellaCondiciones:hash,justificacion:nota,claveIdempotencia:clave,confirmacion:z.literal('SOLICITUD_TECNICA_NO_CONTABILIZABLE')});
export const decisionEntrada=z.strictObject({operacion:z.literal('DECISION'),solicitudId:z.string().regex(/^[1-9]\d{0,18}$/),versionEsperada:z.number().int().min(0).max(2147483646),
 accion:z.enum(['REVISION_TECNICA','DEVOLVER','RECHAZAR','DEJAR_PENDIENTE','INVALIDAR']),justificacion:nota,claveIdempotencia:clave,
 confirmacion:z.literal('DECISION_TECNICA_SIN_APROBACION_CONTABLE')});
export const gestionEntrada=z.discriminatedUnion('operacion',[politicaEntrada,solicitudEntrada,decisionEntrada]);
export type DecisionTecnica=z.infer<typeof decisionEntrada>['accion'];
export const AVISO_AUTORIZACION='PROPUESTA Y CONTROL TÉCNICO — SIN APROBACIÓN CONTABLE FORMAL NI ASIENTO CONTABILIZADO.';
export const PENDIENTES_AUTORIZACION=['POLITICA_CONTABLE_FORMAL_PENDIENTE','RESPONSABLES_FORMALES_PENDIENTES','CIRCUITO_AUTORIZACION_FORMAL_PENDIENTE'] as const;

export function estadoSolicitud(accion:string|undefined){
 return accion===undefined?'PREPARADA':accion==='REVISION_TECNICA'?'REVISION_TECNICA_REGISTRADA':accion==='DEVOLVER'?'DEVUELTA':accion==='RECHAZAR'?'RECHAZADA':accion==='INVALIDAR'?'INVALIDADA':accion==='DEJAR_PENDIENTE'?'PENDIENTE_AUTORIZACION_FORMAL':'INTEGRIDAD_INVALIDA';
}
export function validarTransicion(estado:string,accion:DecisionTecnica,actorId:number,roles:{preparadorId:number;revisorId:number;resolutorId:number},obsoleta:boolean,bloqueantes:string[]):{status:number;error:string}|null{
 if(!['REVISION_TECNICA','DEVOLVER','RECHAZAR','DEJAR_PENDIENTE','INVALIDAR'].includes(accion)||!['PREPARADA','REVISION_TECNICA_REGISTRADA','PENDIENTE_AUTORIZACION_FORMAL','DEVUELTA','RECHAZADA','INVALIDADA'].includes(estado))return {status:409,error:'Estado o acción fuera del contrato técnico.'};
 if(new Set(Object.values(roles)).size!==3)return {status:409,error:'Responsabilidades incompatibles.'};
 if(['DEVUELTA','RECHAZADA','INVALIDADA'].includes(estado))return {status:409,error:'Solicitud finalizada: prepara un nuevo borrador y solicitud.'};
 if(accion==='INVALIDAR')return !Object.values(roles).includes(actorId)?{status:403,error:'No eres responsable de esta solicitud.'}:!obsoleta?{status:409,error:'No se detectaron condiciones obsoletas.'}:null;
 if(obsoleta)return {status:409,error:'Solicitud desactualizada; debe invalidarse y prepararse otra.'};
 if(accion==='REVISION_TECNICA'){
  if(actorId!==roles.revisorId)return {status:403,error:'Solo el revisor técnico designado puede revisar; no se admite autorrevisión.'};
  if(estado!=='PREPARADA')return {status:409,error:'Ya existe revisión o resolución técnica.'};
  if(bloqueantes.length)return {status:422,error:'Hay bloqueantes técnicos o procedencia no verificada.'};
  return null;
 }
 if(actorId!==roles.resolutorId)return {status:403,error:'Solo el resolutor técnico designado puede resolver; no hay autorización contable formal.'};
 if(accion==='DEJAR_PENDIENTE'&&estado!=='REVISION_TECNICA_REGISTRADA')return {status:409,error:'Debe existir una revisión técnica previa.'};
 return null;
}
