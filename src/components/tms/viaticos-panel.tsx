"use client";

import { useCallback, useEffect, useState } from "react";

type ViaticoRow = {
  id: number;
  personalNombre: string;
  rol: string;
  puesto: string;
  montoSugerido: number;
  montoAsignado: number;
  motivoCambio: string | null;
  modificadoPor: string | null;
  estado: string;
};

function q(n: number): string {
  return `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

/**
 * VIAT-0 (puntos 6-7) — viáticos operativos del plan: viático sugerido
 * (según el puesto de cada piloto/auxiliar asignado, ya calculado por el
 * servidor) y monto asignado editable, con motivo obligatorio cuando el
 * monto difiere del sugerido. Las filas las crea automáticamente el
 * servidor (sincronizarViaticosPlan) en cuanto el plan se guarda con
 * piloto/auxiliares — este panel solo lee y permite ajustar el monto de
 * cada uno, nunca crea/quita personal del plan.
 *
 * Información INTERNA (punto 4): vive únicamente en TMS/RRHH, nunca en una
 * pantalla o respuesta destinada al cliente.
 */
export default function ViaticosPanel({
  slug,
  planId,
}: {
  slug: string;
  planId: number;
}) {
  const [rows, setRows] = useState<ViaticoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [motivos, setMotivos] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [okId, setOkId] = useState<number | null>(null);

  const cargar = useCallback(
    async (opts?: { silencioso?: boolean }) => {
      if (!opts?.silencioso) setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/viaticos`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "No se pudieron cargar los viáticos.");
          return;
        }
        const list: ViaticoRow[] = data.viaticos ?? [];
        setRows(list);
        setMontos(Object.fromEntries(list.map((r) => [r.id, String(r.montoAsignado)])));
        setMotivos(Object.fromEntries(list.map((r) => [r.id, r.motivoCambio ?? ""])));
      } catch {
        setError("Error de conexión.");
      } finally {
        if (!opts?.silencioso) setLoading(false);
      }
    },
    [slug, planId],
  );

  // Carga inicial + al cambiar de plan — IIFE inline con bandera `ignore`
  // (mismo patrón que src/app/e/[slug]/rrhh/horas-extra/page.tsx), en vez de
  // llamar a `cargar` directamente: evita el set-state síncrono dentro del
  // efecto que exige el linter de hooks.
  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/viaticos`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(data.error ?? "No se pudieron cargar los viáticos.");
          return;
        }
        const list: ViaticoRow[] = data.viaticos ?? [];
        setRows(list);
        setMontos(Object.fromEntries(list.map((r) => [r.id, String(r.montoAsignado)])));
        setMotivos(Object.fromEntries(list.map((r) => [r.id, r.motivoCambio ?? ""])));
      } catch {
        if (!ignore) setError("Error de conexión.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug, planId]);

  async function guardar(row: ViaticoRow) {
    const montoTxt = montos[row.id] ?? String(row.montoAsignado);
    const monto = Number(montoTxt);
    if (!Number.isFinite(monto) || monto < 0) {
      setError("Monto inválido.");
      return;
    }
    const difiere = Math.abs(monto - row.montoSugerido) > 0.005;
    const motivo = (motivos[row.id] ?? "").trim();
    if (difiere && !motivo) {
      setError(
        `Indica el motivo del cambio para ${row.personalNombre}: el monto difiere del predeterminado.`,
      );
      return;
    }
    setSavingId(row.id);
    setError("");
    setOkId(null);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          montoAsignado: monto,
          motivoCambio: difiere ? motivo : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el viático.");
        return;
      }
      setOkId(row.id);
      await cargar({ silencioso: true });
    } catch {
      setError("Error de conexión.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="md:col-span-4 rounded border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
        Cargando viáticos…
      </div>
    );
  }

  const pilotos = rows.filter((r) => r.rol === "Piloto");
  const auxiliares = rows.filter((r) => r.rol !== "Piloto");

  function fila(r: ViaticoRow) {
    const montoTxt = montos[r.id] ?? String(r.montoAsignado);
    const monto = Number(montoTxt);
    const difiere = Number.isFinite(monto) && Math.abs(monto - r.montoSugerido) > 0.005;
    return (
      <div key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] p-2">
        <div className="min-w-[140px] flex-1">
          <p className="text-sm">{r.personalNombre}</p>
          <p className="text-[10px] text-[var(--muted)]">puesto: {r.puesto}</p>
        </div>
        <div className="text-[11px] text-[var(--muted)]">
          Sugerido
          <br />
          {q(r.montoSugerido)}
        </div>
        <label className="text-[11px] text-[var(--muted)]">
          Asignado
          <input
            type="number"
            min="0"
            step="0.01"
            className={`${inputCls} mt-0.5 block w-24`}
            value={montoTxt}
            onChange={(e) => setMontos((m) => ({ ...m, [r.id]: e.target.value }))}
          />
        </label>
        {difiere ? (
          <input
            className={`${inputCls} min-w-[160px] flex-1`}
            placeholder="Motivo del ajuste (obligatorio)"
            value={motivos[r.id] ?? ""}
            onChange={(e) => setMotivos((m) => ({ ...m, [r.id]: e.target.value }))}
          />
        ) : null}
        <button
          type="button"
          disabled={savingId === r.id}
          onClick={() => void guardar(r)}
          className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {savingId === r.id ? "Guardando…" : "Guardar"}
        </button>
        {okId === r.id ? <span className="text-[10px] text-emerald-400">Guardado</span> : null}
        {r.modificadoPor ? (
          <span className="w-full text-[10px] text-[var(--muted)]">
            Último cambio: {r.modificadoPor}
            {r.motivoCambio ? ` · ${r.motivoCambio}` : ""}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="md:col-span-4 space-y-2 rounded border border-[var(--border)] p-3">
      <p className="text-xs font-medium">
        Viáticos del viaje (información interna — no se muestra al cliente)
      </p>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {!rows.length ? (
        <p className="text-xs text-[var(--muted)]">
          Sin piloto/auxiliares asignados todavía, o el plan aún no se ha guardado.
        </p>
      ) : (
        <div className="space-y-3">
          {pilotos.length ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Piloto</p>
              {pilotos.map(fila)}
            </div>
          ) : null}
          {auxiliares.length ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Auxiliares</p>
              {auxiliares.map(fila)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
