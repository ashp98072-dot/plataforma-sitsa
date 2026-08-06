"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

export default function InventarioRrhhPage() {
  const slug = String(useParams().slug);
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [stock, setStock] = useState(0);
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/rrhh/inventario`);
    const data = await res.json();
    if (res.ok) setItems(data.items ?? []);
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/inventario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, nombre, stock }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setCodigo("");
      setNombre("");
      setStock(0);
      await cargar();
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Inventario RRHH</h1>
      <p className="text-sm text-[var(--muted)]">
        EPP / útiles por empresa (no es el inventario de logística SKAS).
      </p>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <input type="number" className="w-24 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={stock} onChange={(e) => setStock(Number(e.target.value))} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm">Agregar</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={String(i.id)} className="rounded border border-[var(--border)] px-3 py-2">
            {String(i.codigo)} — {String(i.nombre)} · stock {String(i.stock)}
          </li>
        ))}
      </ul>
    </div>
  );
}
