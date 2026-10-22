"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CandidatosCB2, input, button, type EjecutarCB2 } from "./importar";
import { FiltrosCB2, PaginacionCB2, useListadoCB2 } from "./listados";
import { excelPrivadoCB2, seleccionPendienteCB2, gruposOrigen, jsonCB2, todasCB2, leerObjeto, type CatalogosCB2, type Registro } from "./client";
export function HistorialCB2({ api, cat, run, locked, admin, canWrite, refresh, activo }: {
    api: string;
    cat: CatalogosCB2;
    run: EjecutarCB2;
    locked: boolean;
    admin: boolean;
    canWrite: boolean;
    refresh: number;
    activo: boolean;
}) {
    const list = useListadoCB2(api, "importaciones", refresh, activo);
    const [header, setHeader] = useState<Registro | null>(null), [rows, setRows] = useState<Registro[]>([]), [sel, setSel] = useState<Record<string, string>>({}), [motivo, setMotivo] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false), [page, setPage] = useState(0);
    const filas = useMemo(() => gruposOrigen(rows), [rows]);
    const pendientes = new Set(filas.filter(f => f.estadoCandidato === "PENDIENTE" && f.candidato).map(f => f.candidato)).size;
    const seleccionValida = seleccionPendienteCB2(filas, sel);
    const revision = useRef(0);
    const [descargando, setDescargando] = useState(false);
    useEffect(() => () => { revision.current++; }, []);
    async function abrir(h: Registro) {
        const actual = ++revision.current;
        setHeader(h);
        setRows([]);
        setSel({});
        setMotivo("");
        setLoading(true);
        setError("");
        setPage(0);
        try {
            const r = await todasCB2(`${api}/importaciones/${h.id}/filas`);
            if (actual === revision.current)
                setRows(r);
        }
        catch (e) {
            if (actual === revision.current)
                setError(e instanceof Error ? e.message : "No se pudo leer el diario.");
        }
        finally {
            if (actual === revision.current)
                setLoading(false);
        }
    }
    async function reanudar() {
        if (!header || !motivo.trim() || locked || loading || !pendientes || !seleccionValida.length)
            return;
        const data = { proveedorId: Number(header.proveedor_id), importacionId: header.id, revision: Number(header.revision), seleccion: seleccionValida, motivo: motivo.trim() };
        await run("reanudar", data, key => jsonCB2(`${api}/reanudar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, clave: key }) })).catch(() => { });
    }
    return <section className="space-y-4" aria-label="Historial de importaciones"><h2 className="text-lg font-semibold">Historial y trazabilidad</h2><FiltrosCB2 tipo="importaciones" cat={cat} onApply={list.setQuery}/>{list.loading && <p role="status">Cargando importaciones…</p>}{list.error && <p role="alert">{list.error}</p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Archivo / proveedor", "Estado", "Revisión", "Trazabilidad"].map(h => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{list.rows.map(h => <tr key={h.id} className="border-t border-[var(--border)]"><td className="p-2">{String(h.archivo_nombre)}<br />{String(h.proveedor_nombre)} · {String(h.creado_en)}</td><td>{String(h.estado)}<br />{String(leerObjeto(h.resumen_actual).pendientes ?? "—")} apariciones pendientes</td><td>{String(h.revision)}</td><td><button className={button} disabled={loading || locked} onClick={() => void abrir(h)}>Ver trazabilidad #{h.id}</button></td></tr>)}</tbody></table></div>{!list.loading && !list.rows.length && <p>No hay importaciones para estos filtros.</p>}<PaginacionCB2 list={list}/>
 {header && <section className="space-y-3 rounded border border-[var(--border)] p-4"><h3 className="font-semibold">{String(header.archivo_nombre)} · revisión {String(header.revision)}</h3><a className="underline" href={`${api}/importaciones/${header.id}/archivo`} download aria-disabled={descargando} onClick={async (e) => {
                e.preventDefault();
                if (descargando)
                    return;
                setDescargando(true);
                setError("");
                try {
                    const blob = await excelPrivadoCB2(`${api}/importaciones/${header.id}/archivo`), url = URL.createObjectURL(blob), a = document.createElement("a");
                    a.href = url;
                    a.download = `cb2-${header.id}.xlsx`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
                catch (err) {
                    setError(err instanceof Error ? err.message : "No se pudo descargar.");
                }
                finally {
                    setDescargando(false);
                }
            }}>Descargar Excel original privado</a><p>SHA-256: <span className="break-all">{String(header.archivo_sha256)}</span></p>{descargando && <p role="status">Descargando Excel privado…</p>}{loading && <p role="status">Leyendo todas las páginas del diario…</p>}{error && <p role="alert">{error}</p>}
 {!loading && !error && rows.length > 0 && <><details><summary>Diario completo ({rows.length} eventos)</summary><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{["Evento / revisión", "Origen", "Resultado / consumo", "Decisión y evidencia"].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{rows.slice(page * 25, page * 25 + 25).map(r => <tr key={r.id} className="border-t"><td>{String(r.tipo)} · {String(r.revision)}</td><td>{String(r.hoja_nombre)}:{String(r.fila_excel)}</td><td>{String(r.resultado)} · {String(r.consumo_id ?? "Sin consumo")}</td><td><details><summary>Ver evidencia #{r.id}</summary><pre className="max-w-lg whitespace-pre-wrap break-all">{JSON.stringify({ original: leerObjeto(r.datos_origen), decision: leerObjeto(r.decision), motivo: r.motivo, operacion: r.operacion_clave }, null, 2)}</pre></details></td></tr>)}</tbody></table></div><button className={button} disabled={!page} onClick={() => setPage(page - 1)}>Eventos anteriores</button><button className={button} disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(page + 1)}>Eventos siguientes</button></details>
 {admin && canWrite ? <><h3 className="font-semibold">Reanudar candidatos pendientes</h3><p>{pendientes} candidatos pendientes de resolución.</p>{!pendientes && <p role="status">No quedan candidatos pendientes para reanudar. Los resueltos y bloqueados se conservan en la trazabilidad.</p>}<p>Solo Admin. Se usa el Excel privado original; no es posible forzar conflictos. El servidor revalida toda la identidad, historial y acceso actual.</p><CandidatosCB2 key={header.id} filas={filas} cat={cat} seleccion={sel} onChange={setSel} disabled={locked}/><fieldset disabled={locked}><label>Motivo de reanudación<textarea className={input} required maxLength={1000} value={motivo} onChange={e => setMotivo(e.target.value)}/></label><button className={button} disabled={!pendientes || !motivo.trim() || !seleccionValida.length} onClick={() => void reanudar()}>Reanudar selección</button></fieldset></> : <p>La reanudación requiere autorización Admin.</p>}</>}
 </section>}
 </section>;
}
