"use client";
import { useState } from "react";
import { jsonCB2, type CatalogosCB2, type Registro } from "./client";
import { button } from "./controles";

type Proveedor = { proveedorId: number; pendientes: { id: number; revision: number }[]; identificados: number; conflictos: number; conflictoIds: number[] };
type Vista = { nombre: string; empleado: { id: number; nombre: string }; empresaId: number; proveedores: Proveedor[] };
type Resultado = { proveedorId: number; actualizados: number; repetidos: number; lote: number };
type Lote = { proveedorId: number; items: Proveedor["pendientes"]; clave: string; lote: number };
type Plan = { vista: Vista; todos: boolean; recordar: boolean; lotes: Lote[]; resultados: Resultado[]; equivalencia: { requiereRevision: boolean } | null };
const TAMANO_LOTE = 250;

export function IdentificarHistoricos({ api, r, cat, empleado, motivo }: { api: string; r: Registro; cat: CatalogosCB2; empleado: string; motivo: string }) {
  const storageKey = `cb2-identificacion:${api}:${r.id}:${empleado}:${motivo}`;
  const [plan, setPlan] = useState<Plan | null>(() => { try { const raw = sessionStorage.getItem(storageKey); return raw ? JSON.parse(raw) as Plan : null; } catch { return null; } });
  const [anteriores, setAnteriores] = useState<Resultado[]>(() => { try { return JSON.parse(sessionStorage.getItem(`${storageKey}:resultados`) ?? "[]") as Resultado[]; } catch { return []; } });
  const [todos, setTodos] = useState(() => plan?.todos ?? false), [recordar, setRecordar] = useState(() => plan?.recordar ?? false), [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [persistencia, setPersistencia] = useState(true);
  const nombre = String(r.piloto_informado ?? "");
  function guardarPlan(p: Plan | null) { setPlan(p); try { if (p) sessionStorage.setItem(storageKey, JSON.stringify(p)); else sessionStorage.removeItem(storageKey); setPersistencia(true); return true; } catch { setPersistencia(false); return false; } }
  const post = <T,>(ruta: string, datos: unknown) => jsonCB2<T>(`${api}/${ruta}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
  async function consultar() {
    setBusy(true); setError(""); setConfirmado(false);
    try {
      const vista = await post<Vista>("identificacion-vista", { nombre, empleadoId: Number(empleado), ...(!todos ? { consumoId: r.id } : {}) });
      const lotes = vista.proveedores.flatMap(p => Array.from({ length: Math.ceil(p.pendientes.length / TAMANO_LOTE) }, (_, lote) => ({ proveedorId: p.proveedorId, lote, items: p.pendientes.slice(lote * TAMANO_LOTE, (lote + 1) * TAMANO_LOTE), clave: crypto.randomUUID().replaceAll("-", "") })));
      guardarPlan({ vista, todos, recordar, lotes, resultados: [], equivalencia: null });
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo consultar."); }
    finally { setBusy(false); }
  }
  async function aplicar() {
    if (!plan || !confirmado) return;
    setBusy(true); setError(""); let actual = plan;
    try {
      for (const l of actual.lotes) {
        if (actual.resultados.some(x => x.proveedorId === l.proveedorId && x.lote === l.lote)) continue;
        const resultado = await post<Omit<Resultado, "lote">>("identificacion-confirmar", { nombre, empleadoId: Number(empleado), ...(!actual.todos ? { consumoId: r.id } : {}), proveedorId: l.proveedorId, items: l.items, motivo: motivo.trim(), clave: l.clave });
        actual = { ...actual, resultados: [...actual.resultados, { ...resultado, lote: l.lote }] }; if (!guardarPlan(actual)) throw new Error("No se pudo conservar el progreso en esta sesión.");
      }
      if (actual.recordar && !actual.equivalencia) {
        const equivalencia = await post<{ requiereRevision: boolean }>("identificacion-recordar", { nombre, empleadoId: Number(empleado), proveedorId: Number(r.proveedor_id) });
        actual = { ...actual, equivalencia }; if (!guardarPlan(actual)) throw new Error("No se pudo conservar el resultado de la equivalencia en esta sesión.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo confirmar. Reintenta la misma solicitud."); }
    finally { setBusy(false); }
  }
  const terminado = !!plan && plan.resultados.length === plan.lotes.length && (!plan.recordar || !!plan.equivalencia);
  return <section className="space-y-2 rounded border p-3" aria-label="Identificación de piloto">
    <h4>Identificar piloto histórico</h4><p>Solo cambia el vínculo del piloto; conserva el nombre original y los demás datos.</p>
    <label><input type="radio" checked={!todos} onChange={() => { setTodos(false); guardarPlan(null); }} disabled={busy || !!plan?.resultados.length}/> Solo este consumo</label>{" "}
    <label><input type="radio" checked={todos} onChange={() => { setTodos(true); guardarPlan(null); }} disabled={busy || !!plan?.resultados.length}/> Todos los consumos pendientes con este nombre</label>
    <label className="block"><input type="checkbox" checked={recordar} onChange={e => { setRecordar(e.target.checked); guardarPlan(null); setConfirmado(false); }} disabled={busy || !!plan?.resultados.length}/> Recordar equivalencia para futuras importaciones</label>
    <button type="button" className={button} onClick={() => void consultar()} disabled={busy || !nombre.trim() || !empleado || !!plan?.resultados.length}>Consultar vista previa</button>
    {plan && <div className="space-y-2"><p>Empresa #{plan.vista.empresaId}. Original: {plan.vista.nombre}. Empleado: {plan.vista.empleado.nombre} #{plan.vista.empleado.id}.</p>
      {plan.vista.proveedores.map(p => <p key={p.proveedorId}>{cat.proveedores.find(x => x.id === p.proveedorId)?.nombre ?? `Proveedor #${p.proveedorId}`}: {p.pendientes.length} pendientes a actualizar, {p.identificados} ya identificados, {p.conflictos} conflictos excluidos{p.conflictos ? ` (consumos ${p.conflictoIds.map(id => `#${id}`).join(", ")})` : ""}.</p>)}
      {!plan.vista.proveedores.length && <p>No hay consumos coincidentes.</p>}
      <p>{plan.resultados.length} de {plan.lotes.length} lotes confirmados. Cada lote se procesa en una transacción independiente.</p>
      <label className="block"><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} disabled={busy}/> Confirmo la identificación indicada</label>
      <button type="button" className={button} disabled={busy || !persistencia || !confirmado || motivo.trim().length < 10 || terminado || (!plan.recordar && !plan.lotes.length)} onClick={() => void aplicar()}>Confirmar identificación</button>
      {plan.resultados.map(x => <p key={`${x.proveedorId}:${x.lote}`}>Proveedor #{x.proveedorId}, lote {x.lote + 1}: {x.actualizados} actualizados, {x.repetidos} ya procesados en este intento.</p>)}{plan.equivalencia && <p>{plan.equivalencia.requiereRevision ? "Equivalencia guardada: requiere revisión en futuras importaciones." : "Equivalencia guardada."}</p>}
      {!!plan.resultados.length && <button type="button" className={button} disabled={busy} onClick={() => { const anterioresNuevos = [...anteriores, ...plan.resultados]; try { sessionStorage.setItem(`${storageKey}:resultados`, JSON.stringify(anterioresNuevos)); setAnteriores(anterioresNuevos); guardarPlan(null); setConfirmado(false); setError(""); } catch { setError("No se pudieron conservar los resultados anteriores."); } }}>Cerrar intento y consultar nuevamente</button>}
    </div>}{anteriores.map((x, i) => <p key={i}>Resultado anterior: proveedor #{x.proveedorId}, lote {x.lote + 1}: {x.actualizados} actualizados, {x.repetidos} repetidos.</p>)}{!persistencia && <p role="alert">No se puede conservar el progreso en esta sesión; habilita el almacenamiento antes de continuar.</p>}{error && <p role="alert">{error} {persistencia ? "Los lotes completados se conservan; reintenta los pendientes." : "Anota los resultados visibles antes de cerrar esta pantalla."}</p>}
  </section>;
}
