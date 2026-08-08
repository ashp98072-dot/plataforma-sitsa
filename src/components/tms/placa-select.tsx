"use client";

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

export function PlacaSelect({
  value,
  options,
  resumen,
  inputClassName,
  onChange,
  allowManual = true,
}: Props) {
  const upper = value.toUpperCase();
  const inList = options.some((o) => o.placa.toUpperCase() === upper);

  return (
    <label className="block text-xs text-[var(--muted)]">
      Placa (solo disponibles)
      <select
        className={`${inputClassName} mt-1 w-full font-mono`}
        value={inList ? upper : ""}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      >
        <option value="">
          {options.length
            ? "— Seleccionar unidad disponible —"
            : "— Sin unidades disponibles —"}
        </option>
        {options.map((o) => (
          <option key={o.placa} value={o.placa.toUpperCase()}>
            {o.placa}
            {o.marca || o.modelo
              ? ` · ${[o.marca, o.modelo].filter(Boolean).join(" ")}`
              : ""}
            {o.compartido ? " (compartida)" : ""}
          </option>
        ))}
      </select>
      {allowManual ? (
        <input
          className={`${inputClassName} mt-1 w-full font-mono uppercase`}
          placeholder="O escribe placa…"
          value={value}
          list="placas-tms-disponibles"
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      ) : null}
      <datalist id="placas-tms-disponibles">
        {options.map((o) => (
          <option key={o.placa} value={o.placa} />
        ))}
      </datalist>
      <span className="mt-0.5 block text-[10px]">
        {resumen
          ? `${resumen.disponibles} disponibles · ${resumen.enTaller} taller · ${resumen.enRuta} en ruta`
          : "No se envían unidades en taller o en ruta"}
      </span>
    </label>
  );
}
