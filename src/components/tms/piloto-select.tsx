"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatearHora12 } from "@/lib/tms/hora-formato";

export type PilotoOpt = {
  id: number;
  codigo: string;
  nombre: string;
};

/** Ocupación real de un recurso para el intervalo del viaje que se está armando — ver disponibilidad-recursos-lista.ts. */
export type OcupacionRecurso = {
  planCodigo: string;
  /** "YYYY-MM-DD HH:mm:ss" */
  horaInicio: string;
  /** `null` = viaje activo sin fin real conocido (nunca inventado). */
  horaFin: string | null;
};

/** Texto del badge: "PLAN-000123 · 08:00 AM" (o solo el código si no hay hora). */
export function textoOcupacion(o: OcupacionRecurso): string {
  const hora = formatearHora12(o.horaInicio.slice(11, 16));
  return hora === "—" ? o.planCodigo : `${o.planCodigo} · ${hora}`;
}

type Props = {
  pilotos: PilotoOpt[];
  empleadoId: number;
  nombre: string;
  inputClassName: string;
  onChange: (next: { empleadoId: number; nombre: string }) => void;
  /**
   * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — empleadoId -> ocupación real
   * si ese piloto ya está asignado a OTRO viaje que se traslapa con el
   * intervalo actual (nunca se filtra de la lista, solo se marca; ver
   * sección 1/10 del ticket). Ausente o vacío = todos disponibles.
   */
  ocupados?: Record<number, OcupacionRecurso>;
};

/**
 * VIAT-4 (punto 4) — selector compacto y buscable: no lista los pilotos
 * permanentemente, la lista solo se abre al enfocar/escribir (mismo
 * patrón de ClienteSearch, ya usado y probado en este mismo formulario).
 * Sigue permitiendo escribir un nombre libre si el piloto no está en
 * planilla RRHH — misma Props que antes, sin tocar plan-form.tsx.
 */
export function PilotoSelect({
  pilotos,
  empleadoId,
  nombre,
  inputClassName,
  onChange,
  ocupados,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const display =
    empleadoId > 0
      ? (pilotos.find((p) => p.id === empleadoId)?.nombre ?? nombre)
      : nombre;
  const q = display.trim().toLowerCase();

  const filtered = (
    q.length < 1
      ? pilotos.slice(0, 12)
      : pilotos
          .filter((p) => `${p.nombre} ${p.codigo}`.toLowerCase().includes(q))
          .slice(0, 20)
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function elegir(p: PilotoOpt) {
    // Defensa adicional: aunque el botón ya viene `disabled`, Enter usa
    // `filtered[0]` directamente — nunca debe seleccionar un piloto ocupado.
    if (ocupados?.[p.id]) return;
    onChange({ empleadoId: p.id, nombre: p.nombre });
    setOpen(false);
  }

  // PLAN-FORM-SELECTS-DROPDOWN-STACKING: mismo ajuste que PlacaSelect —
  // ver el comentario allí. El z-10 fijo hacía que un hermano más abajo
  // en el DOM (AuxiliaresSelect) tapara la lista de este campo cuando se
  // abría; z-30 solo mientras `open` es true resuelve el desempate sin
  // afectar el resto del layout cuando está cerrado.
  return (
    <div
      ref={rootRef}
      className={`relative block text-xs text-[var(--muted)] ${open ? "z-30" : "z-10"}`}
    >
      <label htmlFor={listId} className="block">
        Piloto (buscar en RRHH o escribir)
      </label>
      <input
        id={listId}
        className={`${inputClassName} mt-1 w-full`}
        placeholder="Escribe nombre o código…"
        value={display}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const val = e.target.value;
          const match = pilotos.find((p) => p.nombre.toLowerCase() === val.trim().toLowerCase());
          onChange({ empleadoId: match ? match.id : 0, nombre: val });
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" && open && filtered[0]) {
            e.preventDefault();
            elegir(filtered[0]);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
          }, 120);
        }}
      />
      <span className="mt-0.5 block text-[10px]">
        {empleadoId
          ? `Enlazado a RRHH #${empleadoId}`
          : pilotos.length
            ? `${pilotos.length} pilotos en planilla — escribe para buscar`
            : "Sin pilotos en RRHH — puedes escribir el nombre"}
      </span>

      {open && filtered.length > 0 ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-44 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        >
          {filtered.map((p) => {
            const ocupacion = ocupados?.[p.id];
            return (
              <li key={p.id} role="option" aria-selected={empleadoId === p.id} aria-disabled={Boolean(ocupacion)}>
                <button
                  type="button"
                  disabled={Boolean(ocupacion)}
                  className={[
                    "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm",
                    ocupacion
                      ? "cursor-not-allowed bg-[var(--muted-bg,rgba(120,120,120,0.12))] opacity-60"
                      : "hover:bg-[var(--nav-hover)]",
                    !ocupacion && empleadoId === p.id ? "bg-[var(--nav-active)]" : "",
                  ].join(" ")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(p)}
                >
                  <span className={ocupacion ? "text-[var(--muted)]" : "text-[var(--text)]"}>{p.nombre}</span>
                  {ocupacion ? (
                    <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      Asignado · {textoOcupacion(ocupacion)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--muted)]">{p.codigo}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
