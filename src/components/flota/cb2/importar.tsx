"use client";
import { seleccionShell } from "./seleccion-shell";
import { politicaIndependiente, seleccionPilotoIndependiente } from "./piloto-independiente";
import { pilotoDirecto } from "./identidad-directa";

import { claveNombreShell } from "./revision-nombres";
import { normalizarNombreReportado,type DecisionNombre } from "@/lib/flota/cb2/pilotos-nombres";
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
import { UnidadesPendientesCB2 } from "./unidades-pendientes";
import { UnidadShellVale } from "./unidad-shell-vale";
import { clavesListas, resumenPrevio } from "./resumen-previo";
import { ResumenPrevioCB2 } from "./resumen-previo-vista";
const sinFilas: PreviewCB2["filas"] = [];
export type EjecutarCB2 = (accion: string, identidad: unknown, fn: (key: string) => Promise<unknown>) => Promise<unknown>;
export function ImportarCB2({ api, cat, run, locked, actualizarCatalogos }: {
    api: string;
    cat: CatalogosCB2;
    run: EjecutarCB2;
    locked: boolean;
    actualizarCatalogos?: () => Promise<CatalogosCB2>;
}) {
    const [proveedor, setProveedor] = useState(""), [moneda, setMoneda] = useState("GTQ"), [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<PreviewCB2 | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [aceptacion, setAceptacion] = useState<string | null>(null);
    const [decisiones, setDecisiones] = useState<Record<string, DecisionAsignacion>>({});
    const [correccion, setCorreccion] = useState<{ clave: string; intento: number }>();
    const revision = useRevisionCB2(preview?.filas ?? sinFilas, cat, decisiones, setDecisiones);
    const pendientesProducto = revision.resumen.revision.filter(g => g.seleccionado && !decisiones[g.clave]?.productoClasificado && !clasificarProducto(g.fila.origen?.producto)).length;
    const entradaResumen = { filas: preview?.filas ?? sinFilas, cat, segura: revision.resumen.segura, omitidos: revision.omitidos, decisiones };
    const listas = clavesListas(entradaResumen), resumenFilas = resumenPrevio(entradaResumen);
    function elegirNombre(clave:string,d:DecisionNombre) {
        setDecisiones(prev=>{const siguientes={...prev};for(const f of preview?.filas??[])if(f.candidato && normalizarNombreReportado(f.origen?.piloto??"")===clave)siguientes[f.candidato]={...prev[f.candidato],decisionNombre:d,pilotoTipo:d.tipo==="EMPLEADO"?"INTERNO":"REPORTADO",empleadoId:d.tipo==="EMPLEADO"?d.empleadoId:null,pilotoExternoId:null,asociacionExternaId:null};return siguientes;});setAceptacion(null);
    }
    function seleccionActual() { const porClave = new Map(revision.resumen.revision.map(g => [g.clave,g.fila])); return elecciones(Object.fromEntries(Object.entries(revision.resumen.segura).filter(([k]) => listas.has(k)))).map(s => { const f = porClave.get(s.candidato)!; const d = decisiones[s.candidato] ?? {}; const empleado = seleccionarEmpleado(f.origen?.piloto ?? "", cat.empleados ?? [], d.empleadoId); const externo = preview?.perfilDetectado==="SHELL" ? {} : politicaIndependiente(cat) ? seleccionPilotoIndependiente(f,cat,d,s.vehiculoId) : s.vehiculoId < 0 ? { empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" as const, ...(cat.tercerosDirectos ? { pilotoExternoId: pilotoDirecto(f, cat, d)?.id } : { asociacionExternaId: d.asociacionExternaId ?? f.asociacionExterna?.id }) } : empleado; const identidadShell=preview?.perfilDetectado==="SHELL"?seleccionShell(f,cat,d,s.vehiculoId):externo; return { ...s, ...identidadShell, ...(d.recordarPlaca && s.vehiculoId > 0 ? { recordarPlaca: true } : {}), ...(d.usarEquivalenciaPlaca ? { usarEquivalenciaPlaca: true } : {}), ...(preview?.perfilDetectado!=="SHELL" && d.decisionNombre?.tipo==="REPORTADO" ? { empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" as const, decisionNombre: d.decisionNombre } : preview?.perfilDetectado!=="SHELL" && s.vehiculoId>0 && d.decisionNombre?.tipo==="EMPLEADO" && d.decisionNombre.origen==="EQUIVALENCIA" ? { empleadoId: d.decisionNombre.empleadoId, metodoEmpleado: "MANUAL" as const, decisionNombre: d.decisionNombre } : {}), productoClasificado: d.productoClasificado ?? clasificarProducto(f.origen?.producto) ?? undefined, ...(d.motivoUnidad?.trim() ? { motivoUnidad: d.motivoUnidad.trim() } : {}) }; }); }
    const firmaRevision = JSON.stringify([preview?.sha256, elecciones(revision.solicitudes), elecciones(revision.resumen.segura), revision.revisados, seleccionActual()]);
    const acepta = aceptacion === firmaRevision;
    function invalidar() { setCorreccion(undefined); setPreview(null); revision.reset(); setDecisiones({}); setAceptacion(null); setError(""); }
    async function analizar() {
        if (!file || !proveedor || loading || locked)
            return;
        setLoading(true);
        setError("");
        setPreview(null); setAceptacion(null);
        try {
            await actualizarCatalogos?.();
            const resultado = await jsonCB2<PreviewCB2>(`${api}/preview`, { method: "POST", body: formCB2(file, undefined, proveedor, moneda, []) });
            if (resultado.perfilDetectado !== "HALEL" && resultado.perfilDetectado !== "SHELL") throw new Error("El servidor no informó un formato reconocido. Vuelve a analizar el archivo con la versión actual de la aplicación.");
            setPreview(resultado);
            revision.reset(); setDecisiones(Object.fromEntries(resultado.filas.filter(f=>f.candidato).map(f=>{const n=resultado.nombres?.find(n=>n.clave===normalizarNombreReportado(f.origen?.piloto??"")),d=n?.propuesta;return [f.candidato!,{exigirProducto:true,...(resultado.perfilDetectado==="SHELL"?{exigirPiloto:true,pilotoTipo:d?.tipo==="EMPLEADO"?"INTERNO":"REPORTADO",empleadoId:d?.tipo==="EMPLEADO"?d.empleadoId:null,pilotoExternoId:null,...(d?{decisionNombre:d}:{})}:d?.tipo==="REPORTADO"?{pilotoTipo:"REPORTADO" as const,empleadoId:null,pilotoExternoId:null,decisionNombre:d}:d?.tipo==="EMPLEADO" && d.origen==="EQUIVALENCIA"?{empleadoId:d.empleadoId,decisionNombre:d}:{})}];}))); setAceptacion(null);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo analizar.");
        }
        finally {
            setLoading(false);
        }
    }
    async function confirmar() {
        if (!file || !preview?.perfilDetectado || !acepta || locked || loading || listas.size === 0)
            return;
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
 <p className="text-sm text-[var(--muted)]">El formato HALEL o SHELL se detecta automáticamente al analizar el archivo. El proveedor comercial se selecciona de forma independiente.</p><p className="text-sm text-[var(--muted)]">Flujo: Importar → Vista previa → Guardar. Después consulta los vales guardados en la pestaña «Consumos» (filtros por placa, piloto, fecha, combustible y vínculo de la unidad). Una placa ambigua o sin unidad en Flota se guarda con la placa del Excel, sin vincular y sin crear vehículos.</p><p role="note">{cat.pilotosReportados ? "Primero se revisan empleados y equivalencias confirmadas. Un piloto reportado nuevo requiere tu confirmación; no crea empleados ni contratos." : "Registro persistente de nombres no instalado: el nombre original se conserva en cada consumo; no se crearán empleados ni terceros."}</p><PasosImportacionCB2 paso={!file ? 1 : !preview ? 2 : !acepta ? 3 : 4}/><fieldset disabled={locked || loading} className="grid items-end gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 md:grid-cols-3"><CatalogoSearchSelect label="Proveedor de la empresa" placeholder="Buscar proveedor" value={proveedor} onChange={v => { setProveedor(v); invalidar(); }} options={cat.proveedores.map(p => ({ value: String(p.id), label: p.nombre }))} inputClassName={input}/><label>Moneda declarada<select className={input} value={moneda} onChange={e => { setMoneda(e.target.value); invalidar(); }}><option>GTQ</option><option>USD</option></select></label><label className="rounded-xl border border-dashed border-[var(--border)] p-4 md:col-span-3">Excel original .xlsx (máximo 50 MB)<input className={input} type="file" accept=".xlsx" onChange={e => {
            const f = e.target.files?.[0] ?? null;
            invalidar();
            if (f && (!f.name.toLowerCase().endsWith(".xlsx") || f.size <= 0 || f.size > 52428800)) {
                setFile(null);
                setError("Selecciona un Excel .xlsx de hasta 50 MB.");
            }
            else
                setFile(f);
        }}/></label><button type="button" className={primaryButton} disabled={!file || !proveedor} onClick={() => void analizar()}>{loading ? "Analizando…" : "Analizar Excel"}</button></fieldset>
 {error && <p role="alert" className="text-red-500">{error}</p>}{preview && <><p role="status">Formato detectado: {preview.perfilDetectado}</p><p>{preview.nota}</p><CandidatosCB2 corregir={correccion} key={preview.sha256} filas={preview.filas} cat={cat} seleccion={revision.asignaciones} manuales={revision.manuales} omitidos={revision.omitidos} revisados={revision.revisados} onRevisar={(key, value) => { revision.revisar(key, value); setAceptacion(null); }} onAsignar={(key, value) => { revision.asignar(key, value); setAceptacion(null); }} onAceptarEquivalencia={(key, value) => { revision.asignar(key, value); setDecisiones(prev => ({ ...prev, [key]: { ...prev[key], usarEquivalenciaPlaca: true } })); setAceptacion(null); }} onAsignarVarias={(keys, value) => { revision.asignarVarias(keys, value); setAceptacion(null); }} onSeleccionar={(key, value) => { revision.seleccionar(key, value); setAceptacion(null); }} decisiones={decisiones} unidadExterna={g => g.estado !== "RESUELTO" && <UnidadShellVale parte="casilla" fila={g.fila} cat={cat} vehiculoId={g.vehiculoId} api={api} recargar={actualizarCatalogos} onUnidad={v => { revision.asignar(g.clave, v); setAceptacion(null); }} disabled={locked || loading}/>} revisionExtra={g => g.estado !== "RESUELTO" && <fieldset disabled={locked || loading || g.estado === "BLOQUEADO"}><AsignacionCB2 api={api} actualizarCatalogos={actualizarCatalogos} fila={g.fila} cat={cat} value={decisiones[g.clave] ?? {}} disabled={locked || loading} vehiculoId={g.vehiculoId} onUnidad={v => { revision.asignar(g.clave, v); setAceptacion(null); }} nombre={preview.nombres?.find(n => n.clave === claveNombreShell(g.fila.origen?.piloto))} onNombre={d => elegirNombre(claveNombreShell(g.fila.origen?.piloto), d)} onChange={v => { revision.cambiarDecision(g.clave, v); setAceptacion(null); }}/></fieldset>} disabled={locked || loading}/><fieldset disabled={locked || loading} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><h3 className="font-semibold">Confirmar los consumos seleccionados</h3><ResumenSeleccionCB2 onCorregir={clave => setCorreccion(prev => ({ clave, intento: (prev?.intento ?? 0) + 1 }))} filas={preview.filas} cat={cat} seleccion={revision.asignaciones} omitidos={revision.omitidos} revisados={revision.revisados} decisiones={decisiones}/><ResumenPrevioCB2 r={resumenFilas}/>{cat.tercerosDirectos && actualizarCatalogos && <UnidadesPendientesCB2 api={api} filas={preview.filas} cat={cat} recargar={actualizarCatalogos} disabled={locked || loading}/>}{pendientesProducto > 0 && <p role="status">{pendientesProducto} seleccionados sin clasificar el combustible (incluso NO DETERMINADO): quedan pendientes y no se importan ahora.</p>}<p>{listas.size} candidatos se importarán ahora. Las demás apariciones se conservarán como evidencia y quedan pendientes.</p><label className="flex gap-2"><input type="checkbox" checked={acepta} onChange={e => setAceptacion(e.target.checked ? firmaRevision : null)}/>Confirmo el procesamiento parcial y la conservación de todas las apariciones.</label><button className={primaryButton} disabled={!acepta || listas.size === 0} onClick={() => void confirmar()}>Confirmar selección parcial</button></fieldset></>}
 </section>;
}
