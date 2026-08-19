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
  const [vista, setVista] = useState<"pendientes" | "resueltas">(
    "pendientes",
  );
  const [items, setItems] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState<number | null>(null);
  const [comentarios, setComentarios] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const estadoQs = vista === "pendientes" ? "Pendiente" : "todas";
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/vacaciones/solicitudes?estado=${estadoQs}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar.");
      const todas = (data.solicitudes ?? []) as Solicitud[];
      setItems(
        vista === "pendientes"
          ? todas
          : todas.filter((s) => s.estado !== "Pendiente"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, vista]);

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

  function descargarBoleta(id: number) {
    window.open(
      `/api/empresas/${slug}/rrhh/vacaciones/solicitudes/${id}/boleta`,
      "_blank",
    );
  }

  if (
    !loading &&
    items.length === 0 &&
    !error &&
    vista === "pendientes"
  ) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <button
          type="button"
          onClick={() => setVista("resueltas")}
          className="text-xs text-[var(--accent-2)] underline"
        >
          No hay solicitudes pendientes · Ver resueltas
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {vista === "pendientes"
            ? "Solicitudes pendientes de aprobación"
            : "Solicitudes resueltas"}
          {vista === "pendientes" && items.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
              {items.length}
            </span>
          ) : null}
        </h2>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setVista("pendientes")}
            className={`rounded px-2 py-1 ${
              vista === "pendientes"
                ? "bg-[var(--accent)] text-white"
                : "bg-black/10 text-[var(--muted)]"
            }`}
          >
            Pendientes
          </button>
          <button
            type="button"
            onClick={() => setVista("resueltas")}
            className={`rounded px-2 py-1 ${
              vista === "resueltas"
                ? "bg-[var(--accent)] text-white"
                : "bg-black/10 text-[var(--muted)]"
            }`}
          >
            Resueltas
          </button>
        </div>
      </div>

      {error ? <p className="mb-2 text-sm text-red-300">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando…</p>
      ) : null}
      {!loading && items.length === 0 && !error ? (
        <p className="text-sm text-[var(--muted)]">
          No hay solicitudes resueltas todavía.
        </p>
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
                {vista === "resueltas" ? (
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      s.estado === "Aprobada"
                        ? "bg-emerald-900/50 text-emerald-200"
                        : "bg-rose-900/50 text-rose-200"
                    }`}
                  >
                    {s.estado}
                  </span>
                ) : null}
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
              {vista === "resueltas" && s.comentarioRrhh ? (
                <p className="text-xs text-[var(--muted)]">
                  RRHH: {s.comentarioRrhh}
                </p>
              ) : null}
            </div>

            {vista === "pendientes" ? (
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
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => descargarBoleta(s.id)}
                  className="rounded bg-[#1F6AA5] px-3 py-1.5 text-xs text-white"
                >
                  Descargar boleta
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
