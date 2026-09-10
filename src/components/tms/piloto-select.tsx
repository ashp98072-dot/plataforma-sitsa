"use client";

import { useEffect, useId, useRef, useState } from "react";

export type PilotoOpt = {
  id: number;
  codigo: string;
  nombre: string;
  /** PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — tms_personal.id (compartido/externo). */
  personalId?: number | null;
  /** "propio" | "compartido" | "externo" */
  fuente?: string;
  /** Etiqueta de origen/tipo para mostrar junto al nombre. */
  sub?: string;
};

type Props = {
  pilotos: PilotoOpt[];
  empleadoId: number;
  nombre: string;
  inputClassName: string;
  onChange: (next: { empleadoId: number; nombre: string; personalId?: number | null; fuente?: string }) => void;
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
      ? pilotos.slice(0, 15)
      : pilotos
          .filter((p) => `${p.nombre} ${p.codigo} ${p.sub ?? ""}`.toLowerCase().includes(q))
          .slice(0, 25)
  );
  const opKey = (p: PilotoOpt) => (p.id > 0 ? `emp:${p.id}` : `per:${p.personalId ?? 0}`);

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
    onChange({ empleadoId: p.id, nombre: p.nombre, personalId: p.personalId ?? null, fuente: p.fuente });
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
          onChange({
            empleadoId: match ? match.id : 0,
            nombre: val,
            personalId: match?.personalId ?? null,
            fuente: match?.fuente,
          });
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
          {filtered.map((p) => (
            <li key={opKey(p)} role="option" aria-selected={empleadoId === p.id && p.id > 0}>
              <button
                type="button"
                className={[
                  "flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-[var(--nav-hover)]",
                  empleadoId === p.id && p.id > 0 ? "bg-[var(--nav-active)]" : "",
                ].join(" ")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(p)}
              >
                <span className="text-[var(--text)]">{p.nombre}</span>
                <span className="text-[10px] text-[var(--muted)]">{p.sub || p.codigo}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
