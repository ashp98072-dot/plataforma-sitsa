'use client';
import type {PeriodoReporte} from '@/lib/contabilidad/reportes/periodo';
export type OpcionPeriodo={id:number;codigo:string;ejercicio:string;fechaInicio:string;fechaFin:string;estado:string};
export function SelectorPeriodoReporte({periodos,value,onChange,disabled}:{periodos:OpcionPeriodo[];value:string;onChange:(value:string)=>void;disabled:boolean}){
  return <label className="block space-y-2 text-sm font-medium"><span className="block">Período contable</span>
    <select aria-describedby="periodo-reporte-ayuda" className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50" value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
      <option value="">Fechas manuales</option>{periodos.map(p=><option key={p.id} value={p.id}>{p.ejercicio} · {p.codigo} · {p.estado}</option>)}
    </select><span id="periodo-reporte-ayuda" className="block text-xs font-normal text-[var(--muted)]">El período fija ambas fechas. Puedes consultar períodos configurados, abiertos o cerrados.</span>
  </label>;
}
export function ResumenPeriodoReporte({periodo}:{periodo:PeriodoReporte}){
  return <section aria-label="Período del reporte generado" className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
    <h2 className="font-semibold">{periodo.ejercicio} · {periodo.codigo}</h2>
    <div className="flex flex-wrap gap-x-6 gap-y-2"><p>{periodo.desde} — {periodo.hasta}</p><p>Estado: <strong>{periodo.estado}</strong></p><p>Versión {periodo.version} · revisión de cierre {periodo.revisionCierre}</p></div>
    <p className="text-xs leading-relaxed text-[var(--muted)]">Movimientos por fecha de asiento en la instantánea de esta consulta. No modifica asientos históricos ni reproduce la evidencia de un cierre anterior. El saldo del Mayor continúa limitado al rango consultado.</p>
  </section>;
}
