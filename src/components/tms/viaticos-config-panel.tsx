"use client";

import { useEffect, useState } from "react";

type ConfigRow = {
  id: number;
  puesto: string;
  montoDefecto: number;
};

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

/**
 * VIAT-0 (punto 5, revisión del usuario) — UI mínima para el viático
 * predeterminado por puesto operativo (Piloto, Auxiliar). Lee/guarda contra
 * GET/PUT /api/empresas/[slug]/tms/viaticos-config — los montos SIEMPRE
 * vienen de la fila real en tms_viaticos_config (sembrada por
 * sql/migrate-2026-08-viat-0-viaticos.sql), nunca hardcodeados aquí; si un
 * puesto todavía no tiene fila, se muestra en Q0.00 y el primer "Guardar"
 * la crea vía el mismo PUT (ON DUPLICATE KEY UPDATE).
 */
export default function ViaticosConfigPanel({ slug }: { slug: string }) {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingPuesto, setSavingPuesto] = useState<string | null>(null);
  const [okPuesto, setOkPuesto] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/viaticos-config`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(data.error ?? "No se pudo cargar la configuración.");
          return;
        }
        // Piloto y Auxiliar siempre visibles aunque la BD todavía no tenga
        // fila para alguno (se completa con Q0.00 hasta que se guarde).
        const porPuesto = new Map<string, ConfigRow>(
          (data.config ?? []).map((c: ConfigRow) => [c.puesto, c]),
        );
        const base = ["Piloto", "Auxiliar"].map(
          (p) => porPuesto.get(p) ?? { id: 0, puesto: p, montoDefecto: 0 },
        );
        for (const [puesto, c] of porPuesto) {
          if (!base.some((b) => b.puesto === puesto)) base.push(c);
        }
        setRows(base);
        setMontos(Object.fromEntries(base.map((r) => [r.puesto, String(r.montoDefecto)])));
      } catch {
        if (!ignore) setError("Error de conexión.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug]);

  async function guardar(puesto: string) {
    const txt = montos[puesto] ?? "0";
    const monto = Number(txt);
    if (!Number.isFinite(monto) || monto < 0) {
      setError("Monto inválido.");
      return;
    }
    setSavingPuesto(puesto);
    setError("");
    setOkPuesto(null);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puesto, montoDefecto: monto }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      setOkPuesto(puesto);
    } catch {
      setError("Error de conexión.");
    } finally {
      setSavingPuesto(null);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-sm font-medium">Configuración de viáticos</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Monto predeterminado por puesto operativo (por empresa). Se sugiere
        automáticamente al asignar piloto/auxiliares a un viaje.
      </p>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      {loading ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Cargando…</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-4">
          {rows.map((r) => (
            <div key={r.puesto} className="flex items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                {r.puesto}
                <span className="mt-0.5 flex items-center gap-1">
                  <span>Q</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${inputCls} w-24`}
                    value={montos[r.puesto] ?? "0"}
                    onChange={(e) =>
                      setMontos((m) => ({ ...m, [r.puesto]: e.target.value }))
                    }
                  />
                </span>
              </label>
              <button
                type="button"
                disabled={savingPuesto === r.puesto}
                onClick={() => void guardar(r.puesto)}
                className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {savingPuesto === r.puesto ? "Guardando…" : "Guardar"}
              </button>
              {okPuesto === r.puesto ? (
                <span className="text-[10px] text-emerald-400">Guardado</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
