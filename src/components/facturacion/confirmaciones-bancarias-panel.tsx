"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tieneAccionCatalogo, tienePermisoBase } from "@/lib/permisos-catalogo";

type Historial = { id:number; monto:string; fecha_acreditacion:string; banco:string; alias:string; referencia:string; confirmado_por:number; confirmado_nombre:string|null; confirmado_en:string; estado:string; tiene_evidencia:number; motivo_anulacion:string|null };
type Datos = { confirmaciones:Historial[]; cuentas:{id:number;banco:string;alias:string}[]; pagos:{id:number;monto:string;referencia:string|null}[]; cobros?:{id:number;monto:string;referencia:string|null}[]; totalConfirmadoActivo:string; saldoPendiente:string|null; bloqueo:string|null };
export function ConfirmacionesBancariasPanel({slug,facturaId}:{slug:string;facturaId:number}) {
  const { permisos,rol }=useEmpresaSession();
  const base=rol==="Admin"||tienePermisoBase(permisos,"facturacion");
  const puedeVer=base&&(rol==="Admin"||tieneAccionCatalogo(permisos,"facturacion","ver_confirmaciones_bancarias"));
  const puedeConfirmar=base&&(rol==="Admin"||tieneAccionCatalogo(permisos,"facturacion","confirmar_banco"));
  const puedeAnular=base&&(rol==="Admin"||tieneAccionCatalogo(permisos,"facturacion","anular_confirmacion"));
  const [datos,setDatos]=useState<Datos|null>(null),[error,setError]=useState(""),[mensaje,setMensaje]=useState(""),[busy,setBusy]=useState(false),[form,setForm]=useState(false);
  const [cuenta,setCuenta]=useState(""),[pago,setPago]=useState(""),[fecha,setFecha]=useState(""),[monto,setMonto]=useState(""),[referencia,setReferencia]=useState(""),[observaciones,setObservaciones]=useState(""),[archivo,setArchivo]=useState<File|null>(null);
  const key=useRef<string|null>(null);
  const url=`/api/empresas/${encodeURIComponent(slug)}/facturacion/facturas/${facturaId}/confirmaciones-bancarias`;
  const cargar=useCallback(async(signal?:AbortSignal)=>{
    try { const res=await fetch(url,{signal,cache:"no-store"}); const d=await res.json(); if(!res.ok) throw new Error(d.error??"No se pudo cargar el historial."); if(!signal?.aborted) {setDatos(d);setError("");} }
    catch(e) {if(!signal?.aborted) setError(e instanceof Error?e.message:"Error de conexión.");}
  },[url]);
  useEffect(()=>{
    if(!puedeVer) return;
    const c=new AbortController();
    // cargar solo modifica estado tras resolver fetch, igual que los paneles existentes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar(c.signal);
    return()=>c.abort();
  },[cargar,puedeVer]);
  if(!puedeVer) return null;
  async function confirmar(e:React.FormEvent) {
    e.preventDefault(); if(busy) return;
    setBusy(true);setError("");setMensaje("");
    key.current??=crypto.randomUUID();
    const data=new FormData();
    data.set("datos",JSON.stringify({cuentaBancariaId:Number(cuenta),pagoId:pago.startsWith("p")?Number(pago.slice(1)):null,cobroId:pago.startsWith("c")?Number(pago.slice(1)):null,fechaAcreditacion:fecha,monto,referencia,observaciones:observaciones||null,idempotencyKey:key.current}));
    if(archivo) data.set("evidencia",archivo);
    try {const res=await fetch(url,{method:"POST",body:data});const d=await res.json();if(!res.ok)throw new Error(d.error??"No se pudo confirmar.");
      key.current=null;setArchivo(null);setForm(false);setMonto("");setReferencia("");setObservaciones("");setMensaje("Ingreso bancario confirmado. No se generó asiento contable.");await cargar();
    }catch(e){setError(e instanceof Error?e.message:"Error de conexión. Reintenta sin cambiar los datos.");}finally{setBusy(false);}
  }
  async function anular(id:number) {
    const motivo=window.prompt("Motivo obligatorio de anulación");if(!motivo?.trim()||busy)return;
    setBusy(true);setError("");
    try {const res=await fetch(url+`/${id}/anular`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({motivo})});const d=await res.json();if(!res.ok)throw new Error(d.error??"No se pudo anular.");await cargar();}
    catch(e){setError(e instanceof Error?e.message:"Error de conexión.");}finally{setBusy(false);}
  }
  const cls="rounded border border-[var(--border)] bg-[var(--input)] p-2";
  return <section className="space-y-3 rounded border border-[var(--border)] p-3">
    <h4 className="font-semibold">Confirmaciones bancarias</h4>
    <p className="text-xs text-[var(--muted)]">Pago informado no equivale a ingreso bancario confirmado. Esta sección no genera asientos contables.</p>
    {error&&<p role="alert" className="text-rose-500">{error}</p>}{mensaje&&<p role="status">{mensaje}</p>}
    {datos&&<><p>Confirmado en banco: Q {datos.totalConfirmadoActivo}{datos.saldoPendiente!==null&&<> · Pendiente de confirmar: Q {datos.saldoPendiente}</>}</p>
      {datos.bloqueo?<p role="status">{datos.bloqueo}</p>:puedeConfirmar&&<button type="button" disabled={busy} onClick={()=>setForm(!form)} className={cls}>Confirmar ingreso bancario</button>}
      {form&&!datos.bloqueo&&<form onSubmit={confirmar} onChange={()=>{key.current=null;}}><fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
        <label>Cuenta bancaria<select required value={cuenta} onChange={e=>setCuenta(e.target.value)} className={cls}><option value="">Seleccionar cuenta</option>{datos.cuentas.map(c=><option key={c.id} value={c.id}>{c.banco} · {c.alias}</option>)}</select></label>
        <label>Pago informado (opcional)<select value={pago} onChange={e=>setPago(e.target.value)} className={cls}><option value="">Sin vínculo administrativo</option>{datos.pagos.map(p=><option key={`p${p.id}`} value={`p${p.id}`}>Pago #{p.id} · Q {p.monto}</option>)}{(datos.cobros??[]).map(k=><option key={`c${k.id}`} value={`c${k.id}`}>Cobro múltiple #{k.id} · aplicado Q {k.monto}</option>)}</select></label>
        <label>Fecha real de acreditación<input required type="date" value={fecha} onChange={e=>setFecha(e.target.value)} className={cls}/></label>
        <label>Monto confirmado (GTQ)<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:[.][0-9]{1,2})?" value={monto} onChange={e=>setMonto(e.target.value)} className={cls}/></label>
        <label>Referencia bancaria<input required maxLength={120} value={referencia} onChange={e=>setReferencia(e.target.value)} className={cls}/></label>
        <label>Observaciones<textarea maxLength={2000} value={observaciones} onChange={e=>setObservaciones(e.target.value)} className={cls}/></label>
        <label>Evidencia opcional (PDF/PNG/JPEG, 10 MB)<input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setArchivo(e.target.files?.[0]??null)}/></label>
        <button type="submit" className={cls}>{busy?"Confirmando…":"Confirmar ingreso"}</button>
      </fieldset></form>}
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{["Acreditación","Cuenta","Monto","Referencia","Confirmado por","Registro","Estado","Evidencia","Acción"].map(s=><th key={s} className="p-2 text-left">{s}</th>)}</tr></thead>
        <tbody>{datos.confirmaciones.map(c=><tr key={c.id}><td>{c.fecha_acreditacion}</td><td>{c.banco} · {c.alias}</td><td>Q {c.monto}</td><td>{c.referencia}</td><td>{c.confirmado_nombre??c.confirmado_por}</td><td>{c.confirmado_en}</td><td>{c.estado}{c.motivo_anulacion&&<p>{c.motivo_anulacion}</p>}</td><td>{!!c.tiene_evidencia&&<a href={url+`/${c.id}/evidencia`} className="underline">Descargar</a>}</td><td>{puedeAnular&&c.estado==="CONFIRMADA"&&<button disabled={busy} type="button" onClick={()=>void anular(c.id)}>Anular</button>}</td></tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
