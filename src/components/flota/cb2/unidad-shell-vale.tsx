"use client";
import { useRef, useState } from "react";
import { jsonCB2, type CatalogosCB2, type FilaCB2 } from "./client";
import { input } from "./controles";
import { placasPendientes, referenciaUnidadShell } from "./placas-pendientes";
import { claseUnidadShell } from "./unidad-shell";

/**
 * Unidad del vale Shell: INTERNA (vehículo de Flota), EXTERNA (identidad persistente, sin vehículo ficticio) o NO IDENTIFICADA (se conserva el valor original).
 * Confirmar una unidad externa registra su identidad reutilizable (referencia derivada de la placa; auditoría con quién la confirmó) y la deja elegida.
 * El tipo (vehículo/motocicleta) lo elige la persona; las placas sospechosas o sin forma de placa no se registran.
 */
export function UnidadShellVale({ fila, cat, vehiculoId, api, recargar, onUnidad, disabled, parte = "todo" }: { /** «estado»: explicación de la unidad (panel derecho); «casilla»: solo la casilla de unidad externa (panel «Unidad y placa»); «todo»: ambos. */ parte?: "todo" | "estado" | "casilla"; fila: FilaCB2; cat: CatalogosCB2; vehiculoId: string; api?: string; recargar?: () => Promise<unknown>; onUnidad?: (valor: string) => void; disabled?: boolean }) {
  const [tipo, setTipo] = useState(""), [busy, setBusy] = useState(false), [mensaje, setMensaje] = useState(""), enCurso = useRef(false);
  const c = claseUnidadShell(fila, cat, vehiculoId), p = placasPendientes([fila], cat).registrables[0];
  const habilitado = !!cat.tercerosDirectos && !!api && !!recargar;
  async function confirmarExterna() {
    if (enCurso.current || disabled || !habilitado || !p || !tipo) return;   // la referencia evita el doble envío aunque React aún no haya redibujado
    enCurso.current = true; setBusy(true); setMensaje("");
    try {
      const r = await jsonCB2<{ id: number; existente?: boolean }>(`${api}/terceros`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recurso: "UNIDAD", referencia: referenciaUnidadShell(p.placa), placa: p.placa, tipo, descripcion: `Unidad externa confirmada desde un vale Shell. Placa original en Excel: «${fila.placa}»` }) });
      await recargar!();
      onUnidad?.(String(-r.id)); setMensaje(r.existente ? "La unidad externa ya estaba registrada; se reutilizó su identidad." : "Unidad externa registrada y elegida para este vale.");
    } catch (e) { setMensaje(e instanceof Error ? e.message : "No se pudo registrar la unidad externa."); }
    finally { enCurso.current = false; setBusy(false); }
  }
  // La casilla solo existe si la placa NO está en Flota ni entre las unidades externas, tiene forma de placa y las políticas CB2 permiten registrarla.
  const casillaVisible = c.clase === "NO_IDENTIFICADA" && !vehiculoId && c.registrable && !!p && habilitado;
  if (parte === "casilla") {
    if (!casillaVisible && !mensaje) return null;
    return <section aria-label={`Unidad externa del vale ${fila.vale}`} className="space-y-1">
      {casillaVisible && p && <fieldset disabled={disabled || busy} className="space-y-1"><label>Tipo de unidad externa para {fila.placa}<select className={input} value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Elegir tipo</option>{p.tipos.map(t => <option key={t} value={t}>{t === "VEHICULO" ? "Vehículo" : "Motocicleta"}</option>)}</select></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={false} disabled={!tipo || busy} onChange={e => { if (e.target.checked) void confirmarExterna(); }}/><span>Guardar como unidad externa para futuras importaciones</span></label>
        <p className="text-xs">No crea ningún vehículo en Flota: guarda una identidad externa reutilizable en futuras importaciones y reportes.</p></fieldset>}
      {mensaje && <p role="status" className="text-xs">{mensaje}</p>}
    </section>;
  }
  return <section aria-label={`Clasificación de la unidad del vale ${fila.vale}`} className="space-y-1">
    <p role="status"><strong>{c.clase === "INTERNA" ? "Unidad interna" : c.clase === "EXTERNA" ? "Unidad externa" : c.clase === "AMBIGUA" ? "Unidad ambigua" : c.clase === "NO_IDENTIFICADA" ? "Unidad no identificada" : "Unidad por confirmar"}</strong>: {c.mensaje}</p>
    {c.clase === "NO_IDENTIFICADA" && !vehiculoId && (c.registrable && p
      ? habilitado
        ? parte === "estado" ? null : <fieldset disabled={disabled || busy} className="space-y-1"><label>Tipo de unidad externa para {fila.placa}<select className={input} value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Elegir tipo</option>{p.tipos.map(t => <option key={t} value={t}>{t === "VEHICULO" ? "Vehículo" : "Motocicleta"}</option>)}</select></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={false} disabled={!tipo || busy} onChange={e => { if (e.target.checked) void confirmarExterna(); }}/><span>Guardar como unidad externa para futuras importaciones</span></label>
          <p className="text-xs">No crea ningún vehículo en Flota: guarda una identidad externa reutilizable en futuras importaciones y reportes.</p></fieldset>
        : <p className="text-xs">El registro de unidades externas está deshabilitado por configuración del servidor; la activación corresponde al propietario.</p>
      : c.motivoNoRegistrable && <p role="alert" className="text-xs">{c.motivoNoRegistrable}</p>)}
    {parte !== "estado" && mensaje && <p role="status" className="text-xs">{mensaje}</p>}
  </section>;
}
