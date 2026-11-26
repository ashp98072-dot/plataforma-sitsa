"use client";
import { useState } from "react";
import { jsonCB2, type CatalogosCB2, type Registro } from "./client";
import { button } from "./controles";

type Proveedor = { proveedorId: number; pendientes: { id: number; revision: number }[]; identificados: number; conflictos: number; conflictoIds: number[] };
type Vista = { nombre: string; empleado: { id: number; nombre: string }; empresaId: number; proveedores: Proveedor[] };
type Resultado = { proveedorId: number; actualizados: number; repetidos: number };

export function IdentificarHistoricos({ api, r, cat, empleado, motivo }: { api: string; r: Registro; cat: CatalogosCB2; empleado: string; motivo: string }) {
  const [todos, setTodos] = useState(false), [recordar, setRecordar] = useState(false), [vista, setVista] = useState<Vista | null>(null), [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [resultados, setResultados] = useState<Resultado[]>([]), [equivalencia, setEquivalencia] = useState<{ requiereRevision: boolean } | null>(null);
  const [claves, setClaves] = useState<Record<number, string>>({});
  const nombre = String(r.piloto_informado ?? "");
  const post = <T,>(ruta: string, datos: unknown) => jsonCB2<T>(`${api}/${ruta}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  async function consultar() {
    setBusy(true); setError(""); setConfirmado(false); setResultados([]); setEquivalencia(null);
    try {
      const v = await post<Vista>("identificacion-vista", { nombre, empleadoId: Number(empleado), ...(!todos ? { consumoId: r.id } : {}) });
      setVista(v); setClaves(Object.fromEntries(v.proveedores.map(p => [p.proveedorId, crypto.randomUUID().replaceAll("-", "")])));
    } catch (e) { setVista(null); setError(e instanceof Error ? e.message : "No se pudo consultar."); }
    finally { setBusy(false); }
  }
  async function aplicar() {
    if (!vista || !confirmado) return;
    setBusy(true); setError("");
    try {
      for (const p of vista.proveedores) {
        if (!p.pendientes.length || resultados.some(x => x.proveedorId === p.proveedorId)) continue;
        const resultado = await post<Resultado>("identificacion-confirmar", { nombre, empleadoId: Number(empleado), ...(!todos ? { consumoId: r.id } : {}), proveedorId: p.proveedorId, items: p.pendientes, motivo: motivo.trim(), clave: claves[p.proveedorId] });
        setResultados(prev => [...prev, resultado]);
      }
      if (recordar && !equivalencia) {
        const guardada = await post<{ requiereRevision: boolean }>("identificacion-recordar", { nombre, empleadoId: Number(empleado), proveedorId: Number(r.proveedor_id) });
        setEquivalencia(guardada);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo confirmar. Reintenta la misma solicitud."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-2 rounded border p-3" aria-label="Identificación de piloto">
    <h4>Identificar piloto histórico</h4><p>Solo cambia el vínculo del piloto; conserva el nombre original y los demás datos.</p>
    <label><input type="radio" checked={!todos} onChange={() => { setTodos(false); setVista(null); }} disabled={busy}/> Solo este consumo</label>{" "}
    <label><input type="radio" checked={todos} onChange={() => { setTodos(true); setVista(null); }} disabled={busy}/> Todos los consumos pendientes con este nombre</label>
    <label className="block"><input type="checkbox" checked={recordar} onChange={e => { setRecordar(e.target.checked); setConfirmado(false); }} disabled={busy}/> Recordar equivalencia para futuras importaciones</label>
    <button type="button" className={button} onClick={() => void consultar()} disabled={busy || !nombre.trim() || !empleado}>Consultar vista previa</button>
    {vista && <div className="space-y-2"><p>Empresa #{vista.empresaId}. Original: {vista.nombre}. Empleado: {vista.empleado.nombre} #{vista.empleado.id}.</p>
      {vista.proveedores.map(p => <p key={p.proveedorId}>{cat.proveedores.find(x => x.id === p.proveedorId)?.nombre ?? `Proveedor #${p.proveedorId}`}: {p.pendientes.length} pendientes a actualizar, {p.identificados} ya identificados, {p.conflictos} conflictos excluidos{p.conflictos ? ` (consumos ${p.conflictoIds.map(id => `#${id}`).join(", ")})` : ""}.</p>)}
      {!vista.proveedores.length && <p>No hay consumos coincidentes.</p>}
      <label className="block"><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} disabled={busy}/> Confirmo la identificación indicada</label>
      <button type="button" className={button} disabled={busy || !confirmado || motivo.trim().length < 10 || (!recordar && vista.proveedores.every(p => !p.pendientes.length))} onClick={() => void aplicar()}>Confirmar identificación</button>
      {resultados.map(x => <p key={x.proveedorId}>Proveedor #{x.proveedorId}: {x.actualizados} actualizados, {x.repetidos} ya procesados en este intento.</p>)}{equivalencia && <p>{equivalencia.requiereRevision ? "Equivalencia guardada: requiere revisión en futuras importaciones." : "Equivalencia guardada."}</p>}
    </div>}{error && <p role="alert">{error}</p>}
  </section>;
}
