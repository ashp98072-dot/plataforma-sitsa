"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

export default function TarimasPage() {
  const slug = String(useParams().slug);
  const [ordenes, setOrdenes] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState({
    codigo: "",
    cliente: "",
    cantidad: 0,
    fecha: new Date().toISOString().slice(0, 10),
  });
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/tarimas`);
    const data = await res.json();
    if (res.ok) setOrdenes(data.ordenes ?? []);
    else setMsg(data.error ?? "");
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/tarimas`, {
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
      <h1 className="text-2xl font-semibold">Tarimas</h1>
      <p className="text-sm text-[var(--muted)]">
        Órdenes de fabricación/venta (Tarimas Center).
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
        <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Cliente" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} />
        <input type="number" className="w-28 rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: Number(e.target.value) })} />
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm">Crear orden</button>
      </form>
      {msg ? <p className="text-sm">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {ordenes.map((o) => (
          <li key={String(o.id)} className="rounded border border-[var(--border)] px-3 py-2">
            {String(o.codigo)} · {String(o.cliente ?? "")} · qty {String(o.cantidad)} · {String(o.estado)}
          </li>
        ))}
      </ul>
    </div>
  );
}
