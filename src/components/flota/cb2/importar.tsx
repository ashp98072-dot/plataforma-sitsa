"use client";
import { PasosImportacionCB2 } from "./presentacion";
import { useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { elecciones, formCB2, jsonCB2, type CatalogosCB2, type PreviewCB2 } from "./client";
import { input, primaryButton } from "./controles";
export { input, button, primaryButton } from "./controles";
import { CandidatosCB2, ResumenSeleccionCB2 } from "./preview-vista";
export { CandidatosCB2 } from "./preview-vista";
import { asignacionesExactas, seleccionSegura } from "./preview-model";
export type EjecutarCB2 = (accion: string, identidad: unknown, fn: (key: string) => Promise<unknown>) => Promise<unknown>;
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
            const resultado = await jsonCB2<PreviewCB2>(`${api}/preview`, { method: "POST", body: formCB2(file, perfil, proveedor, moneda, []) });
            setPreview(resultado);
            setSel(asignacionesExactas(resultado.filas, cat)); setAcepta(false);
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
        const seguras = seleccionSegura(preview.filas, cat, sel);
        if (Object.keys(seguras).length !== Object.values(sel).filter(Boolean).length) { setError("La selección contiene candidatos bloqueados o unidades no disponibles. Revisa las asignaciones."); return; }
        const archivo = file, seleccion = elecciones(seguras), identity = { sha256: preview.sha256, perfil, proveedorId: Number(proveedor), moneda, seleccion };
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
    return <section className="space-y-4" aria-label="Importar consumos"><h2 className="text-lg font-semibold">Importar consumos HALEL / SHELL</h2><p className="text-sm text-[var(--muted)]">Registra consumos independientes de los vales. No crea pagos ni documentos fiscales. Una factura ausente no impide guardar un consumo seguro.</p>
 <PasosImportacionCB2 paso={!file ? 1 : !preview ? 2 : !acepta ? 3 : 4}/><fieldset disabled={locked || loading} className="grid items-end gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 md:grid-cols-3"><CatalogoSearchSelect label="Proveedor de la empresa" placeholder="Buscar proveedor" value={proveedor} onChange={v => { setProveedor(v); invalidar(); }} options={cat.proveedores.map(p => ({ value: String(p.id), label: p.nombre }))} inputClassName={input}/><label>Perfil<select className={input} value={perfil} onChange={e => { setPerfil(e.target.value); invalidar(); }}><option>HALEL</option><option>SHELL</option></select></label><label>Moneda declarada<select className={input} value={moneda} onChange={e => { setMoneda(e.target.value); invalidar(); }}><option>GTQ</option><option>USD</option></select></label><label className="rounded-xl border border-dashed border-[var(--border)] p-4 md:col-span-3">Excel original .xlsx (máximo 50 MB)<input className={input} type="file" accept=".xlsx" onChange={e => {
            const f = e.target.files?.[0] ?? null;
            invalidar();
            if (f && (!f.name.toLowerCase().endsWith(".xlsx") || f.size <= 0 || f.size > 52428800)) {
                setFile(null);
                setError("Selecciona un Excel .xlsx de hasta 50 MB.");
            }
            else
                setFile(f);
        }}/></label><button type="button" className={primaryButton} disabled={!file || !proveedor} onClick={() => void analizar()}>{loading ? "Analizando…" : "Analizar Excel"}</button></fieldset>
 {error && <p role="alert" className="text-red-500">{error}</p>}{preview && <><p>{preview.nota}</p><CandidatosCB2 filas={preview.filas} cat={cat} seleccion={sel} onChange={v => { setSel(v); setAcepta(false); }} disabled={locked || loading}/><fieldset disabled={locked || loading} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><h3 className="font-semibold">Confirmar los consumos seleccionados</h3><ResumenSeleccionCB2 filas={preview.filas} cat={cat} seleccion={sel}/><p>{elecciones(sel).length} candidatos seleccionados. Las demás apariciones se conservarán como evidencia y podrán quedar pendientes.</p><label className="flex gap-2"><input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)}/>Confirmo el procesamiento parcial y la conservación de todas las apariciones.</label><button className={primaryButton} disabled={!acepta} onClick={() => void confirmar()}>Confirmar selección parcial</button></fieldset></>}
 </section>;
}
