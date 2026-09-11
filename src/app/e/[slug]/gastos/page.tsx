"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CatalogoSearchSelect, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";
import { MESES_ES } from "@/lib/tms/reportes-mes";
import { paramsExportarGastos, paramsListadoGastos } from "@/lib/tms/exportacion-operativa-filtros";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";

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
  facturaNombreOriginal: string | null;
  facturaTamano: number | null;
  observaciones: string | null;
  activo: boolean;
  estado: string | null;
  motivoRechazo: string | null;
  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 4) — mismo patrón visual/funcional que
   * Solicitudes de fondo (fondos/page.tsx) para empresa requirente/
   * requirente/solicitante. `entidadRequirenteId`/nombre y
   * requirente/solicitante ya los devuelve la API desde la Fase 1; aquí
   * solo se leen para precargar el formulario de edición.
   */
  entidadRequirenteId: number | null;
  entidadRequirenteNombre: string | null;
  requirenteUsuarioId: number | null;
  requirenteNombre: string | null;
  solicitanteUsuarioId: number | null;
  solicitanteNombre: string | null;
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

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 4) — `usuarios`/`solicitantes`/
 * `entidadesRequirentes` ya los devuelve HOY el mismo endpoint compartido
 * `/tms/gastos/catalogos` (Fondos ya los consume desde su propia Fase 1);
 * Gastos solo no los estaba leyendo todavía. No se agrega ningún
 * endpoint ni campo nuevo al catálogo.
 */
type Catalogos = {
  empleados: { id: number; codigo: string; nombre: string; puesto: string | null }[];
  vehiculos: { id: number; placa: string; marca?: string | null; modelo?: string | null }[];
  clientes: { id: number; codigo?: string | null; nombre: string; nit?: string | null }[];
  planes: PlanCatalogo[];
  usuarios: { id: number; nombre: string }[];
  solicitantes: { id: number; nombre: string }[];
  entidadesRequirentes: { id: number; codigo: string; nombre: string }[];
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
  entidadRequirenteId: 0,
  requirenteUsuarioId: 0,
  requirenteNombre: "",
  solicitanteUsuarioId: 0,
};

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — gastos operativos asociados
 * opcionalmente a un viaje/plan. "Eliminar" desactiva (activo=0), nunca
 * borra — mismo criterio que Rutas/Contactos.
 */
