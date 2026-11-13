"use client";
import { useState } from "react";
import { jsonCB2, type Registro } from "./client";
import { button,input } from "./controles";
import { contrastarFondo } from "@/lib/flota/cb2/fondos-model";
type Fondo={id:number;codigo:string;monto:string;fecha:string;persona:string|null;placa:string|null};
type Datos={estado:string;items:Fondo[];vinculo:{linea_id:number;snapshot:unknown;motivo:string}|null};
export function FondosConsumoCB2({api,r,canWrite,locked}:{api:string;r:Registro;canWrite:boolean;locked:boolean}) {
 const [datos,setDatos]=useState<Datos|null>(null),[buscar,setBuscar]=useState(""),[linea,setLinea]=useState(""),[motivo,setMotivo]=useState(""),[confirmado,setConfirmado]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const fondo=datos?.items.find(f=>String(f.id)===linea);
 const contraste=fondo?contrastarFondo({monto:String(r.monto),fecha:String(r.fecha_consumo).slice(0,10),piloto:String(r.piloto_informado??""),moneda:String(r.moneda)},{monto:fondo.monto,fecha:fondo.fecha,persona:fondo.persona??""}):null;
 async function cargar(){setBusy(true);setError("");setLinea("");setConfirmado(false);try{setDatos(await jsonCB2<Datos>(`${api}/fondos?proveedorId=${r.proveedor_id}&consumoId=${r.id}&buscar=${encodeURIComponent(buscar)}`));}catch(e){setError(e instanceof Error?e.message:"No se pudo consultar fondos.");}finally{setBusy(false);}}
 async function guardar(){if(!fondo||!confirmado||motivo.trim().length<10||busy||locked)return;setBusy(true);setError("");try{await jsonCB2(`${api}/fondos`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({proveedorId:r.proveedor_id,consumoId:r.id,lineaId:fondo.id,revision:Number(r.revision_asignacion??0),motivo:motivo.trim(),confirmado:true})});setDatos(await jsonCB2<Datos>(`${api}/fondos?proveedorId=${r.proveedor_id}&consumoId=${r.id}`));}catch(e){setError(e instanceof Error?e.message:"No se pudo vincular.");}finally{setBusy(false);}}
 return <div className="space-y-3"><p>Este consumo ya está registrado. Vincular fondos es opcional y no cambia el consumo ni autoriza pagos. Las diferencias se revisan manualmente.</p>
 <label>Buscar solicitud de fondos<input className={input} value={buscar} maxLength={100} disabled={busy} onChange={e=>setBuscar(e.target.value)}/></label><button className={button} type="button" disabled={busy} onClick={()=>void cargar()}>Consultar fondos</button>
 {error&&<p role="alert">{error}</p>}{datos&&<p role="status">Conciliación: {datos.estado.replaceAll("_"," ")}</p>}
 {datos?.vinculo?<details><summary>Vínculo manual con línea #{datos.vinculo.linea_id}</summary><p>{datos.vinculo.motivo}</p><pre className="whitespace-pre-wrap">{JSON.stringify(datos.vinculo.snapshot,null,2)}</pre><p>El vínculo conserva la evidencia revisada. Una asignación modificada requiere nueva revisión; no se reescribe automáticamente.</p></details>:datos&&canWrite&&<fieldset disabled={busy||locked}><label>Línea de fondos<select className={input} value={linea} onChange={e=>{setLinea(e.target.value);setConfirmado(false);}}><option value="">Seleccionar manualmente</option>{datos.items.map(f=><option key={f.id} value={f.id}>{f.codigo} · {f.placa??"Sin placa"} · {f.persona??"Sin persona"} · Q {f.monto} · {f.fecha}</option>)}</select></label>
 {contraste&&<p>Diferencias: {contraste.diferencias.join(", ")||"Sin diferencias en monto, fecha y persona"}. Diferencia contra esta línea: {contraste.diferenciaMonto??"Moneda no comparable"}. No representa el saldo total de la solicitud.</p>}
 <label>Motivo de revisión manual<textarea className={input} minLength={10} maxLength={1000} value={motivo} onChange={e=>{setMotivo(e.target.value);setConfirmado(false);}}/></label>
 <label><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/>Revisé la solicitud, el consumo y sus diferencias</label><button className={button} type="button" disabled={!fondo||!confirmado||motivo.trim().length<10} onClick={()=>void guardar()}>Vincular fondos sin cambiar el consumo</button></fieldset>}</div>;
}
