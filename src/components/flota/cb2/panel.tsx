"use client";
import styles from "./panel.module.css";
import { useEffect, useState } from "react";
import { apiCB2, jsonCB2, OperacionCB2, type CatalogosCB2 } from "./client";
import { ImportarCB2, button, type EjecutarCB2 } from "./importar";
import { HistorialCB2 } from "./historial";
import { ConsumosCB2, FacturasCB2, documentoVacio } from "./consumos";
const tabs = [['consumos', 'Consumos'], ['importar', 'Importar Excel'], ['facturas', 'Facturas'], ['historial', 'Historial']] as const;
function storageSeguro() {
    try {
        return typeof window !== "undefined" ? window.sessionStorage : undefined;
    }
    catch {
        return undefined;
    }
}
export function CombustiblesCB2({ slug, actorId, canWrite, admin }: {
    slug: string;
    actorId: number;
    canWrite: boolean;
    admin: boolean;
}) {
    const api = apiCB2(slug), [tab, setTab] = useState("consumos"), [cat, setCat] = useState<CatalogosCB2>({ proveedores: [], vehiculos: [] }), [catalogosError, setCatalogosError] = useState(""), [catalogosListos, setCatalogosListos] = useState(false), [recargarCat, setRecargarCat] = useState(0), [documento, setDocumento] = useState(documentoVacio);
    const scope = `sitsa:cb2:${actorId}:${slug}`;
    const [op, setOp] = useState(() => new OperacionCB2(scope)), [restaurado, setRestaurado] = useState(false);
    useEffect(() => {
        let activo = true;
        Promise.resolve().then(() => {
            if (!activo)
                return;
            const restored = new OperacionCB2(scope, storageSeguro());
            const p = restored.pending;
            if (p?.identidad && (p.action === "asociar" || p.action === "reanudar"))
                p.ejecutar = key => jsonCB2(`${api}/${p.action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...p.identidad as object, clave: key }) });
            setOp(restored);
            setRestaurado(true);
        });
        return () => { activo = false; };
    }, [scope, api]);
    const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [error, setError] = useState(""), [message, setMessage] = useState("");
    const locked = !restaurado || busy || !!op.pending?.ejecutar;
    useEffect(() => {
        const ac = new AbortController();
        jsonCB2<CatalogosCB2>(`/api/empresas/${encodeURIComponent(slug)}/flota/combustible/catalogos`, { signal: ac.signal }).then(d => {
            if (!Array.isArray(d.vehiculos) || !Array.isArray(d.proveedores))
                throw new Error("Catálogos incompletos.");
            if (!ac.signal.aborted) {
                setCat(d);
                setCatalogosListos(true);
                setCatalogosError("");
            }
        }).catch(e => {
            if (!ac.signal.aborted)
                setCatalogosError(e.message);
        });
        return () => ac.abort();
    }, [slug, recargarCat]);
    function aplicado(result: unknown) {
        const r = result as {
            existente?: boolean;
            importacionId?: number;
            eventos?: {
                resultado: string;
            }[];
        };
        setMessage(r.existente ? `El archivo ya existe como importación #${r.importacionId}. No se creó otra importación; revisa su historial para reanudar.` : `Operación confirmada: ${r.eventos?.length ?? 0} eventos conservados. Consulta el historial para revisar los resultados y candidatos pendientes.`);
        setRefresh(n => n + 1);
        setDocumento(documentoVacio);
    }
    const run: EjecutarCB2 = async (action, identity, fn) => {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const r = await op.enviar(action, identity, fn);
            aplicado(r);
            return r;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
            throw e;
        }
        finally {
            setBusy(false);
        }
    };
    async function retry() {
        setBusy(true);
        setError("");
        try {
            aplicado(await op.reintentar());
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo recuperar.");
        }
        finally {
            setBusy(false);
        }
    }
    return <section className={`${styles.panel} space-y-6 rounded-2xl border border-[var(--border)] p-4 sm:p-6`} aria-label="Consumos y facturas CB2"><header className="space-y-1"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Consumos de proveedores</p><h2 className="text-xl font-semibold">Consumos y facturas de proveedor</h2><p className="text-sm text-[var(--muted)]">Importa, revisa y da seguimiento a tus archivos HALEL y SHELL.</p></header>
 <nav className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--bg)] p-1.5 sm:grid-cols-4" aria-label="Vistas de consumos y facturas">{tabs.filter(([k]) => k !== "importar" || canWrite).map(([key, label]) => <button key={key} className={`${button} ${tab === key ? "border-transparent bg-[var(--accent)] text-white shadow-sm" : "border-transparent text-[var(--muted)]"}`} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
 {busy && <p role="status">Procesando solicitud. No cierres esta pantalla ni repitas la acción.</p>}{error && <p role="alert" className="text-red-500">{error}</p>}{message && <p role="status" className="rounded border border-[var(--border)] p-3">{message}</p>}
 {op.pending && <aside className="space-y-2 rounded border border-amber-600 p-3"><p>Hay una solicitud pendiente ({op.pending.action}). Conservamos su clave de reintento. No cambies archivo, selección ni revisiones para recuperar un resultado incierto.</p>{op.pending.ejecutar ? <button className={button} disabled={busy} onClick={() => void retry()}>Reintentar exactamente la solicitud</button> : <p>Tras recargar, reproduce el mismo archivo y decisiones. No se guardan archivos ni recibos en el navegador.</p>}<details><summary>Decisiones del intento pendiente</summary><pre className="max-w-xl whitespace-pre-wrap break-all text-xs">{JSON.stringify(op.pending.identidad, null, 2)}</pre></details>{op.pending.definitivo && <button className={button} disabled={busy} onClick={() => { op.editar(); setError(""); setMessage("Solicitud rechazada sin aplicar. Puedes corregirla o actualizar los datos."); }}>Corregir solicitud rechazada</button>}</aside>}
 {catalogosError && <p role="alert">{catalogosError} <button className={button} onClick={() => setRecargarCat(n => n + 1)}>Reintentar catálogos</button></p>}
 <div hidden={tab !== "consumos"}><ConsumosCB2 key={`consumos:${refresh}`} api={api} cat={cat} run={run} canWrite={canWrite && catalogosListos} locked={locked} refresh={refresh} activo={tab === "consumos"} documento={documento} setDocumento={setDocumento}/></div>
 {canWrite && <div hidden={tab !== "importar"}>{catalogosListos ? <ImportarCB2 key={`importar:${refresh}`} api={api} cat={cat} run={run} locked={locked}/> : <p role="status">Carga los catálogos para importar.</p>}</div>}
 <div hidden={tab !== "facturas"}><FacturasCB2 key={`facturas:${refresh}`} api={api} cat={cat} refresh={refresh} activo={tab === "facturas"} canWrite={canWrite} locked={locked} elegir={(d, p) => { setDocumento(d); setTab("consumos"); setMessage(`Documento del proveedor #${p} seleccionado. Selecciona sus consumos y confirma la asociación.`); }}/></div>
 <div hidden={tab !== "historial"}><HistorialCB2 key={`historial:${refresh}`} api={api} cat={cat} run={run} locked={locked} admin={admin} canWrite={canWrite && catalogosListos} refresh={refresh} activo={tab === "historial"}/></div>
 </section>;
}
