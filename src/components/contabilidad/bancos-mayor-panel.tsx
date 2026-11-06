"use client";
import { useEffect, useState } from "react";
import type { movimientosMayorBancario } from "@/lib/contabilidad/bancos-mayor";

type Resultado = Awaited<ReturnType<typeof movimientosMayorBancario>>;
export function BancosMayorPanel({ base, entidad }: { base: string; entidad: string }) {
  const [desde, setDesde] = useState(""), [hasta, setHasta] = useState("");
  const [consulta, setConsulta] = useState<{ qs: string } | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null), [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (consulta === null) return;
    const ac = new AbortController();
    fetch(`${base}?${consulta.qs}`, { cache: "no-store", signal: ac.signal }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw Error(data?.error ?? "No se pudo consultar el Mayor.");
      if (!ac.signal.aborted) { setResultado(data); setCargando(false); }
    }).catch(e => { if (!ac.signal.aborted) { setError(e.message); setCargando(false); } });
    return () => ac.abort();
  }, [base, consulta]);
  return <section className="space-y-3 rounded-xl border border-[var(--border)] p-4" aria-label="Movimientos del Mayor">
    <h2 className="text-xl font-semibold">Movimientos del Mayor de la cuenta seleccionada</h2>
    <p>Solo líneas de asientos Registrado de la cuenta contable actualmente vinculada. No demuestra movimiento bancario real, conciliación ni disponibilidad. No incluye cobros o pagos administrativos sin asiento.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      if (!desde || !hasta || desde > hasta) { setError("Selecciona un rango de fechas válido."); setResultado(null); return; }
      const sp = new URLSearchParams({ entidad, desde, hasta });
      setResultado(null); setError("");
      // Permite repetir la misma consulta tras un error sin reutilizar una respuesta anterior.
      setCargando(true); setConsulta({ qs: sp.toString() });
    }}>
      <label>Fecha contable desde <input required disabled={cargando} type="date" value={desde} onChange={e => { setDesde(e.target.value); setResultado(null); }} className="rounded border p-2" /></label>
      <label>Fecha contable hasta <input required disabled={cargando} type="date" value={hasta} onChange={e => { setHasta(e.target.value); setResultado(null); }} className="rounded border p-2" /></label>
      <button type="submit" disabled={cargando} className="rounded border p-2">Consultar movimientos del Mayor</button>
    </form>
    {cargando && <p role="status">Consultando Mayor…</p>}
    {error && <p role="alert">{error}</p>}
    {resultado && <>
      <p>Procedencia: Libro Mayor · Cuenta {resultado.cuenta.codigo} — {resultado.cuenta.nombre} · Fecha contable {resultado.desde} a {resultado.hasta} (inclusive).</p>
      {resultado.movimientos.length === 0 ? <p>No hay movimientos del Mayor para esta cuenta y rango.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption>Líneas contables registradas; no son movimientos bancarios conciliados. Importes contables sin conversión de moneda.</caption>
        <thead><tr>{["Fecha contable", "Asiento", "Detalle", "Estado contable", "Debe", "Haber"].map(h => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead>
        <tbody>{resultado.movimientos.map(m => <tr key={m.detalleId} className="border-t border-[var(--border)]">
          <td className="p-2">{m.fecha}</td><td className="p-2">{m.numero} (#{m.asientoId})</td><td className="p-2">{m.detalleId}</td><td className="p-2">{m.estado}</td>
          <td className="p-2 font-mono">{m.debe}</td><td className="p-2 font-mono">{m.haber}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
