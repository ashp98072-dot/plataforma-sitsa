"use client";

import { useCallback, useEffect, useState } from "react";
import { textoResumenCargos } from "@/lib/tms/cargos-adicionales-shared";
import type { ListaCerradosPendientes } from "@/lib/tms/cargos-adicionales";

/**
 * LIQUIDACIÓN DE VIAJES, FASE 4 — vista «Cerrados pendientes de liquidación» dentro de Ajustes rápidos. Lista SOLO los viajes
 * Cerrado que aún requieren trabajo comercial/de liquidación (REPORTE_RECIBIDO / EN_AJUSTE; opcionalmente los LIQUIDADO recientes,
 * con cargos bloqueados). No es la lista de Programación ni el histórico Cerrado. Los cargos se operan desde el MISMO panel
 * (`ModalCargosViaje`) que la vista de viajes activos; aquí solo se elige el viaje. No edita personal, unidad, tarifa ni viáticos.
 */

const ETIQUETA_LIQUIDACION: Record<string, { texto: string; clase: string }> = {
  REPORTE_RECIBIDO: { texto: "Reporte recibido", clase: "bg-sky-900/40 text-sky-200" },
  EN_AJUSTE: { texto: "En ajuste", clase: "bg-amber-900/40 text-amber-200" },
  LIQUIDADO: { texto: "Liquidado", clase: "bg-emerald-900/40 text-emerald-200" },
};

export function CerradosPendientesCargos({
  slug, puedeGestionarCargos, refrescarClave, onAbrirCargos,
}: {
  slug: string;
  puedeGestionarCargos: boolean;
  /** Cambia cuando el panel de cargos modificó algo: vuelve a leer la lista (resumen y estado al día). */
  refrescarClave: number;
  onAbrirCargos: (plan: { id: number; codigo: string }) => void;
}) {
  const [lista, setLista] = useState<ListaCerradosPendientes | null>(null);
  const [error, setError] = useState("");
  const [incluirLiquidados, setIncluirLiquidados] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/cargos-cerrados-pendientes${incluirLiquidados ? "?incluirLiquidados=1" : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer los viajes cerrados.");
        return;
      }
      setError("");
      setLista(data as ListaCerradosPendientes);
    } catch {
      setError("Error de conexión.");
    }
  }, [slug, incluirLiquidados]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al abrir la vista, al cambiar el filtro y tras cambios de cargos
    void cargar();
  }, [cargar, refrescarClave]);

  return (
    <div className="space-y-2" data-vista="cerrados-pendientes">
      <p className="text-xs text-[var(--muted)]">
        Viajes <strong>cerrados</strong> con reporte recibido que todavía requieren ajustes o cargos antes de liquidarse. Aquí solo se
        gestionan cargos: el personal, la unidad, la tarifa y los viáticos de un viaje cerrado no se editan.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={incluirLiquidados} onChange={(e) => setIncluirLiquidados(e.target.checked)} />
        Incluir liquidados de los últimos {lista?.diasLiquidados ?? 30} días (cargos bloqueados; reabre la liquidación para modificarlos)
      </label>
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      {!lista && !error ? <p className="text-xs text-[var(--muted)]">Cargando…</p> : null}
      {lista?.truncado ? (
        <p className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1 text-xs text-amber-300">
          Se muestran los {lista.limite} viajes más recientes; liquida o ajusta los pendientes para ver el resto.
        </p>
      ) : null}
      {lista ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-[var(--thead)] text-[var(--muted)]">
              <tr>
                {["Liquidación", "Fecha", "Código", "Ruta / Cliente", "Tarifa base", "Cargos"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.filas.map((f) => {
                const et = ETIQUETA_LIQUIDACION[f.estadoLiquidacion] ?? { texto: f.estadoLiquidacion, clase: "" };
                return (
                  <tr key={f.planId} className="border-t border-[var(--border)] align-top" data-plan-id={f.planId}>
                    <td className="px-2 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${et.clase}`}>{et.texto}</span></td>
                    <td className="whitespace-nowrap px-2 py-1.5">{f.fechaPlan}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold text-sky-300">{f.codigo}</td>
                    <td className="max-w-[260px] px-2 py-1.5">
                      <span className="block truncate" title={f.ruta}>{f.ruta || "—"}</span>
                      <span className="block truncate text-[10px] text-[var(--muted)]">{f.cliente || "—"}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {f.tarifaComercial == null ? "Sin tarifa" : `${f.moneda === "GTQ" ? "Q" : `${f.moneda} `}${Number(f.tarifaComercial).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="block text-[11px]">{textoResumenCargos(f.cargos, f.moneda)}</span>
                      <button
                        type="button"
                        onClick={() => onAbrirCargos({ id: f.planId, codigo: f.codigo })}
                        className="mt-0.5 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]"
                        aria-label={`${puedeGestionarCargos && f.editable ? "Gestionar" : "Ver"} cargos adicionales de ${f.codigo}`}
                      >
                        {puedeGestionarCargos && f.editable ? "Cargos" : "Ver cargos"}
                      </button>
                      {!f.editable ? <span className="ml-1 text-[10px] text-[var(--muted)]">bloqueados</span> : null}
                    </td>
                  </tr>
                );
              })}
              {!lista.filas.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[var(--muted)]">No hay viajes cerrados pendientes de liquidación.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
