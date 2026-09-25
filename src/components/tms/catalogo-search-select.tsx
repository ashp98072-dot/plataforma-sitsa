"use client";

import { useId, useState } from "react";
import { filtrarPersonas } from "@/lib/busqueda-personas";

export type CatalogoSearchOption = { value: string; label: string; detail?: string; searchText?: string };

/** Solo conserva la selección histórica; no incorpora otros usuarios fuera del catálogo. */
export function opcionesConHistorico(options: CatalogoSearchOption[], value: string, nombre: string): CatalogoSearchOption[] {
  return value && !options.some(o => o.value === value)
    ? [{ value, label: `${nombre || "Sin dato histórico"} (histórico)` }, ...options] : options;
}

/**
 * Búsqueda compartida (src/lib/busqueda-personas.ts): sin distinguir mayúsculas ni tildes, espacios repetidos = uno, todas las
 * palabras deben estar presentes, y ranking exacto > prefijo > palabra > resto (alfabético dentro de cada nivel). Solo filtra
 * y ordena las opciones recibidas: no cambia quién es seleccionable.
 */
export function filtrarOpcionesBusqueda(opciones: CatalogoSearchOption[], texto: string, limite = 200): CatalogoSearchOption[] {
  if (!texto.trim()) return opciones;
  return filtrarPersonas(opciones, texto, { nombre: (o) => o.label, buscable: (o) => o.searchText ?? o.detail }, limite);
}

/** Texto visible de una opción: siempre el nombre real, más el detalle de identificación si existe (código · puesto). */
export const etiquetaOpcion = (o: CatalogoSearchOption) => `${o.label}${o.detail ? ` · ${o.detail}` : ""}`;

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
  emptyLabel?: string;
  selectDataCampo?: string;
  /** Mensaje cuando la búsqueda no encuentra nada (por defecto "Sin coincidencias."). */
  sinResultados?: string;
};

/** Buscador auxiliar + select nativo visible. El input solo filtra; la selección siempre ocurre en el desplegable. */
export function CatalogoSearchSelect({ label, placeholder, value, options, inputClassName, onChange, manualText, onTextChange, onOptionSelected, emptyLabel, selectDataCampo, sinResultados }: Props) {
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
        data-campo={selectDataCampo}
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
        <option value="">{emptyLabel ?? `— Seleccionar ${label.toLocaleLowerCase("es")} —`}</option>
        {onTextChange ? <option value={VALOR_NOMBRE_MANUAL}>Nombre manual</option> : null}
        {opcionesVisibles.map((o) => <option key={o.value} value={o.value}>{etiquetaOpcion(o)}</option>)}
      </select>
      {busqueda.trim() && filtradas.length === 0 ? <p className="text-[11px]">{sinResultados ?? "Sin coincidencias."}</p> : null}
      {manual ? <input className={`${inputClassName} w-full`} placeholder="Nombre manual" value={manualText ?? ""} onChange={(e) => onTextChange!(e.target.value)} /> : null}
    </div>
  );
}
