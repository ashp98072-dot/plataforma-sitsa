"use client";

import { useMemo, useState } from "react";
import { filtrarPersonas } from "@/lib/busqueda-personas";

export type EmpOpt = {
  id: number;
  codigo: string;
  nombre: string;
  dpi?: string | null;
};

type Props = {
  empleados: EmpOpt[];
  value: number;
  onChange: (id: number) => void;
  className?: string;
  inputClassName?: string;
  label?: string;
};

/** Selector de empleado con filtro por nombre, código o DPI. */
export function EmpleadoPicker({
  empleados,
  value,
  onChange,
  className,
  inputClassName,
  label = "Empleado",
}: Props) {
  const [q, setQ] = useState("");
  const filtrados = useMemo(() => {
    // Búsqueda compartida (src/lib/busqueda-personas.ts): sin tildes/mayúsculas, todas las palabras, ranking. Sigue buscando por
    // nombre, código y DPI como antes (el DPI no se muestra en más sitios que antes).
    if (!q.trim()) return empleados.slice(0, 120);
    return filtrarPersonas(empleados, q, { nombre: (e) => e.nombre, buscable: (e) => `${e.codigo} ${e.dpi ?? ""}` }, 120);
  }, [empleados, q]);

  const selected = empleados.find((e) => e.id === value);
  const input =
    inputClassName ??
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <label className={["text-sm text-[var(--muted)]", className].filter(Boolean).join(" ")}>
      {label}
      <input
        className={`${input} mt-1 w-full`}
        placeholder="Buscar por nombre, código o DPI…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className={`${input} mt-1 w-full`}
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {!value ? <option value="">— Seleccionar —</option> : null}
        {selected && !filtrados.some((e) => e.id === selected.id) ? (
          <option value={selected.id}>
            {selected.codigo} — {selected.nombre}
            {selected.dpi ? ` · DPI ${selected.dpi}` : ""}
          </option>
        ) : null}
        {filtrados.map((e) => (
          <option key={e.id} value={e.id}>
            {e.codigo} — {e.nombre}
            {e.dpi ? ` · DPI ${e.dpi}` : ""}
          </option>
        ))}
      </select>
      {q.trim() ? (
        <span className="mt-0.5 block text-xs opacity-70">
          {filtrados.length === 0 ? "No se encontraron empleados." : `${filtrados.length} coincidencia(s)`}
        </span>
      ) : null}
    </label>
  );
}
