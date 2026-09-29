"use client";

import { useMemo, useState } from "react";
import { filtrarPersonas } from "@/lib/busqueda-personas";

export type UsuarioEntrevistaOpt = {
  id: number;
  nombre: string;
  username: string;
  rol: string;
};

type Props = {
  usuarios: UsuarioEntrevistaOpt[];
  value: number;
  onChange: (id: number) => void;
  className?: string;
  inputClassName?: string;
  label?: string;
  emptyLabel?: string;
  /** Igual que EmpleadoPicker: en un FILTRO (0 = "Todos" es una elección válida) debe seguir disponible con selección. */
  allowEmptySelection?: boolean;
};

/**
 * ATRACCION-TALENTO-2 (secciones 4-8) — selector de USUARIO (entrevistador
 * principal / auxiliar / filtro de reportes), alimentado por
 * GET /rrhh/entrevistas/usuarios. Deliberadamente un componente propio (no
 * EmpleadoPicker): el shape es distinto (nombre/username/rol, no
 * codigo/dpi) y EmpleadoPicker no se toca. Reutiliza la misma semántica de
 * búsqueda compartida (src/lib/busqueda-personas.ts) que el resto de
 * selectores de personal del proyecto.
 */
export function UsuarioEntrevistaPicker({
  usuarios,
  value,
  onChange,
  className,
  inputClassName,
  label = "Usuario",
  emptyLabel = "— Seleccionar —",
  allowEmptySelection = false,
}: Props) {
  const [q, setQ] = useState("");
  const filtrados = useMemo(() => {
    if (!q.trim()) return usuarios.slice(0, 120);
    return filtrarPersonas(usuarios, q, { nombre: (u) => u.nombre, buscable: (u) => `${u.username} ${u.rol}` }, 120);
  }, [usuarios, q]);

  const selected = usuarios.find((u) => u.id === value);
  const input =
    inputClassName ??
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <label className={["text-sm text-[var(--muted)]", className].filter(Boolean).join(" ")}>
      {label}
      <input
        className={`${input} mt-1 w-full`}
        placeholder="Buscar por nombre, usuario o rol…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className={`${input} mt-1 w-full`}
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {!value || allowEmptySelection ? <option value="">{emptyLabel}</option> : null}
        {selected && !filtrados.some((u) => u.id === selected.id) ? (
          <option value={selected.id}>{selected.nombre} — {selected.rol}</option>
        ) : null}
        {filtrados.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre} — {u.rol}
          </option>
        ))}
      </select>
      {q.trim() ? (
        <span className="mt-0.5 block text-xs opacity-70">
          {filtrados.length === 0 ? "No se encontraron usuarios." : `${filtrados.length} coincidencia(s)`}
        </span>
      ) : null}
    </label>
  );
}
