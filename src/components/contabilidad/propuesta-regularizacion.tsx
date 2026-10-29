"use client";
import type {PropuestaRegularizacion} from '@/lib/contabilidad/propuesta-regularizacion';
import {ResultadoDiagnosticoCierre} from './cierre-diagnostico';
const texto:Record<string,string>={
 CUENTA_RESULTADO_NO_CONFIGURADA:'Falta configurar la cuenta de resultado del libro.',CUENTA_RESULTADO_INVALIDA:'La cuenta de resultado no cumple las validaciones técnicas.',
 CLASIFICACION_INSUFICIENTE:'Hay cuentas con clasificación desconocida.',NOMINALES_INACTIVAS_CON_SALDO:'Hay cuentas nominales inactivas con saldo.',
 PERIODOS_NO_CERRADOS:'Hay períodos abiertos o pendientes de cierre.',CONTROL_NO_ACTIVO:'Control de períodos no activo.',CONTROL_NO_DISPONIBLE:'Control de períodos no disponible.',
 ASIENTOS_DESCUADRADOS:'Hay asientos registrados descuadrados.',INTEGRIDAD_MOVIMIENTOS:'Hay movimientos con problemas de integridad.',DETALLES_HUERFANOS_LIBRO:'Hay detalles huérfanos en el libro.',
 CALCULO_NOMINAL_INCONSISTENTE:'Las inversas nominales no coinciden con el resultado preliminar.',PROPUESTA_DESCUADRADA:'La propuesta no cuadra.',
 POLITICA_REGULARIZACION_PENDIENTE:'La política formal de regularización no está aprobada.',IDONEIDAD_FORMAL_CUENTA_PENDIENTE:'La idoneidad formal e imputabilidad de la cuenta de resultado requieren aprobación.',
 IDENTIFICACION_REGULARIZACIONES_PREVIAS_PENDIENTE:'Pendiente definir cómo reconocer regularizaciones anteriores.',REGULARIZACIONES_PREVIAS_NO_IDENTIFICABLES:'El modelo no permite identificar inequívocamente regularizaciones previas; no se certifica su ausencia.',
 INDICIOS_REGULARIZACION_PREVIA:'La cuenta de resultado tiene movimientos en el ejercicio: pueden ser indicios de una regularización previa, pero no constituyen prueba.',
 SALDOS_NOMINALES_CONTRARIOS:'Hay saldos contrarios a su naturaleza habitual; se conserva el signo.',SIN_SALDOS_REGULARIZABLES:'No hay saldos nominales del ejercicio por neutralizar; no se propone un asiento de importe cero.',
 HISTORIA_ANTERIOR_AL_EJERCICIO:'Existe historia anterior: queda separada y excluida de esta propuesta.',REGULARIZACION_NO_VERIFICADA:'Regularización formal no verificada.',POLITICA_CIERRE_PENDIENTE:'Política de cierre pendiente.',SIN_ASIENTOS_REGISTRADOS:'No hay asientos registrados en el ejercicio.',ASIENTOS_NO_REGISTRADOS:'Borradores y otros estados excluidos de los importes.'
};
export function ResultadoPropuestaRegularizacion({d}:{d:PropuestaRegularizacion}){
 return <section aria-label="Propuesta simulada de regularización" className="space-y-3 rounded border border-[var(--border)] p-4">
  <h3 className="font-semibold">Propuesta de regularización · {String(d.ejercicio.codigo)}</h3>
  <p role="note" className="font-semibold">{d.avisoPropuesta}</p>
  <p>Empresa #{d.empresaId} · Libro #{d.entidadId} · Ejercicio #{d.ejercicioId}: {String(d.ejercicio.fechaInicio)} a {String(d.ejercicio.fechaFin)}</p>
  <p>Fecha: <time dateTime={d.generadoEn}>{d.generadoEn}</time></p>
  <p>Política {d.politica.version}: {d.politica.estado}. Tipos: {d.politica.tiposNominales.join(', ')}. Solo movimientos Registrados del ejercicio; sin saldos anteriores.</p>
  <p>{d.politica.tratamientoSignos}</p>
  <p>Cuenta de resultado: {d.cuentaResultado?`${d.cuentaResultado.codigo} — ${d.cuentaResultado.nombre}`:'no disponible'}</p>
  <p>Ingresos netos: {d.calculo.ingresos} · Gastos netos: {d.calculo.gastos} · Resultado preliminar: {d.calculo.resultadoPreliminar}</p>
  {!d.resultadoConfiable&&<p role="alert">Resumen parcial o con integridad pendiente; no usar como resultado validado.</p>}
  <p>Balance aritmético: {d.aritmeticamenteBalanceada?'comprobado':'no disponible'} · Validez técnica: {d.tecnicamenteValida?'sin bloqueantes detectados':'bloqueada'} · Política aprobada: NO · Contabilizada: NO · Lista para contabilizar: NO.</p>
  <h4 className="font-semibold">Bloqueantes técnicos</h4>
  {d.bloqueantesTecnicos.length?<ul>{d.bloqueantesTecnicos.map(c=><li key={c}>{texto[c]??c}</li>)}</ul>:<p>No se detectaron bloqueantes técnicos.</p>}
  <h4 className="font-semibold">Requisitos formales pendientes</h4><ul>{d.bloqueantesFormales.map(c=><li key={c}>{texto[c]??c}</li>)}</ul>
  <h4 className="font-semibold">Advertencias</h4><ul>{d.advertenciasPropuesta.map(c=><li key={c}>{texto[c]??c}</li>)}</ul>
  {d.propuestaSimulada?<><h4 className="font-semibold">Líneas simuladas en memoria</h4><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Cuenta</th><th>Origen</th><th>Debe</th><th>Haber</th></tr></thead><tbody>
   {d.propuestaSimulada.lineas.map(l=><tr key={l.cuentaId} className="border-t border-[var(--border)]"><td>{l.codigo} — {l.nombre}</td><td>{l.origen}</td><td>{l.debe}</td><td>{l.haber}</td></tr>)}
   <tr className="font-semibold"><td colSpan={2}>Totales</td><td>{d.propuestaSimulada.totales.debe}</td><td>{d.propuestaSimulada.totales.haber}</td></tr></tbody></table></div>
   <p>Diferencia: {d.propuestaSimulada.totales.diferencia}. {d.propuestaSimulada.hayMovimientos?'Cuadre solo de simulación.':'Sin líneas de importe cero.'}</p></>:<p>Propuesta no disponible por bloqueantes técnicos. No se fabrica una contrapartida.</p>}
  <details><summary>Diagnóstico C3C-5 de la misma instantánea</summary><ResultadoDiagnosticoCierre d={d.diagnostico}/></details>
 </section>;
}
