"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ViajeAbiertoPiloto } from "@/lib/flota/viajes-piloto";
import type { PlanSalidaMatch } from "@/lib/tms/planes-salida";

export default function ViajeForm({
  viajeAbierto,
  planesHoy,
}: {
  viajeAbierto: ViajeAbiertoPiloto | null;
  planesHoy: PlanSalidaMatch[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);

  // Formulario de salida
  const [placa, setPlaca] = useState("");
  const [kmSalida, setKmSalida] = useState("");
  const [destino, setDestino] = useState("");

  // Formulario de llegada
  const [kmLlegada, setKmLlegada] = useState("");
  const [observaciones, setObservaciones] = useState("");

  async function enviar(payload: Record<string, unknown>) {
    setError("");
    setMensaje("");
    setLoading(true);
    try {
      const res = await fetch("/api/portal/viajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo completar la acción.");
      setMensaje(data.mensaje ?? "Listo.");
      setPlaca("");
      setKmSalida("");
      setDestino("");
      setKmLlegada("");
      setObservaciones("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      setLoading(false);
    }
  }

  async function onSalida(e: FormEvent) {
    e.preventDefault();
    const km = Number(kmSalida);
    if (!placa.trim() || !Number.isFinite(km) || km < 0) {
      setError("Indica placa y kilometraje de salida válidos.");
      return;
    }
    await enviar({
      accion: "salida",
      placa: placa.trim(),
      kmSalida: km,
      destino: destino.trim() || undefined,
    });
  }

  async function onLlegada(e: FormEvent) {
    e.preventDefault();
    if (!viajeAbierto) return;
    const km = Number(kmLlegada);
    if (!Number.isFinite(km) || km < 0) {
      setError("Indica el kilometraje de llegada.");
      return;
    }
    await enviar({
      accion: "llegada",
      viajeId: viajeAbierto.id,
      kmLlegada: km,
      observaciones: observaciones.trim() || undefined,
    });
  }

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <p className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {mensaje ? (
        <p className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-sm text-[#8fd4a0]" role="status">
          {mensaje}
        </p>
      ) : null}

      {viajeAbierto ? (
        <form
          onSubmit={onLlegada}
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Viaje en curso
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Placa <span className="font-medium text-[var(--foreground)]">{viajeAbierto.placa}</span> ·
            {" "}Km salida {viajeAbierto.kmSalida.toLocaleString("es-GT")} ·{" "}
            {viajeAbierto.horaSalida}
            {viajeAbierto.destino ? ` · Destino: ${viajeAbierto.destino}` : ""}
            {viajeAbierto.planId ? " · Ruta asignada por Operaciones vinculada" : ""}
          </p>

          <label className="mt-4 block text-sm text-[var(--muted)]">
            Km de llegada
            <input
              type="number"
              inputMode="numeric"
              min={viajeAbierto.kmSalida}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
              value={kmLlegada}
              onChange={(e) => setKmLlegada(e.target.value)}
              required
            />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">
            Observaciones (opcional)
            <textarea
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
              rows={2}
              maxLength={500}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-50 sm:w-auto"
          >
            {loading ? "Registrando…" : "Registrar llegada"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={onSalida}
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Registrar salida
          </h2>

          {planesHoy.length ? (
            <p className="mt-1 text-xs text-[#8fd4a0]">
              Operaciones te asignó {planesHoy.length === 1 ? "una ruta" : `${planesHoy.length} rutas`} hoy
              {planesHoy.length === 1
                ? ` (${planesHoy[0].codigo}${planesHoy[0].cliente ? ` · ${planesHoy[0].cliente}` : ""})`
                : ""}
              . Se vincula sola al marcar la salida.
            </p>
          ) : null}

          <label className="mt-4 block text-sm text-[var(--muted)]">
            Placa del camión
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 uppercase"
              value={placa}
              onChange={(e) => setPlaca(e.target.value)}
              placeholder="Ej. C-034BXR"
              required
            />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">
            Km de salida
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
              value={kmSalida}
              onChange={(e) => setKmSalida(e.target.value)}
              required
            />
          </label>

          <label className="mt-3 block text-sm text-[var(--muted)]">
            Destino (opcional)
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              maxLength={200}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-50 sm:w-auto"
          >
            {loading ? "Registrando…" : "Registrar salida"}
          </button>
        </form>
      )}
    </div>
  );
}
