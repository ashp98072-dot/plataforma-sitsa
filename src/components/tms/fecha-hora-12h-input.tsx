"use client";

import { Hora12Input } from "@/components/tms/hora-input-12h";

/**
 * OPERACIONES-HORA-12H-1 (Grupo "Regreso estimado") — separa un valor
 * `"YYYY-MM-DDTHH:mm"` (el MISMO contrato que ya exige la API,
 * `z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)`) en sus dos
 * mitades. Función PURA, probada directo (mismo criterio que
 * catalogo-search-select.tsx / hora-input-12h.tsx: nunca renderizar el
 * DOM para probar esta lógica). `""` -> `{ fecha: "", hora24: "" }`.
 */
export function separarFechaHora(value: string): { fecha: string; hora24: string } {
  if (!value) return { fecha: "", hora24: "" };
  const [fecha, hora24] = value.split("T");
  return { fecha: fecha ?? "", hora24: hora24 ?? "" };
}

/**
 * Inversa de `separarFechaHora`: reconstruye `"YYYY-MM-DDTHH:mm"` a
 * partir de sus dos mitades. Si falta CUALQUIERA de las dos, el valor
 * completo colapsa a `""` — mismo criterio "todo o nada" que ya usa
 * `Hora12Input` (siguienteValorHora12) para sus 3 `<select>`, aplicado
 * aquí al par fecha+hora.
 */
export function siguienteValorFechaHora12(fecha: string, hora24: string): string {
  if (!fecha || !hora24) return "";
  return `${fecha}T${hora24}`;
}

type Props = {
  label?: string;
  /** SIEMPRE `"YYYY-MM-DDTHH:mm"` (mismo contrato que hoy exige la API) o `""` — nunca cambia de formato. */
  value: string;
  /** Recibe SIEMPRE `"YYYY-MM-DDTHH:mm"` o `""` — el componente es puramente de presentación. */
  onChange: (value: string) => void;
  inputClassName: string;
  disabled?: boolean;
  required?: boolean;
};

/**
 * OPERACIONES-HORA-12H-1 — reemplaza un `<input type="datetime-local">`
 * (fecha+hora en 24h) por un `<input type="date">` nativo + el
 * `Hora12Input` YA EXISTENTE (hora en 12h con AM/PM) — nunca reimplementa
 * el selector de hora, lo reutiliza tal cual.
 *
 * `value`/`onChange` son SIEMPRE `"YYYY-MM-DDTHH:mm"` — EXACTAMENTE el
 * mismo formato que ya exige la API (ver el regex en
 * .../tms/planes/route.ts) y que se guarda en `tms_planes_viaje.
 * regreso_estimado` (DATETIME). Este componente nunca cambia ese
 * contrato, solo cómo se presenta/edita en pantalla.
 *
 * Vaciar la fecha O la hora colapsa el valor completo a `""` (mismo
 * criterio "todo o nada" que Hora12Input) — necesario porque
 * `regresoEstimado` es opcional salvo cuando el plan tiene piloto/
 * auxiliares/unidad asignados (esa validación vive en plan-form.tsx, sin
 * cambios).
 */
export function FechaHora12Input({ label, value, onChange, inputClassName, disabled, required }: Props) {
  const { fecha, hora24 } = separarFechaHora(value);

  return (
    <div className="space-y-1">
      {label ? <p className="text-xs text-[var(--muted)]">{label}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <input
          type="date"
          className={`${inputClassName} block`}
          value={fecha}
          disabled={disabled}
          required={required}
          onChange={(e) => onChange(siguienteValorFechaHora12(e.target.value, hora24))}
        />
        <Hora12Input
          value={hora24}
          onChange={(nuevaHora24) => onChange(siguienteValorFechaHora12(fecha, nuevaHora24))}
          inputClassName={inputClassName}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
