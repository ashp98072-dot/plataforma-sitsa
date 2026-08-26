"use client";
import { useCallback, useEffect, useState } from "react";
import { EntrevistaDocumentos } from "./entrevista-documentos";

type Entrevista = { id: number; candidatoNombre: string; candidatoTelefono: string | null; candidatoEmail: string | null; puesto: string; fechaHora: string; entrevistadorNombre?: string; modalidad: string; lugarOEnlace: string | null; estado: string; resultado: string; notas: string | null; creadoPor: string | null };
type Usuario = { id: number; username: string; nombre: string | null };
type Comentario = { id: number; comentario: string; creadoEn: string; autor: string; username: string };
export function ExpedienteCandidato({ slug, entrevistaId, onClose }: { slug: string; entrevistaId: number; onClose: () => void }) {
  const [entrevista, setEntrevista] = useState<Entrevista | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]); const [seleccion, setSeleccion] = useState<number[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]); const [comentario, setComentario] = useState(""); const [msg, setMsg] = useState("");
  const cargar = useCallback(async () => {
    const r = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${entrevistaId}/seguimiento`); const d = await r.json();
    if (!r.ok) { setMsg(d.error ?? "No se pudo cargar el expediente."); return; }
    setEntrevista(d.entrevista); setUsuarios(d.usuarios ?? []); setSeleccion((d.responsables ?? []).map((u: Usuario) => u.id)); setComentarios(d.comentarios ?? []);
  }, [slug, entrevistaId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota del expediente seleccionado
    void cargar();
  }, [cargar]);
  async function guardarResponsables() {
    const r = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${entrevistaId}/seguimiento`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "responsables", usuarioIds: seleccion }) });
    const d = await r.json(); setMsg(d.mensaje ?? d.error ?? ""); if (r.ok) await cargar();
  }
  async function comentar() {
    const r = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${entrevistaId}/seguimiento`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "comentar", comentario }) });
    const d = await r.json(); setMsg(d.mensaje ?? d.error ?? ""); if (r.ok) { setComentario(""); await cargar(); }
  }
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4"><div className="mx-auto max-w-5xl space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
    <div className="flex justify-between gap-3"><div><h2 className="text-xl font-semibold">Expediente de reclutamiento</h2><p className="text-sm text-[var(--muted)]">Información, documentos y seguimiento compartido del candidato.</p></div><button type="button" onClick={onClose} className="rounded border border-[var(--border)] px-3 py-1">Cerrar</button></div>
    {entrevista ? <>
      <section className="grid gap-3 rounded border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Dato label="Candidato" valor={entrevista.candidatoNombre} /><Dato label="Puesto" valor={entrevista.puesto} /><Dato label="Teléfono" valor={entrevista.candidatoTelefono || "No registrado"} />
        <Dato label="Correo" valor={entrevista.candidatoEmail || "No registrado"} /><Dato label="Entrevista" valor={entrevista.fechaHora.replace("T", " ").slice(0, 16)} /><Dato label="Modalidad / lugar" valor={`${entrevista.modalidad}${entrevista.lugarOEnlace ? ` · ${entrevista.lugarOEnlace}` : ""}`} />
        <Dato label="Entrevistador" valor={entrevista.entrevistadorNombre || "Sin asignar"} /><Dato label="Estado" valor={entrevista.estado} /><Dato label="Resultado" valor={entrevista.resultado} />
        <div className="sm:col-span-2 lg:col-span-3"><p className="text-xs text-[var(--muted)]">Evaluación general</p><p className="whitespace-pre-wrap">{entrevista.notas || "Sin evaluación registrada."}</p></div>
      </section>
      <section className="space-y-2 rounded border border-[var(--border)] p-4"><h3 className="font-medium">Responsables del proceso</h3><p className="text-xs text-[var(--muted)]">Puedes asignar uno o varios usuarios de RRHH de esta empresa.</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{usuarios.map(u => <label key={u.id} className="flex gap-2 rounded border border-[var(--border)] p-2 text-sm"><input type="checkbox" checked={seleccion.includes(u.id)} onChange={e => setSeleccion(e.target.checked ? [...seleccion, u.id] : seleccion.filter(id => id !== u.id))} /><span>{u.nombre || u.username}<small className="block text-[var(--muted)]">@{u.username}</small></span></label>)}</div><button type="button" onClick={() => void guardarResponsables()} className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Guardar responsables</button></section>
      <EntrevistaDocumentos slug={slug} entrevistaId={entrevistaId} />
      <section className="space-y-2 rounded border border-[var(--border)] p-4"><h3 className="font-medium">Bitácora de seguimiento</h3><textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3} maxLength={5000} placeholder="Registra llamada, documentos pendientes, referencias, decisión o próximo paso…" className="w-full rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm"/><button type="button" disabled={!comentario.trim()} onClick={() => void comentar()} className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-40">Agregar seguimiento</button><ul className="space-y-2">{comentarios.map(c => <li key={c.id} className="rounded border border-[var(--border)] p-2 text-sm"><div className="flex justify-between gap-2 text-xs text-[var(--muted)]"><span>{c.autor} (@{c.username})</span><time>{new Date(c.creadoEn).toLocaleString("es-GT")}</time></div><p className="mt-1 whitespace-pre-wrap">{c.comentario}</p></li>)}{comentarios.length === 0 ? <li className="text-sm text-[var(--muted)]">Sin seguimiento registrado todavía.</li> : null}</ul></section>
    </> : <p>Cargando expediente…</p>}{msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}
  </div></div>;
}
function Dato({ label, valor }: { label: string; valor: string }) { return <div><p className="text-xs text-[var(--muted)]">{label}</p><p className="font-medium">{valor}</p></div>; }
