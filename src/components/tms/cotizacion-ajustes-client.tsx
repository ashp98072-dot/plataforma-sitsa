"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParametroAjustes, PerfilAjustes } from "@/lib/tms/cotizacion-costeo-ajustes";
import { DOCUMENTOS_EMISOR, MARCAS_DOCUMENTO, type DocumentoEmisor } from "@/lib/tms/cotizacion-documento";
import { CAMPOS_EXCEL_PARAMETROS } from "@/lib/tms/cotizacion-costeo-excel-campos";
import { CODIGOS_PERFIL_COSTEO } from "@/lib/tms/cotizacion-costeo";

type PresentacionMarca={mensaje:string;cierre:string};
type Presentacion=Record<DocumentoEmisor,PresentacionMarca>;
type Datos={hoy:string;parametros:ParametroAjustes[];perfiles:PerfilAjustes[];presentacion:Presentacion};
const cls="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const money=(v:number|null)=>v==null||!Number.isFinite(v)?"—":v.toLocaleString("es-GT",{style:"currency",currency:"GTQ"});
function CamposExcel({campos,valores,cambiar}:{campos:readonly {key:string;label:string;group:string}[];valores:Record<string,string>;cambiar:(key:string,value:string)=>void}){
 return <div className="md:col-span-3 space-y-3"><p className="text-xs">Cotizador 2026: vacío = sin configurar. No se inventan montos; estos valores son configurables y no están fijos en el cálculo.</p>{[...new Set(campos.map(c=>c.group))].map(grupo=><fieldset key={grupo} className="grid gap-3 rounded border border-[var(--border)] p-3 md:grid-cols-3"><legend>{grupo}</legend>{campos.filter(c=>c.group===grupo).map(c=><label key={c.key}>{c.label}<input type="number" min="0" step="any" className={cls+" block w-full"} value={valores[c.key]??""} onChange={e=>cambiar(c.key,e.target.value)}/></label>)}</fieldset>)}</div>;
}
export const decimalAPorcentaje=(v:number|null)=>v==null?"":String(v*100);
export const porcentajeADecimal=(v:string)=>v.trim()===""?null:Number(v)/100;
/** Plantilla de una NUEVA vigencia: la última configuración disponible (el servidor ordena por vigente_desde DESC, id DESC), incluida una futura ya programada. NO es la "Vigencia actual" del badge (esa la marca el servidor en cada fila con esVigenciaActual). */
export const ultimaVigencia=(parametros:ParametroAjustes[]|undefined)=>parametros?.[0];
export function formularioNuevaVigencia(p:ParametroAjustes|undefined,hoy:string):Record<string,string>{return {...Object.fromEntries(CAMPOS_EXCEL_PARAMETROS.map(c => [c.key, String(p?.[c.key] ?? "")])),vigenteDesde:hoy,precioCombustibleGalon:String(p?.precioCombustibleGalon??""),ivaTasa:decimalAPorcentaje(p?.ivaTasa??null),costoPilotoDia:String(p?.costoPilotoDia??0),costoAuxiliarDia:String(p?.costoAuxiliarDia??0),viaticoPilotoDia:String(p?.viaticoPilotoDia??0),viaticoAuxiliarDia:String(p?.viaticoAuxiliarDia??0),viaticoGuiaDia:String(p?.viaticoGuiaDia??0),hotelDia:p?.hotelDia?.toString()??"",margenObjetivo:decimalAPorcentaje(p?.margenObjetivo??null)};}
const vacioPerfil={salarioPilotoMensual:"",salarioAuxiliarMensual:"",viaticosHotelViaje:"",viajesMes:"20",precioLlanta:"",cantidadLlantas:"",codigo:"",nombre:"",activo:true,costoAdquisicion:"",diasOperacionMes:"30",gpsMensual:"0",seguroVehiculoMensual:"0",costoAceiteServicio:"0",vidaUtilAceiteKm:"",costoJuegoLlantas:"0",vidaUtilLlantasKm:"",rendimientoKmGalon:"",deprecValorBase:"",deprecAnios:"",deprecDiasOperacionMes:"",refrigValorBase:"",refrigAnios:"",refrigDiasOperacionMes:""};
type PerfilForm=typeof vacioPerfil;
/** Divisor interno de respaldo del equipo; el vigente es el global «Días depreciación» (referencia del Cotizador 2026: 26). */
const DIAS_DEPREC_RESPALDO="26";
/** Thermo solo aplica a perfiles refrigerados/personalizados: oculto en los perfiles normales (no es columna de las hojas del libro). */
export const mostrarThermoPerfil=(f:{codigo:string;refrigValorBase:string;refrigAnios:string;refrigDiasOperacionMes:string})=>f.refrigValorBase!==""||f.refrigAnios!==""||f.refrigDiasOperacionMes!==""||/REFRIGERADO/.test(f.codigo);
/** Campos visibles del perfil (los de respaldo histórico —costo de adquisición, días de operación, juego de llantas, divisor de depreciación— se conservan internamente y no se piden). */
export function gruposPerfil(f:PerfilForm):[string,(keyof PerfilForm)[]][]{
 return [
  ["Identificación",["codigo","nombre"]],
  ["Operación",["rendimientoKmGalon","gpsMensual","viajesMes"]],
  ["Mantenimiento",["costoAceiteServicio","vidaUtilAceiteKm","precioLlanta","cantidadLlantas","vidaUtilLlantasKm"]],
  ["Seguro",["seguroVehiculoMensual"]],
  ["Depreciación",["deprecValorBase","deprecAnios"]],
  ["Personal",["salarioPilotoMensual","salarioAuxiliarMensual","viaticosHotelViaje"]],
  ...(mostrarThermoPerfil(f)?[["Refrigeración / Thermo",["refrigValorBase","refrigAnios","refrigDiasOperacionMes"]] as [string,(keyof PerfilForm)[]]]:[]),
 ];
}
const ETIQUETAS_PERFIL: Partial<Record<keyof PerfilForm,string>> = {
 rendimientoKmGalon:"Rendimiento (km/galón)",gpsMensual:"GPS mensual (Q)",viajesMes:"Viajes estimados mensuales",
 costoAceiteServicio:"Costo cambio de aceite (Q)",vidaUtilAceiteKm:"Intervalo de aceite (km)",
 precioLlanta:"Precio por llanta (Q)",cantidadLlantas:"Cantidad de llantas",vidaUtilLlantasKm:"Vida útil de llantas (km)",
 seguroVehiculoMensual:"Seguro del vehículo mensual (Q)",
 deprecValorBase:"Valor del camión (Q)",deprecAnios:"Años de depreciación",
 salarioPilotoMensual:"Salario piloto mensual (Q)",salarioAuxiliarMensual:"Salario auxiliar mensual (Q)",viaticosHotelViaje:"Viáticos y hotel por viaje (Q)",
 refrigValorBase:"Valor Thermo (Q)",refrigAnios:"Años depreciación Thermo",
 refrigDiasOperacionMes:"Días depreciación Thermo (respaldo)",
};
const numero=(v:string)=>Number(v);const nullable=(v:string)=>v.trim()===""?null:Number(v);
export function payloadPerfil(f:PerfilForm){
 const conDesglose=f.precioLlanta.trim()!==""&&f.cantidadLlantas.trim()!=="";
 const conDeprec=f.deprecValorBase.trim()!=="";
 return {salarioPilotoMensual:nullable(f.salarioPilotoMensual),salarioAuxiliarMensual:nullable(f.salarioAuxiliarMensual),viaticosHotelViaje:nullable(f.viaticosHotelViaje),viajesMes:nullable(f.viajesMes),precioLlanta:nullable(f.precioLlanta),cantidadLlantas:nullable(f.cantidadLlantas),nombre:f.nombre.trim(),activo:f.activo,costoAdquisicion:nullable(f.costoAdquisicion),diasOperacionMes:numero(f.diasOperacionMes),gpsMensual:numero(f.gpsMensual),seguroVehiculoMensual:numero(f.seguroVehiculoMensual),costoAceiteServicio:numero(f.costoAceiteServicio),vidaUtilAceiteKm:numero(f.vidaUtilAceiteKm),
  // Con desglose precio×cantidad el juego histórico queda coherente (respaldo interno); sin desglose se conserva el valor existente.
  costoJuegoLlantas:conDesglose?Number(f.precioLlanta)*Number(f.cantidadLlantas):numero(f.costoJuegoLlantas),vidaUtilLlantasKm:numero(f.vidaUtilLlantasKm),rendimientoKmGalon:numero(f.rendimientoKmGalon),deprecValorBase:nullable(f.deprecValorBase),deprecAnios:nullable(f.deprecAnios),
  // El trío de depreciación exige los tres datos: el divisor de respaldo no se pide al usuario.
  deprecDiasOperacionMes:nullable(f.deprecDiasOperacionMes)??(conDeprec?Number(DIAS_DEPREC_RESPALDO):null),refrigValorBase:nullable(f.refrigValorBase),refrigAnios:nullable(f.refrigAnios),refrigDiasOperacionMes:nullable(f.refrigDiasOperacionMes)};}
