"use client";

import { useEffect, useId, useRef, useState } from "react";

export type CatalogoSearchOption = { value: string; label: string; detail?: string; searchText?: string };

export function filtrarOpcionesBusqueda(opciones: CatalogoSearchOption[], texto: string, limite = 20): CatalogoSearchOption[] {
  const q = texto.trim().toLocaleLowerCase("es");
  return (q ? opciones.filter((o) => `${o.label} ${o.detail ?? ""} ${o.searchText ?? ""}`.toLocaleLowerCase("es").includes(q)) : opciones).slice(0, limite);
}

export function textoInicialBusqueda(opciones: CatalogoSearchOption[], value: string, manualText = ""): string {
  return opciones.find((o) => o.value === value)?.label ?? manualText;
}

type Props = {
  label: string;
  placeholder: string;
  value: string;
  options: CatalogoSearchOption[];
  inputClassName: string;
  onChange: (value: string) => void;
  /** Texto libre opcional; usado por Requirente cuando no existe usuario. */
  manualText?: string;
  onTextChange?: (texto: string) => void;
};

/** Selector compacto reutilizable, basado en el patrón de ClienteSearch/PilotoSelect/PlacaSelect. */
export function CatalogoSearchSelect({ label, placeholder, value, options, inputClassName, onChange, manualText, onTextChange }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;
  const [texto, setTexto] = useState(textoInicialBusqueda(options, value, manualText));
  const [open, setOpen] = useState(false);
  const [activo, setActivo] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTexto(selected?.label ?? manualText ?? "");
  }, [selected?.label, manualText]);

  useEffect(() => {
    if (!open) return;
    const cerrar = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [open]);

  const filtradas = filtrarOpcionesBusqueda(options, texto);
  const elegir = (opcion: CatalogoSearchOption) => {
    onChange(opcion.value); setTexto(opcion.label); setOpen(false); setActivo(0);
  };

  return (
    <div ref={rootRef} className={`relative text-xs text-[var(--muted)] ${open ? "z-30" : "z-10"}`}>
      <label htmlFor={id} className="block">{label}</label>
      <div className="relative mt-0.5">
        <input
          id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
          className={`${inputClassName} w-full pr-8`} placeholder={placeholder} autoComplete="off" value={texto}
          onFocus={() => { setOpen(true); setActivo(0); }}
          onChange={(e) => { setTexto(e.target.value); onChange(""); onTextChange?.(e.target.value); setOpen(true); setActivo(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActivo((i) => Math.min(i + 1, Math.max(0, filtradas.length - 1))); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter" && open && filtradas[activo]) { e.preventDefault(); elegir(filtradas[activo]); }
          }}
        />
        {texto || value ? <button type="button" aria-label={`Limpiar ${label}`} className="absolute right-2 top-1/2 -translate-y-1/2 text-sm" onClick={() => { setTexto(""); onChange(""); onTextChange?.(""); setOpen(true); }}>×</button> : null}
      </div>
      {open ? (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
          {filtradas.map((o, i) => (
            <li key={o.value} role="option" aria-selected={value === o.value}>
              <button type="button" className={`w-full px-2.5 py-1.5 text-left hover:bg-[var(--nav-hover)] ${i === activo || value === o.value ? "bg-[var(--nav-active)]" : ""}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActivo(i)} onClick={() => elegir(o)}>
                <span className="block text-sm text-[var(--text)]">{o.label}</span>
                {o.detail ? <span className="block text-[10px] text-[var(--muted)]">{o.detail}</span> : null}
              </button>
            </li>
          ))}
          {!filtradas.length ? <li className="px-2.5 py-2 text-[var(--muted)]">Sin coincidencias</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
