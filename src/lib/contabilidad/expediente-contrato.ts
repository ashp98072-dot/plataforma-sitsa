import {z} from 'zod';
export const evidenciaEntrada=z.strictObject({solicitudId:z.string().regex(/^[1-9]\d{0,18}$/),codigo:z.string().trim().regex(/^[A-Z0-9_-]{2,40}$/),versionEsperada:z.number().int().min(0).max(2147483646),huellaExpediente:z.string().regex(/^[0-9a-f]{64}$/),estado:z.enum(['PENDIENTE','NO_VERIFICADA','VERIFICADA_TECNICAMENTE','REVOCADA']),referencia:z.string().trim().max(500),huellaDocumento:z.string().regex(/^[0-9a-f]{64}$/).nullable(),justificacion:z.string().trim().min(10).max(1000),claveIdempotencia:z.uuid()}).superRefine((d,c)=>{if(['NO_VERIFICADA','VERIFICADA_TECNICAMENTE'].includes(d.estado)&&(!d.referencia||!d.huellaDocumento))c.addIssue({code:'custom',message:'Referencia y huella requeridas'});});
export const OBLIGATORIAS=['POLITICA','BORRADOR','REVISION_DOCUMENTAL'] as const;
export type Evidencia={codigo:string;version:number;estado:string;referencia:string;huellaDocumento:string|null;justificacion:string;creadoPor:number;creadoEn:string;huellaBase:string;integra:boolean};
export function evaluarEvidencias(evidencias:Evidencia[],huellaBase:string){
 const actuales=evidencias.filter((e,i,a)=>a.findIndex(x=>x.codigo===e.codigo)===i);
 const integridad=evidencias.flatMap(e=>!e.integra?['EVIDENCIA_INTEGRA_INVALIDA:'+e.codigo+':'+e.version]:[]);
 for(const codigo of new Set(evidencias.map(e=>e.codigo))){const versiones=evidencias.filter(e=>e.codigo===codigo).map(e=>e.version).sort((a,b)=>a-b);if(versiones.some((v,i)=>v!==i+1))integridad.push('CADENA_EVIDENCIA_INVALIDA:'+codigo);}
 return [...integridad,...OBLIGATORIAS.filter(c=>!actuales.some(e=>e.codigo===c)).map(c=>'EVIDENCIA_OBLIGATORIA_PENDIENTE:'+c),...actuales.flatMap(e=>[...(!e.integra?['EVIDENCIA_INTEGRA_INVALIDA:'+e.codigo]:[]),...(e.estado!=='VERIFICADA_TECNICAMENTE'?['EVIDENCIA_'+e.estado+':'+e.codigo]:[]),...(e.huellaBase!==huellaBase?['EVIDENCIA_DESACTUALIZADA:'+e.codigo]:[])])];
}
