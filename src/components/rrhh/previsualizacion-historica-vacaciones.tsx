"use client";

import type { PrevisualizacionRegistro } from "@/lib/rrhh/vacaciones-registro";

const dma = (iso: string) => {
  const p = String(iso).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
};
const n2 = (n: number) => n.toFixed(2);

type Props = {
  previa: PrevisualizacionRegistro & { diasHabiles: number };
  decisionAcepta: boolean;
  onDecisionAcepta: (v: boolean) => void;
  decisionMotivo: string;
  onDecisionMotivo: (v: string) => void;
};

/**
 * «Registro histórico»: antes de guardar muestra contra qué período(s) se consumiría la vacación EN SU FECHA (no el saldo de hoy), los días por
 * período, el saldo histórico disponible a esa fecha, el déficit y las advertencias. Un déficit o un cruce de aniversario exigen una decisión
 * explícita (confirmación + motivo). Presentacional: no guarda nada.
 */
export function PrevisualizacionHistorica({ previa, decisionAcepta, onDecisionAcepta, decisionMotivo, onDecisionMotivo }: Props) {
  const plan = previa.plan;
  if (!plan || !plan.esHistorico) return null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-200">Registro histórico</span>
        {plan.periodoInicio ? (
          <span className="text-xs text-[var(--muted)]">
            La fecha de inicio pertenece al año laboral {plan.periodoInicio.anioLaboral} ({dma(plan.periodoInicio.inicio)} → {dma(plan.periodoInicio.fin)}), hoy {plan.periodoInicio.estadoHoy}.
          </span>
        ) : null}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Se evalúa el saldo que ese período tenía <strong>en la fecha de la vacación</strong>, no el saldo disponible hoy. El saldo utilizable actual (máximo 30 días) no se amplía ni se reactiva ningún período vencido.
      </p>

      {plan.bloqueos.length ? (
        <ul className="space-y-1 text-xs text-red-300">{plan.bloqueos.map((b) => <li key={b.codigo}><strong>{b.codigo}</strong>: {b.mensaje}</li>)}</ul>
      ) : null}
      {previa.superposiciones.length ? (
        <p className="text-xs text-red-300">
          <strong>SUPERPOSICIÓN</strong>: se solapa con {previa.superposiciones.map((x) => `${x.tipo} ${dma(x.inicio)} → ${dma(x.fin)}`).join("; ")}. No se puede guardar.
        </p>
      ) : null}

      {plan.tramos.map((t) => (
        <div key={`${t.desde}-${t.hasta}`} className="rounded border border-[var(--border)] p-2 text-xs">
          <p className="font-medium">
            {dma(t.desde)} → {dma(t.hasta)} · {n2(t.dias)} día(s) · saldo evaluado al {dma(t.fechaEvaluacion)}
          </p>
          {t.disponiblePorPeriodo.length ? (
            <p className="text-[var(--muted)]">
              Saldo histórico disponible a esa fecha:{" "}
              {t.disponiblePorPeriodo.map((p) => `año ${p.anioLaboral}${p.estadoHoy === "Vencido" ? " (hoy vencido)" : ""}: ${n2(p.libre)}`).join(" · ")}
            </p>
          ) : <p className="text-[var(--muted)]">Ningún período con saldo en esa fecha.</p>}
          {t.asignaciones.length ? (
            <ul className="mt-1 space-y-0.5">
              {t.asignaciones.map((a) => (
                <li key={`${a.anioLaboral}-${a.periodoInicio}`} className="text-emerald-300">
                  Consumirá {n2(a.dias)} día(s) del año laboral {a.anioLaboral} ({dma(a.periodoInicio)} → {dma(a.periodoFin)}){a.estadoHoy === "Vencido" ? " · período vencido hoy: no recupera saldo" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {t.deficit > 0 ? <p className="mt-1 text-red-300">Déficit: faltan {n2(t.deficit)} día(s) en esa fecha.</p> : null}
        </div>
      ))}

      {plan.advertencias.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200">{plan.advertencias.map((a) => <li key={a}>{a}</li>)}</ul> : null}

      {plan.requiereDecision && !plan.bloqueos.length && !previa.superposiciones.length ? (
        <div className="space-y-2 rounded border border-amber-400/40 p-2 text-xs">
          <p className="font-medium text-amber-200">Requiere una decisión explícita de RRHH</p>
          <ul className="list-disc space-y-1 pl-5 text-amber-100">{plan.decisiones.map((d) => <li key={d.codigo}>{d.mensaje}</li>)}</ul>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={decisionAcepta} onChange={(e) => onDecisionAcepta(e.target.checked)} />
            <span>Confirmo esta distribución{plan.deficit > 0 ? " y registrar la vacación con el déficit indicado" : ""}.</span>
          </label>
          <textarea
            value={decisionMotivo} onChange={(e) => onDecisionMotivo(e.target.value)} rows={2} maxLength={500}
            placeholder="Motivo de la decisión (mínimo 10 caracteres)"
            className="w-full rounded border border-[var(--border)] bg-[var(--input)] p-2"
          />
        </div>
      ) : null}
    </div>
  );
}
