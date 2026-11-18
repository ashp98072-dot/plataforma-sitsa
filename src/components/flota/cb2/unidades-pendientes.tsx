"use client";
import { useState } from "react";
import { jsonCB2, type CatalogosCB2, type FilaCB2 } from "./client";
import { button, input } from "./controles";
import { placasPendientes, referenciaUnidadShell } from "./placas-pendientes";

/** Alta directa de unidades externas para placas desconocidas. Solo registra las filas donde la persona ELIGIÓ el tipo; no hay tipo por defecto. */
export function UnidadesPendientesCB2({ api, filas, cat, recargar, disabled }: { api: string; filas: FilaCB2[]; cat: CatalogosCB2; recargar: () => Promise<unknown>; disabled: boolean }) {
  const [tipos, setTipos] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [mensaje, setMensaje] = useState("");
  const { registrables, excluidas } = placasPendientes(filas, cat);
  if (!registrables.length && !excluidas.length) return null;
  const elegidas = registrables.filter(p => tipos[p.placa] && p.tipos.includes(tipos[p.placa] as "VEHICULO"));
  async function registrar() {
    if (busy || disabled || !elegidas.length) return;
    setBusy(true); setMensaje(""); let ok = 0; const fallos: string[] = [];
    for (const p of elegidas) {
      try { await jsonCB2(`${api}/terceros`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recurso: "UNIDAD", referencia: referenciaUnidadShell(p.placa), placa: p.placa, tipo: tipos[p.placa], descripcion: "Unidad externa registrada desde la importación Shell" }) }); ok++; }
      catch (e) { fallos.push(`${p.placa}: ${e instanceof Error ? e.message : "no se pudo registrar"}`); }
    }
    try { await recargar(); } catch { fallos.push("No se pudo actualizar el catálogo; recarga la página."); }
    setMensaje(`${ok} unidades externas registradas.${fallos.length ? ` Con error: ${fallos.join(" · ")}` : " Ya puedes asignarlas a sus filas."}`); setBusy(false);
  }
  return <section aria-label="Unidades pendientes de registro" className="space-y-2 rounded-xl border border-[var(--border)] p-3">
    <h4 className="font-semibold">Unidades que no existen en Flota</h4>
    <p className="text-xs">Elige el tipo de cada placa que sea realmente una unidad externa. No se registra nada que no hayas marcado.</p>
    <ul className="space-y-1">{registrables.map(p => <li key={p.placa} className="flex flex-wrap items-center gap-2"><span>{p.placa} · {p.filas} filas</span>
      <label>Tipo de {p.placa}<select className={input} disabled={disabled || busy} value={tipos[p.placa] ?? ""} onChange={e => setTipos(prev => ({ ...prev, [p.placa]: e.target.value }))}><option value="">Elegir tipo</option>{p.tipos.map(t => <option key={t} value={t}>{t === "VEHICULO" ? "Vehículo" : "Motocicleta"}</option>)}</select></label></li>)}</ul>
    {registrables.length > 0 && <button type="button" className={button} disabled={disabled || busy || !elegidas.length} onClick={() => void registrar()}>Registrar las {elegidas.length} unidades con tipo elegido</button>}
    {excluidas.length > 0 && <><p className="text-xs">No se registran automáticamente:</p><ul className="text-xs">{excluidas.map(x => <li key={x.texto}>«{x.texto}» ({x.filas} filas): {x.motivo}</li>)}</ul></>}
    {mensaje && <p role="status">{mensaje}</p>}
  </section>;
}
