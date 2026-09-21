"use client";

import { useEffect, useId, useRef, useState } from "react";

type ClienteOpt = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

type Props = {
  /** Modo local: catálogo ya cargado por el llamador (se filtra en el navegador). */
  clientes?: ClienteOpt[];
  /**
   * Modo remoto: con `slug` el buscador consulta GET /tms/clientes?q= (debounce
   * ~200 ms, mismo patrón que RutaSelect) en vez de filtrar un catálogo local.
   * Los ids son siempre `tms_clientes.id`.
   */
  slug?: string;
  valueNombre: string;
  valueId: number;
  onChange: (next: { clienteId: number; clienteNombre: string }) => void;
  inputClassName: string;
  /** Etiqueta propia del campo (el componente ya dibuja su <label>: no envolverlo en otro). */
  label?: string;
  /** Texto de ayuda cuando el campo está vacío. */
  descripcion?: string;
  /** Solo modo remoto: mensaje cuando hay texto escrito pero ningún cliente elegido. */
  mensajeSinSeleccion?: string;
  /** Solo modo remoto: si se pasa, se muestra el botón "Limpiar". */
  onLimpiar?: () => void;
  /** Texto accesible del botón "Limpiar". */
  limpiarAriaLabel?: string;
};

/**
 * Buscador de cliente: la lista solo se abre al enfocar/escribir y se cierra
 * al elegir o salir, sin tapar el resto del formulario.
 *
 * Dos modos:
 * - Local (`clientes`): filtra un catálogo ya cargado; conserva el
 *   comportamiento histórico (coincidencia exacta por nombre) para Programación,
 *   Rutas y las pantallas de contactos/ubicaciones.
 * - Remoto (`slug`): consulta el servidor mientras se escribe y NUNCA elige por
 *   coincidencia de texto: el cliente queda seleccionado solo al hacer clic o
 *   Enter sobre una opción de la lista.
 */
