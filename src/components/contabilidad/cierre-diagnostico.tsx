"use client";
import {useRef,useEffect,useState} from 'react';
import type {DiagnosticoCierre} from '@/lib/contabilidad/cierre-diagnostico';

const mensajes:Record<string,string>={
 PERIODOS_NO_CERRADOS:'Hay períodos abiertos o configurados pendientes de cierre.',
 CONTROL_NO_ACTIVO:'El control de períodos no está activo o su estado es inválido.',
 CONTROL_NO_DISPONIBLE:'El esquema del control de períodos no está disponible.',
 ASIENTOS_DESCUADRADOS:'Hay asientos registrados cuyo Debe y Haber no coinciden.',
 INTEGRIDAD_MOVIMIENTOS:'Hay asientos registrados incompletos, cuentas ausentes, vínculos incompatibles o importes inválidos.',
 DETALLES_HUERFANOS_LIBRO:'Hay detalles sin asiento válido en el libro completo; no se les puede atribuir fecha de ejercicio.',
 POLITICA_CIERRE_PENDIENTE:'Pendiente aprobar la política de cierre definitivo y apertura formal.',
 REGULARIZACION_NO_VERIFICADA:'No se verifica ni presume la regularización formal de ingresos, gastos y resultados.',
 HISTORIA_ANTERIOR_AL_EJERCICIO:'Existen asientos anteriores al ejercicio. Los saldos acumulados incluyen esa historia; no certifican arrastre ni apertura.',
 ASIENTOS_NO_REGISTRADOS:'Existen borradores u otros estados; se excluyen de los totales y del cuadre de registrados.',
 SIN_ASIENTOS_REGISTRADOS:'No hay asientos registrados en el ejercicio.',
 CALENDARIO_VACIO:'El ejercicio no tiene períodos.',COBERTURA:'Los períodos no cubren el ejercicio completo.',
 CONSECUTIVIDAD:'Hay huecos, solapamientos u orden incorrecto entre períodos.',
 SOLAPAMIENTO:'Hay períodos solapados.',PERIODO_INVALIDO:'Hay estados o fechas de períodos inválidos.'
};
export function ResultadoDiagnosticoCierre({d}:{d:DiagnosticoCierre}){
 return <section aria-label="Resultado del diagnóstico de cierre" className="space-y-3 rounded border border-[var(--border)] p-4">
  <h3 className="font-semibold">Diagnóstico de preparación: {String(d.ejercicio.codigo)}</h3>
  <p>Fecha: <time dateTime={d.generadoEn}>{d.generadoEn}</time></p>
  <p className="font-medium">{d.bloqueantes.length?'Con bloqueantes técnicos':'Sin bloqueantes técnicos detectados; no autoriza el cierre formal'}</p>
  <p className="text-sm">{d.alcance}</p>
  <h4 className="font-semibold">Bloqueantes ({d.bloqueantes.length})</h4>
  {d.bloqueantes.length?<ul className="list-disc pl-5">{d.bloqueantes.map(c=><li key={c}>{mensajes[c]??c}</li>)}</ul>:<p>No se detectaron bloqueantes técnicos.</p>}
  <h4 className="font-semibold">Advertencias</h4>
  <ul className="list-disc pl-5">{d.advertencias.map(c=><li key={c}>{mensajes[c]??c}</li>)}</ul>
  <p>Control: {d.control.estado} · Esquema: {d.control.disponible?'disponible':'no disponible'} · Versión: {d.control.version??'sin registro'}</p>
  <h4 className="font-semibold">Períodos del ejercicio</h4>
  <p>Abiertos: {d.abiertos.length} · Sin cerrar: {d.noCerrados.length}</p>
  <ul>{d.periodos.map(p=><li key={p.id}>{p.codigo}: {p.fechaInicio} a {p.fechaFin} · {p.estado}</li>)}</ul>
  <p>Asientos registrados: {d.asientos.registrados} · Otros estados: {d.asientos.noRegistrados}</p>
  <p>Debe: {d.asientos.debe} · Haber: {d.asientos.haber} · Diferencia: {d.asientos.diferencia}</p>
  <p>Detalles huérfanos en todo el libro: {d.detallesHuerfanosLibro} · Asientos anteriores al ejercicio: {d.asientosAnteriores}</p>
  {(['descuadrados','integridad'] as const).map(k=><div key={k}><h4 className="font-semibold">{k==='descuadrados'?'Asientos descuadrados':'Asientos con problemas de integridad'}: {d.asientos[k].total}</h4>
   <p className="text-xs">Se muestran como máximo 100 por categoría; los totales incluyen todos.</p>
   <ul>{d.asientos[k].muestra.map(a=><li key={a.id}>#{a.id} · {a.numero} · {a.fecha} · Debe {a.debe} / Haber {a.haber}</li>)}</ul></div>)}
 </section>;
}
export function DiagnosticoCierrePanel({slug,entidadId,ejercicioId}:{slug:string;entidadId:number;ejercicioId:string}){
 const [resultado,setResultado]=useState<DiagnosticoCierre>();const [error,setError]=useState('');const [ocupado,setOcupado]=useState(false);
 const actual=useRef<AbortController|null>(null);
 useEffect(()=>()=>actual.current?.abort(),[]);
 async function consultar(){
  actual.current?.abort();const ac=new AbortController();actual.current=ac;setOcupado(true);setError('');setResultado(undefined);
  try{const r=await fetch(`/api/empresas/${slug}/contabilidad/ejercicios/${ejercicioId}/diagnostico?entidad=${entidadId}`,{cache:'no-store',signal:ac.signal});const d=await r.json();
   if(!r.ok)throw Error(d.error??'No se pudo consultar el diagnóstico.');if(!ac.signal.aborted)setResultado(d);
  }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudo consultar.');}
  finally{if(!ac.signal.aborted)setOcupado(false);}
 }
 return <div className="space-y-3"><button type="button" disabled={ocupado} onClick={consultar} className="min-h-11 rounded border border-[var(--border)] bg-[var(--input)] px-3">{ocupado?'Consultando…':'Diagnosticar preparación de cierre'}</button>
  {ocupado&&<p role="status">Consultando la instantánea del ejercicio…</p>}{error&&<p role="alert">{error}</p>}{resultado&&<ResultadoDiagnosticoCierre d={resultado}/>}</div>;
}
