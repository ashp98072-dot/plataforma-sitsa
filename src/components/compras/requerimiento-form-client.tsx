"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { METODOS_PAGO_COMPRAS, type DetalleCompra, type LineaCompraDatos } from "@/lib/compras/requerimiento-schema";
import { seleccionarProveedorCompra } from "@/lib/compras/metodos-pago";
import { CatalogoSearchSelect, opcionesConHistorico, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";
import { LineaDocumentosClient } from "@/components/compras/linea-documentos-client";
import { RequerimientoDecisionClient, formatearTimestampCompra } from "@/components/compras/requerimiento-decision-client";

type Opcion = { id: number; nombre: string };
type Proveedor = { id: number; nombre_comercial: string; nit: string | null; contacto_nombre: string | null; contacto_telefono: string | null; telefono: string | null; metodo_pago_habitual: string | null; banco: string | null; numero_cuenta: string | null; dias_credito: number | null };
type Vehiculo = { id: number; placa: string; descripcion: string | null; marca: string | null; modelo: string | null };
type Catalogos = { entidades: Opcion[]; usuarios: Opcion[]; requirentesOperaciones: Opcion[]; proveedores: Proveedor[]; vehiculos: Vehiculo[] };

export function opcionesUnidadesCompra(vehiculos: Vehiculo[], id: number | null, nombre: string | null): CatalogoSearchOption[] {
  return opcionesConHistorico(vehiculos.map(v => ({
    value: String(v.id),
    label: [v.placa, v.descripcion || [v.marca, v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
    searchText: [v.placa, v.descripcion, v.marca, v.modelo].filter(Boolean).join(" "),
  })), String(id || ""), nombre || "Unidad histórica");
}

export function opcionesProveedoresCompra(proveedores: Proveedor[], id: number, nombre?: string): CatalogoSearchOption[] {
  return opcionesConHistorico(proveedores.map(p => ({
    value: String(p.id), label: p.nombre_comercial,
    searchText: [p.nombre_comercial, p.nit, p.contacto_nombre, p.contacto_telefono, p.telefono].filter(Boolean).join(" "),
  })), String(id || ""), nombre || "Proveedor histórico");
}

function opcionesIdentidad(usuarios: Opcion[], id: number, nombre?: string | null): CatalogoSearchOption[] {
  const opciones = usuarios.map(u => ({ value: String(u.id), label: u.nombre }));
  if (id && !usuarios.some(u => u.id === id)) opciones.unshift({ value: String(id), label: `${nombre || "Sin dato histórico"} (histórico)` });
  return opciones;
}
type LineaForm = LineaCompraDatos & { key: string };
const estilo = "block w-full rounded border border-[var(--border)] bg-[var(--input)] p-2 disabled:opacity-80";
const boton = "rounded border border-[var(--border)] px-3 py-2 disabled:opacity-50";
export function nuevaLinea(fecha: string, key: string): LineaForm { return { key, vehiculo_id: null, unidad_descripcion: null, fecha, serie_factura: null, numero_factura: null, proveedor_id: 0, repuesto_descripcion: "", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "", observaciones: null }; }
export function lineaEditable(l: DetalleCompra["lineas"][number]): LineaForm {
  // No devolver snapshots en PATCH: solo IDs y campos editables.
  return { key: `id-${l.id}`, id: l.id, vehiculo_id: l.vehiculo_id, unidad_descripcion: l.unidad_descripcion, fecha: l.fecha, serie_factura: l.serie_factura, numero_factura: l.numero_factura, proveedor_id: l.proveedor_id, repuesto_descripcion: l.repuesto_descripcion, metodo_pago: l.metodo_pago, condicion_pago: l.condicion_pago, total: l.total, observaciones: l.observaciones };
}
export function RequerimientoFormClient({ slug, detalle, editable, solicitante, puedeEliminar, puedeVerProveedores, puedeSubirDocumentos, puedeAutorizar, fechaHoy }: { slug: string; detalle?: DetalleCompra; editable: boolean; solicitante: string; puedeEliminar: boolean; puedeVerProveedores: boolean; puedeSubirDocumentos: boolean; puedeAutorizar: boolean; fechaHoy: string }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(detalle?.fecha_requerimiento ?? fechaHoy);
  const [entidad, setEntidad] = useState(detalle?.entidad_requirente_id ?? 0);
  const [requirente, setRequirente] = useState(detalle?.requirente_usuario_id ?? 0);
  const [encargado, setEncargado] = useState(detalle?.encargado_compras_usuario_id ?? 0);
  const [observaciones, setObservaciones] = useState(detalle?.observaciones ?? "");
  const [lineas, setLineas] = useState<LineaForm[]>(detalle ? detalle.lineas.map(lineaEditable) : [nuevaLinea(fechaHoy, "nueva-1")]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [conflicto, setConflicto] = useState(false);
  useEffect(() => {
    if (!editable) return;
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/compras/catalogos`, { cache: "no-store", signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; })
      .then(setCatalogos).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudieron cargar los catálogos."); });
    return () => controller.abort();
  }, [slug, editable]);
  const cambiar = (key: string, cambios: Partial<LineaForm>) => setLineas(actual => actual.map(l => l.key === key ? { ...l, ...cambios } : l));
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!requirente && (!detalle || detalle.requirente_usuario_id !== null)) { setError("Selecciona un requirente de Operaciones."); return; }
    if (lineas.some(l => !l.proveedor_id)) { setError("Selecciona un proveedor para cada línea."); return; }
    setGuardando(true); setError("");
    try {
      const r = await fetch(`/api/empresas/${slug}/compras/requerimientos${detalle ? `/${detalle.id}` : ""}`, { method: detalle ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha_requerimiento: fecha, entidad_requirente_id: entidad, requirente_usuario_id: requirente || null, ...(detalle && encargado === (detalle.encargado_compras_usuario_id ?? 0) ? {} : { encargado_compras_usuario_id: encargado || null }), observaciones: observaciones || null, ...(detalle ? { version: detalle.version } : {}), lineas: lineas.map(l => Object.fromEntries(Object.entries(l).filter(([campo]) => campo !== "key"))) }) });
      const data = await r.json(); if (!r.ok) { if (r.status === 409) setConflicto(true); throw new Error(data.error); }
      router.push(`/e/${slug}/compras/requerimientos/${data.id}`); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setGuardando(false); }
  }
  const deshabilitado = !editable || guardando || conflicto;
  const total = lineas.reduce((sum, l) => sum + (Number.isFinite(Number(l.total)) ? Number(l.total) : 0), 0);
  return <main className="space-y-5 p-6"><h1 className="text-2xl font-semibold">{detalle?.codigo ?? "Nuevo requerimiento de compra"}</h1>{detalle && <p>Estado: {detalle.estado} · Versión: {detalle.version}</p>}
    {/* COMPRAS-FASE-4-AUTORIZACION: snapshot de la decisión — nunca un JOIN en vivo contra usuarios (autorizante_nombre ya viene guardado tal cual estaba al momento de autorizar). */}
    {detalle && detalle.estado === "Autorizada" ? <p className="text-sm text-[var(--muted)]">Autorizado por: {detalle.autorizante_nombre ?? "—"} · Fecha autorización: {formatearTimestampCompra(detalle.autorizado_en)}</p> : null}
    {detalle && detalle.estado === "Rechazada" ? <div className="text-sm text-[var(--muted)]"><p>Fecha rechazo: {formatearTimestampCompra(detalle.rechazado_en)}</p><p>Motivo: {detalle.motivo_rechazo ?? "—"}</p></div> : null}
    {detalle && detalle.estado === "Pendiente" && puedeAutorizar ? <RequerimientoDecisionClient slug={slug} requerimientoId={detalle.id} version={detalle.version} /> : null}
    <form onSubmit={guardar} className="space-y-5"><fieldset disabled={deshabilitado} className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-2">
      <label>Fecha de requerimiento<input className={estilo} type="date" required value={fecha} onChange={e => setFecha(e.target.value)} /></label>
      {editable ? <><label>Empresa requirente<select className={estilo} required value={entidad || ""} onChange={e => setEntidad(Number(e.target.value))}><option value="">Seleccionar</option>{entidad && !catalogos?.entidades.some(v => v.id === entidad) && <option value={entidad}>{detalle?.entidad_requirente_nombre} (revalidar)</option>}{catalogos?.entidades.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}</select></label>
        <div><CatalogoSearchSelect label="Persona que requiere" placeholder="Buscar requirente..." value={String(requirente || "")} options={opcionesIdentidad(catalogos?.requirentesOperaciones ?? [], requirente === detalle?.requirente_usuario_id ? requirente : 0, detalle?.requirente_nombre)} inputClassName={estilo} onChange={value => setRequirente(Number(value) || 0)} />{detalle?.requirente_usuario_id === null && <p>Requirente histórico: {detalle.requirente_nombre || "Sin dato histórico"}</p>}</div></> : <><p>Empresa requirente: {detalle?.entidad_requirente_nombre || "Sin dato histórico"}</p><p>Persona que requiere: {detalle?.requirente_nombre || "—"}</p></>}
      {editable ? <CatalogoSearchSelect label="Encargado de compras" placeholder="Buscar encargado de compras..." value={String(encargado || "")} options={opcionesIdentidad(catalogos?.usuarios ?? [], encargado === detalle?.encargado_compras_usuario_id ? encargado : 0, detalle?.encargado_compras_nombre)} inputClassName={estilo} emptyLabel="Sin asignar" onChange={value => setEncargado(Number(value) || 0)} /> : <p>Encargado de compras: {detalle?.encargado_compras_nombre || "Sin asignar"}</p>}
      <p>Solicitante: {detalle?.solicitante_nombre ?? solicitante} (solo lectura)</p><label className="md:col-span-2">Observaciones<textarea className={estilo} maxLength={10000} value={observaciones} onChange={e => setObservaciones(e.target.value)} /></label>
    </fieldset><h2 className="text-lg font-semibold">Detalle de compra</h2>
    {lineas.map((l, indice) => {
      const proveedor = catalogos?.proveedores.find(p => p.id === l.proveedor_id);
      const original = detalle?.lineas.find(v => v.id === l.id);
      const ayuda = proveedor ? [["NIT", proveedor.nit], ["Contacto", proveedor.contacto_nombre], ["Teléfono", proveedor.contacto_telefono || proveedor.telefono], ["Método habitual", proveedor.metodo_pago_habitual], ["Banco", proveedor.banco], ["Cuenta", proveedor.numero_cuenta], ["Días de crédito", proveedor.dias_credito]] : [];
      return <section key={l.key} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><h3 className="font-semibold">Línea {indice + 1}</h3><fieldset disabled={deshabilitado} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {editable ? <CatalogoSearchSelect label="Unidad / placa" placeholder="Buscar placa o unidad..." value={String(l.vehiculo_id || "")} options={opcionesUnidadesCompra(catalogos?.vehiculos ?? [], l.vehiculo_id, l.unidad_descripcion)} inputClassName={estilo} emptyLabel="Unidad manual / sin unidad" onChange={value => cambiar(l.key, { vehiculo_id: value ? Number(value) : null, unidad_descripcion: null })} /> : <p>Unidad / placa: {l.unidad_descripcion || "—"}</p>}
        {editable && !l.vehiculo_id && <label>Descripción manual de unidad<input className={estilo} maxLength={200} value={l.unidad_descripcion ?? ""} onChange={e => cambiar(l.key, { unidad_descripcion: e.target.value || null })} /></label>}
        <label>Fecha<input className={estilo} type="date" required value={l.fecha} onChange={e => cambiar(l.key, { fecha: e.target.value })} /></label>
        <label>Serie factura<input className={estilo} maxLength={100} value={l.serie_factura ?? ""} onChange={e => cambiar(l.key, { serie_factura: e.target.value || null })} /></label>
        <label>Número factura<input className={estilo} maxLength={100} value={l.numero_factura ?? ""} onChange={e => cambiar(l.key, { numero_factura: e.target.value || null })} /></label>
        {editable ? <CatalogoSearchSelect label="Proveedor" placeholder="Buscar proveedor..." value={String(l.proveedor_id || "")} options={opcionesProveedoresCompra(catalogos?.proveedores ?? [], l.proveedor_id, original?.proveedor_nombre_snapshot)} inputClassName={estilo} emptyLabel="Seleccionar" onChange={value => { const id = Number(value); const habitual = catalogos?.proveedores.find(v => v.id === id)?.metodo_pago_habitual; setLineas(actual => actual.map(v => v.key === l.key ? seleccionarProveedorCompra(v, id, habitual) : v)); }} /> : <p>Proveedor: {original?.proveedor_nombre_snapshot}</p>}
        <label>Repuesto a comprar<input className={estilo} required maxLength={1000} value={l.repuesto_descripcion} onChange={e => cambiar(l.key, { repuesto_descripcion: e.target.value })} /></label>
        <label>Método de pago<select className={estilo} value={l.metodo_pago} onChange={e => cambiar(l.key, { metodo_pago: e.target.value })}>{!METODOS_PAGO_COMPRAS.some(v => v === l.metodo_pago) && <option value={l.metodo_pago}>{l.metodo_pago}</option>}{METODOS_PAGO_COMPRAS.map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Condición de pago<select className={estilo} value={l.condicion_pago} onChange={e => cambiar(l.key, { condicion_pago: e.target.value as LineaForm["condicion_pago"] })}><option>Contado</option><option>Crédito</option></select></label>
        <label>Total (Q)<input className={estilo} type="number" min="0.01" max="9999999999.99" step="0.01" required value={l.total} onChange={e => cambiar(l.key, { total: e.target.value })} /></label>
        <label className="md:col-span-2">Observaciones<textarea className={estilo} maxLength={10000} value={l.observaciones ?? ""} onChange={e => cambiar(l.key, { observaciones: e.target.value || null })} /></label>
      </fieldset>
      {ayuda.some(([, valor]) => valor !== null && valor !== "") && <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">{ayuda.filter(([, valor]) => valor !== null && valor !== "").map(([nombre, valor]) => <div key={String(nombre)}><dt>{nombre}</dt><dd>{valor}</dd></div>)}</dl>}
      {editable && puedeVerProveedores && <Link className="text-sm underline" href={`/e/${slug}/compras/proveedores`}>Administrar proveedores comerciales</Link>}
      {editable && (!l.id || puedeEliminar) && <button className={boton} type="button" disabled={deshabilitado || lineas.length === 1} onClick={() => setLineas(actual => actual.filter(v => v.key !== l.key))}>Eliminar línea</button>}
      {detalle && l.id ? <LineaDocumentosClient slug={slug} requerimientoId={detalle.id} lineaId={l.id} puedeSubir={puedeSubirDocumentos} puedeEliminar={puedeEliminar && detalle.estado === "Pendiente"} /> : null}
    </section>; })}
    {editable && <button className={boton} type="button" disabled={deshabilitado || lineas.length >= 500} onClick={() => setLineas(actual => [...actual, nuevaLinea(fecha, crypto.randomUUID())])}>+ Agregar línea</button>}
    <p className="text-lg font-semibold">Total requerimiento: Q {total.toFixed(2)}</p>{error && <p role="alert">{error}</p>}
    {conflicto && <button className={boton} type="button" onClick={() => window.location.reload()}>Actualizar información (descarta cambios locales)</button>}
    {editable && <button className={boton} disabled={deshabilitado || !catalogos} type="submit">{guardando ? "Guardando…" : "Guardar requerimiento"}</button>}
    </form><Link href={`/e/${slug}/compras/requerimientos`}>Volver al listado</Link></main>;
}
