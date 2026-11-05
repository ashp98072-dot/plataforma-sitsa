"use client";
import { useEffect, useState } from "react";
import { libroUnicoActivo } from "@/lib/contabilidad/seleccion-libro";
import type { BancoContable } from "@/lib/contabilidad/bancos-shared";

type Entidad = { id: number; codigo: string; nombre: string; activa: number };
async function datos(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw Error(data?.error ?? "No se pudo consultar el catálogo bancario.");
  return data;
}
export function BancosClient({ slug }: { slug: string }) {
  const [entidades, setEntidades] = useState<Entidad[] | null>(null), [seleccion, setSeleccion] = useState("");
  const [error, setError] = useState("");
  const base = `/api/empresas/${encodeURIComponent(slug)}/contabilidad/bancos`;
  useEffect(() => {
    const ac = new AbortController();
    fetch(base, { cache: "no-store", signal: ac.signal }).then(datos).then(d => {
      if (!ac.signal.aborted) { setEntidades(d.entidades); setSeleccion(libroUnicoActivo(d.entidades)); }
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [base]);
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Cuentas bancarias contables</h1>
    <p>Consulta de la configuración registrada por entidad. No incluye saldos ni movimientos bancarios.</p>
    <a className="underline" href={`/e/${encodeURIComponent(slug)}/contabilidad`}>Volver a Contabilidad</a>
    {error ? <p role="alert">{error}</p> : entidades === null ? <p role="status">Cargando entidades…</p> : entidades.length === 0 ? <p>No hay entidades disponibles.</p> : <>
      <label>Entidad contable <select aria-label="Entidad contable" value={seleccion} onChange={e => setSeleccion(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--input)] p-2">
        <option value="">Seleccionar entidad</option>
        {entidades.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}{Number(e.activa) === 0 ? " (inactiva)" : ""}</option>)}
      </select></label>
      {seleccion && <ListaBancos key={`${base}:${seleccion}`} base={base} entidad={seleccion} />}
    </>}
  </div>;
}
function ListaBancos({ base, entidad }: { base: string; entidad: string }) {
  const [bancos, setBancos] = useState<BancoContable[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}?entidad=${entidad}`, { cache: "no-store", signal: ac.signal }).then(datos).then(d => {
      if (!ac.signal.aborted) setBancos(d.bancos);
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [base, entidad]);
  if (error) return <p role="alert">{error}</p>;
  if (bancos === null) return <p role="status">Cargando cuentas bancarias…</p>;
  if (!bancos.length) return <p>No hay cuentas bancarias configuradas en esta entidad.</p>;
  return <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><table className="w-full text-left text-sm">
    <caption className="pb-3 text-left">Configuración bancaria registrada. Las cuentas inactivas se muestran para consulta.</caption>
    <thead><tr>{["Banco", "Alias", "Moneda", "Cuenta contable", "Estado", "Configuración"].map(h => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead>
    <tbody>{bancos.map(b => <tr key={b.id} className="border-t border-[var(--border)]">
      <td className="p-2">{b.banco ?? "Sin configurar"}</td><td className="p-2">{b.alias ?? "Sin configurar"}</td><td className="p-2">{b.moneda ?? "Sin configurar"}</td>
      <td className="p-2">{b.cuenta ? `${b.cuenta.codigo ?? "Sin código"} — ${b.cuenta.nombre ?? "Sin nombre"}` : "No disponible"}</td>
      <td className="p-2">{b.activa === true ? "Activa" : b.activa === false ? "Inactiva" : "Sin configurar"}</td>
      <td className="p-2">{b.advertencias.length ? b.advertencias.join(" ") : "Sin advertencias de configuración"}</td>
    </tr>)}</tbody>
  </table></div>;
}
