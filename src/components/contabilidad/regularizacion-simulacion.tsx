"use client";
import {useEffect,useRef,useState} from 'react';
import type {SimulacionRegularizacion} from '@/lib/contabilidad/regularizacion';
import {ResultadoDiagnosticoCierre} from './cierre-diagnostico';
const mensajes:Record<string,string>={
 CUENTA_RESULTADO_NO_CONFIGURADA:'No existe un rol configurado para la cuenta de resultado del ejercicio. Debe aprobarse su identificación y validación por empresa/libro.',
 POLITICA_REGULARIZACION_PENDIENTE:'Pendiente aprobar alcance y política de regularización. No se infieren ajustes previos ni se certifica ausencia de regularizaciones ya registradas.',
 CLASIFICACION_INSUFICIENTE:'Hay cuentas sin clasificación reconocida. El resumen solo incluye tipos exactos Ingreso/Gasto y puede ser parcial.',
 NOMINALES_INACTIVAS_CON_SALDO:'Hay cuentas nominales inactivas con saldo; se incluyen en los cálculos, pero requieren revisión.',
 SALDOS_NOMINALES_CONTRARIOS:'Hay saldos contrarios a la naturaleza habitual; se conserva el signo y no se aplican valores absolutos.'
};
export function ResultadoRegularizacion({d}:{d:SimulacionRegularizacion}){
 return <section aria-label="Simulación de regularización" className="space-y-3 rounded border border-[var(--border)] p-4">
  <h3 className="font-semibold">Simulación: {String(d.ejercicio.codigo)} · {String(d.ejercicio.fechaInicio)} a {String(d.ejercicio.fechaFin)}</h3>
  <p role="note" className="font-semibold">{d.aviso}</p>
  <p>Fecha: <time dateTime={d.generadoEn}>{d.generadoEn}</time> · Estado: {d.estado}</p>
  <p>Ingresos netos: {d.calculo.ingresos} · Gastos netos: {d.calculo.gastos} · Resultado preliminar: {d.calculo.resultadoPreliminar}</p>
  {!d.resultadoConfiable&&<p role="alert">Resultado parcial o con integridad pendiente. No utilizar como resultado validado del ejercicio.</p>}
  <p>Cuenta de resultado: no configurada. Propuesta de asiento completo: no disponible.</p>
  <h4 className="font-semibold">Bloqueantes</h4>
  <ul className="list-disc pl-5">{d.bloqueantes.map(c=><li key={c}>{mensajes[c]??`Ver diagnóstico técnico: ${c}`}</li>)}</ul>
  <h4 className="font-semibold">Advertencias de simulación</h4>
  <ul className="list-disc pl-5">{d.advertencias.filter(c=>mensajes[c]).map(c=><li key={c}>{mensajes[c]}</li>)}</ul>
  <h4 className="font-semibold">Cuentas nominales e inversas indicativas (sin contrapartida)</h4>
  <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Cuenta','Tipo','Debe del ejercicio','Haber del ejercicio','Saldo del ejercicio D-H','Saldo anterior separado','Debe inverso indicativo','Haber inverso indicativo'].map(t=><th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
   <tbody>{d.calculo.nominales.map(c=><tr key={c.cuentaId} className="border-t border-[var(--border)]"><td>{c.codigo} · {c.nombre}{c.activa===1?'':' (inactiva)'}</td><td>{c.tipo}</td><td>{c.debe}</td><td>{c.haber}</td><td>{c.saldoEjercicio}</td><td>{c.saldoHistoricoAnterior}</td><td>{c.inversaIndicativa.debe}</td><td>{c.inversaIndicativa.haber}</td></tr>)}</tbody></table></div>
  {!d.calculo.nominales.length&&<p>No hay cuentas clasificadas como Ingreso o Gasto.</p>}
  {d.calculo.sinClasificar.length>0&&<div><h4>Cuentas pendientes de clasificación</h4><ul>{d.calculo.sinClasificar.map(c=><li key={c.cuentaId}>{c.codigo} · {c.nombre} · Tipo: {c.tipo} · Debe {c.debe} / Haber {c.haber}</li>)}</ul></div>}
  <details><summary>Diagnóstico C3C-5 de la misma instantánea</summary><ResultadoDiagnosticoCierre d={d.diagnostico}/></details>
 </section>;
}
export function RegularizacionPanel({slug,entidadId,ejercicioId}:{slug:string;entidadId:number;ejercicioId:string}){
 const [resultado,setResultado]=useState<SimulacionRegularizacion>();const [error,setError]=useState('');const [ocupado,setOcupado]=useState(false);
 const actual=useRef<AbortController|null>(null);useEffect(()=>()=>actual.current?.abort(),[]);
 async function consultar(){
  actual.current?.abort();const ac=new AbortController();actual.current=ac;setOcupado(true);setError('');setResultado(undefined);
  try{const r=await fetch(`/api/empresas/${slug}/contabilidad/ejercicios/${ejercicioId}/simulacion-regularizacion?entidad=${entidadId}`,{cache:'no-store',signal:ac.signal});const d=await r.json();
   if(!r.ok)throw Error(d.error??'No se pudo simular.');if(!ac.signal.aborted)setResultado(d);
  }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudo consultar.');}finally{if(!ac.signal.aborted)setOcupado(false);}
 }
 return <div className="space-y-3"><button type="button" disabled={ocupado} onClick={consultar} className="min-h-11 rounded border border-[var(--border)] bg-[var(--input)] px-3">{ocupado?'Simulando…':'Simular regularización (solo lectura)'}</button>
  {ocupado&&<p role="status">Consultando movimientos del ejercicio…</p>}{error&&<p role="alert">{error}</p>}{resultado&&<ResultadoRegularizacion d={resultado}/>}</div>;
}
