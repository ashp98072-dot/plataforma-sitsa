"use client";
import { useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { elecciones, formCB2, jsonCB2, type CatalogosCB2, type PreviewCB2, type FilaCB2 } from "./client";
export const input = "w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5";
export const button = "rounded border border-[var(--border)] px-3 py-2 disabled:opacity-50";
export type EjecutarCB2 = (accion: string, identidad: unknown, fn: (key: string) => Promise<unknown>) => Promise<unknown>;
export function CandidatosCB2({ filas, cat, seleccion, onChange, disabled = false }: {
    filas: FilaCB2[];
    cat: CatalogosCB2;
    seleccion: Record<string, string>;
    onChange: (v: Record<string, string>) => void;
    disabled?: boolean;
}) {
    const [pagina, setPagina] = useState(0), [filtro, setFiltro] = useState("");
    const rows = filas.filter(f => `${f.vale} ${f.placa} ${f.hoja} ${f.estado}`.toLowerCase().includes(filtro.toLowerCase()));
    const page = Math.min(pagina, Math.max(0, Math.ceil(rows.length / 25) - 1));
    return <div className="space-y-3"><p>{filas.length} apariciones · {new Set(filas.flatMap(f => f.candidato ? [f.candidato] : [])).size} candidatos. Elegir una unidad selecciona todas las apariciones de ese candidato. Sin selección se conserva pendiente.</p>
 <label>Buscar en la vista previa<input className={input} value={filtro} onChange={e => { setFiltro(e.target.value); setPagina(0); }}/></label>
 <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Apariciones del Excel y selección de unidades</caption><thead><tr>{["Origen", "Vale / placa", "Fecha / importes", "Validación", "Unidad para procesar"].map(h => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{rows.slice(page * 25, page * 25 + 25).map(f => <tr key={`${f.hoja}:${f.fila}`} className="border-t border-[var(--border)] align-top"><td className="p-2">{f.hoja} / {f.fila}</td><td className="p-2">{f.vale || "Sin vale"}<br />{f.placa || "Sin placa"}</td><td className="p-2">{f.fecha || "Sin fecha"}<br />{f.galones ?? "—"} gal · {f.moneda} {f.monto ?? "—"}<br />{f.documento ? `${f.documento.serie} / ${f.documento.numero}` : "Sin documento verificable"}</td><td className="p-2"><strong>{f.estado === "RESUELTA" ? "RESUELTA" : f.estado === "IGNORADA" ? "IGNORADA" : f.bloqueada ? "BLOQUEADA" : f.estado}</strong><ul>{[...f.errores, ...f.motivos].map((m, i) => <li key={i}>{m}</li>)}</ul></td><td className="min-w-64 p-2">{f.candidato && !f.bloqueada ? <fieldset disabled={disabled}><CatalogoSearchSelect label={`Unidad para vale ${f.vale}, ${f.hoja}:${f.fila}`} placeholder="Buscar placa o unidad" value={seleccion[f.candidato] ?? ""} onChange={v => onChange({ ...seleccion, [f.candidato!]: v })} options={cat.vehiculos.map(v => ({ value: String(v.id), label: v.placa, detail: v.descripcion }))} inputClassName={input}/></fieldset> : "No seleccionable"}</td></tr>)}</tbody></table></div>
 <div className="flex gap-3"><button className={button} disabled={!page} onClick={() => setPagina(page - 1)}>Anterior</button><span>Página {page + 1} · {rows.length} apariciones</span><button className={button} disabled={(page + 1) * 25 >= rows.length} onClick={() => setPagina(page + 1)}>Siguiente</button></div></div>;
}
export function ImportarCB2({ api, cat, run, locked }: {
    api: string;
    cat: CatalogosCB2;
    run: EjecutarCB2;
    locked: boolean;
}) {
    const [perfil, setPerfil] = useState("HALEL"), [proveedor, setProveedor] = useState(""), [moneda, setMoneda] = useState("GTQ"), [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<PreviewCB2 | null>(null), [sel, setSel] = useState<Record<string, string>>({}), [error, setError] = useState(""), [loading, setLoading] = useState(false), [acepta, setAcepta] = useState(false);
    function invalidar() { setPreview(null); setSel({}); setAcepta(false); setError(""); }
    async function analizar() {
        if (!file || !proveedor || loading || locked)
            return;
        setLoading(true);
        setError("");
        try {
            setPreview(await jsonCB2<PreviewCB2>(`${api}/preview`, { method: "POST", body: formCB2(file, perfil, proveedor, moneda, []) }));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo analizar.");
        }
        finally {
            setLoading(false);
        }
    }
    async function confirmar() {
        if (!file || !preview || !acepta || locked || loading)
            return;
        const archivo = file, seleccion = elecciones(sel), identity = { sha256: preview.sha256, perfil, proveedorId: Number(proveedor), moneda, seleccion };
        await run("confirmar", identity, async (key) => {
            const f = formCB2(archivo, identity.perfil, String(identity.proveedorId), identity.moneda, identity.seleccion);
            const recibo = await jsonCB2<PreviewCB2>(`${api}/preview`, { method: "POST", body: f });
            if (recibo.sha256 !== identity.sha256)
                throw new Error("El archivo cambió; conserva el intento para revisión.");
            const body = formCB2(archivo, identity.perfil, String(identity.proveedorId), identity.moneda, identity.seleccion);
            body.set("token", recibo.token);
            body.set("clave", key);
            return jsonCB2(`${api}/confirmar`, { method: "POST", body });
        }).catch(() => { });
    }
    return <section className="space-y-4" aria-label="Importar consumos"><h2 className="text-lg font-semibold">Importar consumos HALEL / SHELL</h2><p>Registra consumos independientes de los vales. No crea pagos ni documentos fiscales. Una factura ausente no impide guardar un consumo seguro.</p>
 <fieldset disabled={locked || loading} className="grid gap-3 md:grid-cols-3"><CatalogoSearchSelect label="Proveedor de la empresa" placeholder="Buscar proveedor" value={proveedor} onChange={v => { setProveedor(v); invalidar(); }} options={cat.proveedores.map(p => ({ value: String(p.id), label: p.nombre }))} inputClassName={input}/><label>Perfil<select className={input} value={perfil} onChange={e => { setPerfil(e.target.value); invalidar(); }}><option>HALEL</option><option>SHELL</option></select></label><label>Moneda declarada<select className={input} value={moneda} onChange={e => { setMoneda(e.target.value); invalidar(); }}><option>GTQ</option><option>USD</option></select></label><label className="md:col-span-3">Excel original .xlsx (máximo 50 MB)<input className={input} type="file" accept=".xlsx" onChange={e => {
            const f = e.target.files?.[0] ?? null;
            invalidar();
            if (f && (!f.name.toLowerCase().endsWith(".xlsx") || f.size <= 0 || f.size > 52428800)) {
                setFile(null);
                setError("Selecciona un Excel .xlsx de hasta 50 MB.");
            }
            else
                setFile(f);
        }}/></label><button className={button} disabled={!file || !proveedor} onClick={() => void analizar()}>{loading ? "Analizando…" : "Analizar Excel"}</button></fieldset>
 {error && <p role="alert" className="text-red-500">{error}</p>}{preview && <><p>{preview.nota}</p><CandidatosCB2 filas={preview.filas} cat={cat} seleccion={sel} onChange={setSel} disabled={locked || loading}/><fieldset disabled={locked || loading} className="space-y-3"><p>{elecciones(sel).length} candidatos seleccionados. Las demás apariciones se conservarán como evidencia y podrán quedar pendientes.</p><label className="flex gap-2"><input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)}/>Confirmo el procesamiento parcial y la conservación de todas las apariciones.</label><button className="rounded bg-sky-700 px-3 py-2 text-white disabled:opacity-50" disabled={!acepta} onClick={() => void confirmar()}>Confirmar selección parcial</button></fieldset></>}
 </section>;
}
