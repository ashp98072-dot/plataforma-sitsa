import {simularRegularizacion} from './regularizacion';
import {construirPropuestaRegularizacion} from './propuesta-regularizacion-calculo';
/** Deriva todo de la única instantánea C3C-6; no abre conexiones ni escribe. */
export async function simularPropuestaRegularizacion(empresaId:number,entidadId:number,ejercicioId:number){
 const datos=await simularRegularizacion(empresaId,entidadId,ejercicioId);
 return {...datos,...construirPropuestaRegularizacion(datos)};
}
export type PropuestaRegularizacion=Awaited<ReturnType<typeof simularPropuestaRegularizacion>>;
