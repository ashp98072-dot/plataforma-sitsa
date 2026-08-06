"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

export default function ContabilidadPage() {
  const slug = String(useParams().slug);
  const [cuentas, setCuentas] = useState<Record<string, unknown>[]>([]);
  const [asientos, setAsientos] = useState<Record<string, unknown>[]>([]);
  const [cxc, setCxc] = useState<Record<string, unknown>[]>([]);
  const [cxp, setCxp] = useState<Record<string, unknown>[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("Activo");
  const [cliente, setCliente] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [monto, setMonto] = useState(0);
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [c, a, cx, cp] = await Promise.all([
      fetch(`/api/empresas/${slug}/contabilidad/cuentas`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/contabilidad/asientos`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/contabilidad/cxc`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/contabilidad/cxp`).then((r) => r.json()),
    ]);
    setCuentas(c.cuentas ?? []);
    setAsientos(a.asientos ?? []);
    setCxc(cx.cxc ?? []);
    setCxp(cp.cxp ?? []);
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crearCuenta(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/contabilidad/cuentas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, nombre, tipo }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setCodigo("");
      setNombre("");
      await cargar();
    }
  }

  async function asientoDemo() {
    if (cuentas.length < 2) {
      setMsg("Crea al menos 2 cuentas para un asiento demo.");
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/contabilidad/asientos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: `A-${Date.now()}`,
        fecha: new Date().toISOString().slice(0, 10),
        glosa: "Asiento de prueba (esqueleto Contabilidad)",
        lineas: [
          { cuentaId: Number(cuentas[0].id), debe: 100, haber: 0 },
          { cuentaId: Number(cuentas[1].id), debe: 0, haber: 100 },
        ],
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function crearCxc() {
    const res = await fetch(`/api/empresas/${slug}/contabilidad/cxc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente,
        fecha: new Date().toISOString().slice(0, 10),
        monto,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setCliente("");
      await cargar();
    }
  }

  async function crearCxp() {
    const res = await fetch(`/api/empresas/${slug}/contabilidad/cxp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor,
        fecha: new Date().toISOString().slice(0, 10),
        monto,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setProveedor("");
      await cargar();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contabilidad</h1>
        <p className="text-sm text-[var(--muted)]">
          Plan de cuentas, asientos, CxC/CxP por empresa (esqueleto para migración
          gradual desde SKAS).
        </p>
      </div>

      <form onSubmit={crearCuenta} className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <select className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {["Activo", "Pasivo", "Capital", "Ingreso", "Gasto"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm">Crear cuenta</button>
        <button type="button" onClick={() => void asientoDemo()} className="rounded bg-[#6A1B9A] px-3 py-1 text-sm">
          Asiento demo
        </button>
      </form>

      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Cliente CxC" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Proveedor CxP" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
        <input type="number" className="w-28 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={monto} onChange={(e) => setMonto(Number(e.target.value))} />
        <button type="button" onClick={() => void crearCxc()} className="rounded bg-[var(--accent-2)] px-3 py-1 text-sm">CxC</button>
        <button type="button" onClick={() => void crearCxp()} className="rounded bg-[#0f766e] px-3 py-1 text-sm">CxP</button>
      </div>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">Cuentas</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cuentas.map((c) => (
              <li key={String(c.id)}>
                {String(c.codigo)} — {String(c.nombre)} ({String(c.tipo)})
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">Asientos recientes</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {asientos.map((a) => (
              <li key={String(a.id)}>
                {String(a.numero)} · {String(a.fecha).slice(0, 10)} · {String(a.glosa ?? "")}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">CxC ({cxc.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cxc.map((r) => (
              <li key={String(r.id)}>
                {String(r.cliente)} · Q{Number(r.saldo).toFixed(2)} · {String(r.estado)}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">CxP ({cxp.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cxp.map((r) => (
              <li key={String(r.id)}>
                {String(r.proveedor)} · Q{Number(r.saldo).toFixed(2)} · {String(r.estado)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
