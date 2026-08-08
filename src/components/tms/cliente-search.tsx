"use client";

type ClienteOpt = {
  id: number;
  nombre: string;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

type Props = {
  clientes: ClienteOpt[];
  valueNombre: string;
  valueId: number;
  onChange: (next: { clienteId: number; clienteNombre: string }) => void;
  inputClassName: string;
};

/**
 * Buscador de cliente del catálogo TMS/Clientes (sin crear módulos nuevos).
 */
export function ClienteSearch({
  clientes,
  valueNombre,
  valueId,
  onChange,
  inputClassName,
}: Props) {
  const q = valueNombre.trim().toLowerCase();
  const activos = clientes.filter(
    (c) => !c.estado || String(c.estado).toLowerCase() === "activo",
  );
  const filtered =
    q.length < 1
      ? activos.slice(0, 12)
      : activos
          .filter((c) => {
            const hay = `${c.nombre} ${c.nit ?? ""} ${c.telefono ?? ""}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 20);

  const exact = activos.find(
    (c) => c.nombre.toLowerCase() === q && q.length > 0,
  );

  return (
    <label className="relative block text-xs text-[var(--muted)] md:col-span-1">
      Cliente (buscar en catálogo)
      <input
        className={`${inputClassName} mt-1 w-full`}
        placeholder="Escribe nombre o NIT…"
        value={valueNombre}
        autoComplete="off"
        onChange={(e) => {
          const nombre = e.target.value;
          const match = activos.find(
            (c) => c.nombre.toLowerCase() === nombre.trim().toLowerCase(),
          );
          onChange({
            clienteId: match ? match.id : 0,
            clienteNombre: nombre,
          });
        }}
        onBlur={() => {
          // Si hay coincidencia exacta al salir, fijar id
          if (!valueId && exact) {
            onChange({ clienteId: exact.id, clienteNombre: exact.nombre });
          }
        }}
      />
      {valueId ? (
        <span className="mt-0.5 block text-[10px] text-emerald-400">
          Cliente del catálogo #{valueId}
          {exact?.nit ? ` · NIT ${exact.nit}` : ""}
        </span>
      ) : valueNombre.trim() ? (
        <span className="mt-0.5 block text-[10px] text-amber-300/90">
          Sin coincidencia exacta: se creará/usará por nombre al guardar
        </span>
      ) : (
        <span className="mt-0.5 block text-[10px]">
          Elige de la lista o busca por nombre/NIT
        </span>
      )}
      {filtered.length > 0 && (q.length > 0 || !valueId) ? (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={[
                  "flex w-full flex-col px-2.5 py-1.5 text-left text-sm hover:bg-[var(--nav-hover)]",
                  valueId === c.id ? "bg-[var(--nav-active)]" : "",
                ].join(" ")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  onChange({ clienteId: c.id, clienteNombre: c.nombre })
                }
              >
                <span className="text-[var(--text)]">{c.nombre}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {c.nit ? `NIT ${c.nit}` : "Sin NIT"}
                  {c.telefono ? ` · ${c.telefono}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}
