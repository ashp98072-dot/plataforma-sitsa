"use client";

import { useEffect, useState } from "react";
import type { PendienteReparacion } from "@/lib/rrhh/vacaciones-reparacion-db";
import { MOTIVOS_REPARACION as MOTIVOS } from "@/lib/rrhh/vacaciones-reparacion-textos";
import { ReparacionLoteVacaciones } from "./reparacion-lote-vacaciones";


/**
 * Indicador de cuántos colaboradores de la empresa requieren reparar la serie de períodos de vacaciones. Por sí mismo no repara nada: «Revisar»
 * selecciona al colaborador (reparación individual con vista previa) y «Revisar reparación de pendientes» abre la vista previa GLOBAL del lote, que solo
 * escribe tras una confirmación explícita.
 */
export function PendientesReparacionVacaciones({ slug, version, onRevisar, onLoteTerminado }: {
  slug: string;
  version: number;
  onRevisar: (empleadoId: number) => void;
  /** Se invoca tras ejecutar un lote para refrescar el empleado seleccionado, el saldo y el historial. */
  onLoteTerminado: () => void | Promise<void>;
}) {
  const [lista, setLista] = useState<PendienteReparacion[]>([]);
  const [loteAbierto, setLoteAbierto] = useState(false);

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

  // El modal del lote se conserva abierto (con su resumen) aunque, tras repararlos, ya no queden pendientes.
  if (lista.length === 0 && !loteAbierto) return null;
  return (
    <>
    <details className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-amber-200">
        {lista.length} colaborador(es) requieren reparar sus períodos de vacaciones
      </summary>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Su serie de períodos no coincide con la fecha de contratación actual. Puede repararlos uno por uno («Revisar» y después «Reparar períodos») o revisar el lote completo con vista previa antes de confirmar.
      </p>
      <button type="button" onClick={() => setLoteAbierto(true)} className="mt-2 rounded-lg border border-amber-400/60 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/10">
        Revisar reparación de pendientes
      </button>
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
    {loteAbierto ? <ReparacionLoteVacaciones slug={slug} onCerrar={() => setLoteAbierto(false)} onTerminado={onLoteTerminado} /> : null}
    </>
  );
}
