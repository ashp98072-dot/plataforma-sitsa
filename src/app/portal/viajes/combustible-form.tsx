"use client";

import { useEffect, useState, type FormEvent } from "react";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 1: captura del piloto) — registrar la carga
 * de combustible del viaje en curso (galones, monto, km, gasolinera y
 * foto del vale) y ver el estado de lo ya registrado (Pendiente hasta
 * que Operaciones lo revise — la revisión es una fase aparte, todavía no
 * construida). Componente propio (no se agrega dentro de viaje-form.tsx,
 * que ya es grande) para mantener el cambio chico y reversible.
 *
 * A diferencia de "Adjuntar evidencia" (tablero/parada, con geoestampado
 * GPS en la foto para probar ubicación), la foto aquí es solo el
 * respaldo del vale físico que ya entregó la gasolinera — no necesita el
 * flujo de cámara en vivo con overlay; un input de cámara nativo del
 * dispositivo es suficiente y mucho más simple.
 */

type EstadoCarga = "PENDIENTE" | "APROBADO" | "RECHAZADO";

type CargaCombustible = {
  id: number;
  tipoCombustible: "diesel" | "gasolina";
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  nombreArchivo: string;
  estado: EstadoCarga;
  motivoRechazo: string | null;
  creadoEn: string;
  url: string;
};

const ESTADO_LABEL: Record<EstadoCarga, string> = {
  PENDIENTE: "Pendiente de revisión",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
};

const ESTADO_CLASE: Record<EstadoCarga, string> = {
  PENDIENTE: "bg-amber-950/30 text-amber-300",
  APROBADO: "bg-emerald-950/30 text-[#8fd4a0]",
  RECHAZADO: "bg-red-950/30 text-red-300",
};

export default function CombustibleForm({ viajeId }: { viajeId: number | null }) {
  const [cargas, setCargas] = useState<CargaCombustible[]>([]);
  const [tipoCombustible, setTipoCombustible] = useState<"diesel" | "gasolina">("diesel");
  const [galones, setGalones] = useState("");
  const [monto, setMonto] = useState("");
  const [km, setKm] = useState("");
  const [gasolinera, setGasolinera] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!viajeId) return;
    let cancelado = false;
    fetch(`/api/portal/viajes/${viajeId}/combustible`)
      .then((res) => (res.ok ? res.json() : { cargas: [] }))
      .then((data) => { if (!cancelado) setCargas(data.cargas ?? []); })
      .catch(() => undefined);
    return () => { cancelado = true; };
  }, [viajeId, mensaje]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!viajeId) return;
    const g = Number(galones);
    const m = Number(monto);
    if (!Number.isFinite(g) || g <= 0) return setError("Indica los galones cargados.");
    if (!Number.isFinite(m) || m <= 0) return setError("Indica el valor pagado.");
    if (!archivo) return setError("Adjunta la fotografía del vale.");
    setError(""); setMensaje(""); setLoading(true);
    try {
      const form = new FormData();
      form.set("tipoCombustible", tipoCombustible);
      form.set("galones", String(g));
      form.set("monto", String(m));
      if (km.trim()) form.set("km", km.trim());
      if (gasolinera.trim()) form.set("gasolinera", gasolinera.trim());
      form.set("file", archivo, archivo.name);
      const res = await fetch(`/api/portal/viajes/${viajeId}/combustible`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar la carga de combustible.");
      setMensaje(data.mensaje ?? "Registrado.");
      setGalones(""); setMonto(""); setKm(""); setGasolinera(""); setArchivo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la carga de combustible.");
    } finally {
      setLoading(false);
    }
  }

  if (!viajeId) return null;

  return (
    <form onSubmit={enviar} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold">Registrar carga de combustible</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Registra cada vez que cargues diesel o gasolina en este viaje. Operaciones revisará el vale.
      </p>

      {error ? <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{error}</p> : null}
      {mensaje ? <p className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3 text-sm text-[#8fd4a0]" role="status">{mensaje}</p> : null}

      <label className="mt-4 block text-sm text-[var(--muted)]">Tipo de combustible
        <select
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          value={tipoCombustible}
          onChange={(e) => setTipoCombustible(e.target.value as "diesel" | "gasolina")}
        >
          <option value="diesel">Diesel</option>
          <option value="gasolina">Gasolina</option>
        </select>
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Galones cargados
        <input type="number" min={0.01} step={0.01} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={galones} onChange={(e) => setGalones(e.target.value)} required />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Valor pagado (Q)
        <input type="number" min={0.01} step={0.01} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={monto} onChange={(e) => setMonto(e.target.value)} required />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Kilometraje al momento de cargar
        <input type="number" min={0} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={km} onChange={(e) => setKm(e.target.value)} />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Gasolinera / sucursal
        <input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={gasolinera} onChange={(e) => setGasolinera(e.target.value)} maxLength={150} placeholder="Ej. Shell Zona 10" />
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">Foto del vale
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="mt-1 block w-full text-sm"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          required
        />
      </label>

      <button className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={loading}>
        Guardar carga de combustible
      </button>

      {cargas.length ? (
        <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-medium">Cargas registradas en este viaje</p>
          {cargas.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{c.tipoCombustible === "diesel" ? "Diesel" : "Gasolina"} · {c.galones} gal · Q{c.monto.toFixed(2)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span>
              </div>
              {c.gasolinera ? <p className="mt-1 text-[var(--muted)]">{c.gasolinera}</p> : null}
              {c.motivoRechazo ? <p className="mt-1 text-red-300">Motivo: {c.motivoRechazo}</p> : null}
              <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-400 hover:underline">Ver vale</a>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}
