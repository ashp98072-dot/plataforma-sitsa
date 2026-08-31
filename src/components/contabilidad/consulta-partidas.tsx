"use client";
import { useEffect, useRef, useState } from "react";

type Detalle = {
  asiento: { numero: string; fecha: string; glosa: string; estado: string; creado_por: string };
  lineas: { id: number; cuenta_id: number; codigo: string | null; nombre: string | null; debe: string; haber: string }[];
  totales: { debe: string; haber: string; diferencia: string };
};
export function ConsultaPartidas({ url, asientos }: { url: string; asientos: Record<string, unknown>[] }) {
  const solicitud = useRef<AbortController | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  useEffect(() => () => solicitud.current?.abort(), []);
  function cerrar() {
    solicitud.current?.abort(); setDetalle(null); setError(""); setCargando(false);
  }
  async function consultar(id: string) {
    solicitud.current?.abort();
    const controller = new AbortController();
    solicitud.current = controller;
    setDetalle(null); setError(""); setCargando(true);
    try {
      const res = await fetch(url + "&id=" + encodeURIComponent(id), { cache: "no-store", signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo consultar la partida.");
      if (!controller.signal.aborted) setDetalle(data);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Error de conexión.");
    } finally { if (!controller.signal.aborted) setCargando(false); }
  }
  return <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
    <h2 className="font-medium">Consulta de partidas</h2>
    <p className="text-sm">Últimas 100 partidas de la entidad seleccionada. Los importes corresponden a cada partida, no al saldo del libro.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr>{["Número", "Fecha", "Glosa", "Debe", "Haber", "Consulta"].map((t) => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{asientos.map((a) => <tr key={String(a.id)}>
        <td className="p-2">{String(a.numero)}</td><td>{String(a.fecha).slice(0, 10)}</td><td>{String(a.glosa ?? "")}</td>
        <td>{String(a.total_debe ?? "—")}</td><td>{String(a.total_haber ?? "—")}</td>
        <td><button type="button" className="underline" onClick={() => void consultar(String(a.id))}>Ver detalle</button></td>
      </tr>)}</tbody>
    </table></div>
    {!asientos.length && <p>Sin partidas registradas.</p>}
    {cargando && <p role="status">Cargando partida…</p>}
    {error && <p role="alert">{error}</p>}
    {(detalle || cargando || error) && <button type="button" className="underline" onClick={cerrar}>Cerrar detalle</button>}
    {detalle && <article aria-label="Detalle de partida" className="space-y-2">
      <h3>Partida {detalle.asiento.numero} · {detalle.asiento.fecha}</h3>
      <p>{detalle.asiento.glosa}</p>
      <p>Estado: {detalle.asiento.estado} · Registrada por: {detalle.asiento.creado_por}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr><th>Cuenta</th><th>Nombre</th><th>Debe</th><th>Haber</th></tr></thead>
        <tbody>{detalle.lineas.map((l) => <tr key={l.id}><td>{l.codigo ?? "Cuenta no disponible"}</td><td>{l.nombre ?? "—"}</td><td>{l.debe}</td><td>{l.haber}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={2}>Totales</th><td>{detalle.totales.debe}</td><td>{detalle.totales.haber}</td></tr></tfoot>
      </table></div>
      <p>Diferencia: {detalle.totales.diferencia}</p>
      {detalle.totales.diferencia !== "0.00" && <p role="alert">Esta partida no cuadra. Requiere revisión contable.</p>}
      {!detalle.lineas.length && <p role="alert">La partida no tiene líneas. Requiere revisión.</p>}
    </article>}
  </section>;
}
