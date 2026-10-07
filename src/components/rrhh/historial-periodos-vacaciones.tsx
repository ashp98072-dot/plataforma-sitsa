import { Fragment } from "react";
import type { HistorialVacaciones } from "@/lib/rrhh/vacaciones";

const dma = (iso: string) => {
  const p = String(iso).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
};
const dias = (n: number) => n.toFixed(2);

const COLOR_ESTADO: Record<string, string> = {
  "En curso": "text-sky-300",
  Vigente: "text-emerald-300",
  Consumido: "text-[var(--muted)]",
  Vencido: "text-amber-300",
};

/**
 * Historial COMPLETO de períodos de vacaciones: período, otorgados, consumidos, disponibles y estado. Los períodos vencidos o
 * consumidos siguen siendo parte del historial. «Saldo actual» es solo lo UTILIZABLE (tope de 30 días); NO es la suma de la tabla.
 * Presentacional y sin estado: sirve en la pantalla de RRHH (`admin`, con advertencias administrativas) y en el portal.
 */
export function HistorialPeriodosVacaciones({ historial, admin = false }: { historial: HistorialVacaciones | null | undefined; admin?: boolean }) {
  if (!historial) return null;
  const { periodos, advertencias, fechaLaboralSospechosa, historialOculto, saldoActual, requiereReparacion } = historial;
  const avisos = advertencias.filter((a) => a.codigo !== "TRASLAPE_BORDE" || admin);
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Historial de períodos ({periodos.length}) · Saldo actual: <span className="text-emerald-300">{dias(saldoActual)}</span> día(s)
      </summary>
      <p className="mt-2 text-xs text-[var(--muted)]">
        El saldo actual solo incluye los períodos vigentes (máximo 2 períodos completos = 30 días). Los períodos anteriores, consumidos o vencidos
        permanecen en el historial y no se suman al saldo.
      </p>

      {fechaLaboralSospechosa ? (
        <p className="mt-2 rounded border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
          {admin
            ? "La fecha de alta de este colaborador es inválida o anterior a 1980: no se generan períodos y los generados antes no se muestran como válidos. RRHH debe confirmar la fecha real antes de repararlos."
            : "Tu fecha de ingreso está en revisión por RRHH; por ahora solo se muestran los períodos con saldo o consumo."}
          {historialOculto && admin ? " (Se muestran solo los períodos vigentes o con consumo.)" : ""}
        </p>
      ) : null}

      {admin && requiereReparacion && !fechaLaboralSospechosa ? (
        <p className="mt-2 rounded border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
          Sincronización congelada para este colaborador: los períodos con consumo o la estructura de saldos no coinciden con su fecha laboral actual.
          No se modificó ningún saldo; requiere reparación administrada (ver sql/preflight-2026-10-vacaciones-historial-periodos.sql).
        </p>
      ) : null}

      {admin && avisos.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-200">
          {avisos.filter((a) => a.codigo !== "FECHA_LABORAL_SOSPECHOSA").map((a, i) => (
            <li key={`${a.codigo}-${a.saldoId ?? a.anioLaboral ?? i}-${i}`}>{a.mensaje}</li>
          ))}
        </ul>
      ) : null}

      {periodos.length === 0 ? (
        <p className="mt-3 text-[var(--muted)]">Sin períodos registrados.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="py-1 pr-3">Año laboral</th>
                <th className="py-1 pr-3">Período</th>
                <th className="py-1 pr-3 text-right">Otorgados</th>
                <th className="py-1 pr-3 text-right">Consumidos</th>
                <th className="py-1 pr-3 text-right">Disponibles</th>
                <th className="py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-t border-[var(--border)]">
                    <td className="py-1 pr-3">{p.anioLaboral ?? "—"}</td>
                    <td className="py-1 pr-3">{dma(p.periodoInicio)} → {dma(p.periodoFin)}</td>
                    <td className="py-1 pr-3 text-right">{dias(p.diasOtorgados)}</td>
                    <td className="py-1 pr-3 text-right">{dias(p.diasConsumidos)}</td>
                    <td className="py-1 pr-3 text-right">{dias(p.diasDisponibles)}</td>
                    <td className={`py-1 ${COLOR_ESTADO[p.estadoVisual] ?? ""}`}>{p.estadoVisual}</td>
                  </tr>
                  {(p.consumos ?? []).map((c) => (
                    <tr key={`${p.id}-${c.incidenciaId}`} className="text-[var(--muted)]">
                      <td className="pb-1 pr-3" />
                      <td className="pb-1 pr-3" colSpan={5}>↳ {c.tipo} · {dma(c.fechaInicio)} → {dma(c.fechaFin)} · {dias(c.dias)} día(s) consumidos de este período</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
