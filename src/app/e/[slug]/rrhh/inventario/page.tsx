"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

type Articulo = {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string | null;
  stock: number;
  unidad: string;
  costoUnitario: number | null;
  estado: string;
};

type Movimiento = {
  id: number;
  articuloId: number;
  tipo: "ENTRADA" | "AJUSTE";
  cantidad: number;
  stockResultante: number;
  motivo: string | null;
  registradoPor: string | null;
  creadoEn: string;
};

function formatQ(v: number | null): string {
  if (v == null) return "—";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const input =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm";

export default function InventarioRrhhPage() {
  const slug = String(useParams().slug);
  const [items, setItems] = useState<Articulo[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  // Alta de artículo
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [stockInicial, setStockInicial] = useState("0");
  const [unidad, setUnidad] = useState("Unidad");
  const [costoUnitario, setCostoUnitario] = useState("");

  // Historial / registrar movimiento
  const [seleccionado, setSeleccionado] = useState<Articulo | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [tipoMov, setTipoMov] = useState<"ENTRADA" | "AJUSTE">("ENTRADA");
  const [cantidadMov, setCantidadMov] = useState("");
  const [motivoMov, setMotivoMov] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const cargar = useCallback(async () => {
    const params = new URLSearchParams();
    if (qDebounced.trim()) params.set("q", qDebounced.trim());
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/inventario?${params.toString()}`,
    );
    const data = await res.json();
    if (res.ok) setItems(data.items ?? []);
  }, [slug, qDebounced]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMensaje("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/inventario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigo,
        nombre,
        categoria: categoria.trim() || null,
        stock: Number(stockInicial) || 0,
        unidad,
        costoUnitario: costoUnitario.trim() ? Number(costoUnitario) : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "No se pudo guardar.");
      return;
    }
    setMensaje(data.mensaje || "Artículo registrado.");
    setCodigo("");
    setNombre("");
    setCategoria("");
    setStockInicial("0");
    setUnidad("Unidad");
    setCostoUnitario("");
    setNuevoAbierto(false);
    await cargar();
  }

  async function verHistorial(art: Articulo) {
    setSeleccionado(art);
    setMovimientos([]);
    setTipoMov("ENTRADA");
    setCantidadMov("");
    setMotivoMov("");
    setError("");
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/inventario/${art.id}/movimientos`,
    );
    const data = await res.json();
    if (res.ok) setMovimientos(data.movimientos ?? []);
  }

  async function registrarMov(e: FormEvent) {
    e.preventDefault();
    if (!seleccionado) return;
    setError("");
    setMensaje("");
    const cantidadNum = Number(cantidadMov);
    const cantidadFinal =
      tipoMov === "ENTRADA" ? Math.abs(cantidadNum) : cantidadNum;
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/inventario/${seleccionado.id}/movimientos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: tipoMov,
          cantidad: cantidadFinal,
          motivo: motivoMov.trim() || null,
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "No se pudo registrar el movimiento.");
      return;
    }
    setMensaje(data.mensaje || "Movimiento registrado.");
    setMovimientos(data.movimientos ?? []);
    setCantidadMov("");
    setMotivoMov("");
    setSeleccionado((prev) =>
      prev ? { ...prev, stock: data.stockResultante } : prev,
    );
    await cargar();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventario</h1>
          <p className="text-sm text-[var(--muted)]">
            Artículos entregables a empleados (uniformes, EPP, celulares…).
            No es el inventario operativo de Flota.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNuevoAbierto((v) => !v)}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
        >
          {nuevoAbierto ? "Cancelar" : "+ Nuevo artículo"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {mensaje ? <p className="text-sm text-emerald-400">{mensaje}</p> : null}

      {nuevoAbierto ? (
        <form
          onSubmit={crear}
          className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label>
            <span className="text-sm text-[var(--muted)]">Código</span>
            <input
              className={input}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
            />
          </label>
          <label>
            <span className="text-sm text-[var(--muted)]">Nombre</span>
            <input
              className={input}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
            />
          </label>
          <label>
            <span className="text-sm text-[var(--muted)]">Categoría</span>
            <input
              className={input}
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Uniformes, EPP, Celulares…"
            />
          </label>
          <label>
            <span className="text-sm text-[var(--muted)]">Stock inicial</span>
            <input
              type="number"
              min="0"
              className={input}
              value={stockInicial}
              onChange={(e) => setStockInicial(e.target.value)}
            />
          </label>
          <label>
            <span className="text-sm text-[var(--muted)]">Unidad</span>
            <input
              className={input}
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
            />
          </label>
          <label>
            <span className="text-sm text-[var(--muted)]">Costo unitario</span>
            <input
              type="number"
              step="0.01"
              min="0"
              className={input}
              value={costoUnitario}
              onChange={(e) => setCostoUnitario(e.target.value)}
              placeholder="Q"
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
              Guardar
            </button>
          </div>
        </form>
      ) : null}

      <div className="max-w-sm">
        <input
          className={input}
          placeholder="Buscar por código, nombre o categoría"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--card)] text-left text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Artículo</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2 text-right">Costo unitario</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {items.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2">{it.codigo}</td>
                <td className="px-3 py-2">{it.nombre}</td>
                <td className="px-3 py-2">{it.categoria || "—"}</td>
                <td className="px-3 py-2 text-right">{it.stock}</td>
                <td className="px-3 py-2">{it.unidad}</td>
                <td className="px-3 py-2 text-right">
                  {formatQ(it.costoUnitario)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => verHistorial(it)}
                    className="text-xs text-[var(--accent)] underline"
                  >
                    Movimientos
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[var(--muted)]"
                >
                  Sin artículos.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {seleccionado ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {seleccionado.codigo} — {seleccionado.nombre}
            </h2>
            <button
              type="button"
              onClick={() => setSeleccionado(null)}
              className="text-sm text-[var(--muted)]"
            >
              Cerrar
            </button>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Stock actual: {seleccionado.stock} {seleccionado.unidad}
          </p>

          <form
            onSubmit={registrarMov}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <label>
              <span className="block text-sm text-[var(--muted)]">Tipo</span>
              <select
                className={input}
                value={tipoMov}
                onChange={(e) =>
                  setTipoMov(e.target.value as "ENTRADA" | "AJUSTE")
                }
              >
                <option value="ENTRADA">Entrada</option>
                <option value="AJUSTE">Ajuste</option>
              </select>
            </label>
            <label>
              <span className="block text-sm text-[var(--muted)]">
                {tipoMov === "ENTRADA" ? "Cantidad" : "Cantidad (+/-)"}
              </span>
              <input
                type="number"
                className={input}
                value={cantidadMov}
                onChange={(e) => setCantidadMov(e.target.value)}
                required
              />
            </label>
            <label className="min-w-[200px] flex-1">
              <span className="block text-sm text-[var(--muted)]">
                Motivo {tipoMov === "AJUSTE" ? "(obligatorio)" : "(opcional)"}
              </span>
              <input
                className={input}
                value={motivoMov}
                onChange={(e) => setMotivoMov(e.target.value)}
                required={tipoMov === "AJUSTE"}
              />
            </label>
            <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
              Registrar
            </button>
          </form>

          <div className="mt-4 space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Historial
            </h3>
            {movimientos.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Sin movimientos todavía.
              </p>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {movimientos.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">
                        {m.tipo === "ENTRADA" ? "Entrada" : "Ajuste"}
                      </span>{" "}
                      <span
                        className={
                          m.cantidad >= 0 ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {m.cantidad >= 0 ? "+" : ""}
                        {m.cantidad}
                      </span>{" "}
                      · stock resultante {m.stockResultante}
                      {m.motivo ? (
                        <span className="text-[var(--muted)]"> · {m.motivo}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {m.registradoPor ?? ""} ·{" "}
                      {m.creadoEn.replace("T", " ").slice(0, 16)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
