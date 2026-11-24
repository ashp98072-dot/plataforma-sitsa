"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Fila = Record<string, string | number | boolean | null>;

/** Cierre de proveedores históricos: el proveedor anterior se muestra solo como dato de lectura; el mapeo es manual y queda registrado. */
export function MapeoProveedores({ slug }: { slug: string }) {
  const [pendientes, setPendientes] = useState<Fila[]>([]);
  const [proveedores, setProveedores] = useState<Fila[]>([]);
  const [mapeos, setMapeos] = useState<Fila[]>([]);
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);
  const base = `/api/empresas/${encodeURIComponent(slug)}/canecas`;
  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try {
      const leer = async (r: string) => { const res = await fetch(`${base}/${r}`, { cache: "no-store" }); const json = await res.json(); if (!res.ok) throw new Error(json.error || "No se pudieron consultar los datos."); return json.datos as Fila[]; };
      const [a, b, c] = await Promise.all([leer("compras_historicas"), leer("proveedores"), leer("mapeos_proveedor")]);
      setPendientes(a); setProveedores(b.filter(p => p.activo !== 0)); setMapeos(c);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de consulta."); } finally { setCargando(false); }
  }, [base]);
  useEffect(() => { const t = setTimeout(() => { void cargar(); }, 0); return () => clearTimeout(t); }, [cargar]);
  async function asignar(compraId: string) {
    const proveedorId = elegidos[compraId];
    if (!proveedorId || enviando.current) return;
    enviando.current = true; setOcupado(true); setMensaje("");
    try {
      const res = await fetch(`${base}/mapeo_proveedor_compra`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ compra_id: Number(compraId), proveedor_id: Number(proveedorId) }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo asignar el proveedor.");
      setMensaje("Proveedor asignado. Queda registrado quién lo hizo."); await cargar();
    } catch (e) { setMensaje(e instanceof Error ? e.message : "Error de operación."); } finally { enviando.current = false; setOcupado(false); }
  }
  const celda = "whitespace-nowrap px-4 py-3";
  return <main className="min-w-0 max-w-full space-y-6 p-4 md:p-6">
    <header><p className="text-sm font-medium text-[var(--muted)]">Gestión de Canecas</p><h1 className="mt-1 text-2xl font-semibold">Proveedores históricos</h1><p className="mt-2 text-sm text-[var(--muted)]">Las compras anteriores conservan su proveedor original solo como información. Asigne a cada una un proveedor de Canecas; nada se reasigna solo y no se borra nada.</p></header>
    {error && <p role="alert" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{error}</p>}
    {mensaje && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{mensaje}</p>}
    <section className="space-y-3"><h2 className="text-lg font-semibold">Compras pendientes de asignar</h2>
      <div className="table-scroll min-w-0 max-w-full rounded-xl border border-[var(--border)] bg-[var(--card)]"><table className="w-full text-left text-sm"><thead className="bg-[var(--thead)] text-[var(--muted)]"><tr>{["Documento","Caneca llena","Canecas","Fecha","Proveedor anterior (solo lectura)","Proveedor de Canecas","Acción"].map(h => <th className="whitespace-nowrap px-4 py-3" key={h}>{h}</th>)}</tr></thead>
        <tbody>{pendientes.map(p => <tr className="border-t border-[var(--border)]" key={String(p.id)}><td className={celda}>{String(p.referencia)}</td><td className={celda}>{String(p.producto)}</td><td className={celda}>{String(p.cantidad)}</td><td className={celda}>{String(p.creado_en ?? "—")}</td><td className={celda}>{String(p.proveedor_anterior)}</td>
          <td className={celda}><select aria-label={`Proveedor de Canecas para ${String(p.referencia)}`} className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={elegidos[String(p.id)] ?? ""} onChange={e => setElegidos({ ...elegidos, [String(p.id)]: e.target.value })}><option value="">Seleccione</option>{proveedores.map(x => <option key={String(x.id)} value={String(x.id)}>{String(x.nombre_comercial)}</option>)}</select></td>
          <td className={celda}><button disabled={ocupado || !elegidos[String(p.id)]} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50" onClick={() => void asignar(String(p.id))}>Asignar proveedor</button></td></tr>)}
          {!pendientes.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--muted)]">{cargando ? "Cargando…" : "No hay compras pendientes de asignar."}</td></tr>}</tbody></table></div></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Asignaciones realizadas</h2>
      <div className="table-scroll min-w-0 max-w-full rounded-xl border border-[var(--border)] bg-[var(--card)]"><table className="w-full text-left text-sm"><thead className="bg-[var(--thead)] text-[var(--muted)]"><tr>{["Documento","Proveedor de Canecas","Proveedor anterior (n.º)","Lo asignó","Fecha"].map(h => <th className="whitespace-nowrap px-4 py-3" key={h}>{h}</th>)}</tr></thead>
        <tbody>{mapeos.map(m => <tr className="border-t border-[var(--border)]" key={String(m.id)}><td className={celda}>{String(m.referencia)}</td><td className={celda}>{String(m.proveedor_canecas)}</td><td className={celda}>{String(m.proveedor_anterior_id ?? "—")}</td><td className={celda}>{String(m.realizado_por)}</td><td className={celda}>{String(m.realizado_en)}</td></tr>)}
          {!mapeos.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">{cargando ? "Cargando…" : "Aún no se ha asignado ninguna compra."}</td></tr>}</tbody></table></div></section>
  </main>;
}
