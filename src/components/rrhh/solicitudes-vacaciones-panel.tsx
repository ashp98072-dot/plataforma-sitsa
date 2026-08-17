"use client";

import { useCallback, useEffect, useState } from "react";

type Solicitud = {
  id: number;
  empleadoId: number;
  empleadoNombre?: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  estado: "Pendiente" | "Aprobada" | "Rechazada";
  comentarioColaborador: string | null;
  comentarioRrhh: string | null;
  creadoEn: string;
  resueltoEn: string | null;
  resueltoPor: string | null;
};

type Props = {
  slug: string;
  /** Se llama después de aprobar/rechazar, para que la página refresque saldo. */
  onResuelto?: () => void;
};

function fmtUi(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = String(iso).slice(0, 10);
  const [y, m, d] = p.split("-");
  if (!y || !m || !d || y.length !== 4) return p;
  return `${d}/${m}/${y}`;
}

export function SolicitudesVacacionesPanel({ slug, onResuelto }: Props) {
  const [items, setItems] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState<number | null>(null);
  const [comentarios, setComentarios] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/vacaciones/solicitudes`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar.");
      setItems(data.solicitudes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function resolver(id: number, accion: "aprobar" | "rechazar") {
    setProcesando(id);
    setError("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/vacaciones/solicitudes/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accion,
            comentario: comentarios[id]?.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al resolver.");
      await cargar();
      onResuelto?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al resolver.");
    } finally {
      setProcesando(null);
    }
  }

  if (!loading && items.length === 0 && !error) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Solicitudes pendientes de aprobación
          {items.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
              {items.length}
            </span>
          ) : null}
        </h2>
      </div>

      {error ? <p className="mb-2 text-sm text-red-300">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando…</p>
      ) : null}

      <div className="space-y-2">
        {items.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-black/10 p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {s.empleadoNombre ?? `Empleado #${s.empleadoId}`} — {s.tipo}
              </p>
              <p className="text-[var(--muted)]">
                {fmtUi(s.fechaInicio)} → {fmtUi(s.fechaFin)} ·{" "}
                {s.diasHabiles} día(s)
              </p>
              {s.comentarioColaborador ? (
                <p className="text-xs italic text-[var(--muted)]">
                  “{s.comentarioColaborador}”
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Comentario (opcional)"
                className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"
                value={comentarios[s.id] ?? ""}
                onChange={(e) =>
                  setComentarios((prev) => ({
                    ...prev,
                    [s.id]: e.target.value,
                  }))
                }
              />
              <button
                type="button"
                disabled={procesando === s.id}
                onClick={() => resolver(s.id, "aprobar")}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {procesando === s.id ? "…" : "Aprobar"}
              </button>
              <button
                type="button"
                disabled={procesando === s.id}
                onClick={() => resolver(s.id, "rechazar")}
                className="rounded bg-red-600/80 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {procesando === s.id ? "…" : "Rechazar"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
