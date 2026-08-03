"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function ReportesRrhhPage() {
  const slug = String(useParams().slug);
  const [desde, setDesde] = useState(new Date().toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10));
  const [filas, setFilas] = useState<Record<string, unknown>[]>([]);
  const [msg, setMsg] = useState("");

  const consultar = useCallback(async () => {
    setMsg("");
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/reportes?desde=${desde}&hasta=${hasta}`,
    );
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? "Error");
      return;
    }
    setFilas(data.filas ?? []);
  }, [slug, desde, hasta]);

  function exportarExcel() {
    window.open(
      `/api/empresas/${slug}/rrhh/reportes?desde=${desde}&hasta=${hasta}&formato=xlsx`,
      "_blank",
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reportes RRHH</h1>
        <p className="text-sm text-[var(--muted)]">
          Asistencias por rango · export Excel.{" "}
          <Link href={`/e/${slug}/rrhh`} className="text-[var(--accent)] underline">RRHH</Link>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <button type="button" onClick={() => void consultar()} className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Consultar</button>
        <button type="button" onClick={exportarExcel} className="rounded bg-[var(--accent-2)] px-3 py-1 text-sm">Excel</button>
      </div>
      {msg ? <p className="text-sm text-red-300">{msg}</p> : null}
      <p className="text-sm text-[var(--muted)]">{filas.length} registros</p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#334155] text-white">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Entrada</th>
              <th className="px-3 py-2">Salida</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r, idx) => (
              <tr key={idx} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{String(r.codigo)}</td>
                <td className="px-3 py-2">{String(r.nombre)}</td>
                <td className="px-3 py-2">{String(r.fecha_jornada).slice(0, 10)}</td>
                <td className="px-3 py-2">{r.entrada_at ? String(r.entrada_at) : "—"}</td>
                <td className="px-3 py-2">{r.salida_at ? String(r.salida_at) : "—"}</td>
                <td className="px-3 py-2">{String(r.estado ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