export function formPerfil(p:PerfilAjustes):PerfilForm{return {salarioPilotoMensual:p.salarioPilotoMensual?.toString()??"",salarioAuxiliarMensual:p.salarioAuxiliarMensual?.toString()??"",viaticosHotelViaje:p.viaticosHotelViaje?.toString()??"",viajesMes:String(p.viajesMes ?? 20),precioLlanta:p.precioLlanta?.toString() ?? "",cantidadLlantas:p.cantidadLlantas?.toString() ?? "",codigo:p.codigo,nombre:p.nombre,activo:p.activo,costoAdquisicion:p.costoAdquisicion?.toString()??"",diasOperacionMes:String(p.diasOperacionMes),gpsMensual:String(p.gpsMensual),seguroVehiculoMensual:String(p.seguroVehiculoMensual),costoAceiteServicio:String(p.costoAceiteServicio),vidaUtilAceiteKm:String(p.vidaUtilAceiteKm),costoJuegoLlantas:String(p.costoJuegoLlantas),vidaUtilLlantasKm:String(p.vidaUtilLlantasKm),rendimientoKmGalon:String(p.rendimientoKmGalon),deprecValorBase:p.deprecValorBase?.toString()??"",deprecAnios:p.deprecAnios?.toString()??"",deprecDiasOperacionMes:p.deprecDiasOperacionMes?.toString()??"",refrigValorBase:p.refrigValorBase?.toString()??"",refrigAnios:p.refrigAnios?.toString()??"",refrigDiasOperacionMes:p.refrigDiasOperacionMes?.toString()??""};}

