"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type FilaLote = {
  key: string;
  nombre: string;
  cantidad: number;
  categoriaId: number;
  unidad: string;
  marca: string;
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

function filaVacia(): FilaLote {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nombre: "",
    cantidad: 1,
    categoriaId: 0,
    unidad: "Unidad",
    marca: "",
  };
}

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
  const [empleadoLoteId, setEmpleadoLoteId] = useState(0);
  const [empFiltro, setEmpFiltro] = useState("");
  const [filasLote, setFilasLote] = useState<FilaLote[]>(() =>
    Array.from({ length: 5 }, () => filaVacia()),
  );
  const [catNombre, setCatNombre] = useState("");
  const [areaNombre, setAreaNombre] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const empleadosCargados = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const tieneDatos = useRef(false);

  const base = `/api/empresas/${slug}/flota/inventario-equipo`;

  const cargar = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!tieneDatos.current) setLoading(true);
    setErr("");
    try {
      const res = await fetch(base, { signal: ac.signal });
      const data = await res.json().catch(() => ({}));
      if (ac.signal.aborted) return;
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar inventario.");
      setItems(data.items ?? []);
      setCategorias(data.categorias ?? []);
      setAreas(data.areas ?? []);
      setResumen(data.resumen ?? null);
      tieneDatos.current = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [base]);

  const cargarEmpleados = useCallback(async () => {
    if (empleadosCargados.current) return;
    const res = await fetch(`${base}/empleados`);
    if (!res.ok) return;
    const data = await res.json();
    setEmpleados(data.empleados ?? []);
    empleadosCargados.current = true;
  }, [base]);

  useEffect(() => {
    void cargar();
    return () => {
      abortRef.current?.abort();
    };
  }, [cargar]);

  useEffect(() => {
    if (vista === "empleado") {
      void cargarEmpleados();
    }
  }, [vista, cargarEmpleados]);

  const empleadosFiltrados = useMemo(() => {
    const term = empFiltro.trim().toLowerCase();
    if (!term) return empleados;
    return empleados.filter((e) =>
      `${e.codigo} ${e.nombre} ${e.puesto}`.toLowerCase().includes(term),
    );
  }, [empleados, empFiltro]);

  const itemsEmpleadoSeleccionado = useMemo(() => {
    if (!empleadoLoteId) return [];
    return items.filter(
      (i) => i.propiedad === "empleado" && i.empleadoId === empleadoLoteId,
    );
  }, [items, empleadoLoteId]);

  const filtrados = useMemo(() => {
    if (vista === "catalogos") return [];
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      if (i.propiedad !== vista) return false;
      if (!s) return true;
      const blob = [
        i.codigo,
        i.nombre,
        i.categoriaNombre,
        i.areaNombre,
        i.empleadoNombre,
        i.marca,
        i.serie,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(s);
    });
  }, [items, vista, q]);

  async function guardarItem() {
    if (!can("flota_inventario", "crear")) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const body = {
        codigo:
          form.codigo.trim() ||
          `EQ-${Date.now().toString(36).toUpperCase()}`,
        nombre: form.nombre.trim(),
        categoriaId: form.categoriaId || null,
        propiedad: form.propiedad,
        areaId: form.propiedad === "empresa" ? form.areaId || null : null,
        empleadoId:
          form.propiedad === "empleado" ? form.empleadoId || null : null,
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

  async function guardarLoteEmpleado() {
    if (!can("flota_inventario", "crear")) return;
    if (!empleadoLoteId) {
      setErr("Selecciona el empleado.");
      return;
    }
    const itemsOk = filasLote
      .map((f) => ({
        nombre: f.nombre.trim(),
        cantidad: Number(f.cantidad) || 0,
        categoriaId: f.categoriaId || null,
        unidad: f.unidad.trim() || "Unidad",
        marca: f.marca.trim() || null,
      }))
      .filter((f) => f.nombre);

    if (!itemsOk.length) {
      setErr("Escribe al menos una herramienta con nombre.");
      return;
    }

    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lote: true,
          propiedad: "empleado",
          empleadoId: empleadoLoteId,
          items: itemsOk,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar el lote.");
      setMsg(data.mensaje ?? "Lote guardado.");
      if (Array.isArray(data.errores) && data.errores.length) {
        setErr(data.errores.slice(0, 5).join(" · "));
      }
      setFilasLote(Array.from({ length: 5 }, () => filaVacia()));
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

  function patchFila(key: string, patch: Partial<FilaLote>) {
    setFilasLote((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Inventario de equipo</h2>
        <p className="text-sm text-[var(--muted)]">
          Herramientas de la empresa por área, y por empleado: carga varias
          herramientas de una vez (cantidades incluidas).
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
            ["empleado", "Por empleado"],
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
          {can("flota_inventario", "crear") && vista === "empresa" ? (
            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-sm font-medium">
                Registrar herramienta de la empresa
              </p>
              <p className="text-xs text-[var(--muted)]">
                <strong>Código</strong> = identificador de la herramienta (ej.
                DES-01). Si lo dejas vacío se genera solo.
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="text-xs text-[var(--muted)]">
                  Código herramienta
                  <input
                    className={`${input} mt-1 block w-36`}
                    placeholder="Auto si vacío"
                    value={form.codigo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, codigo: e.target.value }))
                    }
                  />
                </label>
                <label className="min-w-[12rem] flex-1 text-xs text-[var(--muted)]">
                  Nombre
                  <input
                    className={`${input} mt-1 block w-full`}
                    placeholder="Ej. Desarmador plano"
                    value={form.nombre}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nombre: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Categoría
                  <select
                    className={`${input} mt-1 block`}
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
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Área
                  <select
                    className={`${input} mt-1 block`}
                    value={form.areaId}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        areaId: Number(e.target.value),
                      }))
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
                </label>
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

          {can("flota_inventario", "crear") && vista === "empleado" ? (
            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-sm font-medium">
                Inventario por empleado (varias herramientas)
              </p>
              <p className="text-xs text-[var(--muted)]">
                Elige al empleado y llena la lista: herramienta + cantidad (+
                categoría/marca si quieres). Se guardan todas de una vez.
              </p>

              <div className="flex flex-wrap gap-2">
                <label className="text-xs text-[var(--muted)]">
                  Buscar empleado
                  <input
                    className={`${input} mt-1 block min-w-[14rem]`}
                    placeholder="Nombre, código o puesto…"
                    value={empFiltro}
                    onChange={(e) => setEmpFiltro(e.target.value)}
                  />
                </label>
                <label className="min-w-[16rem] flex-1 text-xs text-[var(--muted)]">
                  Empleado RRHH
                  <select
                    className={`${input} mt-1 block w-full`}
                    value={empleadoLoteId}
                    onChange={(e) =>
                      setEmpleadoLoteId(Number(e.target.value))
                    }
                  >
                    <option value={0}>— Seleccionar empleado —</option>
                    {empleadosFiltrados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.codigo ? `${e.codigo} · ` : ""}
                        {e.nombre}
                        {e.puesto ? ` · ${e.puesto}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {empleadoLoteId && itemsEmpleadoSeleccionado.length ? (
                <p className="text-xs text-[var(--muted)]">
                  Ya tiene {itemsEmpleadoSeleccionado.length} ítem(s) registrado(s)
                  (
                  {itemsEmpleadoSeleccionado.reduce(
                    (a, i) => a + Number(i.cantidad || 0),
                    0,
                  )}{" "}
                  uds). Lo que agregues abajo se suma al inventario.
                </p>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                    <tr>
                      <th className="px-2 py-2">Herramienta</th>
                      <th className="px-2 py-2">Cant.</th>
                      <th className="px-2 py-2">Categoría</th>
                      <th className="px-2 py-2">Marca</th>
                      <th className="px-2 py-2">Unidad</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filasLote.map((fila, idx) => (
                      <tr
                        key={fila.key}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-2 py-1.5">
                          <input
                            className={`${input} w-full min-w-[10rem]`}
                            placeholder={`Herramienta ${idx + 1}`}
                            value={fila.nombre}
                            onChange={(e) =>
                              patchFila(fila.key, { nombre: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min={0}
                            className={`${input} w-20`}
                            value={fila.cantidad}
                            onChange={(e) =>
                              patchFila(fila.key, {
                                cantidad: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className={input}
                            value={fila.categoriaId}
                            onChange={(e) =>
                              patchFila(fila.key, {
                                categoriaId: Number(e.target.value),
                              })
                            }
                          >
                            <option value={0}>—</option>
                            {categorias
                              .filter((c) => c.activa)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nombre}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={`${input} w-28`}
                            placeholder="Marca"
                            value={fila.marca}
                            onChange={(e) =>
                              patchFila(fila.key, { marca: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={`${input} w-24`}
                            value={fila.unidad}
                            onChange={(e) =>
                              patchFila(fila.key, { unidad: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            className="text-xs text-red-400 hover:underline"
                            onClick={() =>
                              setFilasLote((rows) =>
                                rows.length <= 1
                                  ? [filaVacia()]
                                  : rows.filter((r) => r.key !== fila.key),
                              )
                            }
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  onClick={() =>
                    setFilasLote((rows) => [...rows, filaVacia()])
                  }
                >
                  + Otra herramienta
                </button>
                <button
                  type="button"
                  disabled={
                    saving ||
                    !empleadoLoteId ||
                    !filasLote.some((f) => f.nombre.trim())
                  }
                  className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => void guardarLoteEmpleado()}
                >
                  {saving
                    ? "Guardando…"
                    : "Guardar inventario del empleado"}
                </button>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">
              Buscar (filtra en pantalla, sin recargar)
              <input
                className={`${input} mt-1 block min-w-[220px]`}
                placeholder="Código herramienta, nombre, área, empleado…"
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
