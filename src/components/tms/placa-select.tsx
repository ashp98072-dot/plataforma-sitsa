"use client";

import { useEffect, useId, useRef, useState } from "react";

export type VehiculoOpt = {
  placa: string;
  marca?: string | null;
  modelo?: string | null;
  compartido?: boolean;
};

type Props = {
  value: string;
  options: VehiculoOpt[];
  resumen?: { disponibles: number; enTaller: number; enRuta: number };
  inputClassName: string;
  onChange: (placa: string) => void;
  /** Permite escribir placa fuera de lista (solo si no está bloqueada en servidor). */
  allowManual?: boolean;
};

/**
 * VIAT-4 (punto 4) — selector compacto y buscable de unidad: por placa,
 * marca o modelo, sin listar todas las unidades permanentemente (mismo
 * patrón de ClienteSearch/PilotoSelect). Mismas Props que antes.
 */
export function PlacaSelect({
  value,
  options,
  resumen,
  inputClassName,
  onChange,
  allowManual = true,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const upper = value.toUpperCase();
  const q = upper.trim();

  const filtered = (
    q.length < 1
      ? options.slice(0, 12)
      : options
          .filter((o) => `${o.placa} ${o.marca ?? ""} ${o.modelo ?? ""}`.toUpperCase().includes(q))
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

  function elegir(o: VehiculoOpt) {
    onChange(o.placa.toUpperCase());
    setOpen(false);
  }

  // PLAN-FORM-SELECTS-DROPDOWN-STACKING: la lista desplegable vive DENTRO
  // de este div (z-50 relativo a él), pero ese z-50 solo importa dentro
  // del stacking context que este mismo div crea (position:relative +
  // z-index) — no "escapa" para competir con hermanos. Este componente
  // se usa junto a otros iguales (PilotoSelect a su lado, AuxiliaresSelect
  // debajo) que TODOS declaran z-10 fijo: con el mismo z-index, el
  // desempate es por orden en el DOM, así que el campo de MÁS ABAJO
  // (p. ej. Auxiliares) siempre gana y tapa una lista larga que se abre
  // arriba (Unidad/Piloto) y se extiende hacia abajo. Se sube a z-30
  // SOLO mientras `open` es true, para que el campo activo se pinte por
  // encima de sus hermanos sin necesidad de tocar su propio z-index.
  return (
    <div
      ref={rootRef}
      className={`relative block text-xs text-[var(--muted)] ${open ? "z-30" : "z-10"}`}
    >
      <label htmlFor={listId} className="block">
        Unidad (buscar placa/marca/modelo)
      </label>
      <input
        id={listId}
        className={`${inputClassName} mt-1 w-full font-mono uppercase`}
        placeholder={options.length ? "Escribe placa, marca o modelo…" : "Sin unidades disponibles…"}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        readOnly={!allowManual}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          if (!allowManual) return;
          onChange(e.target.value.toUpperCase());
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
        {resumen
          ? `${resumen.disponibles} disponibles · ${resumen.enTaller} taller · ${resumen.enRuta} en ruta`
          : "No se envían unidades en taller o en ruta"}
      </span>

      {open && filtered.length > 0 ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-44 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        >
          {filtered.map((o) => (
            <li key={o.placa} role="option" aria-selected={upper === o.placa.toUpperCase()}>
              <button
                type="button"
                className={[
                  "flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-[var(--nav-hover)]",
                  upper === o.placa.toUpperCase() ? "bg-[var(--nav-active)]" : "",
                ].join(" ")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(o)}
              >
                <span className="font-mono text-[var(--text)]">{o.placa}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {[o.marca, o.modelo].filter(Boolean).join(" ")}
                  {o.compartido ? " · compartida" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
