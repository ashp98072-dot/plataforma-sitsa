"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type TipoReporte = "viaje" | "unidad" | "cliente" | "categoria" | "periodo" | "viaticos" | "rentabilidad";

const TIPOS: { value: TipoReporte; label: string }[] = [
  { value: "viaje", label: "Gastos por viaje" },
  { value: "unidad", label: "Gastos por unidad" },
  { value: "cliente", label: "Gastos por cliente" },
  { value: "categoria", label: "Gastos por categoría" },
  { value: "periodo", label: "Gastos por período" },
  { value: "viaticos", label: "Viáticos por viaje/empleado" },
  { value: "rentabilidad", label: "Rentabilidad por viaje" },
];

type FilaAgregada = { clave: string; etiqueta: string; registros: number; totalMonto: number };
type FilaViatico = { planCodigo: string; fechaPlan: string; personalNombre: string; rol: string; montoSugerido: number; montoAsignado: number; estado: string };
type FilaRentabilidad = { planCodigo: string; fechaPlan: string; clienteNombre: string | null; tarifaComercial: number; costoOperativo: number | null; gastos: number; viaticos: number; utilidad: number };

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const money = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2 })}`;

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — reportes iniciales de gastos/viáticos/
 * rentabilidad. Solo lectura + exportación a Excel; cada tipo reutiliza el
 * endpoint único /tms/reportes/gastos?tipo=... (mismo criterio de
 * filtros que el exportador, nunca dos parseos que puedan divergir).
 */
export default function ReportesGastosPage() {
  const slug = String(useParams().slug);
  const [tipo, setTipo] = useState<TipoReporte>("viaje");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filas, setFilas] = useState<unknown[]>([]);
  const [etiqueta, setEtiqueta] = useState("Clave");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ tipo });
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      const res = await fetch(`/api/empresas/${slug}/tms/reportes/gastos?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el reporte.");
      setFilas(data.filas ?? []);
      setEtiqueta(data.etiqueta ?? "Clave");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, tipo, fechaDesde, fechaHasta]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function exportarUrl() {
    const params = new URLSearchParams({ tipo });
    if (fechaDesde) params.set("fechaDesde", fechaDesde);
    if (fechaHasta) params.set("fechaHasta", fechaHasta);
    return `/api/empresas/${slug}/tms/reportes/gastos/exportar?${params.toString()}`;
  }

  const esAgregado = tipo !== "viaticos" && tipo !== "rentabilidad";

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Reportes de gastos</h1>
        <a href={exportarUrl()} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">Exportar a Excel</a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoReporte)}>
          {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="date" className={inputCls} value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
        <input type="date" className={inputCls} value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}

      {!loading && esAgregado ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]"><tr><th className="px-2 py-1">{etiqueta}</th><th className="px-2 py-1">Registros</th><th className="px-2 py-1">Total</th></tr></thead>
          <tbody>
            {(filas as FilaAgregada[]).map((f) => (
              <tr key={f.clave} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.etiqueta}</td><td className="px-2 py-1">{f.registros}</td><td className="px-2 py-1">{money(f.totalMonto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && tipo === "viaticos" ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]"><tr><th className="px-2 py-1">Viaje</th><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Persona</th><th className="px-2 py-1">Rol</th><th className="px-2 py-1">Sugerido</th><th className="px-2 py-1">Asignado</th><th className="px-2 py-1">Estado</th></tr></thead>
          <tbody>
            {(filas as FilaViatico[]).map((f, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.planCodigo}</td><td className="px-2 py-1">{f.fechaPlan}</td><td className="px-2 py-1">{f.personalNombre}</td>
                <td className="px-2 py-1">{f.rol}</td><td className="px-2 py-1">{money(f.montoSugerido)}</td><td className="px-2 py-1">{money(f.montoAsignado)}</td><td className="px-2 py-1">{f.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && tipo === "rentabilidad" ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]"><tr><th className="px-2 py-1">Viaje</th><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Tarifario</th><th className="px-2 py-1">Costo operativo</th><th className="px-2 py-1">Gastos</th><th className="px-2 py-1">Viáticos</th><th className="px-2 py-1">Utilidad</th></tr></thead>
          <tbody>
            {(filas as FilaRentabilidad[]).map((f, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.planCodigo}</td><td className="px-2 py-1">{f.fechaPlan}</td><td className="px-2 py-1">{f.clienteNombre ?? "—"}</td>
                <td className="px-2 py-1">{money(f.tarifaComercial)}</td><td className="px-2 py-1">{f.costoOperativo != null ? money(f.costoOperativo) : "—"}</td>
                <td className="px-2 py-1">{money(f.gastos)}</td><td className="px-2 py-1">{money(f.viaticos)}</td>
                <td className={`px-2 py-1 ${f.utilidad < 0 ? "text-red-400" : "text-emerald-400"}`}>{money(f.utilidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && !filas.length ? <p className="text-[var(--muted)]">Sin datos para este filtro.</p> : null}
    </div>
  );
}
