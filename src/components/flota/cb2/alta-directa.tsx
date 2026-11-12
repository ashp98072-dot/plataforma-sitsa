"use client";
import { useState } from "react";
import { jsonCB2 } from "./client";
import { button, input } from "./controles";
export function AltaDirectaCB2({ api, recargar, disabled }: { api: string; recargar: () => Promise<unknown>; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [mensaje, setMensaje] = useState("");
  async function enviar(form: HTMLFormElement, recurso: "PILOTO" | "UNIDAD") {
    if (busy || disabled) return;
    setBusy(true); setMensaje("");
    try {
      const datos = Object.fromEntries(new FormData(form));
      const r = await jsonCB2<{ id: number; existente: boolean }>(`${api}/terceros`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recurso, ...datos }) });
      await recargar(); setMensaje(`${recurso} #${r.id}: ${r.existente ? "ya registrado" : "registrado"}. Selecciónalo en el catálogo.`);
    } catch (e) { setMensaje(e instanceof Error ? e.message : "No se pudo registrar."); }
    finally { setBusy(false); }
  }
  return <details><summary>Registrar piloto o unidad externa</summary><p>Consulta primero el catálogo. Usa una referencia real estable; el nombre o la placa no sustituyen la identidad.</p>
    <form aria-label="Alta directa de piloto" onSubmit={e => { e.preventDefault(); void enviar(e.currentTarget, "PILOTO"); }}><fieldset disabled={disabled || busy}><label>Referencia real del piloto<input className={input} name="referencia" required maxLength={160}/></label><label>Nombre externo<input className={input} name="nombre" required maxLength={160}/></label><button className={button}>Guardar piloto externo</button></fieldset></form>
    <form aria-label="Alta directa de unidad" onSubmit={e => { e.preventDefault(); void enviar(e.currentTarget, "UNIDAD"); }}><fieldset disabled={disabled || busy}><label>Referencia real de unidad<input className={input} name="referencia" required maxLength={160}/></label><label>Placa externa<input className={input} name="placa" required maxLength={160}/></label><label>Tipo externo<select className={input} name="tipo"><option>VEHICULO</option><option>MOTOCICLETA</option></select></label><label>Descripción externa<input className={input} name="descripcion" required maxLength={160}/></label><button className={button}>Guardar unidad externa</button></fieldset></form>
    {mensaje && <p role="status">{mensaje}</p>}
  </details>;
}
