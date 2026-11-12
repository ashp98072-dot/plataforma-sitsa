"use client";
import { useEffect, useState } from "react";
import type { RevisionDuplicado, VehiculoRevision } from "@/lib/flota/vehiculos-duplicados";
import { jsonCB2 } from "./client";
import { button, input } from "./controles";
type Grupo = { placa: string; vehiculos: VehiculoRevision[] };
export function DuplicadosVehiculos({ api, activo, recargar }: { api: string; activo: boolean; recargar: () => void }) {
  const [grupos, setGrupos] = useState<Grupo[]>([]), [revision, setRevision] = useState<RevisionDuplicado | null>(null);
  const [error, setError] = useState(""), [mensaje, setMensaje] = useState(""), [busy, setBusy] = useState(false), [busqueda, setBusqueda] = useState(""), [refresh, setRefresh] = useState(0);
  const [conservar, setConservar] = useState(""), [motivo, setMotivo] = useState(""), [confirmado, setConfirmado] = useState(false);
  useEffect(() => {
    if (!activo) return;
    const ac = new AbortController();
    jsonCB2<Grupo[]>(api, { signal: ac.signal }).then(d => { if (!ac.signal.aborted) { setGrupos(d); setError(""); } }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [api, activo, refresh]);
  async function revisar(id: number) {
    if (busy) return; setBusy(true); setRevision(null); setError(""); setMensaje(""); setConfirmado(false); setConservar(""); setMotivo("");
    try { setRevision(await jsonCB2<RevisionDuplicado>(`${api}?id=${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudieron comprobar las referencias."); }
    finally { setBusy(false); }
  }
  async function desactivar(fusionar = false) {
    if (!revision || (!fusionar && !revision.puedeDesactivar) || busy || !confirmado) return;
    setBusy(true); setError("");
    try {
      await jsonCB2(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: revision.vehiculo.id, conservarId: Number(conservar), revision: revision.vehiculo.revision, motivo, confirmado, ...(fusionar ? { fusionar: true, destinoRevision: grupo?.vehiculos.find(v => v.id === Number(conservar))?.revision } : {}) }) });
      setMensaje(`Registro #${revision.vehiculo.id}: ${fusionar ? "fusionado por alias" : "desactivado"}. No se eliminaron ni reasignaron vínculos.`); setRevision(null); setRefresh(n => n + 1); recargar();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo desactivar."); setRevision(null); setRefresh(n => n + 1); }
    finally { setBusy(false); }
  }
  const grupo = grupos.find(g => g.vehiculos.some(v => v.id === revision?.vehiculo.id));
  return <section aria-label="Revisión administrativa de placas duplicadas" className="space-y-4"><h2 className="text-lg font-semibold">Placas duplicadas · revisión por ID</h2><p>La misma placa no demuestra que sea el mismo vehículo. Revisa características y referencias antes de declarar redundante un registro. Los catálogos propios y tercerizados permanecen separados. La fusión crea un alias solo entre vehículos propios con tipo y chasis real coincidentes; conserva sus IDs e históricos. Requiere migración auditada y activación del propietario.</p>
    <label>Buscar placa o ID<input className={input} value={busqueda} onChange={e => setBusqueda(e.target.value)}/></label>
    <button type="button" className={button} disabled={busy} onClick={() => { setRevision(null); setRefresh(n => n + 1); }}>Actualizar revisión</button>
    {busy && <p role="status">Comprobando referencias…</p>}{error && <p role="alert">{error}</p>}{mensaje && <p role="status">{mensaje}</p>}
    {!grupos.length && !error && <p>No se detectaron placas duplicadas en el catálogo accesible de esta empresa.</p>}
    {grupos.filter(g => `${g.placa} ${g.vehiculos.map(v => `${v.id} ${v.placa}`).join(" ")}`.toLowerCase().includes(busqueda.toLowerCase().replaceAll("-", "")) || g.vehiculos.some(v => v.placa.toLowerCase().includes(busqueda.toLowerCase()))).map(g => <section key={g.placa} className="rounded border border-[var(--border)] p-3"><h3 className="font-semibold">{g.placa} · {g.vehiculos.length} IDs</h3><ul>{g.vehiculos.map(v => <li key={v.id} className="my-3"><strong>{v.placa} · Registro #{v.id} · {v.tipo}</strong><p>{v.descripcion || "Sin descripción"} · {v.marca} {v.modelo} · Chasis: {v.chasis || "No registrado"}</p><p>Sucursal: {v.sucursal} · {v.estado} · {v.activo ? "Activo" : "Inactivo"} · {v.propio ? "Propio" : "Compartido; solo consulta"}</p><button type="button" className={button} disabled={busy} onClick={() => void revisar(v.id)}>Revisar referencias del ID #{v.id}</button></li>)}</ul></section>)}
    {revision && <section aria-label="Referencias y decisión administrativa" className="space-y-3 rounded border border-amber-600 p-4"><h3>Revisión del ID #{revision.vehiculo.id} · {revision.vehiculo.placa}</h3><ul>{revision.referencias.map((r, i) => <li key={i}>{r.tabla} · {r.campo} · {r.cantidad === null ? "Referencia detectada" : `${r.cantidad} referencias`}{r.ids.length ? ` · IDs: ${r.ids.map(id => `#${id}`).join(", ")}` : ""}</li>)}</ul>
      {revision.motivos.map(m => <p key={m}>{m}</p>)}
      {!revision.referencias.length && <p>No se detectaron referencias en las columnas de vehículo, FK y snapshots CB2 examinados. Se comprobarán nuevamente bajo bloqueo al guardar.</p>}
      {(revision.puedeDesactivar || revision.puedeFusionar) && <fieldset disabled={busy} className="space-y-3"><label>ID propio activo que se conserva<select className={input} value={conservar} onChange={e => { setConservar(e.target.value); setConfirmado(false); }}><option value="">Selecciona tras revisar ambos registros</option>{grupo?.vehiculos.filter(v => v.id !== revision.vehiculo.id && v.propio && v.activo && v.estado === "Activo").map(v => <option key={v.id} value={v.id}>#{v.id} · {v.placa} · {v.tipo} · {v.descripcion}</option>)}</select></label><label>Motivo de la revisión<textarea className={input} minLength={10} maxLength={1000} value={motivo} onChange={e => { setMotivo(e.target.value); setConfirmado(false); }}/></label><label><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)}/>Verifiqué que el ID #{revision.vehiculo.id} es redundante. Desactivar no fusiona IDs ni transfiere históricos.</label>{revision.puedeFusionar && <button type="button" className={button} disabled={!conservar || motivo.trim().length < 10 || !confirmado} onClick={() => void desactivar(true)}>Fusionar por alias preservando históricos</button>}<button type="button" className={button} disabled={!revision.puedeDesactivar || !conservar || motivo.trim().length < 10 || !confirmado} onClick={() => void desactivar()}>Desactivar únicamente ID #{revision.vehiculo.id}</button></fieldset>}
    </section>}
  </section>;
}
