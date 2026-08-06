"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

export default function ReciclajePage() {
  const slug = String(useParams().slug);
  const [lotes, setLotes] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({
    codigo: "",
    material: "",
    pesoKg: 0,
    proveedor: "",
    fecha: new Date().toISOString().slice(0, 10),
  });
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/reciclaje`);
    const data = await res.json();
    if (res.ok) setLotes(data.lotes ?? []);
    else setMsg(data.error ?? "");
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/reciclaje`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reciclaje</h1>
      <p className="text-sm text-[var(--muted)]">
        Módulo específico (Francisco / Ecoplanet): lotes de material.
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Material" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} required />
        <input type="number" className="w-28 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={form.pesoKg} onChange={(e) => setForm({ ...form, pesoKg: Number(e.target.value) })} />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Proveedor" value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} />
        <input type="date" className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm">Registrar lote</button>
      </form>
      {msg ? <p className="text-sm">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {lotes.map((l) => (
          <li key={String(l.id)} className="rounded border border-[var(--border)] px-3 py-2">
            {String(l.codigo)} · {String(l.material)} · {String(l.peso_kg)} kg · {String(l.fecha).slice(0, 10)}
          </li>
        ))}
      </ul>
    </div>
  );
}