export default function GastosPage() {
  const slug = String(useParams().slug);
  const { permisos } = useEmpresaSession();
  const puedeAutorizar = tienePermiso(permisos, "gastos_operativos_autorizar", "editar");

  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [metodosPago, setMetodosPago] = useState<string[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos>({ empleados: [], vehiculos: [], clientes: [], planes: [], usuarios: [], solicitantes: [], entidadesRequirentes: [] });
  const opcionesUsuarios = (usuarios: { id: number; nombre: string }[]): CatalogoSearchOption[] => usuarios.map((u) => ({ value: String(u.id), label: u.nombre }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fMes, setFMes] = useState("");
  const [fAnio, setFAnio] = useState("");
  const [fEmpleadoId, setFEmpleadoId] = useState("");
  const [fVehiculoId, setFVehiculoId] = useState("");
  const [fClienteId, setFClienteId] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const comprobanteActual = editandoId ? gastos.find((g) => g.id === editandoId) : null;
  const tieneComprobanteAlmacenado = Boolean(comprobanteActual?.facturaNombreOriginal);
  /** GASTOS-ADMINISTRATIVO-1 (Fase 4) — mismo patrón que motivoRechazo en fondos/page.tsx: un input por fila, por id. */
  const [motivoRechazo, setMotivoRechazo] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = paramsListadoGastos({ fechaDesde: fFechaDesde, fechaHasta: fFechaHasta, mes: fMes, anio: fAnio, categoria: fCategoria, empleadoId: fEmpleadoId, vehiculoId: fVehiculoId, clienteId: fClienteId });
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
      if (rCat.ok) setCatalogos({
        empleados: dCat.empleados ?? [], vehiculos: dCat.vehiculos ?? [], clientes: dCat.clientes ?? [], planes: dCat.planes ?? [],
        usuarios: dCat.usuarios ?? [], solicitantes: dCat.solicitantes ?? [], entidadesRequirentes: dCat.entidadesRequirentes ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, fFechaDesde, fFechaHasta, fMes, fAnio, fCategoria, fEmpleadoId, fVehiculoId, fClienteId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function nuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setComprobante(null);
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
      entidadRequirenteId: g.entidadRequirenteId ?? 0,
      requirenteUsuarioId: g.requirenteUsuarioId ?? 0,
      requirenteNombre: g.requirenteNombre ?? "",
      solicitanteUsuarioId: g.solicitanteUsuarioId ?? 0,
    });
    setComprobante(null);
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
      // GASTOS-ADMINISTRATIVO-1 (Fase 4) — los 5 campos administrativos
      // son OPCIONALES (Fase 2/3 aprobadas): omitirlos guarda el gasto
      // exactamente igual que antes de esta fase. `entidadRequirenteId`
      // NO acepta `null` (mismo contrato que SolicitudFondoInput en
      // Fondos) — se manda `undefined` para "no seleccionada", nunca `null`.
      entidadRequirenteId: form.entidadRequirenteId || undefined,
      requirenteUsuarioId: form.requirenteUsuarioId || null,
      requirenteNombre: form.requirenteNombre.trim() || null,
      solicitanteUsuarioId: form.solicitanteUsuarioId || null,
    };
    if (comprobante && (!/\.(pdf|jpe?g|png)$/i.test(comprobante.name) || !["application/pdf", "image/jpeg", "image/png"].includes(comprobante.type))) {
      setError("El comprobante debe ser PDF, JPG, JPEG o PNG."); return;
    }
    if (comprobante && comprobante.size > MAX_UPLOAD_BYTES) { setError("El comprobante supera el máximo de 50 MB."); return; }
    const url = editandoId ? `/api/empresas/${slug}/tms/gastos/${editandoId}` : `/api/empresas/${slug}/tms/gastos`;
    const res = await fetch(url, { method: editandoId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo guardar."); return; }
    const gastoId = editandoId ?? data.gasto?.id;
    if (comprobante && gastoId) {
      const archivos = new FormData(); archivos.set("file", comprobante);
      const subida = await fetch(`/api/empresas/${slug}/tms/gastos/${gastoId}/comprobante`, { method: "POST", body: archivos });
      const subidaData = await subida.json().catch(() => ({}));
      if (!subida.ok) { setError(`${data.mensaje ?? "Gasto guardado."} ${subidaData.error ?? "No se pudo adjuntar el comprobante."}`); await cargar(); return; }
    }
    setMsg(comprobante ? "Gasto y comprobante guardados." : (data.mensaje ?? "Guardado."));
    setMostrarForm(false);
    await cargar();
  }

  async function eliminarComprobante(id: number) {
    if (!confirm("¿Eliminar el comprobante adjunto?")) return;
    const res = await fetch(`/api/empresas/${slug}/tms/gastos/${id}/comprobante`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo eliminar el comprobante."); return; }
    setMsg(data.mensaje); await cargar();
  }

  async function desactivar(id: number) {
    if (!confirm("¿Desactivar este gasto? No se elimina, solo deja de listarse por defecto.")) return;
    const res = await fetch(`/api/empresas/${slug}/tms/gastos/${id}`, { method: "DELETE" });
    if (res.ok) await cargar();
  }

  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 4) — mismo patrón EXACTO que
   * cambiarEstado() en fondos/page.tsx: input "Motivo de rechazo" siempre
   * visible junto al botón (sin modal, sin `window.prompt`). Única
   * adaptación real: Fondos manda todo a un único PATCH con `accion`;
   * Gastos tiene dos endpoints POST dedicados desde la Fase 3.
   */
  async function cambiarEstado(id: number, accion: "autorizar" | "rechazar") {
    const body: Record<string, unknown> = {};
    if (accion === "rechazar") {
      const motivo = motivoRechazo[id]?.trim();
      if (!motivo) { setError("Indica el motivo del rechazo."); return; }
      body.motivoRechazo = motivo;
    }
    setError(""); setMsg("");
    const res = await fetch(`/api/empresas/${slug}/tms/gastos/${id}/${accion}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo actualizar."); return; }
    setMsg(data.mensaje ?? "Actualizado.");
    await cargar();
  }

  const filtroMensual = Boolean(fMes && fAnio);
  const filtros = { fechaDesde: fFechaDesde, fechaHasta: fFechaHasta, mes: fMes, anio: fAnio, categoria: fCategoria, empleadoId: fEmpleadoId, vehiculoId: fVehiculoId, clienteId: fClienteId };
  const exportarUrl = (formato?: "pdf") => `/api/empresas/${slug}/tms/reportes/gastos/exportar?${paramsExportarGastos(filtros, formato).toString()}`;
  const limpiarFiltros = () => { setFFechaDesde(""); setFFechaHasta(""); setFMes(""); setFAnio(""); setFCategoria(""); setFEmpleadoId(""); setFVehiculoId(""); setFClienteId(""); };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Gastos operativos</h1>
        <button type="button" onClick={nuevo} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">
          Nuevo gasto
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <p className="text-sm font-medium">Filtros y exportación</p>
        <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">Fecha desde<input type="date" className={`${inputCls} mt-0.5 block`} value={fFechaDesde} onChange={(e) => setFFechaDesde(e.target.value)} disabled={filtroMensual} /></label>
        <label className="text-xs text-[var(--muted)]">Fecha hasta<input type="date" className={`${inputCls} mt-0.5 block`} value={fFechaHasta} onChange={(e) => setFFechaHasta(e.target.value)} disabled={filtroMensual} /></label>
        <label className="text-xs text-[var(--muted)]">Mes<select className={`${inputCls} mt-0.5 block`} value={fMes} onChange={(e) => setFMes(e.target.value)}><option value="">—</option>{MESES_ES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="text-xs text-[var(--muted)]">Año<input type="number" min="1900" max="9999" className={`${inputCls} mt-0.5 w-24 block`} value={fAnio} onChange={(e) => setFAnio(e.target.value)} placeholder="2026" /></label>
        <label className="text-xs text-[var(--muted)]">Categoría<select className={`${inputCls} mt-0.5 block`} value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select></label>
        <CatalogoSearchSelect label="Empleado / persona" placeholder="Buscar empleado..." value={fEmpleadoId} inputClassName={inputCls} emptyLabel="Todos" options={catalogos.empleados.map((e) => ({ value: String(e.id), label: e.nombre, detail: [e.codigo, e.puesto].filter(Boolean).join(" · ") }))} onChange={setFEmpleadoId} />
        <CatalogoSearchSelect label="Unidad" placeholder="Buscar placa..." value={fVehiculoId} inputClassName={inputCls} emptyLabel="Todas" options={catalogos.vehiculos.map((v) => ({ value: String(v.id), label: v.placa, detail: [v.marca, v.modelo].filter(Boolean).join(" ") }))} onChange={setFVehiculoId} />
        <CatalogoSearchSelect label="Cliente" placeholder="Buscar cliente..." value={fClienteId} inputClassName={inputCls} emptyLabel="Todos" options={catalogos.clientes.map((c) => ({ value: String(c.id), label: c.nombre }))} onChange={setFClienteId} />
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={exportarUrl()} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">{filtroMensual ? "Exportar Excel mensual" : "Exportar Excel"}</a>
          <a href={exportarUrl("pdf")} className="rounded border border-[var(--border)] px-3 py-2 text-sm">{filtroMensual ? "Exportar PDF mensual" : "Exportar PDF"}</a>
          <button type="button" onClick={limpiarFiltros} className="rounded border border-[var(--border)] px-3 py-2 text-sm">Limpiar filtros</button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {mostrarForm ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
          {/*
            GASTOS-ADMINISTRATIVO-1 (Fase 4) — mismo patrón EXACTO que el
            bloque de encabezado de fondos/page.tsx (Empresa requirente,
            Requirente, Solicitante): mismos componentes, mismos
            catálogos, mismo layout. Única adaptación real: en Gastos los
            3 campos son OPCIONALES (Fase 2/3 aprobadas) — sin `*`, sin
            validación bloqueante en guardar().
          */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className="text-xs text-[var(--muted)]">Empresa requirente
              <select className={`${inputCls} mt-0.5 w-full`} value={form.entidadRequirenteId} onChange={(e) => setForm((f) => ({ ...f, entidadRequirenteId: Number(e.target.value) || 0 }))}>
                <option value={0}>—</option>
                {catalogos.entidadesRequirentes.map((entidad) => <option key={entidad.id} value={entidad.id}>{entidad.nombre}</option>)}
              </select>
            </label>
            <CatalogoSearchSelect label="Requirente" placeholder="Buscar requirente..." value={String(form.requirenteUsuarioId || "")} manualText={form.requirenteNombre} options={opcionesUsuarios(catalogos.usuarios)} inputClassName={inputCls} onTextChange={(text) => setForm((f) => ({ ...f, requirenteNombre: text }))} onChange={(value) => setForm((f) => ({ ...f, requirenteUsuarioId: Number(value) || 0, requirenteNombre: value ? "" : f.requirenteNombre }))} />
            <CatalogoSearchSelect label="Solicitante" placeholder="Buscar solicitante de Operaciones..." value={String(form.solicitanteUsuarioId || "")} options={opcionesUsuarios(catalogos.solicitantes)} inputClassName={inputCls} onChange={(value) => setForm((f) => ({ ...f, solicitanteUsuarioId: Number(value) || 0 }))} />
          </div>
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
            <CatalogoSearchSelect label="Empleado / persona" placeholder="Buscar empleado..." value={String(form.empleadoId || "")} inputClassName={inputCls} emptyLabel="— Sin empleado —" options={catalogos.empleados.map((e) => ({ value: String(e.id), label: e.nombre, detail: [e.codigo, e.puesto].filter(Boolean).join(" · ") }))} onChange={(value) => setForm((f) => ({ ...f, empleadoId: Number(value) || 0 }))} />
            <CatalogoSearchSelect label="Placa / unidad" placeholder="Buscar placa..." value={String(form.vehiculoId || "")} inputClassName={inputCls} emptyLabel="— Sin unidad —" options={catalogos.vehiculos.map((v) => ({ value: String(v.id), label: v.placa, detail: [v.marca, v.modelo].filter(Boolean).join(" ") }))} onChange={(value) => setForm((f) => ({ ...f, vehiculoId: Number(value) || 0 }))} />
            <CatalogoSearchSelect label="Cliente" placeholder="Buscar cliente..." value={String(form.clienteId || "")} inputClassName={inputCls} emptyLabel="— Sin cliente —" options={catalogos.clientes.map((c) => ({ value: String(c.id), label: c.nombre, detail: [c.codigo, c.nit ? `NIT ${c.nit}` : null].filter(Boolean).join(" · ") }))} onChange={(value) => setForm((f) => ({ ...f, clienteId: Number(value) || 0 }))} />
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
            {/*
              FONDOS-GASTOS-METODO-PAGO-1 — etiqueta dinámica: un solo
              registro a la vez (nunca una tabla multi-fila), así que sí
              tiene sentido reflejar el método elegido. "Transferencia
              móvil" guarda el número de teléfono en el MISMO campo
              (numeroCuentaPago) — nunca un campo separado.
            */}
            <label className="text-xs text-[var(--muted)]">{form.metodoPago === "Transferencia móvil" ? "Número" : "Cuenta"}
              <input className={`${inputCls} mt-0.5 w-full`} placeholder={form.metodoPago === "Transferencia móvil" ? "Número de transferencia móvil" : "No. cuenta / referencia de pago"} value={form.numeroCuentaPago} onChange={(e) => setForm((f) => ({ ...f, numeroCuentaPago: e.target.value }))} />
            </label>
            <label className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={tieneComprobanteAlmacenado || form.tieneFactura} disabled={tieneComprobanteAlmacenado} onChange={(e) => setForm((f) => ({ ...f, tieneFactura: e.target.checked }))} />
              Tiene factura
              {tieneComprobanteAlmacenado ? <span>(elimina primero el comprobante para desmarcarla)</span> : null}
            </label>
            <label className="text-xs text-[var(--muted)]">Factura / comprobante (PDF, JPG o PNG; máx. 50 MB)
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className={`${inputCls} mt-0.5 w-full`} onChange={(e) => { const file = e.target.files?.[0] ?? null; setComprobante(file); if (file) setForm((f) => ({ ...f, tieneFactura: true })); }} />
              {comprobante ? <span className="mt-1 block">Nuevo archivo: {comprobante.name}</span> : null}
              {comprobanteActual?.facturaNombreOriginal ? <span className="mt-1 block">Actual: {comprobanteActual.facturaNombreOriginal}</span> : null}
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
              <th className="px-2 py-2">Estado</th>
              <th className="px-2 py-2">Comprobante</th>
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
                {/*
                  GASTOS-ADMINISTRATIVO-1 (Fase 4) — mismo ternario de
                  color por estado que fondos/page.tsx (sin "Liquidada",
                  que no existe en Gastos; `estado === null` -> Histórico,
                  color neutro). Texto plano, nunca una píldora/badge —
                  Fondos tampoco usa eso.
                */}
                <td className="px-2 py-2">
                  <span className={g.estado === "Rechazada" ? "text-red-400" : g.estado === "Autorizada" ? "text-emerald-400" : g.estado === "Pendiente" ? "text-amber-400" : "text-[var(--muted)]"}>
                    {g.estado ?? "Histórico"}
                  </span>
                  {g.motivoRechazo ? <span className="block text-red-400">Motivo de rechazo: {g.motivoRechazo}</span> : null}
                </td>
                <td className="px-2 py-2">{g.facturaNombreOriginal ? <span><a className="text-[var(--accent)]" href={`/api/empresas/${slug}/tms/gastos/${g.id}/comprobante`} target="_blank" rel="noreferrer">{g.facturaNombreOriginal}</a><button type="button" onClick={() => void eliminarComprobante(g.id)} className="ml-2 text-red-400">Quitar</button></span> : "—"}</td>
                {/*
                  GASTOS-ADMINISTRATIVO-1 (Fase 4) — Autorizar/Rechazar:
                  mismos botones sólidos (bg-emerald-600/bg-red-600) e
                  input "Motivo de rechazo" siempre visible que ya usa
                  Fondos, gateados por `puedeAutorizar` (gastos_operativos_autorizar)
                  Y por `estado === "Pendiente"` — un histórico o un gasto
                  ya Autorizada/Rechazada nunca los muestra. "Editar"
                  también se oculta en Autorizada/Rechazada (bloqueo de
                  contenido ya exigido por el backend desde la Fase 2) —
                  un histórico (`estado === null`) sigue editable sin
                  restricción, igual que siempre. "Desactivar" queda SIN
                  condición alguna: es la excepción administrativa
                  aprobada, independiente del flujo de autorización.
                */}
                <td className="px-2 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {puedeAutorizar && g.estado === "Pendiente" ? (
                      <>
                        <button type="button" onClick={() => void cambiarEstado(g.id, "autorizar")} className="rounded bg-emerald-600 px-2 py-1 text-white">Autorizar</button>
                        <input className={`${inputCls} w-32`} placeholder="Motivo de rechazo" value={motivoRechazo[g.id] ?? ""} onChange={(e) => setMotivoRechazo((m) => ({ ...m, [g.id]: e.target.value }))} />
                        <button type="button" onClick={() => void cambiarEstado(g.id, "rechazar")} className="rounded bg-red-600 px-2 py-1 text-white">Rechazar</button>
                      </>
                    ) : null}
                    {g.estado === "Pendiente" || g.estado === null ? (
                      <button type="button" onClick={() => editar(g)} className="text-[var(--accent)]">Editar</button>
                    ) : null}
                    {/*
                      GASTOS-ADMINISTRATIVO-1 (Fase 5) — PDF individual
                      (con firmas) solo tiene sentido una vez autorizado,
                      mismo criterio que fondos/page.tsx. El endpoint
                      vuelve a validar el estado del lado del servidor —
                      este enlace oculto no es la única defensa.
                    */}
                    {g.estado === "Autorizada" ? (
                      <a href={`/api/empresas/${slug}/tms/gastos/${g.id}/pdf`} className="rounded border border-[var(--border)] px-2 py-1">Ver PDF</a>
                    ) : null}
                    <button type="button" onClick={() => void desactivar(g.id)} className="text-red-400">Desactivar</button>
                  </div>
                </td>
              </tr>
            ))}
            {!gastos.length && !loading ? (
              <tr><td colSpan={11} className="px-3 py-4 text-[var(--muted)]">Sin gastos con este filtro.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
