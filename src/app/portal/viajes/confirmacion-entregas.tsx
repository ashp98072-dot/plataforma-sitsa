"use client";

import { useRef, useState } from "react";
import type { ConfirmacionParada } from "@/lib/tms/parada-confirmacion";
import {
  ETIQUETA_RECEPCION_OFICIAL, ETIQUETA_RESULTADO, fechaConfirmacion, notaValida, NOTA_MAX_UI, NOTA_MIN_UI, puedeActuar, puedeEnviar, RESULTADOS_CON_INCIDENCIA,
  rutaConfirmar, TEXTO_RECEPCION_OFICIAL, TEXTO_REVISION_HUMANA, usuarioVisible, type EntregaVista, type ResultadoConIncidencia,
} from "@/lib/tms/parada-confirmacion-ui";

/**
 * TMS-ENTREGA-PILOTO-2 — confirmación de entrega por parada en el Portal del piloto. REUTILIZA el flujo de evidencia que ya existe en ViajeForm
 * (cámara con GPS/hora impresos + POST /api/portal/viajes/[id]/evidencias): aquí NO hay una segunda pantalla de cámara; «Subir evidencia» solo
 * preselecciona la parada en ese formulario (onSubirEvidencia). La acción habla únicamente con POST /api/portal/viajes/[id]/paradas/[paradaId]/confirmar.
 * Nada de esta pantalla publica estados externos ni crea solicitudes PriceSmart; la «recepción oficial» se muestra siempre como pendiente y separada.
 */
type Props = {
  viajeId: number;
  entregas: EntregaVista[];
  /** Solo el piloto del viaje puede confirmar (el servidor lo vuelve a validar); un auxiliar ve el estado en solo lectura. */
  puedeConfirmar: boolean;
  onSubirEvidencia?: (paradaId: number) => void;
  onConfirmada?: () => void;
};
const FALLO_RED = "Sin conexión con el servidor. Tu confirmación no se perdió: vuelve a intentarlo (no se duplicará).";

