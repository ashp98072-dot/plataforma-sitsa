"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviaReparacion } from "@/lib/rrhh/vacaciones-reparacion-db";

const dma = (iso: string | null | undefined) => {
  const p = String(iso ?? "").slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "—";
};
const n2 = (n: number) => n.toFixed(2);

/**
 * REPARACIÓN ADMINISTRADA de la serie de vacaciones (uno por uno, nunca automática): «Reparar períodos» solo ABRE una vista previa (solo lectura).
 * Únicamente «Confirmar reparación» escribe, y envía la huella de lo que se está viendo: si algo cambió, el servidor aborta y se vuelve a calcular.
 * Con bloqueos el botón de confirmar queda deshabilitado. No modifica la fecha de contratación, las vacaciones registradas ni sus evidencias.
 */
export function ReparacionSerieVacaciones({ slug, empleadoId, onReparado }: { slug: string; empleadoId: number; onReparado: () => void | Promise<void> }) {
  const [abierto, setAbierto] = useState(false);
  const [previa, setPrevia] = useState<PreviaReparacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState("");
  const enCurso = useRef(false);
  const base = `/api/empresas/${slug}/empleados/${empleadoId}/vacaciones/reparacion`;

  const cargarPrevia = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`${base}/preview`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPrevia(null); setError(data.error ?? "No se pudo calcular la vista previa."); return; }
      setPrevia(data as PreviaReparacion);
    } catch {
      setPrevia(null);
      setError("No se pudo calcular la vista previa.");
    } finally {
      setCargando(false);
    }
  }, [base]);

  // al cambiar de colaborador se descarta cualquier vista previa abierta
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicio al cambiar de colaborador
    setAbierto(false); setPrevia(null); setError(""); setResultado("");
  }, [slug, empleadoId]);

  function abrir() {
    setResultado("");
    setAbierto(true);
    void cargarPrevia();
  }

  async function confirmar() {
    if (!previa || !previa.puedeReparar || enCurso.current) return;
    enCurso.current = true;
    setConfirmando(true);
    setError("");
    try {
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ huella: previa.huella }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo reparar la serie. No se modificó nada.");
        if (data.codigo === "CAMBIO_DESDE_PREVIEW") await cargarPrevia(); // la información cambió: se muestra la vista previa actualizada
        return;
      }
      setAbierto(false);
      setPrevia(null);
      setResultado(data.aplicado ? `Períodos reparados. Consumo conservado: ${n2(Number(data.consumidoPreservado ?? 0))} día(s); saldo ${n2(Number(data.saldoAntes ?? 0))} → ${n2(Number(data.saldoDespues ?? 0))}.` : (data.mensaje ?? "No había nada que reparar."));
      await onReparado();
    } catch {
      setError("No se pudo reparar la serie. No se modificó nada.");
    } finally {
      enCurso.current = false;
      setConfirmando(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <button type="button" onClick={abrir} className="rounded-lg border border-amber-400/60 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/10">
        Reparar períodos
      </button>
      {resultado ? <p className="text-xs text-emerald-300" role="status">{resultado}</p> : null}

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Reparar períodos de vacaciones">
          <div className="max-h-[90vh] w-full max-w-3xl space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
            <h2 className="text-base font-semibold">Reparar períodos de vacaciones</h2>
            <p className="text-xs text-[var(--muted)]">
              Esta reparación reconstruirá los períodos de vacaciones usando la fecha de contratación actual. No modifica la fecha de contratación,
              las vacaciones registradas ni sus evidencias.
            </p>

            {cargando ? <p className="text-xs text-[var(--muted)]">Calculando vista previa…</p> : null}
            {error ? <p className="text-xs text-red-300" role="alert">{error}</p> : null}

            {previa ? <VistaPrevia previa={previa} /> : null}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAbierto(false)} disabled={confirmando} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">
                {previa?.requiereReparacion === false ? "Cerrar" : "Cancelar"}
              </button>
              {previa?.requiereReparacion ? (
                <button
                  type="button"
                  onClick={() => void confirmar()}
                  disabled={!previa.puedeReparar || confirmando || cargando}
                  className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {confirmando ? "Reparando…" : "Confirmar reparación"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VistaPrevia({ previa }: { previa: PreviaReparacion }) {
  if (!previa.requiereReparacion) {
    return <p className="rounded border border-emerald-400/40 bg-emerald-400/10 p-2 text-xs text-emerald-200">La serie de este colaborador ya coincide con su fecha de contratación: no hay nada que reparar.</p>;
  }
  return (
    <div className="space-y-3 text-xs">
      <p>
        Fecha de contratación actual: <strong>{dma(previa.fechaAltaActual)}</strong> · Vacaciones registradas: <strong>{previa.vacacionesRegistradas}</strong> ·
        Consumo que se conservará: <strong>{n2(previa.consumidoPreservado)}</strong> día(s) · Saldo utilizable antes: <strong>{n2(previa.saldoAntes)}</strong> → después:{" "}
        <strong>{n2(previa.saldoDespues)}</strong>.
      </p>
      {previa.traslapesActuales || previa.aniosLaboralesDuplicados.length || previa.periodosFueraDeBase.length ? (
        <p className="text-amber-200">
          Problemas detectados: {previa.traslapesActuales} traslape(s) · {previa.aniosLaboralesDuplicados.length} año(s) laboral(es) duplicado(s) · {previa.periodosFueraDeBase.length} período(s) fuera de la base.
        </p>
      ) : null}
      {previa.bloqueos.length ? (
        <ul className="space-y-1 text-red-300">{previa.bloqueos.map((b, i) => <li key={`${b.codigo}-${i}`}><strong>No se puede reparar:</strong> {b.mensaje}</li>)}</ul>
      ) : null}
      {previa.advertencias.length ? <ul className="list-disc space-y-1 pl-5 text-amber-100">{previa.advertencias.map((a) => <li key={a}>{a}</li>)}</ul> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 font-medium">Períodos actuales ({previa.periodosActuales.length})</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-2">Año</th><th className="pr-2">Período</th><th className="pr-2 text-right">Consumidos</th><th>Estado</th></tr></thead>
              <tbody>
                {previa.periodosActuales.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-2">{p.anioLaboral ?? "—"}</td><td className="pr-2">{dma(p.inicio)} → {dma(p.fin)}</td><td className="pr-2 text-right">{n2(p.consumidos)}</td><td>{p.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="mb-1 font-medium">Períodos resultantes ({previa.periodosPropuestos.length})</p>
          {previa.periodosPropuestos.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-2">Año</th><th className="pr-2">Período</th><th className="pr-2 text-right">Consumidos</th><th className="pr-2 text-right">Disponibles</th><th>Estado</th></tr></thead>
                <tbody>
                  {previa.periodosPropuestos.map((p) => (
                    <tr key={p.anioLaboral} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-2">{p.anioLaboral}</td><td className="pr-2">{dma(p.inicio)} → {dma(p.fin)}</td><td className="pr-2 text-right">{n2(p.consumidos)}</td><td className="pr-2 text-right">{n2(p.disponibles)}</td><td>{p.estado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-[var(--muted)]">No se puede proponer una serie mientras existan bloqueos.</p>}
        </div>
      </div>
    </div>
  );
}
