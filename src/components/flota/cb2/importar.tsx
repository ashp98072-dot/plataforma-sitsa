"use client";
import { PasosImportacionCB2 } from "./presentacion";
import { AsignacionCB2, type DecisionAsignacion } from "./asignacion";
import { clasificarProducto } from "@/lib/flota/cb2/clasificacion";
import { seleccionarEmpleado } from "@/lib/flota/cb2/empleados-coincidencias";
import { useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { elecciones, formCB2, jsonCB2, type CatalogosCB2, type PreviewCB2 } from "./client";
import { input, primaryButton } from "./controles";
export { input, button, primaryButton } from "./controles";
import { CandidatosCB2, ResumenSeleccionCB2 } from "./preview-vista";
export { CandidatosCB2 } from "./preview-vista";
import { useRevisionCB2 } from "./use-revision";
const sinFilas: PreviewCB2["filas"] = [];
export type EjecutarCB2 = (accion: string, identidad: unknown, fn: (key: string) => Promise<unknown>) => Promise<unknown>;
export function ImportarCB2({ api, cat, run, locked }: {
    api: string;
    cat: CatalogosCB2;
    run: EjecutarCB2;
    locked: boolean;
}) {
    const [proveedor, setProveedor] = useState(""), [moneda, setMoneda] = useState("GTQ"), [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<PreviewCB2 | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [aceptacion, setAceptacion] = useState<string | null>(null);
    const [decisiones, setDecisiones] = useState<Record<string, DecisionAsignacion>>({});
    const revision = useRevisionCB2(preview?.filas ?? sinFilas, cat, decisiones);
    const pendientesProducto = revision.resumen.revision.filter(g => g.seleccionado && !decisiones[g.clave]?.productoClasificado && !clasificarProducto(g.fila.origen?.producto)).length;
    function seleccionActual() { const porClave = new Map(revision.resumen.revision.map(g => [g.clave,g.fila])); return elecciones(revision.resumen.segura).map(s => { const f = porClave.get(s.candidato)!; const d = decisiones[s.candidato] ?? {}; const empleado = seleccionarEmpleado(f.origen?.piloto ?? "", cat.empleados ?? [], d.empleadoId); return { ...s, ...empleado, productoClasificado: d.productoClasificado ?? clasificarProducto(f.origen?.producto) ?? undefined, ...(d.motivoUnidad?.trim() ? { motivoUnidad: d.motivoUnidad.trim() } : {}) }; }); }
    const firmaRevision = JSON.stringify([preview?.sha256, elecciones(revision.solicitudes), elecciones(revision.resumen.segura), revision.revisados, seleccionActual()]);
    const acepta = aceptacion === firmaRevision;
    function invalidar() { setPreview(null); revision.reset(); setDecisiones({}); setAceptacion(null); setError(""); }
    async function analizar() {
        if (!file || !proveedor || loading || locked)
            return;
        setLoading(true);
        setError("");
        setPreview(null); setAceptacion(null);
        try {
            const resultado = await jsonCB2<PreviewCB2>(`${api}/preview`, { method: "POST", body: formCB2(file, undefined, proveedor, moneda, []) });
            if (resultado.perfilDetectado !== "HALEL" && resultado.perfilDetectado !== "SHELL") throw new Error("El servidor no informó un formato reconocido. Vuelve a analizar el archivo con la versión actual de la aplicación.");
            setPreview(resultado);
            revision.reset(); setDecisiones(Object.fromEntries(resultado.filas.filter(f => f.candidato).map(f => [f.candidato!, { exigirProducto: true }]))); setAceptacion(null);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo analizar.");
        }
        finally {
            setLoading(false);
        }
    }
    async function confirmar() {
        if (!file || !preview?.perfilDetectado || !acepta || locked || loading || pendientesProducto > 0)
            return;
        const seguras = revision.resumen.segura;
        if (Object.keys(seguras).length !== Object.keys(revision.solicitudes).length) { setError("La selección contiene candidatos bloqueados o unidades no compatibles/disponibles. Revisa las asignaciones."); return; }
        const archivo = file, seleccion = seleccionActual(), identity = { sha256: preview.sha256, perfil: preview.perfilDetectado, proveedorId: Number(proveedor), moneda, seleccion };
        await run("confirmar", identity, async (key) => {
            const f = formCB2(archivo, identity.perfil, String(identity.proveedorId), identity.moneda, identity.seleccion);
            const recibo = await jsonCB2<PreviewCB2>(`${api}/preview`, { method: "POST", body: f });
            if (recibo.sha256 !== identity.sha256 || recibo.perfilDetectado !== identity.perfil)
                throw new Error("El archivo o su formato cambió; conserva el intento para revisión.");
            const body = formCB2(archivo, identity.perfil, String(identity.proveedorId), identity.moneda, identity.seleccion);
            body.set("token", recibo.token);
            body.set("clave", key);
            return jsonCB2(`${api}/confirmar`, { method: "POST", body });
        }).catch(() => { });
    }
    return <section className="space-y-4" aria-label="Importar consumos"><h2 className="text-lg font-semibold">Importar consumos HALEL / SHELL</h2><p className="text-sm text-[var(--muted)]">Registra consumos independientes de los vales. No crea pagos ni documentos fiscales. Una factura ausente no impide guardar un consumo seguro.</p>
 <p className="text-sm text-[var(--muted)]">El formato HALEL o SHELL se detecta automáticamente al analizar el archivo. El proveedor comercial se selecciona de forma independiente.</p><PasosImportacionCB2 paso={!file ? 1 : !preview ? 2 : !acepta ? 3 : 4}/><fieldset disabled={locked || loading} className="grid items-end gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 md:grid-cols-3"><CatalogoSearchSelect label="Proveedor de la empresa" placeholder="Buscar proveedor" value={proveedor} onChange={v => { setProveedor(v); invalidar(); }} options={cat.proveedores.map(p => ({ value: String(p.id), label: p.nombre }))} inputClassName={input}/><label>Moneda declarada<select className={input} value={moneda} onChange={e => { setMoneda(e.target.value); invalidar(); }}><option>GTQ</option><option>USD</option></select></label><label className="rounded-xl border border-dashed border-[var(--border)] p-4 md:col-span-3">Excel original .xlsx (máximo 50 MB)<input className={input} type="file" accept=".xlsx" onChange={e => {
            const f = e.target.files?.[0] ?? null;
            invalidar();
            if (f && (!f.name.toLowerCase().endsWith(".xlsx") || f.size <= 0 || f.size > 52428800)) {
                setFile(null);
                setError("Selecciona un Excel .xlsx de hasta 50 MB.");
            }
            else
                setFile(f);
        }}/></label><button type="button" className={primaryButton} disabled={!file || !proveedor} onClick={() => void analizar()}>{loading ? "Analizando…" : "Analizar Excel"}</button></fieldset>
 {error && <p role="alert" className="text-red-500">{error}</p>}{preview && <><p role="status">Formato detectado: {preview.perfilDetectado}</p><p>{preview.nota}</p><CandidatosCB2 key={preview.sha256} filas={preview.filas} cat={cat} seleccion={revision.asignaciones} manuales={revision.manuales} omitidos={revision.omitidos} revisados={revision.revisados} onRevisar={(key, value) => { revision.revisar(key, value); setAceptacion(null); }} onAsignar={(key, value) => { revision.asignar(key, value); setAceptacion(null); }} onSeleccionar={(key, value) => { revision.seleccionar(key, value); setAceptacion(null); }} decisiones={decisiones} revisionExtra={g => g.estado !== "RESUELTO" && <fieldset disabled={locked || loading || g.estado === "BLOQUEADO"}><AsignacionCB2 fila={g.fila} cat={cat} value={decisiones[g.clave] ?? {}} disabled={locked || loading} onChange={v => { setDecisiones(prev => ({ ...prev, [g.clave]: v })); setAceptacion(null); }}/></fieldset>} disabled={locked || loading}/><fieldset disabled={locked || loading} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><h3 className="font-semibold">Confirmar los consumos seleccionados</h3><ResumenSeleccionCB2 filas={preview.filas} cat={cat} seleccion={revision.asignaciones} omitidos={revision.omitidos} revisados={revision.revisados} decisiones={decisiones}/>{pendientesProducto > 0 && <p role="alert">{pendientesProducto} seleccionados requieren clasificar el combustible, incluso NO DETERMINADO. No se pueden confirmar.</p>}<p>{revision.resumen.seleccionados} candidatos seleccionados. Las demás apariciones se conservarán como evidencia y podrán quedar pendientes.</p><label className="flex gap-2"><input type="checkbox" checked={acepta} onChange={e => setAceptacion(e.target.checked ? firmaRevision : null)}/>Confirmo el procesamiento parcial y la conservación de todas las apariciones.</label><button className={primaryButton} disabled={!acepta || pendientesProducto > 0 || Object.keys(revision.solicitudes).length !== revision.resumen.seleccionados} onClick={() => void confirmar()}>Confirmar selección parcial</button></fieldset></>}
 </section>;
}
