"use client";

import { useId, useState } from "react";

export type CatalogoSearchOption = { value: string; label: string; detail?: string; searchText?: string };

export function filtrarOpcionesBusqueda(opciones: CatalogoSearchOption[], texto: string, limite = 200): CatalogoSearchOption[] {
  const q = texto.trim().toLocaleLowerCase("es");
  if (!q) return opciones;
  return opciones
    .filter((o) => `${o.label} ${o.searchText ?? o.detail ?? ""}`.toLocaleLowerCase("es").includes(q))
    .sort((a, b) => {
      const nombreA = a.label.toLocaleLowerCase("es");
      const nombreB = b.label.toLocaleLowerCase("es");
      const rango = (nombre: string) => nombre.startsWith(q) ? 0 : nombre.includes(q) ? 1 : 2;
      return rango(nombreA) - rango(nombreB);
    })
    .slice(0, limite);
}

export function textoInicialBusqueda(opciones: CatalogoSearchOption[], value: string, manualText = ""): string {
  return opciones.find((o) => o.value === value)?.label ?? manualText;
}

export function debeMostrarNombreManual(value: string, modoManual: boolean, manualText = ""): boolean {
  return !value && (modoManual || Boolean(manualText));
}

const VALOR_NOMBRE_MANUAL = "__nombre_manual__";

type Props = {
  label: string;
  placeholder: string;
  value: string;
  options: CatalogoSearchOption[];
  inputClassName: string;
  onChange: (value: string) => void;
  manualText?: string;
  onTextChange?: (text: string) => void;
  onOptionSelected?: (option: CatalogoSearchOption | undefined) => void;
};

/** Buscador auxiliar + select nativo visible. El input solo filtra; la selección siempre ocurre en el desplegable. */
export function CatalogoSearchSelect({ label, placeholder, value, options, inputClassName, onChange, manualText, onTextChange, onOptionSelected }: Props) {
  const id = useId();
  const [busqueda, setBusqueda] = useState("");
  const [modoManual, setModoManual] = useState(false);
  const filtradas = filtrarOpcionesBusqueda(options, busqueda);
  const seleccion = options.find((o) => o.value === value);
  const opcionesVisibles = seleccion && !filtradas.some((o) => o.value === seleccion.value)
    ? [seleccion, ...filtradas]
    : filtradas;
  const manual = Boolean(onTextChange) && debeMostrarNombreManual(value, modoManual, manualText);

  return (
    <div className="space-y-1 text-xs text-[var(--muted)]">
      <label htmlFor={`${id}-search`} className="block">Buscar {label.toLocaleLowerCase("es")}</label>
      <input id={`${id}-search`} type="search" className={`${inputClassName} w-full`} placeholder={placeholder} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      <label htmlFor={`${id}-select`} className="block">{label}</label>
      <select
        id={`${id}-select`}
        className={`${inputClassName} w-full`}
        value={manual ? VALOR_NOMBRE_MANUAL : value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === VALOR_NOMBRE_MANUAL) {
            setModoManual(true);
            onChange("");
            onOptionSelected?.(undefined);
            return;
          }
          setModoManual(false);
          onChange(next);
          onOptionSelected?.(options.find((o) => o.value === next));
        }}
      >
        <option value="">— Seleccionar {label.toLocaleLowerCase("es")} —</option>
        {onTextChange ? <option value={VALOR_NOMBRE_MANUAL}>Nombre manual</option> : null}
        {opcionesVisibles.map((o) => <option key={o.value} value={o.value}>{o.label}{o.detail ? ` · ${o.detail}` : ""}</option>)}
      </select>
      {busqueda.trim() && filtradas.length === 0 ? <p className="text-[11px]">Sin coincidencias.</p> : null}
      {manual ? <input className={`${inputClassName} w-full`} placeholder="Nombre manual" value={manualText ?? ""} onChange={(e) => onTextChange!(e.target.value)} /> : null}
    </div>
  );
}
