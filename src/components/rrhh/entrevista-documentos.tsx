"use client";
import { useCallback, useEffect, useState } from "react";

const TIPOS = ["Currículum", "DPI", "Licencia", "Antecedentes penales", "Antecedentes policíacos", "Constancia laboral", "Título o diploma", "Otro"];
type Doc = { id: number; tipoDocumento: string; nombreOriginal: string | null };
export function EntrevistaDocumentos({ slug, entrevistaId }: { slug: string; entrevistaId: number }) {
  const [docs, setDocs] = useState<Doc[]>([]); const [file, setFile] = useState<File | null>(null);
  const [tipo, setTipo] = useState(TIPOS[0]); const [msg, setMsg] = useState("");
  const cargar = useCallback(async () => {
    const r = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${entrevistaId}/documentos`);
    const d = await r.json(); if (r.ok) setDocs(d.documentos ?? []); else setMsg(d.error ?? "Error al cargar.");
  }, [slug, entrevistaId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota del expediente al cambiar de entrevista
    void cargar();
  }, [cargar]);
  async function subir() {
    if (!file) return; const fd = new FormData(); fd.set("file", file); fd.set("tipo", tipo);
    const r = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${entrevistaId}/documentos`, { method: "POST", body: fd });
    const d = await r.json(); setMsg(d.mensaje ?? d.error ?? ""); if (r.ok) { setFile(null); await cargar(); }
  }
  async function borrar(id: number) {
    if (!confirm("¿Eliminar este documento del candidato?")) return;
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/documentos/${id}`, { method: "DELETE" }); await cargar();
  }
  return <section className="space-y-2 rounded border border-[var(--border)] p-3">
    <div><h3 className="font-medium">Papelería del candidato</h3><p className="text-xs text-[var(--muted)]">Expediente privado de reclutamiento. Al crear al empleado, los archivos pasan a su expediente laboral.</p></div>
    <div className="flex flex-wrap gap-2"><select value={tipo} onChange={e => setTipo(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm">{TIPOS.map(t => <option key={t}>{t}</option>)}</select>
      <input type="file" accept=".jpg,.jpeg,.png,.webp,.bmp,.pdf,image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      <button type="button" disabled={!file} onClick={() => void subir()} className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-40">Subir documento</button></div>
    {msg ? <p className="text-xs text-[var(--muted)]">{msg}</p> : null}
    <ul className="space-y-1">{docs.map(d => <li key={d.id} className="flex justify-between rounded border border-[var(--border)] px-2 py-1 text-sm"><span>{d.tipoDocumento}: {d.nombreOriginal || "archivo"}</span><span className="flex gap-2"><a target="_blank" rel="noreferrer" href={`/api/empresas/${slug}/rrhh/entrevistas/documentos/${d.id}`} className="text-[var(--accent)]">Ver</a><button type="button" onClick={() => void borrar(d.id)} className="text-red-300">Eliminar</button></span></li>)}</ul>
  </section>;
}
