import {aCentavos,deCentavos} from './reportes/calculo';

export type CuentaSimulacion={cuentaId:number;codigo:string;nombre:string;tipo:string;activa:number;debe:string;haber:string;debeAnterior:string;haberAnterior:string};
/** Solo se interpretan tipos exactos del catálogo. No se infieren roles por códigos o nombres. */
export function calcularRegularizacion(cuentas:CuentaSimulacion[]){
 let ingresos=BigInt(0),gastos=BigInt(0);
 const sinClasificar=cuentas.filter(c=>!['Activo','Pasivo','Capital','Ingreso','Gasto'].includes(c.tipo));
 const nominales=cuentas.filter(c=>c.tipo==='Ingreso'||c.tipo==='Gasto').map(c=>{
  const saldo=aCentavos(c.debe)-aCentavos(c.haber);
  if(c.tipo==='Ingreso')ingresos-=saldo;else gastos+=saldo;
  return {...c,saldoEjercicio:deCentavos(saldo),saldoHistoricoAnterior:deCentavos(aCentavos(c.debeAnterior)-aCentavos(c.haberAnterior)),
   inversaIndicativa:{debe:deCentavos(saldo<BigInt(0)?-saldo:BigInt(0)),haber:deCentavos(saldo>BigInt(0)?saldo:BigInt(0))}};
 });
 return {ingresos:deCentavos(ingresos),gastos:deCentavos(gastos),resultadoPreliminar:deCentavos(ingresos-gastos),
  resultadoCompleto:sinClasificar.length===0,nominales,sinClasificar,
  inactivasConSaldo:nominales.filter(c=>Number(c.activa)!==1&&aCentavos(c.saldoEjercicio)!==BigInt(0)).map(c=>c.cuentaId),
  saldosContrarios:nominales.filter(c=>c.tipo==='Ingreso'?aCentavos(c.saldoEjercicio)>BigInt(0):aCentavos(c.saldoEjercicio)<BigInt(0)).map(c=>c.cuentaId)};
}