export function ClienteSearch({
  clientes = [],
  slug,
  valueNombre,
  valueId,
  onChange,
  inputClassName,
  label = "Cliente (buscar en catálogo)",
  descripcion,
  mensajeSinSeleccion = "Selecciona un cliente de la lista.",
  onLimpiar,
  limpiarAriaLabel,
}: Props) {
  const remoto = Boolean(slug);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [opciones, setOpciones] = useState<ClienteOpt[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ClienteOpt | null>(null);
  const q = valueNombre.trim().toLowerCase();

  const activos = clientes.filter(
    (c) => !c.estado || String(c.estado).toLowerCase() === "activo",
  );

  const selected = remoto
    ? valueId && elegido && elegido.id === valueId
      ? elegido
      : null
    : valueId
      ? activos.find((c) => c.id === valueId) ?? null
      : null;

  const filtered = remoto
    ? opciones
    : q.length < 1
      ? activos.slice(0, 12)
      : activos
          .filter((c) => {
            // VIAT-0 (punto 1): también localizable por código, no solo
            // nombre/NIT/teléfono.
            const hay =
              `${c.nombre} ${c.codigo ?? ""} ${c.nit ?? ""} ${c.telefono ?? ""}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 20);

  const exact = remoto
    ? undefined
    : activos.find((c) => c.nombre.toLowerCase() === q && q.length > 0);

  useEffect(() => {
    if (!open || !slug) return;
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuscando(true);
    const params = new URLSearchParams();
    if (valueNombre.trim()) params.set("q", valueNombre.trim());
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/clientes?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!ignore) setOpciones(res.ok ? ((data.clientes ?? []) as ClienteOpt[]) : []);
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
  }, [slug, valueNombre, open]);

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

  function elegir(c: ClienteOpt) {
    setElegido(c);
    onChange({ clienteId: c.id, clienteNombre: c.nombre });
    setOpen(false);
  }

  const conLimpiar = remoto && Boolean(onLimpiar);

  // PLAN-FORM-SELECTS-DROPDOWN-STACKING: mismo ajuste que PlacaSelect/
  // PilotoSelect/AuxiliaresSelect — ver el comentario en
  // placa-select.tsx. Un z-index fijo igual entre campos hermanos hace
  // que el desempate lo gane siempre el que está más abajo en el DOM,
  // tapando la lista de un campo de más arriba que se abre hacia abajo;
  // z-30 solo mientras `open` es true.
  return (
    <div
      ref={rootRef}
      className={`relative block text-xs text-[var(--muted)] md:col-span-1 ${open ? "z-30" : "z-10"}`}
    >
      <label htmlFor={listId} className="block">
        {label}
      </label>
      <div className={conLimpiar ? "mt-1 flex items-center gap-1" : undefined}>
        <input
          id={listId}
          className={conLimpiar ? `${inputClassName} w-full` : `${inputClassName} mt-1 w-full`}
          placeholder="Escribe nombre, código, NIT o teléfono…"
          value={valueNombre}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const nombre = e.target.value;
            if (remoto) {
              // Escribir invalida la selección previa: el id solo lo fija elegir().
              setElegido(null);
              onChange({ clienteId: 0, clienteNombre: nombre });
            } else {
              const match = activos.find(
                (c) => c.nombre.toLowerCase() === nombre.trim().toLowerCase(),
              );
              onChange({
                clienteId: match ? match.id : 0,
                clienteNombre: nombre,
              });
            }
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Enter" && open && filtered[0]) {
              e.preventDefault();
              elegir(filtered[0]);
            }
          }}
          onBlur={() => {
            // Retraso breve para permitir click en la lista
            window.setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) {
                setOpen(false);
                if (!valueId && exact) {
                  onChange({ clienteId: exact.id, clienteNombre: exact.nombre });
                }
              }
            }, 120);
          }}
        />
        {conLimpiar && (valueId || valueNombre.trim()) ? (
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--nav-hover)]"
            aria-label={limpiarAriaLabel ?? "Limpiar cliente"}
            onClick={() => {
              setElegido(null);
              setOpen(false);
              onLimpiar?.();
            }}
          >
            Limpiar
          </button>
        ) : null}
      </div>
      {remoto ? (
        valueId ? (
          <span className="mt-0.5 block text-[10px] text-emerald-400">
            Seleccionado:{" "}
            {[selected?.codigo, selected?.nombre ?? valueNombre, selected?.nit ? `NIT ${selected.nit}` : null, selected?.telefono]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : valueNombre.trim() ? (
          <span className="mt-0.5 block text-[10px] text-amber-300/90">{mensajeSinSeleccion}</span>
        ) : (
          <span className="mt-0.5 block text-[10px]">
            {descripcion ?? "Haz clic y elige de la lista, o busca por nombre, código, NIT o teléfono"}
          </span>
        )
      ) : valueId && selected ? (
        <span className="mt-0.5 block text-[10px] text-emerald-400">
          Seleccionado #{valueId}
          {selected.nit ? ` · NIT ${selected.nit}` : ""}
        </span>
      ) : valueNombre.trim() ? (
        <span className="mt-0.5 block text-[10px] text-amber-300/90">
          Sin coincidencia exacta: se usará el nombre al guardar
        </span>
      ) : (
        <span className="mt-0.5 block text-[10px]">
          Haz clic y elige de la lista, o busca por nombre/NIT
        </span>
      )}

      {open && (remoto || filtered.length > 0) ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-44 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
        >
          {remoto && buscando ? (
            <li className="px-2.5 py-1.5 text-xs text-[var(--muted)]">Buscando...</li>
          ) : null}
          {remoto && !buscando && !filtered.length ? (
            <li className="px-2.5 py-1.5 text-xs text-[var(--muted)]">Sin clientes que coincidan.</li>
          ) : null}
          {filtered.map((c) => (
            <li key={c.id} role="option" aria-selected={valueId === c.id}>
              <button
                type="button"
                className={[
                  "flex w-full flex-col px-2.5 py-1.5 text-left text-sm hover:bg-[var(--nav-hover)]",
                  valueId === c.id ? "bg-[var(--nav-active)]" : "",
                ].join(" ")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c)}
              >
                <span className="text-[var(--text)]">
                  {c.codigo ? `${c.codigo} · ` : ""}
                  {c.nombre}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {c.nit ? `NIT ${c.nit}` : "Sin NIT"}
                  {c.telefono ? ` · ${c.telefono}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
