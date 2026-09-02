"use client";

import { useEffect, useId, useRef, useState } from "react";

type ClienteOpt = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

type Props = {
  clientes: ClienteOpt[];
  valueNombre: string;
  valueId: number;
  onChange: (next: { clienteId: number; clienteNombre: string }) => void;
  inputClassName: string;
};

/**
 * Buscador de cliente: la lista solo se abre al enfocar/escribir y se cierra
 * al elegir o salir, sin tapar el resto del formulario.
 */
export function ClienteSearch({
  clientes,
  valueNombre,
  valueId,
  onChange,
  inputClassName,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const q = valueNombre.trim().toLowerCase();

  const activos = clientes.filter(
    (c) => !c.estado || String(c.estado).toLowerCase() === "activo",
  );

  const selected = valueId
    ? activos.find((c) => c.id === valueId) ?? null
    : null;

  const filtered =
    q.length < 1
      ? activos.slice(0, 12)
      : activos
          .filter((c) => {
            // VIAT-0 (punto 1): también localizable por código, no solo
            // nombre/NIT/teléfono.
            const hay =
              `${c.nombre} ${c.codigo ?? ""} ${c.nit ?? ""} ${c.telefono ?? ""}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 20);

  const exact = activos.find(
    (c) => c.nombre.toLowerCase() === q && q.length > 0,
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

  function elegir(c: ClienteOpt) {
    onChange({ clienteId: c.id, clienteNombre: c.nombre });
    setOpen(false);
  }

  // PLAN-FORM-SELECTS-DROPDOWN-STACKING: mismo ajuste que PlacaSelect/
  // PilotoSelect/AuxiliaresSelect — ver el comentario en
  // placa-select.tsx. Un z-index fijo igual entre campos hermanos hace
  // que el desempate lo gane siempre el que está más abajo en el DOM,
  // tapando la lista de un campo de más arriba que se abre hacia abajo;
  // z-30 solo mientras `open` es true.
  return (
    <div
      ref={rootRef}
      className={`relative block text-xs text-[var(--muted)] md:col-span-1 ${open ? "z-30" : "z-10"}`}
    >
      <label htmlFor={listId} className="block">
        Cliente (buscar en catálogo)
      </label>
      <input
        id={listId}
        className={`${inputClassName} mt-1 w-full`}
        placeholder="Escribe nombre, código o NIT…"
        value={valueNombre}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const nombre = e.target.value;
          const match = activos.find(
            (c) => c.nombre.toLowerCase() === nombre.trim().toLowerCase(),
          );
          onChange({
            clienteId: match ? match.id : 0,
            clienteNombre: nombre,
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
          // Retraso breve para permitir click en la lista
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              setOpen(false);
              if (!valueId && exact) {
                onChange({ clienteId: exact.id, clienteNombre: exact.nombre });
              }
            }
          }, 120);
        }}
      />
      {valueId && selected ? (
        <span className="mt-0.5 block text-[10px] text-emerald-400">
          Seleccionado #{valueId}
          {selected.nit ? ` · NIT ${selected.nit}` : ""}
        </span>
      ) : valueNombre.trim() ? (
        <span className="mt-0.5 block text-[10px] text-amber-300/90">
          Sin coincidencia exacta: se usará el nombre al guardar
        </span>
      ) : (
        <span className="mt-0.5 block text-[10px]">
          Haz clic y elige de la lista, o busca por nombre/NIT
        </span>
      )}

      {open && filtered.length > 0 ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-44 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        >
          {filtered.map((c) => (
            <li key={c.id} role="option" aria-selected={valueId === c.id}>
              <button
                type="button"
                className={[
                  "flex w-full flex-col px-2.5 py-1.5 text-left text-sm hover:bg-[var(--nav-hover)]",
                  valueId === c.id ? "bg-[var(--nav-active)]" : "",
                ].join(" ")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c)}
              >
                <span className="text-[var(--text)]">
                  {c.codigo ? `${c.codigo} · ` : ""}
                  {c.nombre}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {c.nit ? `NIT ${c.nit}` : "Sin NIT"}
                  {c.telefono ? ` · ${c.telefono}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
