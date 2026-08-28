"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Caso = { id: number; titulo: string; descripcion: string; empleado_nombre: string | null; responsable_id: number | null; responsable_nombre: string; estado: string; version: number };
type Seguimiento = { version: number; comentario: string; responsable_nombre: string; estado: string; creado_por: string; fecha: string };
type Datos = { casos: Caso[]; seguimientos: Seguimiento[]; empleados: { id: number; nombre: string }[]; hayMas: boolean; puedeEditar: boolean };
const vacio: Datos = { casos: [], seguimientos: [], empleados: [], hayMas: false, puedeEditar: false };
const campo = "w-full rounded border border-[var(--border)] bg-[var(--input)] p-2";
export default function CasosLegales({ slug }: { slug: string }) {
  const [datos, setDatos] = useState<Datos>(vacio);
  const [id, setId] = useState<number>();
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const endpoint = `/api/empresas/${slug}/rrhh/casos-legales`;
  const cargar = useCallback(async (signal?: AbortSignal) => {
    setListo(false);
    try {
      const res = await fetch(`${endpoint}?${id ? `id=${id}` : `pagina=${pagina}`}`, { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDatos(data); setError(""); setListo(true);
    } catch (e) {
      if (!signal?.aborted) { setDatos(vacio); setError(e instanceof Error ? e.message : "No se pudo consultar."); }
    }
  }, [endpoint, id, pagina]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void cargar(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cargar]);
  const caso = id ? datos.casos.find((c) => c.id === id) : undefined;
  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setOcupado(true); setError("");
    try {
      const body = caso ? { id: caso.id, version: caso.version, estado: f.get("estado"), comentario: f.get("comentario"), responsableId: Number(f.get("responsable")) }
        : { titulo: f.get("titulo"), descripcion: f.get("descripcion"), empleadoId: Number(f.get("empleado")) || null, responsableId: Number(f.get("responsable")) };
      const res = await fetch(endpoint, { method: caso ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      form.reset();
      if (caso) await cargar(); else setId(data.id);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setOcupado(false); }
  }
  return <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
    <h2 className="text-lg font-semibold">Expedientes y seguimiento de casos legales</h2>
    <p className="text-sm">Complementa la bitácora, no la sustituye. Cada seguimiento conserva autor, fecha, estado y responsable. Usa los recordatorios existentes para avisos de vencimiento.</p>
    <button type="button" disabled={ocupado} onClick={() => { if (id) setId(undefined); else void cargar(); }} className="underline">{id ? "← Lista de casos" : "Actualizar"}</button>
    {error ? <p role="alert" className="text-amber-600">{error}</p> : null}
    {listo && <>
      {!id && <><ul>{datos.casos.map((c) => <li key={c.id} className="my-2"><button disabled={ocupado} className="underline" onClick={() => setId(c.id)}>#{c.id} · {c.titulo} · {c.estado} · {c.responsable_nombre}</button></li>)}</ul>
        {!datos.casos.length && <p>Sin casos registrados.</p>}
        <nav className="flex gap-3"><button disabled={pagina === 1 || ocupado} onClick={() => setPagina(pagina - 1)}>Anterior</button><span>Página {pagina}</span><button disabled={!datos.hayMas || ocupado} onClick={() => setPagina(pagina + 1)}>Siguiente</button></nav></>}
      {caso && <><h3 className="font-semibold">#{caso.id} · {caso.titulo}</h3><p>{caso.empleado_nombre ?? "Gestión general"} · {caso.estado}</p><p className="whitespace-pre-wrap">{caso.descripcion}</p>
        <ol className="space-y-2">{datos.seguimientos.map((s) => <li key={s.version} className="rounded border border-[var(--border)] p-3"><p>#{s.version} · {s.fecha} · {s.creado_por} · {s.estado} · Responsable: {s.responsable_nombre}</p><p className="whitespace-pre-wrap">{s.comentario}</p></li>)}</ol>
        <button type="button" disabled={ocupado} onClick={() => void cargar()} className="underline">Recargar caso</button></>}
      {!datos.puedeEditar && <p>Acceso de consulta. Se requiere permiso de edición de Bitácora Legal para registrar cambios.</p>}
      {datos.puedeEditar && (!id || caso) && <form key={`${id ?? "nuevo"}-${caso?.version ?? 0}`} onSubmit={guardar} className="space-y-3">
        <h3 className="font-semibold">{caso ? "Agregar seguimiento / cambiar estado" : "Nuevo caso"}</h3>
        {!caso && <><label className="block">Título<input className={campo} name="titulo" required maxLength={200} /></label><label className="block">Hechos iniciales<textarea className={campo} name="descripcion" required maxLength={10000} /></label>
          <label className="block">Empleado relacionado<select className={campo} name="empleado"><option value="">Gestión general</option>{datos.empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label></>}
        <label className="block">Responsable<select className={campo} name="responsable" required defaultValue={caso?.responsable_id ?? ""}><option value="">Seleccionar empleado activo</option>{datos.empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label>
        {caso && <><label className="block">Estado<select className={campo} name="estado" defaultValue={caso.estado}>{["Abierto", "En seguimiento", "Cerrado"].map((e) => <option key={e}>{e}</option>)}</select></label><label className="block">Seguimiento / motivo del cambio<textarea className={campo} name="comentario" required maxLength={10000} /></label></>}
        <button disabled={ocupado} className="rounded bg-[var(--accent)] px-4 py-2 text-white">{ocupado ? "Guardando…" : "Guardar"}</button>
      </form>}
    </>}
  </section>;
}
