"use client";

import { useEffect, useId, useRef, useState } from "react";

export type RutaParadaOpt = {
  id: number;
  orden: number;
  tipo: string;
  lugarNombre: string;
  clienteUbicacionId: number | null;
};

export type RutaOpt = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  codigo: string;
  nombre: string | null;
  ubicacionCargaId: number | null;
  lugarCargaTexto: string | null;
  destinoDescripcion: string | null;
  horaHabitual: string | null;
  contactoClienteId: number | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
  paradas: RutaParadaOpt[];
};

type Props = {
  slug: string;
  /** Si hay cliente elegido en el formulario, restringe la búsqueda a sus rutas (modo B). Si es 0, busca en todas (modo A: por código). */
  clienteId: number;
  value: string;
  inputClassName: string;
  onSeleccionar: (ruta: RutaOpt) => void;
};

/**
 * VIAT-4 (Programación — selector "Código / Ruta") — buscador compacto de
 * dos formas: A) escribir un código y el sistema ubica la ruta (y su
 * cliente); B) si ya hay cliente elegido, solo busca entre SUS rutas
 * activas. Al elegir, el formulario COPIA los datos (fotografía
 * histórica) — este componente solo entrega la ruta encontrada, la copia
 * la hace el llamador (plan-form.tsx). Mismo patrón visual que
 * ClienteSearch/PilotoSelect/PlacaSelect.
 */
export function RutaSelect({ slug, clienteId, value, inputClassName, onSeleccionar }: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState(value);
  const [opciones, setOpciones] = useState<RutaOpt[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTexto(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuscando(true);
    const params = new URLSearchParams();
    if (clienteId) params.set("clienteId", String(clienteId));
    if (texto.trim()) params.set("q", texto.trim());
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/rutas?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!ignore) setOpciones(res.ok ? ((data.rutas ?? []) as RutaOpt[]) : []);
      } catch {
        if (!ignore) setOpciones([]);
      } finally {
        if (!ignore) setBuscando(false);
      }
    }, 200);
    return () => {
      ignore = true;
      window.clearTimeout(t);
    };
  }, [slug, clienteId, texto, open]);

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

  function elegir(r: RutaOpt) {
    setTexto(`${r.codigo} — ${r.clienteNombre}${r.nombre ? ` — ${r.nombre}` : ""}`);
    onSeleccionar(r);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative z-10 block text-xs text-[var(--muted)]">
      <label htmlFor={listId} className="block">
        Código / Ruta {clienteId ? "(rutas de este cliente)" : "(busca por código, cliente o nombre)"}
      </label>
      <input
        id={listId}
        className={`${inputClassName} mt-1 w-full`}
        placeholder="Ej. 8, o el nombre del cliente, o nombre de la ruta…"
        value={texto}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTexto(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" && open && opciones[0]) {
            e.preventDefault();
            elegir(opciones[0]);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
          }, 120);
        }}
      />
      <span className="mt-0.5 block text-[10px]">
        Al elegir una ruta se sugieren lugar de carga, hora y destinos — puedes ajustarlos para este
        viaje sin modificar la ruta maestra.
      </span>

      {open ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        >
          {buscando ? <li className="px-2.5 py-1.5 text-xs text-[var(--muted)]">Buscando…</li> : null}
          {!buscando && !opciones.length ? (
            <li className="px-2.5 py-1.5 text-xs text-[var(--muted)]">Sin rutas que coincidan.</li>
          ) : null}
          {opciones.map((r) => (
            <li key={r.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full flex-col px-2.5 py-1.5 text-left text-sm hover:bg-[var(--nav-hover)]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(r)}
              >
                <span className="text-[var(--text)]">
                  {r.codigo} — {r.clienteNombre}
                  {r.nombre ? ` — ${r.nombre}` : ""}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {r.lugarCargaTexto || "Sin carga configurada"}
                  {r.horaHabitual ? ` · ${r.horaHabitual}` : ""}
                  {r.destinoDescripcion ? ` → ${r.destinoDescripcion}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
