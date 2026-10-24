"use client";
import { TablaConsumosCB2 } from "./tabla-consumos";
import { VacioCB2 } from "./presentacion";
import { useRef, useState } from "react";
import { button, input, type EjecutarCB2 } from "./importar";
import { FiltrosCB2, PaginacionCB2, useListadoCB2 } from "./listados";
import { jsonCB2, todasCB2, type Registro, type CatalogosCB2 } from "./client";
export type DocumentoUI = {
    serie: string;
    numero: string;
    moneda: string;
    fecha: string;
    total: string;
    proveedorId?: number;
};
export const documentoVacio: DocumentoUI = { serie: "", numero: "", moneda: "GTQ", fecha: "", total: "" };
export function documentoDe(r: Registro): DocumentoUI { return { proveedorId: Number(r.proveedor_id), serie: String(r.serie), numero: String(r.numero), moneda: String(r.moneda), fecha: r.fecha_factura ? String(r.fecha_factura).slice(0, 10) : "", total: r.total_documental == null ? "" : String(r.total_documental) }; }
export async function revisionesCB2(api: string, seleccion: Registro[]) {
    const ids = new Set(seleccion.map(r => Number(r.importacion_origen_id))), headers = await todasCB2(`${api}/importaciones`);
    const revisiones = headers.filter(h => ids.has(h.id)).map(h => ({ id: h.id, revision: Number(h.revision) })).sort((a, b) => a.id - b.id);
    if (revisiones.length !== ids.size)
        throw new Error("No se encontraron todas las importaciones del lote. Actualiza el historial.");
    return revisiones;
}
export function ConsumosCB2({ api, cat, run, canWrite, admin = false, locked, refresh, activo, documento, setDocumento }: {
    api: string;
    cat: CatalogosCB2;
    run: EjecutarCB2;
    canWrite: boolean;
    admin?: boolean;
    locked: boolean;
    refresh: number;
    activo: boolean;
    documento: DocumentoUI;
    setDocumento: (v: DocumentoUI) => void;
}) {
    const list = useListadoCB2(api, "consumos", refresh, activo), [seleccion, setSeleccion] = useState<Record<number, Registro>>({}), [motivo, setMotivo] = useState(""), [error, setError] = useState(""), [preparando, setPreparando] = useState(false);
    const preparandoRef = useRef(false);
    const elegidas = Object.values(seleccion);
    async function asociar() {
        if (locked || preparandoRef.current || !elegidas.length)
            return;
        preparandoRef.current = true;
        setPreparando(true);
        setError("");
        try {
            const proveedores = new Set(elegidas.map(r => Number(r.proveedor_id)));
            if (documento.proveedorId !== undefined && !proveedores.has(documento.proveedorId))
                throw new Error("La factura elegida pertenece a otro proveedor. No se puede usar en este lote.");
            if (proveedores.size !== 1)
                throw new Error("Selecciona consumos de un solo proveedor.");
            if (elegidas.some(r => r.moneda !== documento.moneda))
                throw new Error("La moneda documental debe coincidir con todos los consumos.");
            const data = { proveedorId: Number(elegidas[0].proveedor_id), documento: { serie: documento.serie.trim(), numero: documento.numero.trim(), moneda: documento.moneda, fecha: documento.fecha || null, total: documento.total.trim() || null }, consumos: elegidas.map(r => r.id).sort((a, b) => a - b), revisiones: await revisionesCB2(api, elegidas), motivo: motivo.trim() };
            await run("asociar", data, key => jsonCB2(`${api}/asociar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, clave: key }) }));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo asociar la factura.");
        }
        finally {
            preparandoRef.current = false;
            setPreparando(false);
        }
    }
    return <section className="space-y-4" aria-label="Consumos registrados"><h2 className="text-lg font-semibold">Consumos registrados</h2><FiltrosCB2 tipo="consumos" cat={cat} onApply={list.setQuery}/>{list.loading && <p role="status">Cargando consumos…</p>}{list.error && <p role="alert">{list.error}</p>}
 <TablaConsumosCB2 rows={list.rows} seleccion={seleccion} canWrite={canWrite} admin={admin} locked={locked} preparando={preparando} api={api} cat={cat} run={run} onSeleccionar={(r, valor) => setSeleccion(s => {
                    const next = { ...s };
                    if (valor)
                        next[r.id] = r;
                    else
                        delete next[r.id];
                    return next;
                })}/>{!list.loading && !list.rows.length && <VacioCB2>No hay consumos para estos filtros.</VacioCB2>}<PaginacionCB2 list={list}/>
 {canWrite && <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><h3 className="font-semibold">Asociar factura al lote seleccionado</h3><p>{elegidas.length} consumos seleccionados entre páginas. Todos deben pertenecer al mismo proveedor y moneda. La asociación es documental; no registra pagos ni permite reasignar una factura diferente.</p><fieldset disabled={locked || preparando} className="grid gap-3 md:grid-cols-3"><button className={button} type="button" onClick={() => setSeleccion({})}>Limpiar selección</button><button className={button} type="button" onClick={() => setDocumento({ ...documentoVacio })}>Capturar otro documento</button><label>Serie (texto)<input className={input} maxLength={128} value={documento.serie} onChange={e => setDocumento({ ...documento, serie: e.target.value })}/></label><label>Número (texto, conserva ceros)<input className={input} maxLength={128} value={documento.numero} onChange={e => setDocumento({ ...documento, numero: e.target.value })}/></label><label>Moneda<select className={input} value={documento.moneda} onChange={e => setDocumento({ ...documento, moneda: e.target.value })}><option>GTQ</option><option>USD</option></select></label><label>Fecha documental opcional<input className={input} type="date" value={documento.fecha} onChange={e => setDocumento({ ...documento, fecha: e.target.value })}/></label><label>Total documental opcional<input className={input} inputMode="decimal" placeholder="Ej. 1250.50" value={documento.total} onChange={e => setDocumento({ ...documento, total: e.target.value })}/></label><label className="md:col-span-3">Motivo<textarea className={input} maxLength={1000} value={motivo} onChange={e => setMotivo(e.target.value)}/></label><button className="rounded bg-sky-700 px-3 py-2 text-white disabled:opacity-50" disabled={!elegidas.length || elegidas.length > 1000 || !documento.serie.trim() || !documento.numero.trim() || !motivo.trim()} onClick={() => void asociar()}>{preparando ? "Preparando lote…" : "Asociar factura al lote"}</button></fieldset>{error && <p role="alert">{error}</p>}</section>}
 </section>;
}
export function FacturasCB2({ api, cat, refresh, activo, canWrite, locked, elegir }: {
    api: string;
    cat: CatalogosCB2;
    refresh: number;
    activo: boolean;
    canWrite: boolean;
    locked: boolean;
    elegir: (d: DocumentoUI, proveedor: number) => void;
}) {
    const list = useListadoCB2(api, "facturas", refresh, activo);
    return <section className="space-y-4" aria-label="Facturas operativas"><h2 className="text-lg font-semibold">Facturas operativas</h2><p>Una factura puede agrupar consumos de varias importaciones del mismo proveedor.</p><FiltrosCB2 tipo="facturas" cat={cat} onApply={list.setQuery}/>{list.loading && <p role="status">Cargando facturas…</p>}{list.error && <p role="alert">{list.error}</p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Documento", "Proveedor", "Fecha / moneda", "Total documental", "Asociación"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead><tbody>{list.rows.map(r => <tr key={r.id} className="border-t border-[var(--border)]"><td className="p-2">{String(r.serie)} / {String(r.numero)}</td><td>{cat.proveedores.find(p => p.id === Number(r.proveedor_id))?.nombre ?? `Proveedor #${r.proveedor_id}`}</td><td>{r.fecha_factura ? String(r.fecha_factura).slice(0, 10) : "Sin fecha documental"} · {String(r.moneda)}</td><td>{r.total_documental == null ? "No declarado" : String(r.total_documental)}</td><td>{canWrite && <button className={button} disabled={locked} onClick={() => elegir(documentoDe(r), Number(r.proveedor_id))}>Usar documento #{r.id}</button>}</td></tr>)}</tbody></table></div>{!list.loading && !list.rows.length && <VacioCB2>No hay facturas para estos filtros.</VacioCB2>}<PaginacionCB2 list={list}/></section>;
}
