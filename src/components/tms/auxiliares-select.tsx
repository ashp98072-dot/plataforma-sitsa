"use client";

import { useEffect, useId, useRef, useState } from "react";
import { textoOcupacion, type OcupacionRecurso } from "./piloto-select";
import { filtrarPersonas } from "@/lib/busqueda-personas";

export type AuxiliarOpt = {
  id: number;
  codigo: string;
  nombre: string;
};

type Props = {
  auxiliares: AuxiliarOpt[];
  /** ids de RRHH ya elegidos. */
  empleadoIds: number[];
  /** nombres libres ya elegidos (personal fuera de RRHH). */
  nombresLibres: string[];
  max: number;
  inputClassName: string;
  onChange: (next: { empleadoIds: number[]; nombresLibres: string[] }) => void;
  /**
   * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — mismo mapa que PilotoSelect
   * (empleadoId -> ocupación real): nunca se filtra de la lista, solo se
   * marca y se bloquea la selección (ver sección 1/8/10 del ticket).
   */
  ocupados?: Record<number, OcupacionRecurso>;
};

/**
 * Mejora Programación (punto 8) — mismo patrón visual/UX que PilotoSelect/
 * PlacaSelect/ClienteSearch (buscador compacto, no lista permanentemente
 * toda la nómina), pero de MULTI-selección con chips: agregar por
 * clic/Enter, quitar con "×" en el chip, tope `max`. No permite
 * duplicados; al quitar un chip, ese auxiliar vuelve a estar disponible
 * en la búsqueda.
 */
export function AuxiliaresSelect({ auxiliares, empleadoIds, nombresLibres, max, inputClassName, onChange, ocupados }: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");

  const total = empleadoIds.length + nombresLibres.length;
  const lleno = total >= max;

  const q = texto.trim();
  // Igual que antes, los ya elegidos no se ofrecen; la búsqueda/orden es la compartida (sin tildes, todas las palabras, ranking).
  const disponibles = auxiliares.filter((a) => !empleadoIds.includes(a.id));
  const filtered = q ? filtrarPersonas(disponibles, q, { nombre: (a) => a.nombre, buscable: (a) => a.codigo }, 20) : disponibles.slice(0, 20);

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

  function agregarId(a: AuxiliarOpt) {
    // Defensa adicional: aunque el botón ya viene `disabled`, agregarLibre()
    // puede llegar aquí por match exacto o único resultado filtrado — nunca
    // debe agregar un auxiliar ocupado.
    if (lleno || empleadoIds.includes(a.id) || ocupados?.[a.id]) return;
    onChange({ empleadoIds: [...empleadoIds, a.id], nombresLibres });
    setTexto("");
    setOpen(false);
  }

  function quitarId(id: number) {
    onChange({ empleadoIds: empleadoIds.filter((x) => x !== id), nombresLibres });
  }

  function quitarLibre(n: string) {
    onChange({ empleadoIds, nombresLibres: nombresLibres.filter((x) => x !== n) });
  }

  /** Enter: si hay match exacto por nombre o solo un resultado filtrado, lo agrega; si no, lo guarda como nombre libre (personal fuera de RRHH). */
  function agregarLibre() {
    const t = texto.trim();
    if (t.length < 2 || lleno) return;
    const matchExact = auxiliares.find((a) => a.nombre.toLowerCase() === t.toLowerCase() && !empleadoIds.includes(a.id));
    if (matchExact) {
      agregarId(matchExact);
      return;
    }
    if (filtered.length === 1) {
      agregarId(filtered[0]);
      return;
    }
    if (nombresLibres.some((n) => n.toLowerCase() === t.toLowerCase())) return;
    onChange({ empleadoIds, nombresLibres: [...nombresLibres, t] });
    setTexto("");
    setOpen(false);
  }

  function nombrePorId(id: number): string {
    return auxiliares.find((a) => a.id === id)?.nombre ?? `#${id}`;
  }

  // PLAN-FORM-SELECTS-DROPDOWN-STACKING: mismo ajuste que PlacaSelect/
  // PilotoSelect — ver el comentario en placa-select.tsx. Este campo
  // también puede tapar (o ser tapado por) lo que venga después en el
  // formulario (Motivo del cambio, Tipo de traslado, etc.) por el mismo
  // empate de z-index fijo entre hermanos; z-30 solo mientras `open` es
  // true resuelve el desempate sin afectar el layout cerrado.
  return (
    <div
      ref={rootRef}
      className={`relative text-xs text-[var(--muted)] ${open ? "z-30" : "z-10"}`}
    >
      <label htmlFor={listId} className="block">
        Auxiliares {total}/{max}
      </label>
      <input
        id={listId}
        className={`${inputClassName} mt-1 w-full`}
        placeholder={lleno ? `Máximo ${max} alcanzado` : "Buscar por nombre o código…"}
        value={texto}
        disabled={lleno}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTexto(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            agregarLibre();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
          }, 120);
        }}
      />

      {empleadoIds.length || nombresLibres.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {empleadoIds.map((id) => (
            <span
              key={`e-${id}`}
              className="flex items-center gap-1 rounded border border-sky-700 bg-sky-950/30 px-2 py-1 text-xs text-[var(--text)]"
            >
              {nombrePorId(id)}
              <button type="button" className="text-red-300" onClick={() => quitarId(id)}>
                ×
              </button>
            </span>
          ))}
          {nombresLibres.map((n) => (
            <span
              key={`n-${n}`}
              className="flex items-center gap-1 rounded border border-amber-700 bg-amber-950/20 px-2 py-1 text-xs text-[var(--text)]"
            >
              {n}
              <button type="button" className="text-red-300" onClick={() => quitarLibre(n)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {open && !lleno && q.length > 0 && filtered.length === 0 ? <span className="mt-0.5 block text-[10px]">No se encontraron empleados.</span> : null}

      {open && !lleno && filtered.length > 0 ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        >
          {filtered.map((a) => {
            const ocupacion = ocupados?.[a.id];
            return (
              <li key={a.id} role="option" aria-selected={false} aria-disabled={Boolean(ocupacion)}>
                <button
                  type="button"
                  disabled={Boolean(ocupacion)}
                  className={[
                    "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm",
                    ocupacion ? "cursor-not-allowed bg-[var(--muted-bg,rgba(120,120,120,0.12))] opacity-60" : "hover:bg-[var(--nav-hover)]",
                  ].join(" ")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => agregarId(a)}
                >
                  <span className={ocupacion ? "text-[var(--muted)]" : "text-[var(--text)]"}>{a.nombre}</span>
                  {ocupacion ? (
                    <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      Asignado · {textoOcupacion(ocupacion)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--muted)]">{a.codigo}</span>
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
