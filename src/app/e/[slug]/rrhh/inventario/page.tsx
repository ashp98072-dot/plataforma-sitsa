"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  tipo: "ENTRADA" | "AJUSTE" | "SALIDA";
  cantidad: number;
  stockResultante: number;
  motivo: string | null;
  registradoPor: string | null;
  creadoEn: string;
};

type EmpleadoBusqueda = { id: number; codigo: string; nombre: string };

const PERIODICIDADES_ENTREGA = [
  { value: "CADA_QUINCENA", label: "Cada quincena" },
  { value: "SOLO_QUINCENA_1", label: "Solo primera quincena de cada mes" },
  { value: "SOLO_QUINCENA_2", label: "Solo segunda quincena de cada mes" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "UNA_VEZ", label: "Una vez" },
] as const;
type PeriodicidadEntrega = (typeof PERIODICIDADES_ENTREGA)[number]["value"];

type Entrega = {
  id: number;
  articuloId: number;
  articuloNombre: string;
  articuloCodigo: string;
  empleadoId: number;
  empleadoNombre: string;
  empleadoCodigo: string;
  cantidad: number;
  costoUnitarioEntrega: number;
  costoTotal: number;
  montoCobrado: number;
  descuentoId: number | null;
  motivo: string | null;
  entregadoPor: string | null;
  estado: string;
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

  // Fase INV-1: entregar a empleado
  const [entregaArt, setEntregaArt] = useState<Articulo | null>(null);
  const [busquedaEmp, setBusquedaEmp] = useState("");
  const [candidatosEmp, setCandidatosEmp] = useState<EmpleadoBusqueda[]>([]);
  const [empSeleccionado, setEmpSeleccionado] = useState<EmpleadoBusqueda | null>(null);
  const [cantidadEntrega, setCantidadEntrega] = useState("1");
  const [costoUnitarioEntrega, setCostoUnitarioEntrega] = useState("");
  const [cobraEmpleado, setCobraEmpleado] = useState(true);
  const [montoCobrado, setMontoCobrado] = useState("");
  const [cuotasEntrega, setCuotasEntrega] = useState("1");
  const [periodicidadEntrega, setPeriodicidadEntrega] =
    useState<PeriodicidadEntrega>("CADA_QUINCENA");
  const [fechaInicioEntrega, setFechaInicioEntrega] = useState("");
  const [motivoEntrega, setMotivoEntrega] = useState("");
  const [enviandoEntrega, setEnviandoEntrega] = useState(false);

  const [entregas, setEntregas] = useState<Entrega[]>([]);

  const cargarEntregas = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/rrhh/inventario/entregas`);
    const data = await res.json();
    if (res.ok) setEntregas(data.entregas ?? []);
  }, [slug]);

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
    void cargarEntregas();
  }, [cargar, cargarEntregas]);

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

  // Fase INV-1: búsqueda de empleado por nombre/código/número — debounce
  // manual con setTimeout (no useEffect) para no repetir el patrón
  // set-state-en-efecto en un efecto nuevo.
  const busquedaEmpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onBusquedaEmpChange(v: string) {
    setBusquedaEmp(v);
    setEmpSeleccionado(null);
    if (busquedaEmpTimer.current) clearTimeout(busquedaEmpTimer.current);
    const term = v.trim();
    if (!term) {
      setCandidatosEmp([]);
      return;
    }
    busquedaEmpTimer.current = setTimeout(async () => {
      const res = await fetch(
        `/api/empresas/${slug}/empleados?q=${encodeURIComponent(term)}&estado=Activo`,
      );
      const data = await res.json();
      if (res.ok) setCandidatosEmp(data.empleados ?? []);
    }, 300);
  }

  function abrirEntrega(art: Articulo) {
    setEntregaArt(art);
    setBusquedaEmp("");
    setCandidatosEmp([]);
    setEmpSeleccionado(null);
    setCantidadEntrega("1");
    setCostoUnitarioEntrega(art.costoUnitario != null ? String(art.costoUnitario) : "");
    setCobraEmpleado(true);
    setMontoCobrado("");
    setCuotasEntrega("1");
    setPeriodicidadEntrega("CADA_QUINCENA");
    setFechaInicioEntrega("");
    setMotivoEntrega("");
    setError("");
    setMensaje("");
  }

  function cerrarEntrega() {
    setEntregaArt(null);
    setEmpSeleccionado(null);
  }

  const cantidadEntregaNum = Number(cantidadEntrega) || 0;
  const costoUnitarioEntregaNum = Number(costoUnitarioEntrega) || 0;
  const costoTotalEntrega = Math.round(costoUnitarioEntregaNum * cantidadEntregaNum * 100) / 100;
  const stockResultanteEntrega = entregaArt ? entregaArt.stock - cantidadEntregaNum : 0;
  const cantidadExcedeStock = Boolean(entregaArt) && cantidadEntregaNum > (entregaArt?.stock ?? 0);

  async function enviarEntrega(e: FormEvent) {
    e.preventDefault();
    if (!entregaArt) return;
    if (!empSeleccionado) {
      setError("Selecciona un empleado.");
      return;
    }
    if (cantidadExcedeStock) {
      setError("La cantidad no puede superar el stock disponible.");
      return;
    }
    setError("");
    setMensaje("");
    setEnviandoEntrega(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/inventario/entregas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articuloId: entregaArt.id,
          empleadoId: empSeleccionado.id,
          cantidad: cantidadEntregaNum,
          ...(costoUnitarioEntrega.trim() ? { costoUnitario: costoUnitarioEntregaNum } : {}),
          cobraEmpleado,
          ...(cobraEmpleado
            ? {
                ...(montoCobrado.trim() ? { montoCobrado: Number(montoCobrado) } : {}),
                numeroCuotas: Number(cuotasEntrega) || 1,
                periodicidad: periodicidadEntrega,
                ...(fechaInicioEntrega ? { fechaInicio: fechaInicioEntrega } : {}),
              }
            : {}),
          ...(motivoEntrega.trim() ? { motivo: motivoEntrega.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo registrar la entrega.");
        return;
      }
      setMensaje(data.mensaje || "Entrega registrada.");
      cerrarEntrega();
      await cargar();
      await cargarEntregas();
    } finally {
      setEnviandoEntrega(false);
    }
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
                    onClick={() => abrirEntrega(it)}
                    className="mr-3 text-xs text-[var(--accent)] underline"
                  >
                    Entregar
                  </button>
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
                        {m.tipo === "ENTRADA"
                          ? "Entrada"
                          : m.tipo === "SALIDA"
                            ? "Salida (entrega)"
                            : "Ajuste"}
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

      {entregaArt ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Entregar: {entregaArt.codigo} — {entregaArt.nombre}
            </h2>
            <button
              type="button"
              onClick={cerrarEntrega}
              className="text-sm text-[var(--muted)]"
            >
              Cerrar
            </button>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Stock disponible: {entregaArt.stock} {entregaArt.unidad}
          </p>

          <form onSubmit={enviarEntrega} className="mt-4 space-y-4">
            <div>
              <span className="text-sm text-[var(--muted)]">Empleado</span>
              <input
                className={input}
                placeholder="Buscar por nombre, código o número de empleado"
                value={busquedaEmp}
                onChange={(e) => onBusquedaEmpChange(e.target.value)}
              />
              {empSeleccionado ? (
                <p className="mt-1 text-sm text-emerald-400">
                  Seleccionado: {empSeleccionado.codigo} — {empSeleccionado.nombre}
                </p>
              ) : candidatosEmp.length > 0 ? (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)]">
                  {candidatosEmp.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--nav-hover)]"
                      onClick={() => {
                        setEmpSeleccionado(c);
                        setBusquedaEmp(`${c.codigo} — ${c.nombre}`);
                        setCandidatosEmp([]);
                      }}
                    >
                      {c.codigo} — {c.nombre}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label>
                <span className="text-sm text-[var(--muted)]">Cantidad</span>
                <input
                  type="number"
                  min="1"
                  className={input}
                  value={cantidadEntrega}
                  onChange={(e) => setCantidadEntrega(e.target.value)}
                  required
                />
              </label>
              <label>
                <span className="text-sm text-[var(--muted)]">Costo unitario</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={input}
                  value={costoUnitarioEntrega}
                  onChange={(e) => setCostoUnitarioEntrega(e.target.value)}
                />
              </label>
              <div>
                <span className="text-sm text-[var(--muted)]">Costo total</span>
                <p className="mt-1 font-medium">{formatQ(costoTotalEntrega)}</p>
              </div>
              <div>
                <span className="text-sm text-[var(--muted)]">Stock resultante</span>
                <p
                  className={`mt-1 font-medium ${cantidadExcedeStock ? "text-red-400" : ""}`}
                >
                  {stockResultanteEntrega} {entregaArt.unidad}
                </p>
              </div>
            </div>
            {cantidadExcedeStock ? (
              <p className="text-sm text-red-400">
                La cantidad supera el stock disponible ({entregaArt.stock}).
              </p>
            ) : null}

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={cobraEmpleado}
                onChange={(e) => setCobraEmpleado(e.target.checked)}
              />
              <span className="text-sm">
                ¿Genera descuento? (cobrar al empleado)
              </span>
            </label>

            {cobraEmpleado ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label>
                  <span className="text-sm text-[var(--muted)]">
                    Monto a cobrar
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={input}
                    placeholder={formatQ(costoTotalEntrega)}
                    value={montoCobrado}
                    onChange={(e) => setMontoCobrado(e.target.value)}
                  />
                </label>
                <label>
                  <span className="text-sm text-[var(--muted)]">Cuotas</span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    className={input}
                    value={cuotasEntrega}
                    onChange={(e) => setCuotasEntrega(e.target.value)}
                    required
                  />
                </label>
                <label>
                  <span className="text-sm text-[var(--muted)]">
                    Periodicidad
                  </span>
                  <select
                    className={input}
                    value={periodicidadEntrega}
                    onChange={(e) =>
                      setPeriodicidadEntrega(e.target.value as PeriodicidadEntrega)
                    }
                  >
                    {PERIODICIDADES_ENTREGA.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-sm text-[var(--muted)]">
                    Fecha inicio
                  </span>
                  <input
                    type="date"
                    className={input}
                    value={fechaInicioEntrega}
                    onChange={(e) => setFechaInicioEntrega(e.target.value)}
                  />
                </label>
              </div>
            ) : null}

            <label>
              <span className="text-sm text-[var(--muted)]">Motivo</span>
              <input
                className={input}
                value={motivoEntrega}
                onChange={(e) => setMotivoEntrega(e.target.value)}
                placeholder="Entrega de uniforme, reposición, etc."
              />
            </label>

            <button
              disabled={enviandoEntrega || cantidadExcedeStock}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {enviandoEntrega ? "Registrando…" : "Confirmar entrega"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Historial de entregas</h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--card)] text-left text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Empleado</th>
                <th className="px-3 py-2">Artículo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Costo histórico</th>
                <th className="px-3 py-2 text-right">Monto cobrado</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Descuento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {entregas.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2">
                    {e.empleadoCodigo} — {e.empleadoNombre}
                  </td>
                  <td className="px-3 py-2">
                    {e.articuloCodigo} — {e.articuloNombre}
                  </td>
                  <td className="px-3 py-2 text-right">{e.cantidad}</td>
                  <td className="px-3 py-2">
                    {e.creadoEn.replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatQ(e.costoTotal)}</td>
                  <td className="px-3 py-2 text-right">
                    {e.descuentoId ? formatQ(e.montoCobrado) : "—"}
                  </td>
                  <td className="px-3 py-2">{e.estado}</td>
                  <td className="px-3 py-2 text-xs">
                    {e.descuentoId ? `#${e.descuentoId}` : "Sin cobro"}
                  </td>
                </tr>
              ))}
              {entregas.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-[var(--muted)]"
                  >
                    Sin entregas todavía.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
