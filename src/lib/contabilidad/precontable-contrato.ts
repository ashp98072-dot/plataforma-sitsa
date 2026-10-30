import {z} from 'zod';

export const constanciaEntrada=z.strictObject({
 solicitudId:z.string().regex(/^[1-9]\d{0,18}$/),
 versionEsperada:z.number().int().min(0).max(2147483646),
 huellaIntegral:z.string().regex(/^[0-9a-f]{64}$/),
 justificacion:z.string().trim().min(15).max(1500),
 claveIdempotencia:z.uuid().transform(s=>s.toLowerCase()),
 confirmacion:z.literal('CONSTANCIA_TECNICA_SIN_APROBACION_FORMAL'),
});
export const AVISO_PRECONTABLE='INFORME PRECONTABLE: propuesta y evaluación técnica. Sin aprobación formal, firma de autenticidad ni asiento contabilizado.';
export type Hallazgo={codigo:string;nivel:'BLOQUEANTE'|'ADVERTENCIA';referencias:{tipo:string;id:string;version?:number}[]};
export function componentesCambiados(anteriores:Record<string,string>,actuales:Record<string,string>){
 return [...new Set([...Object.keys(anteriores),...Object.keys(actuales)])].sort().filter(k=>anteriores[k]!==actuales[k]);
}
export function permisoConstancia(usuarioId:number,roles:{preparadorId:number;revisorId:number;resolutorId:number}|undefined,elegibles:number[]){
 return !!roles&&new Set(Object.values(roles)).size===3&&roles.revisorId===usuarioId&&Object.values(roles).every(id=>elegibles.includes(id));
}
