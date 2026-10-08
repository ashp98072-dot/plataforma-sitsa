"use client";

import { useEffect, useState } from "react";
import type { PendienteReparacion } from "@/lib/rrhh/vacaciones-reparacion-db";

const MOTIVOS: Record<string, string> = {
  FECHA_ALTA_AUSENTE: "sin fecha de contratación",
  FECHA_ALTA_SOSPECHOSA: "fecha de contratación inválida",
  FECHA_ALTA_FUTURA: "fecha de contratación futura",
  ANIO_LABORAL_DUPLICADO: "año laboral duplicado",
  TRASLAPE_REAL: "períodos traslapados",
  PERIODO_FUERA_DE_BASE: "períodos de otra fecha base",
  PERIODO_FALTANTE: "períodos faltantes",
  ANIO_FUERA_DE_SERIE: "año laboral fuera de la serie",
  ANIO_LABORAL_NULO_EN_SERIE: "período sin año laboral",
  ESTRUCTURA_CONGELADA: "sincronización congelada",
};

/**
 * Indicador (SOLO LECTURA) de cuántos colaboradores de la empresa requieren reparar la serie de períodos de vacaciones. No repara nada: «Revisar»
 * selecciona al colaborador para que la reparación se haga UNO POR UNO, con vista previa, desde su historial de períodos.
 */
export function PendientesReparacionVacaciones({ slug, version, onRevisar }: { slug: string; version: number; onRevisar: (empleadoId: number) => void }) {
  const [lista, setLista] = useState<PendienteReparacion[]>([]);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones/reparacion/pendientes`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { empleados?: PendienteReparacion[] };
        if (vigente) setLista(data.empleados ?? []);
      } catch {
        /* el indicador es informativo: sin respuesta no se muestra */
      }
    })();
    return () => { vigente = false; };
  }, [slug, version]);

  if (lista.length === 0) return null;
  return (
    <details className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-amber-200">
        {lista.length} colaborador(es) requieren reparar sus períodos de vacaciones
      </summary>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Su serie de períodos no coincide con la fecha de contratación actual. La reparación es manual, uno por uno y con vista previa: use «Revisar» y después «Reparar períodos».
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {lista.map((e) => (
          <li key={e.empleadoId} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{e.nombre}</span>
            <span className="text-[var(--muted)]">{e.codigo ? `(${e.codigo}) ` : ""}— {e.motivos.map((m) => MOTIVOS[m] ?? m).join(", ")}</span>
            <button type="button" onClick={() => onRevisar(e.empleadoId)} className="rounded border border-amber-400/60 px-2 py-0.5 text-amber-200 hover:bg-amber-400/10">Revisar</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
