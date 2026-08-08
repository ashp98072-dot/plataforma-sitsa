"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  slug: string;
  can: (
    sub: string,
    accion?: "ver" | "crear" | "editar" | "eliminar",
  ) => boolean;
};

type Categoria = {
  id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
};
type Area = {
  id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
};
type Empleado = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
};
type Item = {
  id: number;
  codigo: string;
  nombre: string;
  categoriaId: number | null;
  categoriaNombre: string | null;
  propiedad: "empresa" | "empleado";
  areaId: number | null;
  areaNombre: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  cantidad: number;
  unidad: string;
  marca: string | null;
  serie: string | null;
  estado: string;
  notas: string | null;
};
type Resumen = {
  qtyEmpresa: number;
  qtyEmpleado: number;
  itemsEmpresa: number;
  itemsEmpleado: number;
  porArea: { area: string; cantidad: number; items: number }[];
  porEmpleado: { empleado: string; cantidad: number; items: number }[];
};

const input =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const emptyForm = {
  codigo: "",
  nombre: "",
  categoriaId: 0,
  propiedad: "empresa" as "empresa" | "empleado",
  areaId: 0,
  empleadoId: 0,
  cantidad: 1,
  unidad: "Unidad",
  marca: "",
  serie: "",
  estado: "Activo",
  notas: "",
};

