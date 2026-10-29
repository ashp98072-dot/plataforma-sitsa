import type {calcularRegularizacion} from './regularizacion-calculo';
import {aCentavos,deCentavos,totalizar} from './reportes/calculo';
type Entrada={empresaId:number;entidadId:number;ejercicioId:number;calculo:ReturnType<typeof calcularRegularizacion>;cuentaResultado:{id:number;codigo:string;nombre:string;tipo:string}|null;bloqueantes:string[];advertencias:string[];movimientoCuentaResultado?:{debe:string;haber:string}|null};
export type LineaPropuesta={cuentaId:number;codigo:string;nombre:string;origen:'NOMINAL'|'RESULTADO';debe:string;haber:string};
/** Contrato de simulación, sin autoridad aprobadora ni persistencia implícitas. */
export function construirPropuestaRegularizacion(d:Entrada){
 const politica={version:'C3C8-SIM-1',empresaId:d.empresaId,entidadId:d.entidadId,ejercicioId:d.ejercicioId,
  estado:'SIMULACION_PENDIENTE_APROBACION',tiposNominales:['Ingreso','Gasto'],base:'MOVIMIENTOS_REGISTRADOS_DEL_EJERCICIO',
  tratamientoSignos:'Invertir el neto Debe-Haber de cada nominal sin valores absolutos del resultado.',
  incluirHistoriaAnterior:false,cuentaResultadoId:d.cuentaResultado?.id??null,aprobada:false,
  decisionesPendientes:['POLITICA_REGULARIZACION_PENDIENTE','IDONEIDAD_FORMAL_CUENTA_PENDIENTE','IDENTIFICACION_REGULARIZACIONES_PREVIAS_PENDIENTE']};
 const bloqueantesTecnicos=d.bloqueantes.filter(c=>c!=='POLITICA_REGULARIZACION_PENDIENTE');
 if(!d.cuentaResultado&&!bloqueantesTecnicos.some(c=>c.startsWith('CUENTA_RESULTADO_')))bloqueantesTecnicos.push('CUENTA_RESULTADO_NO_CONFIGURADA');
 if(d.cuentaResultado?.tipo!=='Capital'&&d.cuentaResultado)bloqueantesTecnicos.push('CUENTA_RESULTADO_INVALIDA');
 if(!d.calculo.resultadoCompleto)bloqueantesTecnicos.push('CLASIFICACION_INSUFICIENTE');
 if(d.calculo.inactivasConSaldo.length)bloqueantesTecnicos.push('NOMINALES_INACTIVAS_CON_SALDO');
 const advertencias=[...d.advertencias,'REGULARIZACIONES_PREVIAS_NO_IDENTIFICABLES'];
 if(d.movimientoCuentaResultado&&(aCentavos(d.movimientoCuentaResultado.debe)!==BigInt(0)||aCentavos(d.movimientoCuentaResultado.haber)!==BigInt(0)))advertencias.push('INDICIOS_REGULARIZACION_PREVIA');
 let propuestaSimulada:{lineas:LineaPropuesta[];totales:ReturnType<typeof totalizar>;hayMovimientos:boolean}|null=null;
 if(!bloqueantesTecnicos.length&&d.cuentaResultado){
  const lineas:LineaPropuesta[]=d.calculo.nominales.filter(c=>aCentavos(c.saldoEjercicio)!==BigInt(0)).map(c=>({cuentaId:c.cuentaId,codigo:c.codigo,nombre:c.nombre,origen:'NOMINAL',...c.inversaIndicativa}));
  const t=totalizar(lineas);const diferencia=aCentavos(t.diferencia);
  // La contrapartida se deriva del neto nominal y debe coincidir con el resultado C3C-6.
  if(diferencia!==aCentavos(d.calculo.resultadoPreliminar))bloqueantesTecnicos.push('CALCULO_NOMINAL_INCONSISTENTE');
  else{
   if(diferencia!==BigInt(0))lineas.push({cuentaId:d.cuentaResultado.id,codigo:d.cuentaResultado.codigo,nombre:d.cuentaResultado.nombre,origen:'RESULTADO',debe:deCentavos(diferencia<BigInt(0)?-diferencia:BigInt(0)),haber:deCentavos(diferencia>BigInt(0)?diferencia:BigInt(0))});
   const totales=totalizar(lineas);
   if(!totales.cuadra)bloqueantesTecnicos.push('PROPUESTA_DESCUADRADA');
   else propuestaSimulada={lineas,totales,hayMovimientos:lineas.length>0};
   if(!lineas.length)advertencias.push('SIN_SALDOS_REGULARIZABLES');
  }
 }
 return {politica,propuestaSimulada,bloqueantesTecnicos:[...new Set(bloqueantesTecnicos)],
  bloqueantesFormales:politica.decisionesPendientes,advertenciasPropuesta:[...new Set(advertencias)],
  aritmeticamenteBalanceada:propuestaSimulada?.totales.cuadra??false,tecnicamenteValida:propuestaSimulada!==null,
  politicaAprobada:false,contabilizada:false,listaParaContabilizar:false,
  avisoPropuesta:'SIMULACIÓN — NO CONTABILIZADA. Política de simulación pendiente de aprobación; idoneidad formal de la cuenta no aprobada. No registra, aprueba ni ejecuta asientos. El cuadre aritmético no autoriza contabilizar.'};
}
