"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

export default function CmsPage() {
  const slug = String(useParams().slug);
  const [secciones, setSecciones] = useState<Record<string, unknown>[]>([]);
  const [clave, setClave] = useState("inicio");
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [imagenUrl, setImagenUrl] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/cms`);
    const data = await res.json();
    if (res.ok) setSecciones(data.secciones ?? []);
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/cms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave, titulo, contenido, imagenUrl }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Sitio Web (CMS)</h1>
      <p className="text-sm text-[var(--muted)]">
        Secciones editables por empresa (inicio, servicios, galería…). Vista
        pública:{" "}
        <a className="text-[var(--accent)] underline" href={`/site/${slug}`} target="_blank" rel="noreferrer">
          /site/{slug}
        </a>
      </p>
      <form onSubmit={onSubmit} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="w-full rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Clave (inicio, servicios…)" value={clave} onChange={(e) => setClave(e.target.value)} required />
        <input className="w-full rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <textarea className="w-full rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" rows={4} placeholder="Contenido" value={contenido} onChange={(e) => setContenido(e.target.value)} />
        <input className="w-full rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="URL imagen" value={imagenUrl} onChange={(e) => setImagenUrl(e.target.value)} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm">Guardar sección</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="space-y-2">
        {secciones.map((s) => (
          <li key={String(s.id)} className="rounded border border-[var(--border)] p-3 text-sm">
            <strong>{String(s.clave)}</strong> — {String(s.titulo ?? "")}
            <p className="mt-1 text-[var(--muted)]">{String(s.contenido ?? "").slice(0, 160)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