export function InventarioEquipoPanel({ slug, can }: Props) {
  const [vista, setVista] = useState<"empresa" | "empleado" | "catalogos">(
    "empresa",
  );
  const [items, setItems] = useState<Item[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [catNombre, setCatNombre] = useState("");
  const [areaNombre, setAreaNombre] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const base = `/api/empresas/${slug}/flota/inventario-equipo`;

  const cargar = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`${base}?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar inventario.");
      setItems(data.items ?? []);
      setCategorias(data.categorias ?? []);
      setAreas(data.areas ?? []);
      setResumen(data.resumen ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [base, q]);

  const cargarEmpleados = useCallback(async () => {
    const res = await fetch(`${base}/empleados`);
    if (!res.ok) return;
    const data = await res.json();
    setEmpleados(data.empleados ?? []);
  }, [base]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (vista === "empleado" || form.propiedad === "empleado") {
      void cargarEmpleados();
    }
  }, [vista, form.propiedad, cargarEmpleados]);

  const filtrados = useMemo(() => {
    if (vista === "catalogos") return [];
    return items.filter((i) => i.propiedad === vista);
  }, [items, vista]);

  async function guardarItem() {
    if (!can("flota_inventario", "crear")) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const body = {
        codigo: form.codigo.trim() || `EQ-${Date.now().toString(36).toUpperCase()}`,
        nombre: form.nombre.trim(),
        categoriaId: form.categoriaId || null,
        propiedad: form.propiedad,
        areaId: form.propiedad === "empresa" ? form.areaId || null : null,
        empleadoId: form.propiedad === "empleado" ? form.empleadoId || null : null,
        cantidad: Number(form.cantidad) || 0,
        unidad: form.unidad || "Unidad",
        marca: form.marca.trim() || null,
        serie: form.serie.trim() || null,
        estado: form.estado || "Activo",
        notas: form.notas.trim() || null,
      };
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar.");
      setMsg(data.mensaje ?? "Guardado.");
      setForm({ ...emptyForm, propiedad: form.propiedad });
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function eliminarItem(id: number) {
    if (!can("flota_inventario", "eliminar")) return;
    if (!confirm("¿Eliminar este ítem del inventario?")) return;
    setErr("");
    const res = await fetch(`${base}?id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "No se pudo eliminar.");
      return;
    }
    setMsg("Ítem eliminado.");
    await cargar();
  }

  async function crearCategoria() {
    if (!can("flota_inventario", "crear") || !catNombre.trim()) return;
    setErr("");
    const res = await fetch(`${base}/categorias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: catNombre.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "No se pudo crear categoría.");
      return;
    }
    setCatNombre("");
    setMsg("Categoría creada.");
    await cargar();
  }

  async function crearArea() {
    if (!can("flota_inventario", "crear") || !areaNombre.trim()) return;
    setErr("");
    const res = await fetch(`${base}/areas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: areaNombre.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "No se pudo crear área.");
      return;
    }
    setAreaNombre("");
    setMsg("Área creada.");
    await cargar();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Inventario de equipo</h2>
        <p className="text-sm text-[var(--muted)]">
          Herramientas de la empresa por área, y herramientas propias de
          mecánicos, electricistas, herreros, etc. (empleados de RRHH).
        </p>
      </div>

      {resumen ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Herramientas empresa"
            value={`${resumen.qtyEmpresa} uds`}
            hint={`${resumen.itemsEmpresa} ítems`}
          />
          <Stat
            label="Propias de empleados"
            value={`${resumen.qtyEmpleado} uds`}
            hint={`${resumen.itemsEmpleado} ítems`}
          />
          <Stat
            label="Áreas con stock"
            value={String(resumen.porArea.length)}
            hint="Ubicaciones activas"
          />
          <Stat
            label="Empleados con equipo"
            value={String(resumen.porEmpleado.length)}
            hint="Con herramientas propias"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["empresa", "De la empresa"],
            ["empleado", "Propias del empleado"],
            ["catalogos", "Categorías y áreas"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setVista(id);
              setForm((f) => ({
                ...f,
                propiedad: id === "empleado" ? "empleado" : "empresa",
              }));
            }}
            className={[
              "rounded-lg px-3 py-1.5 text-sm",
              vista === id
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] bg-[var(--card)]",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {msg ? <p className="text-sm text-emerald-500">{msg}</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      {vista === "catalogos" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-medium">Categorías (oficio / tipo)</p>
            <p className="text-xs text-[var(--muted)]">
              Ej. Mecánico, Electricista, Herrero…
            </p>
            {can("flota_inventario", "crear") ? (
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} min-w-[12rem] flex-1`}
                  placeholder="Nueva categoría"
                  value={catNombre}
                  onChange={(e) => setCatNombre(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                  onClick={() => void crearCategoria()}
                >
                  Agregar
                </button>
              </div>
            ) : null}
            <ul className="divide-y divide-[var(--border)] text-sm">
              {categorias.map((c) => (
                <li key={c.id} className="flex justify-between py-2">
                  <span>{c.nombre}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {c.activa ? "Activa" : "Inactiva"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-medium">Áreas / ubicaciones</p>
            <p className="text-xs text-[var(--muted)]">
              Dónde está la herramienta de la empresa (Taller, Bodega…).
            </p>
            {can("flota_inventario", "crear") ? (
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} min-w-[12rem] flex-1`}
                  placeholder="Nueva área"
                  value={areaNombre}
                  onChange={(e) => setAreaNombre(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                  onClick={() => void crearArea()}
                >
                  Agregar
                </button>
              </div>
            ) : null}
            <ul className="divide-y divide-[var(--border)] text-sm">
              {areas.map((a) => (
                <li key={a.id} className="flex justify-between py-2">
                  <span>{a.nombre}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {resumen?.porArea.find((x) => x.area === a.nombre)
                      ?.cantidad ?? 0}{" "}
                    uds
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {resumen?.porArea.length ? (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 lg:col-span-2">
              <p className="mb-2 text-sm font-medium">
                Resumen empresa por área
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">Área</th>
                      <th className="px-3 py-2">Ítems</th>
                      <th className="px-3 py-2">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.porArea.map((r) => (
                      <tr key={r.area} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2">{r.area}</td>
                        <td className="px-3 py-2">{r.items}</td>
                        <td className="px-3 py-2">{r.cantidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <>
          {can("flota_inventario", "crear") ? (
            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-sm font-medium">
                {vista === "empresa"
                  ? "Registrar herramienta de la empresa"
                  : "Registrar herramienta propia del empleado"}
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} w-28`}
                  placeholder="Código"
                  value={form.codigo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, codigo: e.target.value }))
                  }
                />
                <input
                  className={`${input} min-w-[12rem] flex-1`}
                  placeholder="Nombre (ej. Desarmador plano)"
                  value={form.nombre}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nombre: e.target.value }))
                  }
                />
                <select
                  className={input}
                  value={form.categoriaId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      categoriaId: Number(e.target.value),
                    }))
                  }
                >
                  <option value={0}>— Categoría —</option>
                  {categorias
                    .filter((c) => c.activa)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                </select>
                {vista === "empresa" ? (
                  <select
                    className={input}
                    value={form.areaId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, areaId: Number(e.target.value) }))
                    }
                  >
                    <option value={0}>— Área —</option>
                    {areas
                      .filter((a) => a.activa)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nombre}
                        </option>
                      ))}
                  </select>
                ) : (
                  <select
                    className={`${input} min-w-[14rem]`}
                    value={form.empleadoId}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        empleadoId: Number(e.target.value),
                      }))
                    }
                  >
                    <option value={0}>— Empleado RRHH —</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                        {e.puesto ? ` · ${e.puesto}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min={0}
                  className={`${input} w-24`}
                  placeholder="Cant."
                  value={form.cantidad}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      cantidad: Number(e.target.value),
                    }))
                  }
                />
                <input
                  className={`${input} w-24`}
                  placeholder="Unidad"
                  value={form.unidad}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, unidad: e.target.value }))
                  }
                />
                <input
                  className={`${input} w-28`}
                  placeholder="Marca"
                  value={form.marca}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, marca: e.target.value }))
                  }
                />
                <button
                  type="button"
                  disabled={saving || !form.nombre.trim()}
                  className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => void guardarItem()}
                >
                  {saving ? "Guardando…" : "Agregar"}
                </button>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">
              Buscar
              <input
                className={`${input} mt-1 block min-w-[220px]`}
                placeholder="Código, nombre, área, empleado…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
              onClick={() => void cargar()}
            >
              Actualizar
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Cargando…</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Herramienta</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">
                      {vista === "empresa" ? "Área" : "Empleado"}
                    </th>
                    <th className="px-3 py-2">Cant.</th>
                    <th className="px-3 py-2">Estado</th>
                    {can("flota_inventario", "eliminar") ? (
                      <th className="px-3 py-2" />
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((it) => (
                    <tr
                      key={it.id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {it.codigo}
                      </td>
                      <td className="px-3 py-2">
                        <div>{it.nombre}</div>
                        {it.marca ? (
                          <div className="text-xs text-[var(--muted)]">
                            {it.marca}
                            {it.serie ? ` · ${it.serie}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {it.categoriaNombre ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {vista === "empresa"
                          ? (it.areaNombre ?? "—")
                          : (it.empleadoNombre ?? "—")}
                      </td>
                      <td className="px-3 py-2">
                        {it.cantidad} {it.unidad}
                      </td>
                      <td className="px-3 py-2">{it.estado}</td>
                      {can("flota_inventario", "eliminar") ? (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="text-xs text-red-400 hover:underline"
                            onClick={() => void eliminarItem(it.id)}
                          >
                            Eliminar
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {!filtrados.length ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-6 text-center text-[var(--muted)]"
                      >
                        No hay ítems en esta vista.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {vista === "empleado" && resumen?.porEmpleado.length ? (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="mb-2 text-sm font-medium">
                Totales por empleado
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">Empleado</th>
                      <th className="px-3 py-2">Ítems</th>
                      <th className="px-3 py-2">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.porEmpleado.map((r) => (
                      <tr
                        key={r.empleado}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-3 py-2">{r.empleado}</td>
                        <td className="px-3 py-2">{r.items}</td>
                        <td className="px-3 py-2">{r.cantidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{hint}</p>
    </div>
  );
}
