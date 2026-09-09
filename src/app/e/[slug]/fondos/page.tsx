"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CatalogoSearchSelect, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";
import { aplicarPlanSeleccionado } from "@/lib/tms/fondos-selectores";

type LineaFondo = {
  id: number; categoria: string; descripcion: string | null; cantidad: number; monto: number; orden: number;
  fechaViaje: string | null; empleadoNombre: string | null; cargo: string | null; cuenta: string | null; placa: string | null; clienteNombre: string | null;
  empleadoId: number | null; vehiculoId: number | null; clienteId: number | null; planId: number | null;
};
type SolicitudFondo = {
  id: number;
  codigo: string;
  requirenteNombre: string | null;
  requirenteUsuarioId: number | null;
  solicitanteUsuarioId: number | null;
  solicitanteNombre: string | null;
  fechaRequerimiento: string;
  total: number;
  autorizanteNombre: string | null;
  estado: "Pendiente" | "Autorizada" | "Rechazada" | "Liquidada";
  motivoRechazo: string | null;
  observaciones: string | null;
  lineas: LineaFondo[];
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const CATEGORIAS = ["Combustible", "Hospedaje", "Parqueo", "Cuadrilla", "Auxiliar extra", "Mantenimiento", "Arbitrios", "Transporte", "Otros"];

/**
 * SOLICITUD-FONDOS-REPORTE-1 — catálogos livianos ya existentes,
 * compartidos con Gastos (/tms/gastos/catalogos, pensado desde su propio
 * comentario para "los formularios de Gastos/Fondos") — no se duplica
 * ningún catálogo nuevo.
 */
type Catalogos = {
  empleados: { id: number; codigo: string; nombre: string; puesto: string | null; cuentaBancaria: string | null }[];
  vehiculos: { id: number; placa: string; marca: string | null; modelo: string | null }[];
  clientes: { id: number; codigo: string | null; nombre: string; nit: string | null }[];
  planes: {
    id: number; codigo: string; clienteId: number | null; clienteNombre: string | null; fechaPlan: string;
    vehiculoId: number | null; placa: string | null; empleadoId: number | null; empleadoNombre: string | null;
    empleadoPuesto: string | null; empleadoCuenta: string | null;
  }[];
  /** SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3) — usuarios reales con acceso a esta empresa, para el selector "Requirente (usuario)". */
  usuarios: { id: number; nombre: string }[];
  solicitantes: { id: number; nombre: string }[];
};

type LineaForm = {
  categoria: string; descripcion: string; cantidad: string; monto: string;
  fechaViaje: string; empleadoId: string; vehiculoId: string; clienteId: string; planId: string;
  empleadoNombre: string; cuenta: string; cargo: string;
};
const LINEA_VACIA: LineaForm = {
  categoria: "", descripcion: "", cantidad: "1", monto: "",
  fechaViaje: "", empleadoId: "", vehiculoId: "", clienteId: "", planId: "",
  empleadoNombre: "", cuenta: "", cargo: "",
};

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — solicitudes de fondo (anticipo) con
 * líneas de gasto estimado. Flujo: Pendiente -> Autorizada -> Liquidada,
 * o Rechazada en cualquier punto antes de Liquidada. La solicitud es
 * inmutable una vez creada (fase 1): solo cambia de estado.
 */
export default function FondosPage() {
  const slug = String(useParams().slug);

  const [solicitudes, setSolicitudes] = useState<SolicitudFondo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [fEstado, setFEstado] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  // SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — mismo formulario
  // para crear y para editar: `editandoId` distingue POST (null) de
  // PATCH accion:"editar" (id de la solicitud). Solo se ofrece "Editar"
  // mientras la solicitud está Pendiente — actualizarSolicitudFondo
  // vuelve a validarlo del lado del servidor, nunca se confía solo en
  // que el botón esté oculto.
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [requirenteNombre, setRequirenteNombre] = useState("");
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3 del ticket) — requirente
  // OPCIONAL seleccionado desde el catálogo de usuarios reales: cuando
  // se elige uno, su nombre real manda sobre el texto libre y el PDF
  // autorizado sale con su firma real (si tiene "Mi firma" guardada) —
  // ver crearSolicitudFondo/actualizarSolicitudFondo en fondos.ts. Sin
  // esta selección, el requirente sigue siendo solo texto libre/empleado
  // RRHH, sin firma (nunca se inventa una).
  const [requirenteUsuarioId, setRequirenteUsuarioId] = useState("");
  const [solicitanteUsuarioId, setSolicitanteUsuarioId] = useState("");
  const [fechaRequerimiento, setFechaRequerimiento] = useState(new Date().toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }]);

  const [expandido, setExpandido] = useState<number | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState<Record<number, string>>({});

  const opcionesUsuarios = (usuarios: { id: number; nombre: string }[]): CatalogoSearchOption[] => usuarios.map((u) => ({ value: String(u.id), label: u.nombre }));

  const [catalogos, setCatalogos] = useState<Catalogos>({ empleados: [], vehiculos: [], clientes: [], planes: [], usuarios: [], solicitantes: [] });
  useEffect(() => {
    fetch(`/api/empresas/${slug}/tms/gastos/catalogos`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "No se pudieron cargar los catálogos.");
        return data;
      })
      .then((data) => setCatalogos({
        empleados: data.empleados ?? [], vehiculos: data.vehiculos ?? [], clientes: data.clientes ?? [],
        planes: data.planes ?? [], usuarios: data.usuarios ?? [], solicitantes: data.solicitantes ?? [],
      }))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los catálogos."));
  }, [slug]);

  const cargar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (fEstado) params.set("estado", fEstado);
      const res = await fetch(`/api/empresas/${slug}/tms/fondos?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar las solicitudes.");
      setSolicitudes(data.solicitudes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, fEstado]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function totalForm(): number {
    return lineas.reduce((s, l) => s + (Number(l.cantidad) || 1) * (Number(l.monto) || 0), 0);
  }

  function cerrarFormulario() {
    setMostrarForm(false);
    setEditandoId(null);
    setRequirenteNombre(""); setRequirenteUsuarioId(""); setSolicitanteUsuarioId(""); setObservaciones(""); setLineas([{ ...LINEA_VACIA }]);
  }

  /**
   * SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — abre el MISMO
   * formulario, precargado, para editar una solicitud Pendiente. El
   * listado (GET /tms/fondos) trae `lineas: []` a propósito (listarSolicitudesFondo
   * no las incluye) — se pide la solicitud COMPLETA por id antes de
   * precargar el formulario, para no perder las líneas ya guardadas.
   */
  async function abrirEditar(s: SolicitudFondo) {
    setError("");
    const res = await fetch(`/api/empresas/${slug}/tms/fondos/${s.id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo cargar la solicitud para editarla."); return; }
    const completa = data.solicitud as SolicitudFondo;
    setEditandoId(completa.id);
    setRequirenteNombre(completa.requirenteNombre ?? "");
    setRequirenteUsuarioId(completa.requirenteUsuarioId != null ? String(completa.requirenteUsuarioId) : "");
    setSolicitanteUsuarioId(completa.solicitanteUsuarioId != null ? String(completa.solicitanteUsuarioId) : "");
    setFechaRequerimiento(completa.fechaRequerimiento);
    setObservaciones(completa.observaciones ?? "");
    setLineas(completa.lineas.length
      ? completa.lineas.map((l) => ({
          categoria: l.categoria, descripcion: l.descripcion ?? "", cantidad: String(l.cantidad), monto: String(l.monto),
          fechaViaje: l.fechaViaje ?? "",
          empleadoId: l.empleadoId != null ? String(l.empleadoId) : "",
          vehiculoId: l.vehiculoId != null ? String(l.vehiculoId) : "",
          clienteId: l.clienteId != null ? String(l.clienteId) : "",
          planId: l.planId != null ? String(l.planId) : "",
          empleadoNombre: l.empleadoNombre ?? "",
          cuenta: l.cuenta ?? "",
          cargo: l.cargo ?? "",
        }))
      : [{ ...LINEA_VACIA }]);
    setMostrarForm(true);
  }

  async function guardar() {
    setError(""); setMsg("");
    if (!requirenteNombre.trim() && !requirenteUsuarioId) { setError("Indica el requirente."); return; }
    if (!solicitanteUsuarioId) { setError("Selecciona el solicitante de Operaciones."); return; }
    const lineasValidas = lineas.filter((l) => l.categoria && Number(l.monto) > 0);
    if (!lineasValidas.length) { setError("Agrega al menos una línea de gasto válida."); return; }
    const lineasPayload = lineasValidas.map((l) => {
      const empleado = catalogos.empleados.find((e) => String(e.id) === l.empleadoId);
      return {
        categoria: l.categoria, descripcion: l.descripcion.trim() || null, cantidad: Number(l.cantidad) || 1, monto: Number(l.monto),
        fechaViaje: l.fechaViaje || undefined,
        empleadoId: l.empleadoId ? Number(l.empleadoId) : undefined,
        vehiculoId: l.vehiculoId ? Number(l.vehiculoId) : undefined,
        clienteId: l.clienteId ? Number(l.clienteId) : undefined,
        planId: l.planId ? Number(l.planId) : undefined,
        empleadoNombreOverride: empleado && l.empleadoNombre.trim() !== empleado.nombre.trim() ? l.empleadoNombre.trim() : undefined,
        cuentaOverride: empleado && l.cuenta.trim() !== (empleado.cuentaBancaria ?? "").trim() ? l.cuenta.trim() : undefined,
        cargoOverride: empleado && l.cargo.trim() !== (empleado.puesto ?? "").trim() ? l.cargo.trim() : undefined,
      };
    });
    const res = editandoId
      ? await fetch(`/api/empresas/${slug}/tms/fondos/${editandoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accion: "editar",
            requirenteNombre: requirenteNombre.trim(),
            requirenteUsuarioId: requirenteUsuarioId ? Number(requirenteUsuarioId) : null,
            solicitanteUsuarioId: Number(solicitanteUsuarioId),
            fechaRequerimiento,
            observaciones: observaciones.trim() || null,
            lineas: lineasPayload,
          }),
        })
      : await fetch(`/api/empresas/${slug}/tms/fondos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirenteNombre: requirenteNombre.trim(),
            requirenteUsuarioId: requirenteUsuarioId ? Number(requirenteUsuarioId) : undefined,
            solicitanteUsuarioId: Number(solicitanteUsuarioId),
            fechaRequerimiento,
            observaciones: observaciones.trim() || null,
            lineas: lineasPayload,
          }),
        });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? (editandoId ? "No se pudo editar la solicitud." : "No se pudo crear la solicitud.")); return; }
    setMsg(data.mensaje ?? (editandoId ? "Solicitud actualizada." : "Solicitud creada."));
    cerrarFormulario();
    await cargar();
  }

  async function cambiarEstado(id: number, accion: "autorizar" | "rechazar" | "liquidar") {
    const body: Record<string, unknown> = { accion };
    if (accion === "rechazar") {
      const motivo = motivoRechazo[id]?.trim();
      if (!motivo) { setError("Indica el motivo del rechazo."); return; }
      body.motivoRechazo = motivo;
    }
    const res = await fetch(`/api/empresas/${slug}/tms/fondos/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo actualizar."); return; }
    setMsg(data.mensaje ?? "Actualizado.");
    await cargar();
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Solicitudes de fondo</h1>
        <button
          type="button"
          onClick={() => (mostrarForm ? cerrarFormulario() : setMostrarForm(true))}
          className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white"
        >
          {mostrarForm ? "Cancelar" : "Nueva solicitud"}
        </button>
      </div>

      <select className={inputCls} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
        <option value="">Todos los estados</option>
        {["Pendiente", "Autorizada", "Rechazada", "Liquidada"].map((e) => <option key={e} value={e}>{e}</option>)}
      </select>

      {error ? (
        <p className="text-sm text-red-300">
          {error}
          {/* SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§2 del ticket) — el mensaje fijo de MENSAJE_FIRMA_REQUERIDA_AUTORIZAR (fondos.ts) lleva directo a "Mi firma". */}
          {error.includes("registrar tu firma en Mi firma") ? (
            <> <a href={`/e/${slug}/mi-firma`} className="underline">Ir a Mi firma</a></>
          ) : null}
        </p>
      ) : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {mostrarForm ? (
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
          <p className="text-sm font-medium">{editandoId ? "Editar solicitud (Pendiente)" : "Nueva solicitud"}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <CatalogoSearchSelect label="Requirente" placeholder="Buscar requirente..." value={requirenteUsuarioId} manualText={requirenteNombre} options={opcionesUsuarios(catalogos.usuarios)} inputClassName={inputCls} onTextChange={setRequirenteNombre} onChange={(value) => { setRequirenteUsuarioId(value); if (value) setRequirenteNombre(""); }} />
            <CatalogoSearchSelect label="Solicitante" placeholder="Buscar solicitante de Operaciones..." value={solicitanteUsuarioId} options={opcionesUsuarios(catalogos.solicitantes)} inputClassName={inputCls} onChange={setSolicitanteUsuarioId} />
            <label className="text-xs text-[var(--muted)]">Fecha de requerimiento
              <input type="date" className={`${inputCls} mt-0.5 w-full`} value={fechaRequerimiento} onChange={(e) => setFechaRequerimiento(e.target.value)} />
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--muted)]">Líneas de gasto</p>
            {lineas.map((l, i) => {
              const set = (patch: Partial<LineaForm>) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const totalLinea = (Number(l.cantidad) || 1) * (Number(l.monto) || 0);
              return (
                <div key={i} className="space-y-1 rounded border border-[var(--border)]/60 p-2">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <select className={inputCls} value={l.categoria} onChange={(e) => set({ categoria: e.target.value })}>
                      <option value="">Categoría…</option>
                      {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className={inputCls} placeholder="Descripción" value={l.descripcion} onChange={(e) => set({ descripcion: e.target.value })} />
                    <input type="number" min="0.01" step="0.01" className={inputCls} placeholder="Cantidad" value={l.cantidad} onChange={(e) => set({ cantidad: e.target.value })} />
                    <input type="number" min="0.01" step="0.01" className={inputCls} placeholder="Monto (Q)" value={l.monto} onChange={(e) => set({ monto: e.target.value })} />
                    <button type="button" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} className="text-red-400">Quitar</button>
                  </div>
                  {/*
                    SOLICITUD-FONDOS-REPORTE-1 — relaciones OPCIONALES por
                    línea (empleado/unidad/cliente/viaje). Reutiliza los
                    MISMOS catálogos que ya usa Gastos (sin duplicar) — el
                    servidor resuelve nombre/cargo/placa/cliente y los
                    congela como snapshot al guardar (fondos.ts).
                  */}
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <CatalogoSearchSelect label="Empleado" placeholder="Buscar empleado por nombre..." value={l.empleadoId} options={catalogos.empleados.map((e) => ({ value: String(e.id), label: e.nombre, detail: [e.codigo, e.puesto].filter(Boolean).join(" · "), searchText: e.nombre }))} inputClassName={inputCls} onChange={(value) => {
                      const empleado = catalogos.empleados.find((e) => String(e.id) === value);
                      set({ empleadoId: value, empleadoNombre: empleado?.nombre ?? "", cuenta: empleado?.cuentaBancaria ?? "", cargo: empleado?.puesto ?? "" });
                    }} />
                    <CatalogoSearchSelect label="Unidad" placeholder="Buscar placa..." value={l.vehiculoId} options={catalogos.vehiculos.map((v) => ({ value: String(v.id), label: v.placa, detail: [v.marca, v.modelo].filter(Boolean).join(" ") }))} inputClassName={inputCls} onChange={(value) => set({ vehiculoId: value })} />
                    <CatalogoSearchSelect label="Cliente" placeholder="Buscar cliente..." value={l.clienteId} options={catalogos.clientes.map((c) => ({ value: String(c.id), label: c.nombre, detail: [c.codigo, c.nit ? `NIT ${c.nit}` : null].filter(Boolean).join(" · ") }))} inputClassName={inputCls} onChange={(value) => set({ clienteId: value })} />
                    {/*
                      SOLICITUD-FONDOS-REPORTE-1 (pendiente 2 del PR #211) —
                      selector opcional de Viaje/Plan: al elegir uno se envía
                      planId; si "Fecha de viaje" está vacía, el SERVIDOR la
                      completa con la fecha real de ese plan
                      (resolverSnapshotLineaTx, fondos.ts) — nunca se
                      sobrescribe aquí en el cliente una fecha que el usuario
                      ya haya escrito a mano.
                    */}
                    <CatalogoSearchSelect label="Viaje / Plan" placeholder="Buscar código, cliente o fecha..." value={l.planId} options={catalogos.planes.map((p) => ({ value: String(p.id), label: p.codigo, detail: [p.clienteNombre, p.fechaPlan ? p.fechaPlan.split("-").reverse().join("/") : null].filter(Boolean).join(" · ") }))} inputClassName={inputCls} onChange={(value) => {
                      const plan = catalogos.planes.find((p) => String(p.id) === value);
                      set(aplicarPlanSeleccionado(l, plan, value));
                    }} />
                    <label className="text-xs text-[var(--muted)]">Fecha de viaje
                      <input type="date" className={`${inputCls} mt-0.5 w-full`} value={l.fechaViaje} onChange={(e) => set({ fechaViaje: e.target.value })} />
                      <span className="mt-0.5 block text-[10px]">Si la dejas vacía y eliges un viaje, se completa con su fecha.</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <label className="text-xs text-[var(--muted)]">Nombre
                      <input className={`${inputCls} mt-0.5 w-full`} value={l.empleadoNombre} onChange={(e) => set({ empleadoNombre: e.target.value })} maxLength={200} />
                    </label>
                    <label className="text-xs text-[var(--muted)]">Cuenta
                      <input className={`${inputCls} mt-0.5 w-full`} value={l.cuenta} onChange={(e) => set({ cuenta: e.target.value })} maxLength={100} />
                    </label>
                    <label className="text-xs text-[var(--muted)]">Cargo
                      <input className={`${inputCls} mt-0.5 w-full`} value={l.cargo} onChange={(e) => set({ cargo: e.target.value })} maxLength={150} />
                    </label>
                  </div>
                  <p className="text-right text-xs text-[var(--muted)]">Total de la línea: Q{totalLinea.toLocaleString("es-GT", { minimumFractionDigits: 2 })}</p>
                </div>
              );
            })}
            <button type="button" onClick={() => setLineas((ls) => [...ls, { ...LINEA_VACIA }])} className="rounded border border-[var(--border)] px-2 py-1 text-xs">
              + Agregar línea
            </button>
            <p className="text-sm font-medium">Total: Q{totalForm().toLocaleString("es-GT", { minimumFractionDigits: 2 })}</p>
          </div>
          <label className="block text-xs text-[var(--muted)]">Observaciones
            <textarea className={`${inputCls} mt-0.5 w-full`} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </label>
          <button type="button" onClick={() => void guardar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
            {editandoId ? "Guardar cambios" : "Crear solicitud"}
          </button>
        </div>
      ) : null}

      <div className="space-y-2">
        {solicitudes.map((s) => (
          <div key={s.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{s.codigo}</span> · {s.requirenteNombre ?? "—"} · {s.fechaRequerimiento} ·{" "}
                <span className={s.estado === "Rechazada" ? "text-red-400" : s.estado === "Autorizada" ? "text-emerald-400" : s.estado === "Liquidada" ? "text-[var(--muted)]" : "text-amber-400"}>
                  {s.estado}
                </span>
                {" "}· Q{s.total.toLocaleString("es-GT", { minimumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => setExpandido(expandido === s.id ? null : s.id)} className="text-[var(--accent)]">
                  {expandido === s.id ? "Ocultar líneas" : "Ver líneas"}
                </button>
                <a href={`/api/empresas/${slug}/tms/fondos/${s.id}/exportar`} className="rounded border border-[var(--border)] px-2 py-1">Exportar Excel</a>
                {/*
                  SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — PDF formal (con
                  firmas) solo tiene sentido una vez que la solicitud fue
                  autorizada; Liquidada conserva acceso al MISMO PDF
                  histórico (§6/§9 del ticket). El endpoint vuelve a
                  validar el estado del lado del servidor — este botón
                  oculto no es la única defensa.
                */}
                {s.estado === "Autorizada" || s.estado === "Liquidada" ? (
                  <a href={`/api/empresas/${slug}/tms/fondos/${s.id}/pdf`} className="rounded border border-[var(--border)] px-2 py-1">Descargar PDF</a>
                ) : null}
                {s.estado === "Pendiente" ? (
                  <>
                    <button type="button" onClick={() => void abrirEditar(s)} className="rounded border border-[var(--border)] px-2 py-1">Editar</button>
                    <button type="button" onClick={() => void cambiarEstado(s.id, "autorizar")} className="rounded bg-emerald-600 px-2 py-1 text-white">Autorizar</button>
                    <input className={`${inputCls} w-40`} placeholder="Motivo de rechazo" value={motivoRechazo[s.id] ?? ""} onChange={(e) => setMotivoRechazo((m) => ({ ...m, [s.id]: e.target.value }))} />
                    <button type="button" onClick={() => void cambiarEstado(s.id, "rechazar")} className="rounded bg-red-600 px-2 py-1 text-white">Rechazar</button>
                  </>
                ) : null}
                {s.estado === "Autorizada" ? (
                  <button type="button" onClick={() => void cambiarEstado(s.id, "liquidar")} className="rounded bg-[var(--accent)] px-2 py-1 text-white">Liquidar</button>
                ) : null}
              </div>
            </div>
            {s.motivoRechazo ? <p className="mt-1 text-xs text-red-300">Motivo de rechazo: {s.motivoRechazo}</p> : null}
            {expandido === s.id ? (
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-[var(--muted)]">
                  <tr>
                    <th>Categoría</th><th>Descripción</th><th>Empleado</th><th>Cargo</th><th>Cuenta</th><th>Placa</th><th>Cliente</th>
                    <th>Fecha viaje</th><th>Cantidad</th><th>Monto</th><th>Total línea</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lineas.map((l) => (
                    <tr key={l.id}>
                      <td>{l.categoria}</td><td>{l.descripcion ?? "—"}</td>
                      <td>{l.empleadoNombre ?? "—"}</td><td>{l.cargo ?? "—"}</td><td>{l.cuenta ?? "—"}</td><td>{l.placa ?? "—"}</td><td>{l.clienteNombre ?? "—"}</td>
                      <td>{l.fechaViaje ?? "—"}</td><td>{l.cantidad}</td>
                      <td>Q{l.monto.toLocaleString("es-GT", { minimumFractionDigits: 2 })}</td>
                      <td>Q{(l.cantidad * l.monto).toLocaleString("es-GT", { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ))}
        {!solicitudes.length && !loading ? <p className="text-[var(--muted)]">Sin solicitudes con este filtro.</p> : null}
      </div>
    </div>
  );
}
