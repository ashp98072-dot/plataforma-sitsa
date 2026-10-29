"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AVISO_CALENDARIO, calendarioSchema, type CalendarioEntrada, type EjercicioCalendario, type PeriodoCalendario } from "@/lib/contabilidad/calendario-schema";
import { libroUnicoActivo } from "@/lib/contabilidad/seleccion-libro";
import { DiagnosticoCierrePanel } from './cierre-diagnostico';
import { RegularizacionPanel } from './regularizacion-simulacion';

type Entidad = { id: number; codigo: string; nombre: string; activa: number };
const inputClase = "rounded border border-[var(--border)] bg-[var(--input)] p-2";
async function datos<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: "no-store" });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "No se pudo completar la operación.");
  return d;
}

export function CalendarioContable({ slug, puedeCrear }: { slug: string; puedeCrear: boolean }) {
  return <SelectorCalendario key={slug} slug={slug} puedeCrear={puedeCrear} />;
}

function SelectorCalendario({ slug, puedeCrear }: { slug: string; puedeCrear: boolean }) {
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [entidad, setEntidad] = useState("");
  const [error, setError] = useState("");
  const [cargandoOpciones, setCargandoOpciones] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    datos<{ entidades: Entidad[] }>(`/api/empresas/${slug}/contabilidad/ejercicios/opciones`, { signal: c.signal })
      .then((d) => { if (!c.signal.aborted) { setError(""); setEntidades(d.entidades); setEntidad(libroUnicoActivo(d.entidades)); } })
      .catch((e) => { if (!c.signal.aborted) setError(e.message); })
      .finally(() => { if (!c.signal.aborted) setCargandoOpciones(false); });
    return () => c.abort();
  }, [slug]);
  const seleccion = entidades.find((e) => String(e.id) === entidad);
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Calendario contable</h1>
    <p className="rounded border border-[var(--border)] p-3">{AVISO_CALENDARIO}</p>
    {cargandoOpciones && <p role="status">Cargando libros contables…</p>}
    <label className="block">Libro contable <select disabled={cargandoOpciones} className={inputClase} value={entidad} onChange={(e) => setEntidad(e.target.value)}>
      <option value="">Seleccionar libro</option>
      {entidades.map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}{e.activa ? "" : " (inactivo)"}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    {seleccion && <CalendarioLibro key={`${slug}:${entidad}`} slug={slug} entidadId={seleccion.id} puedeCrear={puedeCrear && Number(seleccion.activa) === 1} />}
  </div>;
}

export function CalendarioLibro({ slug, entidadId, puedeCrear }: { slug: string; entidadId: number; puedeCrear: boolean }) {
  const [ejercicios, setEjercicios] = useState<EjercicioCalendario[]>([]);
  const [ejercicio, setEjercicio] = useState("");
  const [periodos, setPeriodos] = useState<PeriodoCalendario[]>([]);
  const [revisionPeriodos, setRevisionPeriodos] = useState(0);
  const [errorPeriodos, setErrorPeriodos] = useState("");
  const [cargandoPeriodos, setCargandoPeriodos] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const base = `/api/empresas/${slug}/contabilidad/ejercicios`;
  useEffect(() => {
    const c = new AbortController();
    datos<{ ejercicios: EjercicioCalendario[] }>(`${base}?entidad=${entidadId}`, { signal: c.signal })
      .then((d) => { if (!c.signal.aborted) { setEjercicios(d.ejercicios); setError(""); } })
      .catch((e) => { if (!c.signal.aborted) setError(e.message); })
      .finally(() => { if (!c.signal.aborted) setCargando(false); });
    return () => c.abort();
  }, [base, entidadId, revision]);
  useEffect(() => {
    if (!ejercicio) return;
    const c = new AbortController();
    datos<{ periodos: PeriodoCalendario[] }>(`${base}/${ejercicio}/periodos?entidad=${entidadId}`, { signal: c.signal })
      .then((d) => { if (!c.signal.aborted) { setPeriodos(d.periodos); setErrorPeriodos(""); } })
      .catch((e) => { if (!c.signal.aborted) setErrorPeriodos(e.message); })
      .finally(() => { if (!c.signal.aborted) setCargandoPeriodos(false); });
    return () => c.abort();
  }, [base, entidadId, ejercicio, revisionPeriodos]);
  return <div className="space-y-4">
    {cargando && <p role="status">Cargando ejercicios…</p>}
    {mensaje && <p role="status">{mensaje}</p>}
    {error && <p role="alert">{error}</p>}
    {!cargando && !error && !ejercicios.length && <p>No hay ejercicios configurados para este libro.</p>}
    <ul className="space-y-2">{ejercicios.map((e) => <li key={e.id} className="rounded border border-[var(--border)] p-3">
      <button type="button" className="underline" onClick={() => { if (ejercicio !== String(e.id)) { setPeriodos([]); setErrorPeriodos(""); setCargandoPeriodos(true); setEjercicio(String(e.id)); } }}>{e.codigo}: {e.fechaInicio} a {e.fechaFin}</button> · {e.estado}
    </li>)}</ul>
    {ejercicio && <DiagnosticoCierrePanel key={`${slug}:${entidadId}:${ejercicio}`} slug={slug} entidadId={entidadId} ejercicioId={ejercicio}/>}
    {ejercicio && <RegularizacionPanel key={`sim:${slug}:${entidadId}:${ejercicio}`} slug={slug} entidadId={entidadId} ejercicioId={ejercicio}/>}
    {ejercicio && <section aria-label="Períodos del ejercicio"><h2 className="font-semibold">Períodos</h2>
      {cargandoPeriodos && <p role="status">Cargando períodos…</p>}
      <ErrorConsultaPeriodos error={errorPeriodos} cargando={cargandoPeriodos} reintentar={() => {
        setErrorPeriodos(""); setCargandoPeriodos(true); setRevisionPeriodos((v) => v + 1);
      }} />
      <ul>{periodos.map((p) => <li key={p.id}>{p.orden}. {p.codigo}: {p.fechaInicio} a {p.fechaFin} · {p.estado}</li>)}</ul>
    </section>}
    {puedeCrear && <FormularioCalendario key={revision} url={`${base}?entidad=${entidadId}`} alCrear={() => {
      setMensaje("Ejercicio y períodos configurados correctamente."); setCargando(true); setRevision((v) => v + 1);
    }} />}
  </div>;
}

