"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 2) — bandeja de revisión de Operaciones:
 * aprobar/rechazar las cargas de combustible que el piloto registró
 * desde el Portal. Componente propio (no se agrega dentro de
 * flota-client.tsx, que ya son 5600+ líneas) — mismo patrón de
 * dynamic import que InventarioEquipoPanel/VehiculoDocumentos en ese
 * mismo archivo.
 */

type Props = {
  slug: string;
  can: (sub: string, accion?: "ver" | "crear" | "editar" | "eliminar") => boolean;
};

type Estado = "PENDIENTE" | "APROBADO" | "RECHAZADO";

type Carga = {
  id: number;
  viajeId: number;
  placa: string;
  pilotoNombre: string;
  tipoCombustible: "diesel" | "gasolina";
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  estado: Estado;
  motivoRechazo: string | null;
  revisadoPor: string | null;
  revisadoEn: string | null;
  creadoEn: string;
  url: string;
};

const PESTANAS: { estado: Estado; etiqueta: string }[] = [
  { estado: "PENDIENTE", etiqueta: "Pendientes" },
  { estado: "APROBADO", etiqueta: "Aprobados" },
  { estado: "RECHAZADO", etiqueta: "Rechazados" },
];

const input = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

export function CombustibleRevisionPanel({ slug, can }: Props) {
  const [estado, setEstado] = useState<Estado>("PENDIENTE");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [items, setItems] = useState<Carga[]>([]);
  const [resumen, setResumen] = useState<Record<Estado, number>>({ PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [procesando, setProcesando] = useState<number | null>(null);
  const [motivoPorId, setMotivoPorId] = useState<Record<number, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const puedeRevisar = can("flota_combustible", "editar");

  const cargar = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams({ estado });
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      const res = await fetch(`/api/empresas/${slug}/flota/combustible?${params.toString()}`, { signal: ac.signal });
      const data = await res.json().catch(() => ({}));
      if (ac.signal.aborted) return;
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el listado.");
      setItems(data.items ?? []);
      if (data.resumen) setResumen(data.resumen);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [slug, estado, desde, hasta]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    return () => abortRef.current?.abort();
  }, [cargar]);

  async function revisar(id: number, accion: "aprobar" | "rechazar") {
    const motivo = motivoPorId[id]?.trim() ?? "";
    if (accion === "rechazar" && !motivo) {
      setErr("Indica el motivo del rechazo antes de continuar.");
      return;
    }
    setProcesando(id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/flota/combustible/${id}/revisar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, motivo: accion === "rechazar" ? motivo : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo completar la acción.");
      setMsg(data.mensaje ?? "Listo.");
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setProcesando(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted)]">
        Cargas de combustible registradas por los pilotos desde el Portal. Solo lo Aprobado cuenta para el control mensual.
      </p>

      {err ? <p className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{err}</p> : null}
      {msg ? <p className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-sm text-[#8fd4a0]" role="status">{msg}</p> : null}

      <div className="grid grid-cols-3 gap-2">
        {PESTANAS.map((p) => (
          <button
            key={p.estado}
            type="button"
            role="tab"
            aria-selected={estado === p.estado}
            onClick={() => setEstado(p.estado)}
            className={`rounded border p-2 text-center text-sm font-medium transition ${estado === p.estado ? "border-sky-500 bg-sky-950/20 text-sky-200" : "border-[var(--border)] hover:bg-[var(--input)]"}`}
          >
            {p.etiqueta} ({resumen[p.estado]})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">Desde
          <input type="date" className={`${input} mt-0.5 block`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">Hasta
          <input type="date" className={`${input} mt-0.5 block`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
              <th className="px-2 py-2">Fecha</th>
              <th className="px-2 py-2">Unidad</th>
              <th className="px-2 py-2">Piloto</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Galones</th>
              <th className="px-2 py-2">Monto</th>
              <th className="px-2 py-2">Km</th>
              <th className="px-2 py-2">Gasolinera</th>
              <th className="px-2 py-2">Vale</th>
              {estado === "RECHAZADO" ? <th className="px-2 py-2">Motivo</th> : null}
              {puedeRevisar && estado === "PENDIENTE" ? <th className="px-2 py-2">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border)]">
                <td className="px-2 py-2">{c.creadoEn}</td>
                <td className="px-2 py-2">{c.placa}</td>
                <td className="px-2 py-2">{c.pilotoNombre}</td>
                <td className="px-2 py-2">{c.tipoCombustible === "diesel" ? "Diesel" : "Gasolina"}</td>
                <td className="px-2 py-2">{c.galones}</td>
                <td className="px-2 py-2">Q{c.monto.toFixed(2)}</td>
                <td className="px-2 py-2">{c.km != null ? c.km.toLocaleString("es-GT") : "—"}</td>
                <td className="px-2 py-2">{c.gasolinera ?? "—"}</td>
                <td className="px-2 py-2">
                  <a href={c.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">Ver</a>
                </td>
                {estado === "RECHAZADO" ? <td className="px-2 py-2">{c.motivoRechazo ?? "—"}</td> : null}
                {puedeRevisar && estado === "PENDIENTE" ? (
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        disabled={procesando === c.id}
                        onClick={() => void revisar(c.id, "aprobar")}
                      >
                        Aprobar
                      </button>
                      <input
                        className={`${input} w-32`}
                        placeholder="Motivo rechazo"
                        value={motivoPorId[c.id] ?? ""}
                        onChange={(e) => setMotivoPorId((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="rounded border border-red-700 px-2 py-1 text-xs font-medium text-red-300 disabled:opacity-50"
                        disabled={procesando === c.id}
                        onClick={() => void revisar(c.id, "rechazar")}
                      >
                        Rechazar
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {!loading && !items.length ? (
              <tr>
                <td
                  colSpan={9 + (estado === "RECHAZADO" ? 1 : 0) + (puedeRevisar && estado === "PENDIENTE" ? 1 : 0)}
                  className="px-2 py-4 text-[var(--muted)]"
                >
                  Sin registros con este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
