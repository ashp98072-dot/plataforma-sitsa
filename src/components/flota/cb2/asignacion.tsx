"use client";
import { AltaDirectaCB2 } from "./alta-directa";
import { pilotoDirecto, propuestaDirecta } from "./identidad-directa";
import { normalizarBusquedaUnidad } from "@/lib/flota/cb2/terceros-busqueda";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { clasificarProducto, identificarEmpleado, productos, etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
import type { CatalogosCB2, FilaCB2 } from "./client";
import { input } from "./controles";
import { politicaIndependiente, pilotoIndependiente, unidadIndependiente } from "./piloto-independiente";
export type DecisionAsignacion = { decisionNombre?:import("@/lib/flota/cb2/pilotos-nombres").DecisionNombre; pilotoTipo?: "INTERNO" | "EXTERNO" | "REPORTADO"; pilotoExternoId?: number | null; unidadExternaId?: number | null; exigirProducto?: boolean; empleadoId?: number | null; productoClasificado?: Producto; motivoUnidad?: string; asociacionExternaId?: number | null };
export function AsignacionCB2({ fila, cat, value, onChange, disabled, api, actualizarCatalogos }: { fila: FilaCB2; cat: CatalogosCB2; value: DecisionAsignacion; onChange: (v: DecisionAsignacion) => void; disabled: boolean; api?: string; actualizarCatalogos?: () => Promise<unknown> }) {
    const match = identificarEmpleado(fila.origen?.piloto ?? "", cat.empleados ?? []);
    const empleado = value.empleadoId === undefined ? match.propuesta?.id : value.empleadoId;
    const producto = value.productoClasificado ?? clasificarProducto(fila.origen?.producto);
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
    return <div className="space-y-4">{fila.perfil==="SHELL" && <p>Nombre original: {fila.origen?.piloto || "No informado"}. Revisa y confirma el nombre en el panel común; se aplica a todo el archivo.</p>}
        {independiente && fila.perfil!=="SHELL" && <fieldset disabled={disabled}><legend>Piloto reportado y vinculacion opcional</legend>
          <label>Tipo de piloto<select className={input} value={value.pilotoTipo??piloto?.tipo??""} onChange={e=>onChange({...value,pilotoTipo:e.target.value as "INTERNO"|"EXTERNO"|"REPORTADO",empleadoId:null,pilotoExternoId:null,asociacionExternaId:null})}><option value="">Vinculacion automatica opcional</option><option value="REPORTADO">Conservar solo el nombre reportado</option><option value="INTERNO">De la empresa</option><option value="EXTERNO">Tercerizado</option></select></label>
          <CatalogoSearchSelect label={`Piloto de la empresa para vale ${fila.vale}`} placeholder="Buscar piloto interno" inputClassName={input} value={piloto?.tipo==="INTERNO"?String(piloto.id):""} options={(cat.empleados??[]).map(p=>({value:String(p.id),label:p.nombre}))} onChange={v=>onChange({...value,pilotoTipo:"INTERNO",empleadoId:v?Number(v):null,pilotoExternoId:null,asociacionExternaId:null})}/>
          <CatalogoSearchSelect label={`Piloto tercerizado para vale ${fila.vale}`} placeholder="Buscar piloto externo" inputClassName={input} value={piloto?.tipo==="EXTERNO"?String(piloto.id):""} options={pilotos.map(p=>({value:String(p.id),label:p.nombre,detail:p.referencia}))} onChange={v=>onChange({...value,pilotoTipo:"EXTERNO",pilotoExternoId:v?Number(v):null,empleadoId:null,asociacionExternaId:null})}/>
        </fieldset>}
        {fila.perfil!=="SHELL" && cat.tercerosDirectos && api && actualizarCatalogos && <AltaDirectaCB2 api={api} recargar={actualizarCatalogos} disabled={disabled}/>}
        {cat.tercerosHabilitados && <fieldset disabled={disabled} className="space-y-3"><legend>Identidades tercerizadas registradas</legend>
          {!independiente && fila.perfil!=="SHELL" && <CatalogoSearchSelect label={`Piloto tercerizado para vale ${fila.vale}`} placeholder="Buscar nombre o referencia" value={pilotoId ? String(pilotoId) : ""} inputClassName={input} options={pilotos.map(p => ({ value: String(p.id), label: p.nombre, detail: `Tercerizado #${p.id} · ${p.referencia}` }))} onChange={v => elegir(v ? Number(v) : null, unidadId)}/>}
          <CatalogoSearchSelect normalizarBusqueda={normalizarBusquedaUnidad} label={`Unidad tercerizada para vale ${fila.vale}`} placeholder="Buscar placa o referencia" value={unidadId ? String(unidadId) : ""} inputClassName={input} options={unidades.map(u => ({ value: String(u.id), label: u.placa, detail: `Tercerizada #${u.id} · ${u.tipo} · ${u.referencia} · ${u.descripcion}` }))} onChange={v => elegir(pilotoId, v ? Number(v) : null)}/>
          {!cat.tercerosDirectos && (pilotoId || unidadId) && !externa && <p role="status">Terceros directos deshabilitados en la configuración del servidor. Se mantiene el flujo anterior. Identidad registrada. Consumo PENDIENTE: selecciona ambas identidades y una asociación VERIFICADA por otro administrador. Revisa pendientes o revocadas en Tercerizados.</p>}
        </fieldset>}
        {!cat.tercerosDirectos && cat.tercerosHabilitados && <label>Asociación tercerizada verificada<select className={input} disabled={disabled} value={value.asociacionExternaId === undefined ? fila.asociacionExterna?.id ?? "" : value.asociacionExternaId ?? ""} onChange={e => onChange({ ...value, empleadoId: null, pilotoExternoId: undefined, unidadExternaId: undefined, asociacionExternaId: e.target.value ? Number(e.target.value) : null })}><option value="">Sin asociación externa</option>{(cat.terceros ?? []).filter(a => a.estado === "VERIFICADA").map(a => <option key={a.id} value={a.id}>{a.nombre} · piloto #{a.piloto_id} · {a.placa} · {a.tipo} · unidad #{a.unidad_id} · {a.descripcion}</option>)}</select></label>}
        <p>Piloto original: {fila.origen?.piloto || "No informado"}. {match.estado}: {match.motivo}.</p>
        <p>Candidatos: {match.candidatos.map(p => p.nombre).join(" / ") || "Sin coincidencia"}</p>
        <p>{value.empleadoId !== undefined ? "Elección manual" : match.metodo === "TOKENS_COMPLETOS_UNICOS" ? "Autopropuesta única por tokens completos" : match.propuesta ? "Autopropuesta exacta única" : "Sin vinculo de catalogo (opcional)"}: {(cat.empleados ?? []).find(p => p.id === empleado)?.nombre ?? "Sin empleado vinculado"}</p>
        {cat.tercerosDirectos ? <p>{independiente ? "Piloto y unidad independientes:" : "Terceros directos:"} el servidor valida ambos IDs en esta empresa al confirmar. No se exige asociación.</p> : externa ? <p>Piloto externo verificado: {externa.nombre} · identidad #{externa.piloto_id} · {externa.relacion}. No se vincula a empleados.</p> : fila.perfil!=="SHELL" && <CatalogoSearchSelect label={`Empleado para vale ${fila.vale}`} placeholder="Buscar empleado de la empresa" inputClassName={input} value={empleado ? String(empleado) : ""} options={(cat.empleados ?? []).map(p => ({ value: String(p.id), label: p.nombre }))} onChange={v => onChange({ ...value, empleadoId: v ? Number(v) : null })}/>}
        <p>Producto original: {fila.origen?.producto || "No informado"}. No se infiere por proveedor o placa.</p>
        <label>Combustible para vale {fila.vale}<select className={input} disabled={disabled} value={producto ?? ""} onChange={e => onChange({ ...value, productoClasificado: e.target.value ? e.target.value as Producto : undefined })}><option value="">Clasificar obligatoriamente</option>{productos.map(p => <option key={p} value={p}>{etiquetasProducto[p]}</option>)}</select></label>
        <label>Justificación de unidad manual (solo si no coincide)<textarea className={input} disabled={disabled} minLength={10} maxLength={1000} value={value.motivoUnidad ?? ""} onChange={e => onChange({ ...value, motivoUnidad: e.target.value })}/></label><p>Una unidad distinta requiere justificación de al menos 10 caracteres y acceso vigente. La confirmación guarda la decisión y la evidencia original por separado.</p>
    </div>;
}
