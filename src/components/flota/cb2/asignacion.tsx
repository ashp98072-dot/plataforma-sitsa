"use client";
import { etiquetaEmpleado } from "@/lib/flota/cb2/empleados-baja";
import { AltaDirectaCB2 } from "./alta-directa";
import { pilotoDirecto, propuestaDirecta } from "./identidad-directa";
import { normalizarBusquedaUnidad } from "@/lib/flota/cb2/terceros-busqueda";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { clasificarProducto, identificarEmpleado, productos, etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
import type { CatalogosCB2, FilaCB2 } from "./client";
import { input } from "./controles";
import { PilotoShellVale, CasillaPilotoReportado, etiquetaTipoPiloto } from "./revision-nombres";
import { UnidadShellVale } from "./unidad-shell-vale";
import type { DecisionNombre, RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";
import { politicaIndependiente, pilotoIndependiente, unidadIndependiente } from "./piloto-independiente";
import { placaCompatible } from "@/lib/flota/combustible-coincidencias";
export type DecisionAsignacion = { usarEquivalenciaPlaca?: boolean; recordarPlaca?: boolean; decisionNombre?:import("@/lib/flota/cb2/pilotos-nombres").DecisionNombre; pilotoTipo?: "INTERNO" | "EXTERNO" | "REPORTADO"; pilotoExternoId?: number | null; unidadExternaId?: number | null; exigirProducto?: boolean; /** Shell: el vale no está LISTO hasta resolver el piloto (empleado o piloto reportado confirmado). */exigirPiloto?: boolean; empleadoId?: number | null; productoClasificado?: Producto; motivoUnidad?: string; asociacionExternaId?: number | null };
export function AsignacionCB2({ fila, cat, value, onChange, disabled, api, actualizarCatalogos, nombre, onNombre, vehiculoId = "", onUnidad }: { vehiculoId?: string; onUnidad?: (valor: string) => void; nombre?: RevisionNombre; onNombre?: (d: DecisionNombre) => void; fila: FilaCB2; cat: CatalogosCB2; value: DecisionAsignacion; onChange: (v: DecisionAsignacion) => void; disabled: boolean; api?: string; actualizarCatalogos?: () => Promise<unknown> }) {
    const match = identificarEmpleado(fila.origen?.piloto ?? "", cat.empleados ?? []);
    const empleado = value.empleadoId === undefined ? match.propuesta?.id : value.empleadoId;
    const producto = value.productoClasificado ?? clasificarProducto(fila.origen?.producto);
    const unidadElegida = cat.vehiculos.find(v => String(v.id) === vehiculoId && v.id > 0);
    const placaDistinta = !!unidadElegida && !placaCompatible(fila.placaNormalizada || fila.placa, unidadElegida.id, cat.vehiculos);
    const independiente = politicaIndependiente(cat), piloto = independiente ? pilotoIndependiente(fila,cat,value) : null;
    const externa = cat.terceros?.find(a => a.estado === "VERIFICADA" && a.id === (value.asociacionExternaId === undefined ? fila.asociacionExterna?.id : value.asociacionExternaId));
    const pilotos = cat.pilotosExternos ?? [...new Map((cat.terceros ?? []).map(a => [a.piloto_id, { id: a.piloto_id, nombre: a.nombre, referencia: a.piloto_referencia }])).values()];
    const unidades = cat.unidadesExternas ?? [...new Map((cat.terceros ?? []).map(a => [a.unidad_id, { id: a.unidad_id, placa: a.placa, referencia: a.unidad_referencia, tipo: a.tipo, descripcion: a.descripcion }])).values()];
    const pilotoId = independiente ? piloto?.tipo==="EXTERNO" ? piloto.id : null : value.pilotoExternoId === undefined ? (cat.tercerosDirectos ? pilotoDirecto(fila, cat)?.id : externa?.piloto_id) : value.pilotoExternoId;
    const unidadPropuesta = independiente ? unidadIndependiente(fila,cat) : null;
    const unidadId = value.unidadExternaId === undefined ? (independiente ? unidadPropuesta && unidadPropuesta.id<0 ? -unidadPropuesta.id : null : cat.tercerosDirectos ? propuestaDirecta(fila, cat)?.unidad.id : externa?.unidad_id) : value.unidadExternaId;
    function elegir(p: number | null | undefined, u: number | null | undefined) {
        if (independiente) { onChange({...value,unidadExternaId:u??null,asociacionExternaId:null}); return; }
        const asociaciones = (cat.terceros ?? []).filter(a => a.piloto_id === p && a.unidad_id === u && a.estado === "VERIFICADA");
        onChange({ ...value, empleadoId: null, pilotoExternoId: p ?? null, unidadExternaId: u ?? null, asociacionExternaId: !cat.tercerosDirectos && asociaciones.length === 1 ? asociaciones[0].id : null });
    }
    return <div className="space-y-4">{fila.perfil==="SHELL" && <PilotoShellVale original={fila.origen?.piloto ?? ""} nombre={nombre} decision={value.decisionNombre} externo={value.pilotoTipo==="EXTERNO"?pilotos.find(p=>p.id===value.pilotoExternoId)?.nombre:undefined} empleados={cat.empleados} instalado={!!cat.pilotosReportados} disabled={disabled} onElegir={onNombre ?? (() => undefined)}/>}
        {<UnidadShellVale parte="estado" fila={fila} cat={cat} vehiculoId={vehiculoId} api={api} recargar={actualizarCatalogos} onUnidad={onUnidad} disabled={disabled}/>}
        {independiente && fila.perfil==="SHELL" && <fieldset disabled={disabled}><legend>Piloto tercerizado (opcional)</legend><p className="text-xs">Solo si el piloto es una identidad externa registrada. Para empleados o piloto reportado usa «Piloto del Excel».</p>
          <CatalogoSearchSelect label={`Piloto tercerizado para vale ${fila.vale}`} placeholder="Buscar piloto externo" inputClassName={input} value={value.pilotoTipo==="EXTERNO"&&value.pilotoExternoId?String(value.pilotoExternoId):""} options={pilotos.map(p=>({value:String(p.id),label:p.nombre,detail:p.referencia}))} onChange={v=>onChange(v?{...value,decisionNombre:undefined,pilotoTipo:"EXTERNO",pilotoExternoId:Number(v),empleadoId:null,asociacionExternaId:null}:{...value,decisionNombre:undefined,pilotoTipo:undefined,pilotoExternoId:null,empleadoId:null,asociacionExternaId:null})}/>
        </fieldset>}
        {independiente && fila.perfil!=="SHELL" && <fieldset disabled={disabled}><legend>Piloto reportado y vinculacion opcional</legend>
          <label>Tipo de piloto<select className={input} value={value.pilotoTipo??piloto?.tipo??""} onChange={e=>onChange({...value,decisionNombre:undefined,pilotoTipo:e.target.value as "INTERNO"|"EXTERNO"|"REPORTADO",empleadoId:null,pilotoExternoId:null,asociacionExternaId:null})}><option value="">Vinculacion automatica opcional</option><option value="REPORTADO">Conservar solo el nombre reportado</option><option value="INTERNO">De la empresa</option><option value="EXTERNO">Tercerizado</option></select></label>
          <CatalogoSearchSelect label={`Piloto de la empresa para vale ${fila.vale}`} placeholder="Buscar piloto interno" inputClassName={input} value={piloto?.tipo==="INTERNO"?String(piloto.id):""} options={(cat.empleados??[]).map(p=>({value:String(p.id),label:p.estado==="Baja"?etiquetaEmpleado(p):p.nombre}))} onChange={v=>onChange({...value,decisionNombre:fila.perfil==="SHELL" && v?{tipo:"EMPLEADO",empleadoId:Number(v),confirmado:true}:undefined,pilotoTipo:"INTERNO",empleadoId:v?Number(v):null,pilotoExternoId:null,asociacionExternaId:null})}/>
          {!!cat.pilotosReportados && !!onNombre && piloto?.tipo!=="INTERNO" && value.pilotoTipo!=="EXTERNO" && <CasillaPilotoReportado nombre={nombre} decision={value.decisionNombre} instalado={!!cat.pilotosReportados} disabled={disabled} onElegir={onNombre}/>}
          <CatalogoSearchSelect label={`Piloto tercerizado para vale ${fila.vale}`} placeholder="Buscar piloto externo" inputClassName={input} value={piloto?.tipo==="EXTERNO"?String(piloto.id):""} options={pilotos.map(p=>({value:String(p.id),label:p.nombre,detail:p.referencia}))} onChange={v=>onChange({...value,decisionNombre:undefined,pilotoTipo:"EXTERNO",pilotoExternoId:v?Number(v):null,empleadoId:null,asociacionExternaId:null})}/>
        </fieldset>}
        {cat.tercerosDirectos && api && actualizarCatalogos && <AltaDirectaCB2 api={api} recargar={actualizarCatalogos} disabled={disabled} soloPiloto={fila.perfil==="SHELL"}/>}
        {cat.tercerosHabilitados && fila.perfil!=="SHELL" && <fieldset disabled={disabled} className="space-y-3"><legend>Identidades tercerizadas registradas</legend>
          {!independiente && <CatalogoSearchSelect label={`Piloto tercerizado para vale ${fila.vale}`} placeholder="Buscar nombre o referencia" value={pilotoId ? String(pilotoId) : ""} inputClassName={input} options={pilotos.map(p => ({ value: String(p.id), label: p.nombre, detail: `Tercerizado #${p.id} · ${p.referencia}` }))} onChange={v => elegir(v ? Number(v) : null, unidadId)}/>}
          <CatalogoSearchSelect normalizarBusqueda={normalizarBusquedaUnidad} label={`Unidad tercerizada para vale ${fila.vale}`} placeholder="Buscar placa o referencia" value={unidadId ? String(unidadId) : ""} inputClassName={input} options={unidades.map(u => ({ value: String(u.id), label: u.placa, detail: `Tercerizada #${u.id} · ${u.tipo} · ${u.referencia} · ${u.descripcion}` }))} onChange={v => elegir(pilotoId, v ? Number(v) : null)}/>
          {!cat.tercerosDirectos && (pilotoId || unidadId) && !externa && <p role="status">Terceros directos deshabilitados en la configuración del servidor. Se mantiene el flujo anterior. Identidad registrada. Consumo PENDIENTE: selecciona ambas identidades y una asociación VERIFICADA por otro administrador. Revisa pendientes o revocadas en Tercerizados.</p>}
        </fieldset>}
        {!cat.tercerosDirectos && cat.tercerosHabilitados && <label>Asociación tercerizada verificada<select className={input} disabled={disabled} value={value.asociacionExternaId === undefined ? fila.asociacionExterna?.id ?? "" : value.asociacionExternaId ?? ""} onChange={e => onChange({ ...value, empleadoId: null, pilotoExternoId: undefined, unidadExternaId: undefined, asociacionExternaId: e.target.value ? Number(e.target.value) : null })}><option value="">Sin asociación externa</option>{(cat.terceros ?? []).filter(a => a.estado === "VERIFICADA").map(a => <option key={a.id} value={a.id}>{a.nombre} · piloto #{a.piloto_id} · {a.placa} · {a.tipo} · unidad #{a.unidad_id} · {a.descripcion}</option>)}</select></label>}
        {fila.perfil!=="SHELL" && <>
        <p>Piloto original: {fila.origen?.piloto || "No informado"}. {match.estado}: {match.motivo}.</p>
        <p>Candidatos: {match.candidatos.map(p => etiquetaEmpleado(p)).join(" / ") || "Sin coincidencia"}</p>
        {/* Mismo registro de pilotos reportados que Shell: un piloto que no está en RR. HH. se guarda una vez y se reconoce solo en futuras importaciones (HALEL y Shell). */}
        {!independiente && !!cat.pilotosReportados && !!onNombre && empleado == null && value.pilotoTipo !== "EXTERNO" && <div className="space-y-1"><p data-estado-piloto><strong>{etiquetaTipoPiloto(value.decisionNombre)}</strong></p>
          <CasillaPilotoReportado nombre={nombre} decision={value.decisionNombre} instalado={!!cat.pilotosReportados} disabled={disabled} onElegir={onNombre}/></div>}
        <p>{value.empleadoId !== undefined ? "Elección manual" : match.metodo === "TOKENS_COMPLETOS_UNICOS" ? "Autopropuesta única por tokens completos" : match.propuesta ? "Autopropuesta exacta única" : "Sin vinculo de catalogo (opcional)"}: {(cat.empleados ?? []).find(p => p.id === empleado)?.nombre ?? "Sin empleado vinculado"}</p>
        </>}
        {cat.tercerosDirectos ? <p>{independiente ? "Piloto y unidad independientes:" : "Terceros directos:"} el servidor valida ambos IDs en esta empresa al confirmar. No se exige asociación.</p> : externa ? <p>Piloto externo verificado: {externa.nombre} · identidad #{externa.piloto_id} · {externa.relacion}. No se vincula a empleados.</p> : fila.perfil!=="SHELL" && <CatalogoSearchSelect label={`Empleado para vale ${fila.vale}`} placeholder="Buscar empleado de la empresa" inputClassName={input} value={empleado ? String(empleado) : ""} options={(cat.empleados ?? []).map(p => ({ value: String(p.id), label: p.nombre }))} onChange={v => onChange({ ...value, empleadoId: v ? Number(v) : null })}/>}
        <p>Producto original: {fila.origen?.producto || "No informado"}. No se infiere por proveedor o placa.</p>
        <label>Combustible para vale {fila.vale}<select className={input} disabled={disabled} value={producto ?? ""} onChange={e => onChange({ ...value, productoClasificado: e.target.value ? e.target.value as Producto : undefined })}><option value="">Clasificar obligatoriamente</option>{productos.map(p => <option key={p} value={p}>{etiquetasProducto[p]}</option>)}</select></label>
        {placaDistinta && <p role="status">Placa reportada: {fila.placa || "Sin placa"}. Unidad seleccionada: {unidadElegida.placa} — #{unidadElegida.id}. La selección es provisional hasta confirmar la importación.</p>}
        <label>Justificación de unidad manual (solo si no coincide)<textarea className={input} disabled={disabled} minLength={10} maxLength={1000} value={value.motivoUnidad ?? ""} onChange={e => onChange({ ...value, motivoUnidad: e.target.value })}/></label><p>Una unidad distinta requiere justificación de al menos 10 caracteres y acceso vigente. La confirmación guarda la decisión y la evidencia original por separado.</p>
        {placaDistinta && <label><input type="checkbox" disabled={disabled} checked={!!value.recordarPlaca} onChange={e => onChange({ ...value, recordarPlaca: e.target.checked })}/> Recordar esta equivalencia para futuras importaciones de este proveedor</label>}
    </div>;
}