export function ErrorConsultaPeriodos({ error, cargando, reintentar }: { error: string; cargando: boolean; reintentar: () => void }) {
  if (!error) return null;
  return <div role="alert"><p>{error}</p><button type="button" disabled={cargando} className="underline" onClick={reintentar}>Reintentar consulta de períodos</button></div>;
}

export function FormularioCalendario({ url, alCrear }: { url: string; alCrear: () => void }) {
  const [entrada, setEntrada] = useState<CalendarioEntrada>({ codigo: "", fechaInicio: "", fechaFin: "", periodos: [{ codigo: "", fechaInicio: "", fechaFin: "" }] });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ocupado = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado.current) return;
    const validado = calendarioSchema.safeParse(entrada);
    if (!validado.success) { setError(validado.error.issues[0].message); return; }
    ocupado.current = true; setEnviando(true); setError("");
    try {
      await datos(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validado.data) });
      if (vivo.current) alCrear();
    } catch (e) { if (vivo.current) setError(e instanceof Error ? e.message : "Consulta el calendario antes de reintentar."); }
    finally { ocupado.current = false; if (vivo.current) setEnviando(false); }
  }
  function periodo(i: number, campo: keyof CalendarioEntrada["periodos"][number], valor: string) {
    setEntrada((v) => ({ ...v, periodos: v.periodos.map((p, n) => n === i ? { ...p, [campo]: valor } : p) }));
  }
  return <form onSubmit={enviar} className="space-y-3 rounded border border-[var(--border)] p-4">
    <h2 className="font-semibold">Crear ejercicio con sus períodos</h2>
    <p>Indica los períodos en orden. Deben cubrir todas las fechas del ejercicio, sin huecos ni solapamientos.</p>
    <fieldset disabled={enviando} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label>Código del ejercicio <input required maxLength={40} className={inputClase} value={entrada.codigo} onChange={(e) => setEntrada({ ...entrada, codigo: e.target.value })} /></label>
        <label>Inicio del ejercicio <input required type="date" className={inputClase} value={entrada.fechaInicio} onChange={(e) => setEntrada({ ...entrada, fechaInicio: e.target.value })} /></label>
        <label>Fin del ejercicio <input required type="date" className={inputClase} value={entrada.fechaFin} onChange={(e) => setEntrada({ ...entrada, fechaFin: e.target.value })} /></label>
      </div>
      {entrada.periodos.map((p, i) => <fieldset key={i} className="flex flex-wrap gap-3 rounded border border-[var(--border)] p-2">
        <legend>Período {i + 1}</legend>
        <label>Código <input required maxLength={40} className={inputClase} value={p.codigo} onChange={(e) => periodo(i, "codigo", e.target.value)} /></label>
        <label>Inicio <input required type="date" className={inputClase} value={p.fechaInicio} onChange={(e) => periodo(i, "fechaInicio", e.target.value)} /></label>
        <label>Fin <input required type="date" className={inputClase} value={p.fechaFin} onChange={(e) => periodo(i, "fechaFin", e.target.value)} /></label>
        {entrada.periodos.length > 1 && <button type="button" onClick={() => setEntrada({ ...entrada, periodos: entrada.periodos.filter((_, n) => n !== i) })}>Quitar período {i + 1}</button>}
      </fieldset>)}
      <button type="button" disabled={entrada.periodos.length >= 366} onClick={() => setEntrada({ ...entrada, periodos: [...entrada.periodos, { codigo: "", fechaInicio: "", fechaFin: "" }] })} className="underline">Agregar período</button>
      <button type="submit" className="ml-4 rounded bg-[var(--accent)] px-4 py-2">{enviando ? "Guardando…" : "Guardar calendario configurado"}</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </form>;
}
