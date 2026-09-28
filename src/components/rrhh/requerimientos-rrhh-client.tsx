"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { METODOS_PAGO_RRHH, type DetalleRequerimientoRrhh, type LineaRequerimientoRrhhDatos, type RequerimientoRrhh } from "@/lib/rrhh/requerimiento-schema";
import { CatalogoSearchSelect, opcionesConHistorico, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — UI de Requerimientos de RRHH. Simplificación deliberada frente a Compras (ver
 * reporte del ticket): un solo componente (listado + formulario inline de crear/editar + autorizar/rechazar +
 * enlaces PDF/Excel), sin rutas /nuevo ni /[id] separadas ni documentos adjuntos por línea. Reutiliza el buscador
 * genérico CatalogoSearchSelect (@/components/tms) — nunca importa nada de @/lib/compras.
 */
const estilo = "block w-full rounded border border-[var(--border)] bg-[var(--input)] p-2 disabled:opacity-80";
const inputFiltro = "rounded border border-[var(--border)] bg-[var(--input)] p-2";
const boton = "rounded border border-[var(--border)] px-3 py-2 disabled:opacity-50";
export const monedaRrhhReq = (v: string | number) => `Q ${Number(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Opcion = { id: number; nombre: string };
type ProveedorCat = { id: number; nombre_comercial: string; nit: string | null; contacto_nombre: string | null; telefono: string | null; email: string | null; metodo_pago_habitual: string | null; banco: string | null; numero_cuenta: string | null; tipo_cuenta: string | null; dias_credito: number | null };
type Catalogos = { proveedores: ProveedorCat[]; entidades: Opcion[]; usuarios: Opcion[] };
type LineaForm = LineaRequerimientoRrhhDatos & { key: string };

function opcionesProveedor(proveedores: ProveedorCat[], id: number, nombre?: string): CatalogoSearchOption[] {
  return opcionesConHistorico(proveedores.map(p => ({ value: String(p.id), label: p.nombre_comercial, searchText: [p.nombre_comercial, p.nit, p.contacto_nombre].filter(Boolean).join(" ") })), String(id || ""), nombre || "Proveedor histórico");
}
function opcionesPersona(usuarios: Opcion[], id: number, nombre?: string | null): CatalogoSearchOption[] {
  const opciones = usuarios.map(u => ({ value: String(u.id), label: u.nombre }));
  if (id && !usuarios.some(u => u.id === id)) opciones.unshift({ value: String(id), label: `${nombre || "Sin dato histórico"} (histórico)` });
  return opciones;
}
function nuevaLinea(key: string): LineaForm {
  return { key, proveedor_id: 0, descripcion: "", cantidad: "1", precio_unitario: "", metodo_pago: "Transferencia", condicion_pago: "Contado", observaciones: null };
}
function lineaEditable(l: DetalleRequerimientoRrhh["lineas"][number]): LineaForm {
  return { key: `id-${l.id}`, id: l.id, proveedor_id: l.proveedor_id, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario, metodo_pago: l.metodo_pago, condicion_pago: l.condicion_pago, observaciones: l.observaciones };
}
function totalLinea(l: LineaForm): number {
  const c = Number(l.cantidad), p = Number(l.precio_unitario);
  return Number.isFinite(c) && Number.isFinite(p) ? c * p : 0;
}

function Formulario({ slug, detalle, catalogos, fechaHoy, alGuardar, alCancelar }: {
  slug: string; detalle?: DetalleRequerimientoRrhh; catalogos: Catalogos | null; fechaHoy: string;
  alGuardar: () => void; alCancelar: () => void;
}) {
  const [fecha, setFecha] = useState(detalle?.fecha_requerimiento ?? fechaHoy);
  const [entidad, setEntidad] = useState(detalle?.entidad_requirente_id ?? 0);
  const [requirente, setRequirente] = useState(detalle?.requirente_usuario_id ?? 0);
  const [observaciones, setObservaciones] = useState(detalle?.observaciones ?? "");
  const [lineas, setLineas] = useState<LineaForm[]>(detalle ? detalle.lineas.map(lineaEditable) : [nuevaLinea("nueva-1")]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [conflicto, setConflicto] = useState(false);
  const cambiar = (key: string, cambios: Partial<LineaForm>) => setLineas(actual => actual.map(l => l.key === key ? { ...l, ...cambios } : l));
  const total = lineas.reduce((sum, l) => sum + totalLinea(l), 0);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!requirente) { setError("Selecciona la persona que requiere."); return; }
    if (lineas.some(l => !l.proveedor_id)) { setError("Selecciona un proveedor para cada línea."); return; }
    setGuardando(true); setError("");
    try {
      const body = {
        fecha_requerimiento: fecha, entidad_requirente_id: entidad, requirente_usuario_id: requirente,
        observaciones: observaciones || null, ...(detalle ? { version: detalle.version } : {}),
        lineas: lineas.map(l => Object.fromEntries(Object.entries(l).filter(([c]) => c !== "key"))),
      };
      const r = await fetch(`/api/empresas/${slug}/rrhh/requerimientos${detalle ? `/${detalle.id}` : ""}`, { method: detalle ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) { if (r.status === 409) setConflicto(true); throw new Error(data.error); }
      alGuardar();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { setGuardando(false); }
  }
  const deshabilitado = guardando || conflicto;
  return <form onSubmit={guardar} className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
    <h2 className="text-lg font-semibold">{detalle ? `Editar ${detalle.codigo}` : "Nuevo requerimiento de RRHH"}</h2>
    <fieldset disabled={deshabilitado} className="grid gap-4 md:grid-cols-2">
      <label>Fecha de requerimiento<input className={estilo} type="date" required value={fecha} onChange={e => setFecha(e.target.value)} /></label>
      <label>Empresa requirente<select className={estilo} required value={entidad || ""} onChange={e => setEntidad(Number(e.target.value))}>
        <option value="">Seleccionar</option>
        {entidad && !catalogos?.entidades.some(v => v.id === entidad) && <option value={entidad}>{detalle?.entidad_requirente_nombre} (revalidar)</option>}
        {catalogos?.entidades.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
      </select></label>
      <div><CatalogoSearchSelect label="Persona que requiere" placeholder="Buscar..." value={String(requirente || "")}
        options={opcionesPersona(catalogos?.usuarios ?? [], requirente === detalle?.requirente_usuario_id ? requirente : 0, detalle?.requirente_nombre)}
        inputClassName={estilo} onChange={value => setRequirente(Number(value) || 0)} /></div>
      <p className="self-end text-sm text-[var(--muted)]">Solicitante: {detalle?.solicitante_nombre ?? "Tú (usuario autenticado)"} (solo lectura)</p>
      <label className="md:col-span-2">Observaciones<textarea className={estilo} maxLength={10000} value={observaciones} onChange={e => setObservaciones(e.target.value)} /></label>
    </fieldset>
    <h3 className="font-semibold">Detalle</h3>
    {lineas.map((l, indice) => {
      const proveedor = catalogos?.proveedores.find(p => p.id === l.proveedor_id);
      const original = detalle?.lineas.find(v => v.id === l.id);
      const sinCuenta = l.metodo_pago === "Transferencia" && proveedor && (!proveedor.banco || !proveedor.numero_cuenta);
      return <section key={l.key} className="space-y-3 rounded-lg border border-[var(--border)] p-3">
        <p className="text-sm font-medium">Línea {indice + 1}</p>
        <fieldset disabled={deshabilitado} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <CatalogoSearchSelect label="Proveedor" placeholder="Buscar proveedor..." value={String(l.proveedor_id || "")}
            options={opcionesProveedor(catalogos?.proveedores ?? [], l.proveedor_id, original?.proveedor_nombre_snapshot)} inputClassName={estilo} emptyLabel="Seleccionar"
            onChange={value => { const id = Number(value); const habitual = catalogos?.proveedores.find(v => v.id === id)?.metodo_pago_habitual; cambiar(l.key, { proveedor_id: id, metodo_pago: (METODOS_PAGO_RRHH as readonly string[]).includes(habitual ?? "") ? habitual! as LineaForm["metodo_pago"] : l.metodo_pago }); }} />
          <label className="md:col-span-2 xl:col-span-1">Descripción / concepto<input className={estilo} required maxLength={1000} value={l.descripcion} onChange={e => cambiar(l.key, { descripcion: e.target.value })} /></label>
          <label>Cantidad<input className={estilo} type="number" min="0.01" step="0.01" required value={l.cantidad} onChange={e => cambiar(l.key, { cantidad: e.target.value })} /></label>
          <label>Precio unitario (Q)<input className={estilo} type="number" min="0.01" step="0.01" required value={l.precio_unitario} onChange={e => cambiar(l.key, { precio_unitario: e.target.value })} /></label>
          <label>Método de pago<select className={estilo} value={l.metodo_pago} onChange={e => cambiar(l.key, { metodo_pago: e.target.value as LineaForm["metodo_pago"] })}>{METODOS_PAGO_RRHH.map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Condición de pago<select className={estilo} value={l.condicion_pago} onChange={e => cambiar(l.key, { condicion_pago: e.target.value as LineaForm["condicion_pago"] })}><option>Contado</option><option>Crédito</option></select></label>
          <label className="md:col-span-2 xl:col-span-3">Observaciones<textarea className={estilo} maxLength={10000} value={l.observaciones ?? ""} onChange={e => cambiar(l.key, { observaciones: e.target.value || null })} /></label>
        </fieldset>
        {l.metodo_pago === "Transferencia" && proveedor && <dl className="text-sm text-[var(--muted)]">
          <div><dt className="inline font-medium">Banco: </dt><dd className="inline">{proveedor.banco || "—"}</dd></div>{" · "}
          <div><dt className="inline font-medium">No. de cuenta: </dt><dd className="inline">{proveedor.numero_cuenta || "—"}</dd></div>{" · "}
          <div><dt className="inline font-medium">Tipo de cuenta: </dt><dd className="inline">{proveedor.tipo_cuenta || "—"}</dd></div>
        </dl>}
        {l.condicion_pago === "Crédito" && proveedor?.dias_credito != null && <p className="text-sm text-[var(--muted)]">Días de crédito: {proveedor.dias_credito}</p>}
        {sinCuenta && <p role="alert" className="text-sm text-red-300">Este proveedor no tiene banco y número de cuenta registrados; no se podrá guardar con Transferencia.</p>}
        <p className="text-sm">Total línea: {monedaRrhhReq(totalLinea(l))}</p>
        {lineas.length > 1 && <button className={boton} type="button" disabled={deshabilitado} onClick={() => setLineas(actual => actual.filter(v => v.key !== l.key))}>Eliminar línea</button>}
      </section>;
    })}
    <button className={boton} type="button" disabled={deshabilitado || lineas.length >= 500} onClick={() => setLineas(actual => [...actual, nuevaLinea(crypto.randomUUID())])}>+ Agregar línea</button>
    <p className="text-lg font-semibold">Total requerimiento: {monedaRrhhReq(total)}</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {conflicto && <button className={boton} type="button" onClick={() => window.location.reload()}>Actualizar información (descarta cambios locales)</button>}
    <div className="flex gap-3">
      <button className="rounded bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50" disabled={deshabilitado || !catalogos} type="submit">{guardando ? "Guardando…" : "Guardar requerimiento"}</button>
      <button className={boton} type="button" disabled={guardando} onClick={alCancelar}>Cancelar</button>
    </div>
  </form>;
}

function Decision({ slug, id, version, alCambiar }: { slug: string; id: number; version: number; alCambiar: () => void }) {
  const [mostrarRechazo, setMostrarRechazo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  async function enviar(body: { accion: "autorizar"; version: number } | { accion: "rechazar"; version: number; motivo: string }) {
    setProcesando(true); setError("");
    try {
      const r = await fetch(`/api/empresas/${slug}/rrhh/requerimientos/${id}/estado`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "No se pudo completar la decisión.");
      setMostrarRechazo(false); setMotivo(""); alCambiar();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red."); }
    finally { setProcesando(false); }
  }
  return <div className="space-y-2 text-sm">
    {!mostrarRechazo ? <div className="flex gap-2">
      <button type="button" disabled={procesando} className="rounded bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={() => { if (confirm("¿Autorizar este requerimiento de RRHH?")) void enviar({ accion: "autorizar", version }); }}>Autorizar</button>
      <button type="button" disabled={procesando} className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50" onClick={() => setMostrarRechazo(true)}>Rechazar</button>
    </div> : <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (!motivo.trim()) { setError("El rechazo requiere un motivo."); return; } void enviar({ accion: "rechazar", version, motivo }); }}>
      <label className="block">Motivo del rechazo<textarea className={estilo} maxLength={1000} required value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      <div className="flex gap-2"><button type="submit" disabled={procesando} className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50">Confirmar rechazo</button><button type="button" disabled={procesando} className={boton} onClick={() => setMostrarRechazo(false)}>Cancelar</button></div>
    </form>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </div>;
}

export function RequerimientosRrhhClient({ slug, puedeCrear, puedeEditar, puedeAutorizar, puedeVerProveedores, fechaHoy }: {
  slug: string; puedeCrear: boolean; puedeEditar: boolean; puedeAutorizar: boolean; puedeVerProveedores: boolean; fechaHoy: string;
}) {
  const [filas, setFilas] = useState<RequerimientoRrhh[]>([]);
  const [filtros, setFiltros] = useState({ codigo: "", desde: "", hasta: "", estado: "" });
  const [consulta, setConsulta] = useState("");
  const [refresco, setRefresco] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [detalles, setDetalles] = useState<Record<number, DetalleRequerimientoRrhh>>({});
  const [expandido, setExpandido] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/rrhh/requerimientos?${consulta}`, { cache: "no-store", signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; })
      .then(data => { setFilas(data.requerimientos); setError(""); setCargando(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "No se pudo cargar el listado."); setCargando(false); } });
    return () => controller.abort();
  }, [slug, consulta, refresco]);
  useEffect(() => {
    if (!puedeCrear && !puedeEditar) return;
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/rrhh/requerimientos/catalogos`, { cache: "no-store", signal: controller.signal })
      .then(r => r.json()).then(data => { if (!controller.signal.aborted) setCatalogos(data); }).catch(() => undefined);
    return () => controller.abort();
  }, [slug, puedeCrear, puedeEditar]);

  async function verDetalle(id: number) {
    if (expandido === id) { setExpandido(null); return; }
    setExpandido(id);
    if (!detalles[id]) {
      const r = await fetch(`/api/empresas/${slug}/rrhh/requerimientos/${id}`, { cache: "no-store" });
      const data = await r.json();
      if (r.ok) setDetalles(a => ({ ...a, [id]: data.requerimiento }));
    }
  }
  function refrescarTras(id?: number) {
    setCreando(false); setEditandoId(null); setMsg("Requerimiento guardado."); setRefresco(v => v + 1);
    if (id) setDetalles(a => { const resto = { ...a }; delete resto[id]; return resto; });
  }

  return <main className="space-y-5 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Requerimientos (RRHH)</h1>
      <div className="flex gap-3">
        {puedeVerProveedores && <Link href={`/e/${slug}/rrhh/proveedores`} className={inputFiltro}>Administrar proveedores</Link>}
        {puedeCrear && !creando && <button className={inputFiltro} onClick={() => { setCreando(true); setEditandoId(null); }}>+ Nuevo requerimiento</button>}
      </div>
    </div>
    {creando && <Formulario slug={slug} catalogos={catalogos} fechaHoy={fechaHoy} alGuardar={() => refrescarTras()} alCancelar={() => setCreando(false)} />}
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" onSubmit={e => { e.preventDefault(); setCargando(true); setConsulta(new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v))).toString()); }}>
      <label>Código<input className={`${inputFiltro} block`} value={filtros.codigo} maxLength={40} onChange={e => setFiltros({ ...filtros, codigo: e.target.value })} /></label>
      <label>Desde<input className={`${inputFiltro} block`} type="date" value={filtros.desde} onChange={e => setFiltros({ ...filtros, desde: e.target.value })} /></label>
      <label>Hasta<input className={`${inputFiltro} block`} type="date" value={filtros.hasta} onChange={e => setFiltros({ ...filtros, hasta: e.target.value })} /></label>
      <label>Estado<select className={`${inputFiltro} block`} value={filtros.estado} onChange={e => setFiltros({ ...filtros, estado: e.target.value })}><option value="">Todos</option>{["Pendiente", "Autorizada", "Rechazada"].map(v => <option key={v}>{v}</option>)}</select></label>
      <button className={inputFiltro}>Filtrar</button>
    </form>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {msg && <p role="status" className="text-emerald-400">{msg}</p>}
    {cargando && <p role="status">Cargando…</p>}
    <div className="space-y-2">
      {!cargando && !error && !filas.length && <p className="text-[var(--muted)]">No hay requerimientos.</p>}
      {!cargando && !error && filas.map(f => {
        const detalle = detalles[f.id];
        return <section key={f.id} aria-label={f.codigo} className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-medium">{f.codigo}</span> · {f.requirente_nombre || "—"} · {f.fecha_requerimiento} · <span className={f.estado === "Rechazada" ? "text-red-400" : f.estado === "Autorizada" ? "text-emerald-400" : "text-amber-400"}>{f.estado}</span> · {monedaRrhhReq(f.total)}
              <p className="mt-1 text-xs text-[var(--muted)]">{f.entidad_requirente_nombre || "Sin dato histórico"} · {f.cantidad_lineas} líneas</p>
              {f.estado === "Rechazada" && f.motivo_rechazo ? <p className="mt-1 text-xs text-red-300">Motivo de rechazo: {f.motivo_rechazo}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => void verDetalle(f.id)} className="text-[var(--accent)]">{expandido === f.id ? "Ocultar" : "Ver detalle"}</button>
              <a href={`/api/empresas/${slug}/rrhh/requerimientos/${f.id}/excel`} className={inputFiltro}>Excel</a>
              <a href={`/api/empresas/${slug}/rrhh/requerimientos/${f.id}/pdf`} className={inputFiltro}>PDF</a>
              {puedeEditar && f.estado === "Pendiente" && <button className={inputFiltro} onClick={() => void verDetalle(f.id).then(() => { setEditandoId(f.id); setCreando(false); })}>Editar</button>}
            </div>
          </div>
          {expandido === f.id && detalle && editandoId !== f.id && <div className="mt-3 space-y-3">
            <table className="w-full text-xs"><thead><tr>{["Proveedor", "Descripción", "Cant.", "P. unit.", "Método", "Condición", "Total"].map(h => <th className="p-1 text-left" key={h}>{h}</th>)}</tr></thead>
              <tbody>{detalle.lineas.map(l => <tr key={l.id} className="border-t border-[var(--border)]"><td className="p-1">{l.proveedor_nombre_snapshot}</td><td className="p-1">{l.descripcion}</td><td className="p-1">{l.cantidad}</td><td className="p-1">{monedaRrhhReq(l.precio_unitario)}</td><td className="p-1">{l.metodo_pago}{l.metodo_pago === "Transferencia" ? ` (${l.banco_snapshot || "—"} · ${l.numero_cuenta_snapshot || "—"})` : ""}</td><td className="p-1">{l.condicion_pago}</td><td className="p-1">{monedaRrhhReq(l.total)}</td></tr>)}</tbody></table>
            {detalle.estado === "Autorizada" && <p className="text-xs text-[var(--muted)]">Autorizado por: {detalle.autorizante_nombre ?? "—"}</p>}
            {puedeAutorizar && detalle.estado === "Pendiente" && <Decision slug={slug} id={f.id} version={detalle.version} alCambiar={() => refrescarTras(f.id)} />}
          </div>}
          {editandoId === f.id && detalle && <div className="mt-3"><Formulario slug={slug} detalle={detalle} catalogos={catalogos} fechaHoy={fechaHoy} alGuardar={() => refrescarTras(f.id)} alCancelar={() => setEditandoId(null)} /></div>}
        </section>;
      })}
    </div>
  </main>;
}
