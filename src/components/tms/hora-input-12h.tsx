"use client";

import { useId } from "react";
import { combinarHora12, parsearHora12 } from "@/lib/tms/hora-formato";

const HORAS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTOS_60 = Array.from({ length: 60 }, (_, i) => i); // 0..59

/**
 * OPERACIONES-HORA-12H-1 — lógica PURA de "el usuario tocó un select":
 * separada del componente para poder probarla directo (mismo criterio ya
 * usado en catalogo-search-select.tsx: probar las funciones extraídas,
 * nunca renderizar el DOM del selector). `valorActual` es el `HH:mm`
 * (24h) que ya tenía el campo; `campo`/`valorCrudo` identifican qué
 * select cambió y a qué valor. Vaciar cualquiera de los 3 -> el valor
 * completo colapsa a "" (mismo criterio "todo o nada" que ya tiene el
 * `<input type="time">` nativo al borrarse).
 */
export function siguienteValorHora12(
  valorActual: string,
  campo: "hora" | "minuto" | "ampm",
  valorCrudo: string,
): string {
  if (valorCrudo === "") return "";
  const base = parsearHora12(valorActual) ?? { hora: 12, minuto: 0, ampm: "AM" as const };
  const siguiente = {
    hora: campo === "hora" ? Number(valorCrudo) : base.hora,
    minuto: campo === "minuto" ? Number(valorCrudo) : base.minuto,
    ampm: campo === "ampm" ? (valorCrudo as "AM" | "PM") : base.ampm,
  };
  return combinarHora12(siguiente.hora, siguiente.minuto, siguiente.ampm);
}

type Props = {
  label?: string;
  /** SIEMPRE `HH:mm` (24h), o `""` cuando el campo es opcional y no tiene valor — nunca cambia de formato. */
  value: string;
  /** Recibe SIEMPRE `HH:mm` (24h) — el componente es puramente de presentación. */
  onChange: (hora24: string) => void;
  inputClassName: string;
  disabled?: boolean;
  /** Se coloca en el `<select>` de "Hora" — mismo mecanismo `data-campo` que ya usa rutas/page.tsx para enfocar el primer campo con error del servidor. */
  dataCampo?: string;
};

/**
 * OPERACIONES-HORA-12H-1 — selector de hora en formato 12h (hora 1-12 +
 * minutos 00-59 + AM/PM). 3 `<select>` nativos a propósito, en vez de un
 * combobox custom: teclado (flechas, tipeo-para-buscar) y lector de
 * pantalla funcionan "de fábrica" sin JS adicional, y los 60 minutos
 * quedan todos disponibles (el `<input type="time">` que reemplaza
 * permite cualquier minuto — restringir a incrementos sería una
 * regresión funcional).
 *
 * `value`/`onChange` son SIEMPRE `HH:mm` en 24h — el mismo formato que ya
 * se guarda/envía hoy. Este componente nunca cambia ese contrato, solo
 * cómo se presenta/edita en pantalla (ver src/lib/tms/hora-formato.ts).
 *
 * Vacío (`""`) en cualquiera de los 3 selects colapsa el valor completo a
 * `""` — mismo criterio "todo o nada" que ya tiene el `<input
 * type="time">` nativo al borrarse — necesario porque, p. ej.,
 * `horaHabitual` en Rutas es un campo opcional.
 */
export function Hora12Input({ label, value, onChange, inputClassName, disabled, dataCampo }: Props) {
  const id = useId();
  const partes = parsearHora12(value);
  const actualizar = (campo: "hora" | "minuto" | "ampm", valorCrudo: string) =>
    onChange(siguienteValorHora12(value, campo, valorCrudo));

  return (
    <div className="space-y-1">
      {label ? <p className="text-xs text-[var(--muted)]">{label}</p> : null}
      <div className="flex items-end gap-1">
        <label htmlFor={`${id}-hora`} className="text-[10px] text-[var(--muted)]">
          Hora
          <select
            id={`${id}-hora`}
            data-campo={dataCampo}
            className={`${inputClassName} mt-0.5 block`}
            value={partes ? String(partes.hora) : ""}
            disabled={disabled}
            onChange={(e) => actualizar("hora", e.target.value)}
          >
            <option value="">--</option>
            {HORAS_12.map((h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-minuto`} className="text-[10px] text-[var(--muted)]">
          Min.
          <select
            id={`${id}-minuto`}
            className={`${inputClassName} mt-0.5 block`}
            value={partes ? String(partes.minuto) : ""}
            disabled={disabled}
            onChange={(e) => actualizar("minuto", e.target.value)}
          >
            <option value="">--</option>
            {MINUTOS_60.map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-ampm`} className="text-[10px] text-[var(--muted)]">
          AM/PM
          <select
            id={`${id}-ampm`}
            className={`${inputClassName} mt-0.5 block`}
            value={partes ? partes.ampm : ""}
            disabled={disabled}
            onChange={(e) => actualizar("ampm", e.target.value)}
          >
            <option value="">--</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
      </div>
    </div>
  );
}
