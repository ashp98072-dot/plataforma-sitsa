"use client";

import { useEffect, useState } from "react";
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

/**
 * CORRECCIÓN post-revisión PR #265 — estado interno de `FechaHora12Input`:
 * `draft` es lo que se MUESTRA en los 2 controles (puede estar
 * incompleto); `ultimoEmitido` es el último valor que el componente le
 * mandó al padre vía `onChange` (siempre `"YYYY-MM-DDTHH:mm"` completo, o
 * `""` si el borrador está incompleto). Exportado + las 3 funciones de
 * abajo son funciones PURAS que modelan exactamente la máquina de
 * estados que usa el componente — se prueban directo, sin renderizar
 * nada (mismo criterio que el resto de este archivo y de
 * hora-input-12h.tsx; este proyecto no tiene harness de componentes
 * React, ver vitest.config.mts: environment "node", solo incluye
 * `*.test.ts`).
 */
export type EstadoFechaHora12 = {
  draft: { fecha: string; hora24: string };
  ultimoEmitido: string;
};

/** Estado inicial a partir de un `value` (prop) — usado al montar el componente. */
export function inicializarEstadoFechaHora12(value: string): EstadoFechaHora12 {
  return { draft: separarFechaHora(value), ultimoEmitido: value };
}

/**
 * Simula qué debe pasar cuando el `value` (prop) cambia — el `useEffect`
 * del componente. Si `value` coincide con `ultimoEmitido`, es el ECO del
 * propio `onChange` de este componente (el borrador ya está correcto,
 * NO se toca — esto es lo que corrige el bug: antes, elegir solo la hora
 * con la fecha vacía emitía `onChange("")`, y el componente volvía a
 * derivar `hora24=""` de ese mismo `""`, "olvidando" lo recién elegido).
 * Si `value` NO coincide, es un cambio genuinamente EXTERNO (el padre
 * cargó otro plan, o reseteó el formulario) — ahí sí se resincroniza el
 * borrador completo desde el `value` nuevo. Devuelve el MISMO objeto
 * `estado` (misma referencia) cuando no hay nada que hacer, para que
 * `setState` con esta función pueda evitar un rerender innecesario.
 */
export function sincronizarEstadoFechaHora12(estado: EstadoFechaHora12, value: string): EstadoFechaHora12 {
  if (value === estado.ultimoEmitido) return estado;
  return inicializarEstadoFechaHora12(value);
}

/**
 * Simula "el usuario tocó la fecha o la hora": aplica el cambio parcial
 * sobre el borrador ACTUAL (nunca sobre `value` directamente — ahí está
 * la corrección), recalcula `ultimoEmitido` (completo solo si ambas
 * mitades del borrador quedaron presentes, `""` si falta cualquiera —
 * mismo contrato de siempre) y devuelve el estado siguiente completo.
 */
export function actualizarEstadoFechaHora12(
  estado: EstadoFechaHora12,
  cambio: { fecha?: string; hora24?: string },
): EstadoFechaHora12 {
  const draft = {
    fecha: cambio.fecha !== undefined ? cambio.fecha : estado.draft.fecha,
    hora24: cambio.hora24 !== undefined ? cambio.hora24 : estado.draft.hora24,
  };
  return { draft, ultimoEmitido: siguienteValorFechaHora12(draft.fecha, draft.hora24) };
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
 * CORRECCIÓN post-revisión PR #265 — bug confirmado en producción: antes,
 * fecha/hora se derivaban ÚNICAMENTE de `value`. Como
 * `siguienteValorFechaHora12` colapsa a `""` mientras falte cualquiera de
 * las dos mitades, elegir SOLO la hora (con la fecha todavía vacía)
 * emitía `onChange("")` — el padre seguía viendo `""`, este componente
 * volvía a derivar `hora24=""` de ese mismo `""`, y el selector de hora
 * se "olvidaba" de lo que el usuario acababa de elegir. Mismo problema
 * en el orden inverso (fecha primero, hora después). Era IMPOSIBLE
 * construir un valor nuevo desde vacío.
 *
 * Corregido con un ESTADO LOCAL DE BORRADOR (`draft`): fecha/hora
 * seleccionadas se guardan aquí, no solo se derivan de `value` — así
 * cada mitad se mantiene visualmente aunque el valor combinado todavía
 * no sea válido. Solo se llama a `onChange` con un valor completo
 * (`YYYY-MM-DDTHH:mm`) cuando AMBAS mitades del borrador están
 * presentes; si falta una, se llama con `""` (mismo contrato de
 * siempre), pero el borrador NO se pisa con ese `""` — sigue mostrando lo
 * que el usuario ya eligió.
 *
 * Sincronización con `value` externo (p. ej. el padre carga OTRO plan):
 * el estado guarda `ultimoEmitido` (el último valor que ESTE componente
 * mandó al padre). Cuando `value` cambia, `sincronizarEstadoFechaHora12`
 * compara contra ese campo — si coincide, es simplemente el eco de
 * nuestro propio `onChange` y el borrador YA está correcto (se devuelve
 * el mismo objeto de estado, sin resincronizar); si NO coincide, es un
 * cambio genuinamente externo (otro plan, reset del formulario) y ahí sí
 * se resincroniza el borrador completo desde el `value` nuevo.
 *
 * Nunca se tocó `Hora12Input`: no tiene esta clase de bug — cada
 * `<select>` que se toca ya produce un `HH:mm` completo de inmediato
 * (rellena minuto/AM-PM con valores por defecto sensatos, 00/AM, en vez
 * de exigir que las 3 partes estén completas antes de emitir algo) — ver
 * `siguienteValorHora12` en hora-input-12h.tsx. Ese diseño ya evita la
 * clase de bug que sí tenía este componente; Programación (hora
 * programada) y Rutas (hora habitual) no necesitan ningún cambio.
 *
 * Vaciar la fecha O la hora de un valor YA completo sigue colapsando el
 * valor combinado a `""` (mismo contrato de siempre) — necesario porque
 * `regresoEstimado` es opcional salvo cuando el plan tiene piloto/
 * auxiliares/unidad asignados (esa validación vive en plan-form.tsx, sin
 * cambios).
 */
export function FechaHora12Input({ label, value, onChange, inputClassName, disabled, required }: Props) {
  const [estado, setEstado] = useState(() => inicializarEstadoFechaHora12(value));

  useEffect(() => {
    // Sincroniza el borrador SOLO cuando `value` cambia por una razón
    // externa a este componente (otro plan cargado, reset del
    // formulario) — nunca como eco de nuestro propio onChange, ver
    // sincronizarEstadoFechaHora12 más arriba. Mismo patrón ya usado en
    // plan-form.tsx (precarga de piloto/auxiliares al cambiar de plan).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstado((actual) => sincronizarEstadoFechaHora12(actual, value));
  }, [value]);

  function actualizar(cambio: { fecha?: string; hora24?: string }) {
    const siguiente = actualizarEstadoFechaHora12(estado, cambio);
    setEstado(siguiente);
    onChange(siguiente.ultimoEmitido);
  }

  return (
    <div className="space-y-1">
      {label ? <p className="text-xs text-[var(--muted)]">{label}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <input
          type="date"
          className={`${inputClassName} block`}
          value={estado.draft.fecha}
          disabled={disabled}
          required={required}
          onChange={(e) => actualizar({ fecha: e.target.value })}
        />
        <Hora12Input
          value={estado.draft.hora24}
          onChange={(nuevaHora24) => actualizar({ hora24: nuevaHora24 })}
          inputClassName={inputClassName}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