export default function ConfirmacionEntregas({ viajeId, entregas, puedeConfirmar, onSubirEvidencia, onConfirmada }: Props) {
  const [locales, setLocales] = useState<Record<number, ConfirmacionParada>>({});
  const [enviando, setEnviando] = useState<number | null>(null);
  const [errores, setErrores] = useState<Record<number, string>>({});
  const [formAbierto, setFormAbierto] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoConIncidencia>("PARCIAL");
  const [nota, setNota] = useState("");
  const enVuelo = useRef(false);   // cerrojo síncrono: dos toques seguidos no envían dos peticiones aunque el estado aún no se haya repintado

  async function enviar(paradaId: number, cuerpo: { resultado: string; nota?: string }) {
    if (enVuelo.current) return;
    enVuelo.current = true; setEnviando(paradaId); setErrores((e) => ({ ...e, [paradaId]: "" }));
    try {
      let res: Response;
      try {
        res = await fetch(rutaConfirmar(viajeId, paradaId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      } catch {
        setErrores((e) => ({ ...e, [paradaId]: FALLO_RED })); return;
      }
      let datos: { confirmacion?: ConfirmacionParada; error?: string } | null = null;
      try { datos = await res.json(); } catch { datos = null; }
      if (res.ok && datos?.confirmacion) {
        // 201 (nueva) y 200 (reintento idéntico ya guardado) se muestran igual: la confirmación existe una sola vez.
        const confirmacion = datos.confirmacion;
        setLocales((l) => ({ ...l, [paradaId]: confirmacion })); setFormAbierto(null); setNota("");
        onConfirmada?.();
      } else {
        setErrores((e) => ({ ...e, [paradaId]: datos?.error ?? "No se pudo registrar la confirmación." }));
        if (res.status === 409) onConfirmada?.();   // el servidor ya tiene otro estado de esta parada: se vuelve a leer
      }
    } finally { enVuelo.current = false; setEnviando(null); }
  }

  if (!entregas.length) return null;
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5" aria-labelledby="titulo-confirmacion-entregas">
    <h2 id="titulo-confirmacion-entregas" className="font-semibold">Confirmación de entregas</h2>
    <p className="mt-1 text-xs text-[var(--muted)]">Sube primero la evidencia de cada parada; después confirma. Lo que confirmas aquí queda registrado como «{ETIQUETA_RESULTADO.ENTREGADA_POR_PILOTO}»: no es la recepción oficial de PriceSmart.</p>
    <ul className="mt-4 space-y-3">
      {entregas.map((base) => {
        const e: EntregaVista = { ...base, confirmacion: base.confirmacion ?? locales[base.paradaId] ?? null };
        const c = e.confirmacion; const ocupada = enviando === e.paradaId; const error = errores[e.paradaId];
        return <li key={e.paradaId} data-parada={e.paradaId} className="rounded-xl border border-[var(--border)] p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{e.orden}. {e.lugarNombre}</strong>
            <span className="rounded-full bg-[var(--input)] px-2 py-1 text-xs">{e.tipo}</span>
          </div>
          <p className="mt-2 text-[var(--muted)]" data-evidencia>{e.evidencias > 0 ? `✓ Evidencia de esta parada: ${e.evidencias}` : "○ Sin evidencia de esta parada todavía."}</p>

          {c ? <div className="mt-3 space-y-1" data-confirmacion>
            <p><span className={`rounded-full px-2 py-1 text-xs font-semibold ${c.resultado === "ENTREGADA_POR_PILOTO" ? "bg-emerald-950/40 text-[#8fd4a0]" : "bg-amber-950/40 text-amber-200"}`}>{ETIQUETA_RESULTADO[c.resultado]}</span></p>
            <p className="text-[var(--muted)]">Registrado por {usuarioVisible(c.pilotoUsuario)} el {fechaConfirmacion(c.confirmadoEn)}.</p>
            {c.nota ? <p className="text-[var(--muted)]">Nota: {c.nota}</p> : null}
            {c.revision === "PENDIENTE" ? <p className="text-amber-200">{TEXTO_REVISION_HUMANA}</p> : null}
          </div> : null}
          <p className="mt-2 text-xs text-[var(--muted)]" data-recepcion-oficial><strong className="text-[var(--foreground)]">{ETIQUETA_RECEPCION_OFICIAL}:</strong> {TEXTO_RECEPCION_OFICIAL}</p>

          {puedeActuar(e, puedeConfirmar) ? <div className="mt-3">
            {e.evidencias === 0 ? <p className="mb-2 text-amber-300">Para confirmar necesitas subir primero la evidencia de esta parada.</p> : null}
            <div className="flex flex-wrap gap-2">
              {onSubirEvidencia ? <button type="button" className="rounded-lg bg-[#334155] px-4 py-2.5 font-medium text-white" onClick={() => onSubirEvidencia(e.paradaId)}>{e.evidencias > 0 ? "Subir otra evidencia" : "Subir evidencia"}</button> : null}
              <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={!puedeEnviar(e) || enviando !== null}
                onClick={() => void enviar(e.paradaId, { resultado: "ENTREGADA_POR_PILOTO" })}>{ocupada ? "Enviando…" : error === FALLO_RED ? "Reintentar confirmación" : "Confirmar entrega"}</button>
              <button type="button" className="rounded-lg border border-amber-700 px-4 py-2.5 font-medium text-amber-300 disabled:opacity-50" disabled={!puedeEnviar(e) || enviando !== null}
                onClick={() => { setFormAbierto(formAbierto === e.paradaId ? null : e.paradaId); setNota(""); setResultado("PARCIAL"); }}>Registrar incidencia</button>
            </div>
            {formAbierto === e.paradaId ? <form className="mt-3 space-y-3" onSubmit={(ev) => { ev.preventDefault(); if (notaValida(nota)) void enviar(e.paradaId, { resultado, nota: nota.trim() }); }}>
              <label className="block text-[var(--muted)]">¿Qué ocurrió?
                <select className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={resultado} onChange={(ev) => setResultado(ev.target.value as ResultadoConIncidencia)}>
                  {RESULTADOS_CON_INCIDENCIA.map((r) => <option key={r} value={r}>{ETIQUETA_RESULTADO[r]}</option>)}
                </select>
              </label>
              <label className="block text-[var(--muted)]">Nota obligatoria (mínimo {NOTA_MIN_UI} caracteres)
                <textarea className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" rows={3} maxLength={NOTA_MAX_UI} value={nota} onChange={(ev) => setNota(ev.target.value)} />
              </label>
              <p className="text-xs text-[var(--muted)]">Este caso queda pendiente de revisión humana y no se podrá confirmar como entregado hasta que Operaciones lo resuelva.</p>
              <button className="rounded-lg bg-amber-700 px-4 py-2.5 font-medium text-white disabled:opacity-50" disabled={!notaValida(nota) || enviando !== null}>{ocupada ? "Enviando…" : "Enviar incidencia"}</button>
            </form> : null}
          </div> : null}
          {error ? <p className="mt-2 text-sm text-red-300" role="alert">{error}</p> : null}
        </li>;
      })}
    </ul>
  </section>;
}
