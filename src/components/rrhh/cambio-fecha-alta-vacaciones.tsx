"use client";

import { useEffect, useState } from "react";
import type { PlanRebase } from "@/lib/rrhh/vacaciones-rebase";

const dma = (iso: string | null) => {
  const p = String(iso ?? "").slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "—";
};
const n2 = (n: number) => n.toFixed(2);

type Previa = PlanRebase & { traslapesActuales: number };

/**
 * Advertencia + vista previa al cambiar «Fecha ingreso / contratación» de un colaborador que ya tiene saldos o vacaciones: los períodos se
 * recalculan desde la nueva fecha y TODOS los días ya consumidos se conservan. Si hay un bloqueo, avisa al formulario para que no se pueda guardar.
 * Solo lectura (consulta la vista previa del servidor); no guarda nada.
 */
export function CambioFechaAltaVacaciones({ slug, empleadoId, fechaAlta, onBloqueo }: { slug: string; empleadoId: number; fechaAlta: string; onBloqueo: (bloqueado: boolean) => void }) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaAlta)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sin fecha válida no hay vista previa
      setPrevia(null); onBloqueo(false);
      return;
    }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/empleados/${empleadoId}/preview-fecha-alta?fechaAlta=${fechaAlta}`, { cache: "no-store" });
        const data = await res.json();
        if (!vigente) return;
        if (!res.ok) { setPrevia(null); setError(data.error ?? "No se pudo calcular la vista previa."); onBloqueo(false); return; }
        setError("");
        const p = data as Previa;
        setPrevia(p.aplica ? p : null);
        onBloqueo(p.aplica && p.bloqueos.length > 0);
      } catch {
        if (vigente) { setPrevia(null); onBloqueo(false); }
      }
    }, 400);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onBloqueo es un setState estable
  }, [slug, empleadoId, fechaAlta]);

  if (error) return <p className="text-xs text-red-300">{error}</p>;
  if (!previa) return null;
  return (
    <div className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-xs">
      <p className="text-sm font-medium text-amber-200">
        Cambiar la fecha de contratación recalculará los períodos de vacaciones y conservará todos los días ya consumidos.
      </p>
      <p className="text-[var(--muted)]">
        Fecha anterior: <strong>{dma(previa.fechaAnterior)}</strong> → nueva: <strong>{dma(previa.fechaNueva)}</strong>. Períodos actuales: {previa.periodosAntes}
        {previa.traslapesActuales ? ` (con ${previa.traslapesActuales} traslape(s))` : ""} · períodos resultantes: {previa.periodos.length}.
        Vacaciones que se conservan: {previa.vacaciones} · días consumidos preservados: <strong>{n2(previa.consumidoPreservado)}</strong>.
        Saldo utilizable actual: {n2(previa.saldoAntes)} → después: <strong>{n2(previa.saldoDespues)}</strong>.
      </p>
      {previa.bloqueos.length ? (
        <ul className="space-y-1 text-red-300">{previa.bloqueos.map((b, i) => <li key={`${b.codigo}-${i}`}><strong>No se puede guardar:</strong> {b.mensaje}</li>)}</ul>
      ) : null}
      {previa.advertencias.length ? <ul className="list-disc space-y-1 pl-5 text-amber-100">{previa.advertencias.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      {previa.periodos.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-3">Año</th><th className="pr-3">Período</th><th className="pr-3 text-right">Otorgados</th><th className="pr-3 text-right">Consumidos</th><th className="pr-3 text-right">Disponibles</th><th>Estado</th></tr></thead>
            <tbody>
              {previa.periodos.map((p) => (
                <tr key={p.anioLaboral} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-3">{p.anioLaboral}</td><td className="pr-3">{dma(p.inicio)} → {dma(p.fin)}</td>
                  <td className="pr-3 text-right">{n2(p.otorgados)}</td><td className="pr-3 text-right">{n2(p.consumidos)}</td><td className="pr-3 text-right">{n2(p.disponibles)}</td><td>{p.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