export function CotizacionAjustesClient({slug,puedeCrear,puedeEditar}:{slug:string;puedeCrear:boolean;puedeEditar:boolean}){
 const [datos,setDatos]=useState<Datos|null>(null),[error,setError]=useState(""),[msg,setMsg]=useState(""),[tab,setTab]=useState<"parametros"|"perfiles"|"presentacion">("parametros");
 const [pp,setPp]=useState<Presentacion|null>(null);
 // El formulario arranca (y se resincroniza) desde el último `datos.presentacion` cargado —
 // nunca desde un valor viejo si otra pestaña/sesión ya lo actualizó.
 useEffect(()=>{ if(datos?.presentacion){ // eslint-disable-next-line react-hooks/set-state-in-effect
 setPp(datos.presentacion); } },[datos]);
 async function guardarPresentacion(e:React.FormEvent){e.preventDefault();setError("");if(!pp)return;
   const r=await fetch(`/api/empresas/${slug}/tms/cotizaciones/ajustes/presentacion`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pp)});
   const j=await r.json();if(!r.ok){setError(j.error||"No se pudo guardar.");return;}
   setMsg("Presentación comercial guardada."); await cargar();
 }
 const [mostrarParametro,setMostrarParametro]=useState(false),[perfilId,setPerfilId]=useState<number|null>(null),[pf,setPf]=useState<PerfilForm>(vacioPerfil);
 const cargar=useCallback(async()=>{setError("");const r=await fetch(`/api/empresas/${slug}/tms/cotizaciones/ajustes`,{cache:"no-store"});const j=await r.json();if(!r.ok){setError(j.error||"No se pudo cargar.");return;}setDatos(j);},[slug]);
 useEffect(()=>{
   let vigente=true;
   void fetch(`/api/empresas/${slug}/tms/cotizaciones/ajustes`,{cache:"no-store"}).then(async r=>({r,j:await r.json()})).then(({r,j})=>{
     if(!vigente)return;
     if(!r.ok){setError(j.error||"No se pudo cargar.");return;}
     setDatos(j);
   }).catch(()=>{if(vigente)setError("No se pudo cargar.");});
   return()=>{vigente=false;};
 },[slug]);
 const plantillaVigencia=useMemo(()=>ultimaVigencia(datos?.parametros), [datos]);
 const [pa,setPa]=useState<Record<string,string>>({});
 function nuevaVigencia(){setPa(formularioNuevaVigencia(plantillaVigencia,datos?.hoy??""));setMostrarParametro(true);}
 async function guardarParametro(e:React.FormEvent){e.preventDefault();setError("");const body={...Object.fromEntries(CAMPOS_EXCEL_PARAMETROS.map(c => [c.key, nullable(pa[c.key] ?? "")])),vigenteDesde:pa.vigenteDesde,precioCombustibleGalon:numero(pa.precioCombustibleGalon),ivaTasa:porcentajeADecimal(pa.ivaTasa),costoPilotoDia:numero(pa.costoPilotoDia),costoAuxiliarDia:numero(pa.costoAuxiliarDia),viaticoPilotoDia:numero(pa.viaticoPilotoDia),viaticoAuxiliarDia:numero(pa.viaticoAuxiliarDia),viaticoGuiaDia:numero(pa.viaticoGuiaDia),hotelDia:nullable(pa.hotelDia),margenObjetivo:porcentajeADecimal(pa.margenObjetivo)};const r=await fetch(`/api/empresas/${slug}/tms/cotizaciones/ajustes/parametros`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok){setError(j.error||"No se pudo guardar.");return;}setMsg("Nueva vigencia creada.");setMostrarParametro(false);await cargar();}
 function editarPerfil(p?:PerfilAjustes){setPerfilId(p?.id??null);setPf(p?formPerfil(p):{...vacioPerfil});}
 async function guardarPerfil(e:React.FormEvent){e.preventDefault();setError("");const url=perfilId?`/api/empresas/${slug}/tms/cotizaciones/ajustes/perfiles/${perfilId}`:`/api/empresas/${slug}/tms/cotizaciones/ajustes/perfiles`;const body=perfilId?payloadPerfil(pf):{codigo:pf.codigo.trim().toUpperCase(),...payloadPerfil(pf)};const r=await fetch(url,{method:perfilId?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok){setError(j.error||"No se pudo guardar.");return;}setMsg(perfilId?"Perfil actualizado.":"Perfil creado.");setPerfilId(null);setPf(vacioPerfil);await cargar();}
 if(!datos&&!error)return <p className="p-6">Cargando ajustes…</p>;
 return <main className="space-y-4 p-6"><div><h1 className="text-2xl font-semibold">Ajustes de cotizaciones</h1><p className="text-sm text-[var(--muted-foreground)]">Los cambios aplican a nuevos cálculos. Los snapshots históricos no se modifican.</p></div>{error&&<p className="rounded border border-red-700 bg-red-950/40 p-3 text-red-200">{error}</p>}{msg&&<p className="rounded border border-emerald-700 bg-emerald-950/40 p-3 text-emerald-200">{msg}</p>}
 <div className="flex gap-2"><button className={cls} onClick={()=>setTab("parametros")}>Parámetros económicos</button><button className={cls} onClick={()=>setTab("perfiles")}>Perfiles de unidad</button><button className={cls} onClick={()=>setTab("presentacion")}>Presentación comercial</button></div>
 {tab==="presentacion"?<section className="space-y-4"><div><h2 className="font-semibold">Presentación comercial</h2><p className="text-xs text-[var(--muted-foreground)]">Mensaje introductorio y cierre PREDETERMINADOS del PDF de Cotizaciones, por marca. Son solo la plantilla al crear una cotización nueva — cambiarlos aquí NO modifica las cotizaciones ya guardadas (cada una conserva su propio texto).</p></div>
 {pp&&DOCUMENTOS_EMISOR.map(marca=><form key={marca} onSubmit={guardarPresentacion} className="grid gap-3 rounded border border-[var(--border)] p-4"><h3 className="font-semibold">{MARCAS_DOCUMENTO[marca].nombre}</h3>
   <label className="text-sm">Mensaje introductorio predeterminado<textarea rows={3} maxLength={2000} disabled={!puedeEditar} className={`${cls} block w-full`} value={pp[marca].mensaje} onChange={e=>setPp(x=>x&&({...x,[marca]:{...x[marca],mensaje:e.target.value}}))} placeholder={MARCAS_DOCUMENTO[marca].saludo}/></label>
   <label className="text-sm">Cierre / despedida predeterminado (opcional)<textarea rows={2} maxLength={2000} disabled={!puedeEditar} className={`${cls} block w-full`} value={pp[marca].cierre} onChange={e=>setPp(x=>x&&({...x,[marca]:{...x[marca],cierre:e.target.value}}))} placeholder={MARCAS_DOCUMENTO[marca].cierre}/></label>
   {puedeEditar&&<button className="btn-primary self-start">Guardar {MARCAS_DOCUMENTO[marca].nombre}</button>}
 </form>)}
 </section>
 :tab==="parametros"?<section className="space-y-3"><div className="flex justify-between"><h2 className="font-semibold">Vigencias</h2>{puedeCrear&&<button className="btn-primary" onClick={nuevaVigencia}>Nueva vigencia</button>}</div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Vigente desde</th><th>Combustible</th><th>IVA</th><th>Margen</th><th>Seguro mercadería anual</th><th>Flota</th><th>Viajes anuales</th></tr></thead><tbody>{datos?.parametros.map(p=><tr key={p.id}><td>{p.vigenteDesde} {p.esVigenciaActual&&<span className="rounded bg-emerald-800 px-1">Vigencia actual</span>}</td><td>{money(p.precioCombustibleGalon)}</td><td>{(p.ivaTasa*100).toLocaleString("es-GT")}%</td><td>{p.margenObjetivo==null?"—":`${(p.margenObjetivo*100).toLocaleString("es-GT")}%`}</td><td>{money(p.seguroMercaderiaAnual??null)}</td><td>{p.cantidadCamiones??"—"}</td><td>{p.viajesAnuales??"—"}</td></tr>)}</tbody></table></div>
 {mostrarParametro&&<form onSubmit={guardarParametro} className="grid gap-3 rounded border border-[var(--border)] p-4 md:grid-cols-3"><h3 className="md:col-span-3 font-semibold">Nueva vigencia (se insertará como historial nuevo)</h3>{[["vigenteDesde","Vigente desde","date"],["precioCombustibleGalon","Precio combustible predeterminado (Q/galón)","number"],["ivaTasa","IVA (%)","number"],["margenObjetivo","Margen objetivo único (%)","number"]].map(([k,l,t])=><label key={k} className="text-sm">{l}<input required={k!=='margenObjetivo'} type={t} step={t==="number"?"0.01":undefined} className={`${cls} block w-full`} value={pa[k]??""} onChange={e=>setPa(x=>({...x,[k]:e.target.value}))}/></label>)}<CamposExcel campos={CAMPOS_EXCEL_PARAMETROS} valores={pa} cambiar={(k,v)=>setPa(x=>({...x,[k]:v}))}/><div className="md:col-span-3 flex gap-2"><button className="btn-primary">Guardar vigencia</button><button type="button" className={cls} onClick={()=>setMostrarParametro(false)}>Cancelar</button></div></form>}</section>
 :<section className="space-y-3"><div className="flex justify-between"><h2 className="font-semibold">Perfiles de unidad</h2>{puedeCrear&&<button className="btn-primary" onClick={()=>editarPerfil()}>+ Nuevo perfil</button>}</div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th>Rendimiento</th><th>GPS</th><th>Seguro</th><th>Aceite</th><th>Llantas</th><th>Depreciación</th><th>Viáticos y hotel</th><th>Refrigeración</th><th></th></tr></thead><tbody>{datos?.perfiles.map(p=><tr key={p.id}><td>{p.codigo}</td><td>{p.nombre}</td><td>{p.activo?"Activo":"Inactivo"}</td><td>{p.rendimientoKmGalon.toLocaleString("es-GT")} km/gal</td><td>{money(p.gpsMensual)}</td><td>{money(p.seguroVehiculoMensual)}</td><td>{money(p.costoAceiteServicio)}</td><td>{money(p.precioLlanta!=null&&p.cantidadLlantas!=null?p.precioLlanta*p.cantidadLlantas:p.costoJuegoLlantas)}</td><td>{p.deprecValorBase==null?"No":money(p.deprecValorBase)}</td><td>{p.viaticosHotelViaje==null?"—":money(p.viaticosHotelViaje)}</td><td>{p.refrigValorBase==null?"No":money(p.refrigValorBase)}</td><td>{puedeEditar&&<button className={cls} onClick={()=>editarPerfil(p)}>Editar</button>}</td></tr>)}</tbody></table></div>
 {(perfilId!==null||pf!==vacioPerfil)&&<form onSubmit={guardarPerfil} className="grid gap-3 rounded border border-[var(--border)] p-4 md:grid-cols-3"><h3 className="md:col-span-3 font-semibold">{perfilId?"Editar perfil":"Nuevo perfil"}</h3>{gruposPerfil(pf).map(([grupo,campos])=><fieldset key={grupo} className="md:col-span-3 grid gap-3 rounded border border-[var(--border)] p-3 md:grid-cols-3"><legend>{grupo}</legend>{campos.map(k=><label key={k} className="text-sm">{ETIQUETAS_PERFIL[k]??k.replace(/([A-Z])/g," $1")}{k==="codigo"?<input className={`${cls} block w-full uppercase`} list="codigos-perfil-costeo" disabled={perfilId!==null} value={pf[k as keyof PerfilForm] as string} onChange={e=>setPf(x=>({...x,codigo:e.target.value.toUpperCase()}))}/>:<input className={`${cls} block w-full`} type={k==="nombre"?"text":"number"} step="0.001" value={pf[k as keyof PerfilForm] as string} onChange={e=>setPf(x=>({...x,[k]:e.target.value}))}/>}</label>)}</fieldset>)}<datalist id="codigos-perfil-costeo">{CODIGOS_PERFIL_COSTEO.map(c=><option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</datalist><p className="md:col-span-3 text-xs">GPS/viaje: {money(Number(pf.gpsMensual)/Number(pf.viajesMes||20))} · Aceite/km: {money(Number(pf.costoAceiteServicio)/Number(pf.vidaUtilAceiteKm))} · Llantas/km: {money((pf.precioLlanta!=="" && pf.cantidadLlantas!=="" ? Number(pf.precioLlanta)*Number(pf.cantidadLlantas) : Number(pf.costoJuegoLlantas))/Number(pf.vidaUtilLlantasKm))} · Seguro/día: {money(Number(pf.seguroVehiculoMensual)/30)} · Depreciación/día: {money(Number(pf.deprecValorBase)/Number(pf.deprecAnios)/12/Number(datos?.parametros.find(p=>p.esVigenciaActual)?.diasDepreciacionMes??pf.deprecDiasOperacionMes))}{mostrarThermoPerfil(pf)&&<> · Thermo/día: {money(Number(pf.refrigValorBase)/Number(pf.refrigAnios)/12/Number(datos?.parametros.find(p=>p.esVigenciaActual)?.diasDepreciacionMes??pf.refrigDiasOperacionMes))}</>}. La depreciación usa el divisor global vigente («Días depreciación»).</p><label className="flex items-center gap-2"><input type="checkbox" checked={pf.activo} onChange={e=>setPf(x=>({...x,activo:e.target.checked}))}/> Activo</label><div className="md:col-span-3 flex gap-2"><button className="btn-primary">Guardar perfil</button><button type="button" className={cls} onClick={()=>{setPerfilId(null);setPf(vacioPerfil);}}>Cancelar</button></div></form>}</section>}</main>;
}
