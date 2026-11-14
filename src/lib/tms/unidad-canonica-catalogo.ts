/** Catálogo operativo; no mueve IDs de planes ni agrupa unidades solo por placa. */
export function unidadesTmsVisibles<T extends {id:unknown;flota_vehiculo_id?:unknown}>(unidades:T[],flota:{id:unknown;identidadCanonica?:unknown;equivalenciasHistoricas?:unknown}[]) {
 const mapa=new Map<number,{clave:string;canon:number}>();
 for(const v of flota){const canon=Number(v.id),clave=String(v.identidadCanonica??'FLOTA:'+canon);for(const id of [canon,...(Array.isArray(v.equivalenciasHistoricas)?v.equivalenciasHistoricas.map(Number):[])])mapa.set(id,{clave,canon});}
 const elegidas=new Map<string,T>();
 for(const u of unidades){const id=Number(u.flota_vehiculo_id);if(!id){elegidas.set('TMS:'+u.id,u);continue;}const grupo=mapa.get(id);if(!grupo)continue;const previa=elegidas.get(grupo.clave);if(!previa || (Number(previa.flota_vehiculo_id)!==grupo.canon && id===grupo.canon) || (Number(previa.flota_vehiculo_id)===id && Number(u.id)<Number(previa.id)))elegidas.set(grupo.clave,u);}
 return [...elegidas.values()];
}
