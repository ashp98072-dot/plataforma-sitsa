"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Gasto = {
  id: number;
  fechaSolicitud: string;
  fechaViaje: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  empleadoCargo: string | null;
  vehiculoId: number | null;
  vehiculoPlaca: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  planId: number | null;
  planCodigo: string | null;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  metodoPago: string | null;
  numeroCuentaPago: string | null;
  tieneFactura: boolean;
  observaciones: string | null;
  // GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — indicador operativo, sin efecto en planilla/nómina.
  descuentoPersonal: boolean;
  activo: boolean;
};

type PlanCatalogo = {
  id: number;
  codigo: string;
  fechaPlan: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  empleadoPuesto: string | null;
  vehiculoId: number | null;
  placa: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
};

type Catalogos = {
  empleados: { id: number; codigo: string; nombre: string; puesto: string | null }[];
  vehiculos: { id: number; placa: string }[];
  clientes: { id: number; nombre: string }[];
  planes: PlanCatalogo[];
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const FORM_VACIO = {
  fechaSolicitud: new Date().toISOString().slice(0, 10),
  fechaViaje: "",
  empleadoId: 0,
  vehiculoId: 0,
  clienteId: 0,
  planId: 0,
  categoria: "",
  descripcion: "",
  cantidad: "1",
  monto: "",
  metodoPago: "",
  numeroCuentaPago: "",
  tieneFactura: false,
  observaciones: "",
  descuentoPersonal: false,
};

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — gastos operativos asociados
 * opcionalmente a un viaje/plan. "Eliminar" desactiva (activo=0), nunca
 * borra — mismo criterio que Rutas/Contactos.
 */
export default function GastosPage() {
  const slug = String(useParams().slug);

  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [metodosPago, setMetodosPago] = useState<string[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos>({ empleados: [], vehiculos: [], clientes: [], planes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");
  const [fCategoria, setFCategoria] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (fFechaDesde) params.set("fechaDesde", fFechaDesde);
      if (fFechaHasta) params.set("fechaHasta", fFechaHasta);
      if (fCategoria) params.set("categoria", fCategoria);
      const [rGastos, rCat] = await Promise.all([
        fetch(`/api/empresas/${slug}/tms/gastos?${params.toString()}`),
        fetch(`/api/empresas/${slug}/tms/gastos/catalogos`),
      ]);
      const dGastos = await rGastos.json().catch(() => ({}));
      const dCat = await rCat.json().catch(() => ({}));
      if (!rGastos.ok) throw new Error(dGastos.error ?? "No se pudieron cargar los gastos.");
      setGastos(dGastos.gastos ?? []);
      setCategorias(dGastos.categorias ?? []);
      setMetodosPago(dGastos.metodosPago ?? []);
      if (rCat.ok) setCatalogos(dCat);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, fFechaDesde, fFechaHasta, fCategoria]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function nuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setMostrarForm(true);
  }

  function editar(g: Gasto) {
    setEditandoId(g.id);
    setForm({
      fechaSolicitud: g.fechaSolicitud,
      fechaViaje: g.fechaViaje ?? "",
      empleadoId: g.empleadoId ?? 0,
      vehiculoId: g.vehiculoId ?? 0,
      clienteId: g.clienteId ?? 0,
      planId: g.planId ?? 0,
      categoria: g.categoria,
      descripcion: g.descripcion ?? "",
      cantidad: String(g.cantidad),
      monto: String(g.monto),
      metodoPago: g.metodoPago ?? "",
      numeroCuentaPago: g.numeroCuentaPago ?? "",
      tieneFactura: g.tieneFactura,
      observaciones: g.observaciones ?? "",
      descuentoPersonal: g.descuentoPersonal,
    });
    setMostrarForm(true);
  }

  /**
   * GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — al asociar el gasto a un
   * Viaje/Plan se precargan desde el plan los datos que YA existen
   * (fecha del viaje, piloto/persona, unidad/placa, cliente). No se
   * inventa nada: si el plan no trae alguno de esos datos, el campo
   * respectivo se deja como está para que el usuario lo complete.
   * El usuario siempre puede editar los campos precargados. La categoría,
   * cantidad, descripción, monto y observaciones NO se tocan aquí — son
   * propios del gasto.
   */
  function seleccionarPlan(planId: number) {
    const plan = catalogos.planes.find((p) => p.id === planId);
    setForm((f) => ({
      ...f,
      planId,
      fechaViaje: plan?.fechaPlan ?? f.fechaViaje,
      empleadoId: plan?.empleadoId ?? f.empleadoId,
      vehiculoId: plan?.vehiculoId ?? f.vehiculoId,
      clienteId: plan?.clienteId ?? f.clienteId,
    }));
  }

  async function guardar() {
    setError(""); setMsg("");
    if (!form.categoria) { setError("Selecciona una categoría."); return; }
    if (!(Number(form.monto) > 0)) { setError("El monto debe ser mayor a cero."); return; }
    const payload = {
      fechaSolicitud: form.fechaSolicitud,
      fechaViaje: form.fechaViaje || null,
      empleadoId: form.empleadoId || null,
      vehiculoId: form.vehiculoId || null,
      clienteId: form.clienteId || null,
      planId: form.planId || null,
      categoria: form.categoria,
      descripcion: form.descripcion.trim() || null,
      cantidad: Number(form.cantidad) || 1,
      monto: Number(form.monto),
      metodoPago: form.metodoPago || null,
      numeroCuentaPago: form.numeroCuentaPago.trim() || null,
      tieneFactura: form.tieneFactura,
      observaciones: form.observaciones.trim() || null,
      descuentoPersonal: form.descuentoPersonal,
    };
    const url = editandoId ? `/api/empresas/${slug}/tms/gastos/${editandoId}` : `/api/empresas/${slug}/tms/gastos`;
    const res = await fetch(url, { method: editandoId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo guardar."); return; }
    setMsg(data.mensaje ?? "Guardado.");
    setMostrarForm(false);
    await cargar();
  }

  async function desactivar(id: number) {
    if (!confirm("¿Desactivar este gasto? No se elimina, solo deja de listarse por defecto.")) return;
    const res = await fetch(`/api/empresas/${slug}/tms/gastos/${id}`, { method: "DELETE" });
    if (res.ok) await cargar();
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Gastos operativos</h1>
        <button type="button" onClick={nuevo} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">
          Nuevo gasto
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className={inputCls} value={fFechaDesde} onChange={(e) => setFFechaDesde(e.target.value)} />
        <input type="date" className={inputCls} value={fFechaHasta} onChange={(e) => setFFechaHasta(e.target.value)} />
        <select className={inputCls} value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {mostrarForm ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-xs text-[var(--muted)]">Fecha solicitud
              <input type="date" className={`${inputCls} mt-0.5 w-full`} value={form.fechaSolicitud} onChange={(e) => setForm((f) => ({ ...f, fechaSolicitud: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Fecha viaje
              <input type="date" className={`${inputCls} mt-0.5 w-full`} value={form.fechaViaje} onChange={(e) => setForm((f) => ({ ...f, fechaViaje: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Categoría
              <select className={`${inputCls} mt-0.5 w-full`} value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}>
                <option value="">Selecciona…</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Método de pago
              <select className={`${inputCls} mt-0.5 w-full`} value={form.metodoPago} onChange={(e) => setForm((f) => ({ ...f, metodoPago: e.target.value }))}>
                <option value="">—</option>
                {metodosPago.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Empleado / persona
              <select className={`${inputCls} mt-0.5 w-full`} value={form.empleadoId} onChange={(e) => setForm((f) => ({ ...f, empleadoId: Number(e.target.value) }))}>
                <option value={0}>—</option>
                {catalogos.empleados.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}{e.puesto ? ` (${e.puesto})` : ""}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Placa / unidad
              <select className={`${inputCls} mt-0.5 w-full`} value={form.vehiculoId} onChange={(e) => setForm((f) => ({ ...f, vehiculoId: Number(e.target.value) }))}>
                <option value={0}>—</option>
                {catalogos.vehiculos.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Cliente
              <select className={`${inputCls} mt-0.5 w-full`} value={form.clienteId} onChange={(e) => setForm((f) => ({ ...f, clienteId: Number(e.target.value) }))}>
                <option value={0}>—</option>
                {catalogos.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Viaje / plan
              <select className={`${inputCls} mt-0.5 w-full`} value={form.planId} onChange={(e) => seleccionarPlan(Number(e.target.value))}>
                <option value={0}>—</option>
                {catalogos.planes.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Cantidad
              <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={form.cantidad} onChange={(e) => setForm((f) => ({ ...f, cantidad: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Monto (Q)
              <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={form.monto} onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">No. cuenta / referencia de pago
              <input className={`${inputCls} mt-0.5 w-full`} value={form.numeroCuentaPago} onChange={(e) => setForm((f) => ({ ...f, numeroCuentaPago: e.target.value }))} />
            </label>
            <label className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={form.tieneFactura} onChange={(e) => setForm((f) => ({ ...f, tieneFactura: e.target.checked }))} />
              Tiene factura
            </label>
            {/* GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — indicador OPERATIVO. Solo marca que
                este gasto debería recuperarse del personal; NO genera descuento de
                nómina ni toca planilla/RRHH. */}
            <label className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={form.descuentoPersonal} onChange={(e) => setForm((f) => ({ ...f, descuentoPersonal: e.target.checked }))} />
              Descuento al personal
            </label>
          </div>
          <label className="block text-xs text-[var(--muted)]">Descripción
            <input className={`${inputCls} mt-0.5 w-full`} value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
          </label>
          <label className="block text-xs text-[var(--muted)]">Observaciones
            <textarea className={`${inputCls} mt-0.5 w-full`} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void guardar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">Guardar</button>
            <button type="button" onClick={() => setMostrarForm(false)} className="rounded border border-[var(--border)] px-3 py-1.5 text-sm">Cancelar</button>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto rounded-lg border border-[var(--border)]">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[var(--thead)] text-[var(--muted)]">
            <tr>
              <th className="px-2 py-2">Fecha viaje</th>
              <th className="px-2 py-2">Categoría</th>
              <th className="px-2 py-2">Descripción</th>
              <th className="px-2 py-2">Persona</th>
              <th className="px-2 py-2">Unidad</th>
              <th className="px-2 py-2">Cliente</th>
              <th className="px-2 py-2">Viaje</th>
              <th className="px-2 py-2">Monto</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {gastos.map((g) => (
              <tr key={g.id} className="border-t border-[var(--border)]">
                <td className="px-2 py-2">{g.fechaViaje ?? g.fechaSolicitud}</td>
                <td className="px-2 py-2">{g.categoria}</td>
                <td className="px-2 py-2">{g.descripcion ?? "—"}</td>
                <td className="px-2 py-2">{g.empleadoNombre ?? "—"}</td>
                <td className="px-2 py-2">{g.vehiculoPlaca ?? "—"}</td>
                <td className="px-2 py-2">{g.clienteNombre ?? "—"}</td>
                <td className="px-2 py-2">{g.planCodigo ?? "—"}</td>
                <td className="px-2 py-2">Q{(g.cantidad * g.monto).toLocaleString("es-GT", { minimumFractionDigits: 2 })}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <button type="button" onClick={() => editar(g)} className="mr-2 text-[var(--accent)]">Editar</button>
                  <button type="button" onClick={() => void desactivar(g.id)} className="text-red-400">Desactivar</button>
                </td>
              </tr>
            ))}
            {!gastos.length && !loading ? (
              <tr><td colSpan={9} className="px-3 py-4 text-[var(--muted)]">Sin gastos con este filtro.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
