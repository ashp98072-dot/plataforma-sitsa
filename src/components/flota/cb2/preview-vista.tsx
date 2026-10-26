"use client";
import { opcionesVehiculo } from "@/lib/flota/combustible-estaciones-ui";
import { Fragment, type ReactNode, useId, useMemo, useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import type { CatalogosCB2, FilaCB2 } from "./client";
import { avisosDetallados, estadosPreview, resumirRevision, sugerenciaVehiculo, sugerenciaPiloto, type CandidatoRevision } from "./preview-model";
import { clasificarProducto, identificarEmpleado, etiquetasProducto } from "@/lib/flota/cb2/clasificacion";
import { placaCompatible } from "@/lib/flota/combustible-coincidencias";
import type { DecisionAsignacion } from "./asignacion";
import { button, input } from "./controles";
import { EstadoCB2 } from "./presentacion";
import styles from "./panel.module.css";

type Mapa = Record<string, string>;
type Marcas = Record<string, boolean>;
const vacio: Marcas = {};
type Props = { filas: FilaCB2[]; cat: CatalogosCB2; seleccion: Mapa; omitidos?: Marcas; revisados?: Marcas; decisiones?: Record<string, DecisionAsignacion> };
const importes = (totales: Mapa) => Object.entries(totales).map(([moneda, n]) => `${moneda} ${n}`).join(" · ") || "Sin importe calculable";

function Paginas({ pagina, total, cambiar, anterior, siguiente }: { pagina: number; total: number; cambiar: (p: number) => void; anterior: string; siguiente: string }) {
    return <div className="flex flex-wrap items-center gap-3"><button type="button" className={button} disabled={!pagina} onClick={() => cambiar(pagina - 1)}>{anterior}</button><span>Página {pagina + 1} de {Math.max(1, Math.ceil(total / 25))}</span><button type="button" className={button} disabled={(pagina + 1) * 25 >= total} onClick={() => cambiar(pagina + 1)}>{siguiente}</button></div>;
}
export function ResumenSeleccionCB2({ filas, cat, seleccion, omitidos = vacio, revisados = vacio, decisiones = {} }: Props) {
    const [pagina, setPagina] = useState(0);
    const r = resumirRevision(filas, cat, seleccion, omitidos, revisados, decisiones), grupos = r.revision.filter(g => g.seleccionado);
    function productoResumen(g: CandidatoRevision) { const p = decisiones[g.clave]?.productoClasificado ?? clasificarProducto(g.fila.origen?.producto); return p ? etiquetasProducto[p] : "CLASIFICACION PENDIENTE"; }
    const invalidas = Object.entries(seleccion).filter(([k, v]) => v && !omitidos[k] && !r.segura[k]).length;
    const page = Math.min(pagina, Math.max(0, Math.ceil(grupos.length / 25) - 1));
    return <aside className="space-y-2" aria-label="Resumen antes de confirmar">
        <p><strong>{r.seleccionados} consumos seleccionados para confirmar</strong> · {grupos.filter(g => g.conAdvertencias).length} con advertencias · {grupos.filter(g => g.advertenciasPendientes).length} pendientes de revisión.</p>
        <p>Importe de esta selección: <strong>{importes(r.totalesSeleccionados)}</strong>. Cada candidato cuenta una vez.</p>
        {r.pendientes > 0 && <p role="status">{r.pendientes} candidatos con asignacion o clasificacion pendiente. Quedan pendientes y no se procesan.</p>}
        {r.bloqueados > 0 && <p>{r.bloqueados} candidatos bloqueados quedan excluidos de la confirmación.</p>}
        {invalidas > 0 && <p role="alert">{invalidas} asignaciones incompatibles o bloqueadas. Corrígelas o exclúyelas antes de confirmar.</p>}
        <details><summary>Revisar unidades y advertencias de la selección ({grupos.length})</summary>
            <ul className="space-y-2">{grupos.slice(page * 25, page * 25 + 25).map(g => <li key={g.clave} className="rounded-lg border border-[var(--border)] p-3">Vale {g.fila.vale} → <strong>{cat.vehiculos.find(v => String(v.id) === g.vehiculoId)?.placa}</strong> · {g.apariciones.length} apariciones
                <p>Empleado: {cat.empleados?.find(e => e.id === (decisiones[g.clave]?.empleadoId === undefined ? identificarEmpleado(g.fila.origen?.piloto ?? "", cat.empleados ?? []).propuesta?.id : decisiones[g.clave]?.empleadoId))?.nombre ?? "Sin vinculo"} / Combustible: {productoResumen(g)}</p>{decisiones[g.clave]?.motivoUnidad && <p>Justificacion de unidad: {decisiones[g.clave].motivoUnidad}</p>}<ul>{[...new Set(g.activas.flatMap(f => avisosDetallados(f).map(a => `${a.nivel}: ${a.mensaje}`)))].map(a => <li key={a}>{a}</li>)}</ul>
            </li>)}</ul>
            <Paginas pagina={page} total={grupos.length} cambiar={setPagina} anterior="Resumen anterior" siguiente="Resumen siguiente"/>
        </details>
    </aside>;
}

function identificacion(g: CandidatoRevision, cat: CatalogosCB2, manuales: Mapa) {
    if (Object.hasOwn(manuales, g.clave)) return g.vehiculoId ? "MANUAL" : "PENDIENTE";
    if (g.vehiculoId) return "AUTOMATICA";
    const match = sugerenciaVehiculo(g.fila, cat);
    return match.estado === "AMBIGUA" ? "AMBIGUA" : match.estado === "INEXISTENTE" ? "INEXISTENTE" : "PENDIENTE";
}
export function CandidatosCB2({ filas, cat, seleccion, omitidos = vacio, revisados, manuales = seleccion, onChange, onAsignar, onSeleccionar, onRevisar, revisionExtra, decisiones = {}, disabled = false }: Props & {
    revisionExtra?: (g: CandidatoRevision) => ReactNode; manuales?: Mapa; onChange?: (v: Mapa) => void; onAsignar?: (clave: string, unidad: string) => void; onSeleccionar?: (clave: string, valor: boolean) => void; onRevisar?: (clave: string, valor: boolean) => void; disabled?: boolean;
}) {
    const panelId = useId();
    const [abiertos, setAbiertos] = useState<Marcas>({}), [vista, setVista] = useState("");
    const [pagina, setPagina] = useState(0), [ignoradasPagina, setIgnoradasPagina] = useState(0);
    const [bloqueadasPagina, setBloqueadasPagina] = useState(0);
    const [filtro, setFiltro] = useState(""), [estado, setEstado] = useState(""), [placa, setPlaca] = useState(""), [vale, setVale] = useState(""), [lote, setLote] = useState("");
    const [avisos, setAvisos] = useState(""), [seleccionFiltro, setSeleccionFiltro] = useState(""), [unidadFiltro, setUnidadFiltro] = useState(""), [intervencion, setIntervencion] = useState(false);
    const [revisadosLocales, setRevisadosLocales] = useState<Marcas>({}), [pilotosPendientes, setPilotosPendientes] = useState<Mapa>({}), [pilotosRevisados, setPilotosRevisados] = useState<Mapa>({});
    const marcas = revisados ?? revisadosLocales;
    const r = useMemo(() => resumirRevision(filas, cat, seleccion, omitidos, marcas, decisiones), [filas, cat, seleccion, omitidos, marcas, decisiones]);
    function texto(f: FilaCB2) {
        return f.placa.toLowerCase().includes(placa.toLowerCase()) && f.vale.toLowerCase().includes(vale.toLowerCase()) && (f.lote ?? "").toLowerCase().includes(lote.toLowerCase()) && `${f.vale} ${f.placa} ${f.hoja} ${f.lote ?? ""} ${f.origen?.piloto ?? ""}`.toLowerCase().includes(filtro.toLowerCase());
    }
    const rows = r.revision.filter(g => (!vista || (vista === "EXCLUIDOS" ? !!omitidos[g.clave] : vista === "SELECCIONADOS" ? g.seleccionado : vista === "AVISOS" ? g.conAdvertencias : g.estado === vista)) && (!estado || g.estado === estado) && g.apariciones.some(texto)
        && (!avisos || (avisos === "CON" ? g.conAdvertencias : avisos === "PENDIENTES" ? g.advertenciasPendientes : avisos === "REVISADAS" ? g.conAdvertencias && !g.advertenciasPendientes : !g.conAdvertencias))
        && (!seleccionFiltro || (seleccionFiltro === "SI" ? g.seleccionado : !g.seleccionado))
        && (!unidadFiltro || identificacion(g, cat, manuales) === unidadFiltro)
        && (!intervencion || ["PENDIENTE", "BLOQUEADO"].includes(g.estado) || g.advertenciasPendientes))
        .sort((a, b) => a.fila.hoja.localeCompare(b.fila.hoja) || a.fila.fila - b.fila.fila);
    const ignoradas = filas.filter(f => f.estado === "IGNORADA" && texto(f) && (!estado || estado === "IGNORADO") && !seleccionFiltro && !avisos && !unidadFiltro && !intervencion && !vista);
    const sinIdentidad = filas.filter(f => !f.candidato && f.estado !== "IGNORADA" && texto(f) && (!estado || estado === "BLOQUEADO"));
    const page = Math.min(pagina, Math.max(0, Math.ceil(rows.length / 25) - 1)), ignoredPage = Math.min(ignoradasPagina, Math.max(0, Math.ceil(ignoradas.length / 25) - 1));
    const blockedPage = Math.min(bloqueadasPagina, Math.max(0, Math.ceil(sinIdentidad.length / 25) - 1));
    function filtrar(fn: () => void) { fn(); setPagina(0); setIgnoradasPagina(0); setBloqueadasPagina(0); }
    function asignar(key: string, value: string) { if (onAsignar) onAsignar(key, value); else onChange?.({ ...seleccion, [key]: value }); }
    function elegir(g: CandidatoRevision, valor: boolean) { if (onSeleccionar) onSeleccionar(g.clave, valor); else onChange?.({ ...seleccion, [g.clave]: valor ? g.vehiculoId : "" }); }
    function revisar(key: string, valor: boolean) { if (onRevisar) onRevisar(key, valor); else setRevisadosLocales(prev => ({ ...prev, [key]: valor })); }

    function evidencia(f: FilaCB2) {
        return <><ul className="space-y-2">{avisosDetallados(f).map((a, i) => <li key={i}><strong>{a.nivel === "REVISION" ? "REQUIERE REVISIÓN" : a.nivel}</strong>: {a.mensaje}</li>)}</ul><p className="text-xs">Producto original: {f.origen?.producto || "No informado"} · Kilometraje: {f.origen?.km || "No informado"}<br/>Galones: {f.origen?.galones ?? f.galones ?? "No informado"} · Precio: {f.origen?.precio ?? f.precio ?? "No informado"} · Monto: {f.origen?.monto ?? f.monto ?? "No informado"}<br/>Serie: {f.origen?.serie || f.documento?.serie || "No informada"} · Factura: {f.origen?.factura || f.documento?.numero || "No informada"}</p></>;
    }
    return <section className="space-y-3" aria-label="Vista previa y validaciones">
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7" aria-label="Resumen global de candidatos">{[["Total de candidatos", r.detectados], ["Seleccionados", r.seleccionados], ["Elegibles · LISTO", r.elegibles], ["Con advertencias", r.advertencias], ["Bloqueados", r.bloqueados], ["Pendientes de asignacion", r.pendientes], ["Excluidos", r.revision.filter(g => omitidos[g.clave]).length]].map(([label, n]) => <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="text-xl font-semibold">{n}</dd></div>)}</dl>
        <p className="text-xs"><strong>LISTO</strong> = consumo no bloqueado con unidad compatible y clasificacion requerida completa; puede tener advertencias y estar desmarcado. Seleccionado = LISTO marcado para esta confirmación. {r.advertenciasPendientes} candidatos con advertencias pendientes de revisión; {r.resueltos} ya resueltos. Los indicadores pueden solaparse.</p>
        <details><summary>Cómo se conserva la evidencia y se revisan pilotos</summary><p className="text-xs">{filas.length} apariciones. Los contadores, filtros y selección cuentan cada candidato una vez. Buscar por hoja o lote localiza un candidato por cualquiera de sus apariciones; la confirmación conserva todas.</p><p role="note" className="text-xs">{cat.limitacionPilotos || (revisionExtra ? "El nombre original se conserva y el vinculo usa empleados activos de esta empresa. La autopropuesta requiere dos tokens completos y un empleado activo único; la ambigüedad exige elección manual." : "CB2 conserva el piloto leído del Excel sin vínculo al catálogo de pilotos. Las sugerencias son informativas y no se persisten. Una aproximada o ambigua requiere confirmación explícita de su revisión; no identifica ni asocia al piloto.")}</p></details>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-pressed={intervencion} onClick={() => filtrar(() => setIntervencion(v => !v))}>Requieren intervención</button><button type="button" className={button} onClick={() => filtrar(() => { setEstado(""); setAvisos(""); setSeleccionFiltro(""); setUnidadFiltro(""); setFiltro(""); setPlaca(""); setVale(""); setLote(""); setIntervencion(false); setVista(""); })}>Limpiar filtros</button></div>
        <div className={styles.quickFilters} role="group" aria-label="Vistas de revisión">{[["", "Todos"], ["LISTO", "Listos"], ["PENDIENTE", "Pendientes"], ["AVISOS", "Con advertencias"], ["SELECCIONADOS", "Seleccionados"], ["EXCLUIDOS", "Excluidos"]].map(([value, label]) => <button key={value} type="button" className={button} aria-pressed={vista === value} onClick={() => filtrar(() => setVista(value))}>{label}</button>)}</div>
            <label>Buscar en la vista previa<input className={input} value={filtro} onChange={e => filtrar(() => setFiltro(e.target.value))}/></label>
        <details><summary className="cursor-pointer py-2 text-sm font-medium">Filtros avanzados</summary><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label>Estado de vista previa<select className={input} value={estado} onChange={e => filtrar(() => setEstado(e.target.value))}><option value="">Todos</option>{estadosPreview.map(s => <option key={s}>{s}</option>)}</select></label>
            <label>Advertencias<select className={input} value={avisos} onChange={e => filtrar(() => setAvisos(e.target.value))}><option value="">Todas</option><option value="CON">Con advertencias</option><option value="PENDIENTES">Pendientes de revisión</option><option value="REVISADAS">Revisadas</option><option value="SIN">Sin advertencias</option></select></label>
            <label>Selección para confirmar<select className={input} value={seleccionFiltro} onChange={e => filtrar(() => setSeleccionFiltro(e.target.value))}><option value="">Todas</option><option value="SI">Seleccionados</option><option value="NO">No seleccionados</option></select></label>
            <label>Identificación de unidad<select className={input} value={unidadFiltro} onChange={e => filtrar(() => setUnidadFiltro(e.target.value))}><option value="">Todas</option><option value="AUTOMATICA">Automática</option><option value="MANUAL">Manual</option><option value="AMBIGUA">Ambigua</option><option value="INEXISTENTE">No encontrada</option><option value="PENDIENTE">Requiere revisión</option></select></label>
            {[["Placa", placa, setPlaca], ["Vale", vale, setVale], ["Lote", lote, setLote]].map(([label, value, setter]) => <label key={String(label)}>{String(label)}<input className={input} value={String(value)} onChange={e => filtrar(() => (setter as (v: string) => void)(e.target.value))}/></label>)}
        </div></details>
        <p role="status">{rows.length} candidatos filtrados de {r.detectados} · {r.seleccionados} seleccionados en todo el archivo.</p>
        <div className={styles.reviewScroll} role="region" aria-label="Tabla de revisión de consumos" tabIndex={0}><table className={styles.consumptionTable}><caption className="sr-only">Candidatos únicos del Excel, identificación y revisión</caption><thead><tr>{["Selección", "Vale", "Fecha", "Placa / unidad", "Piloto original", "Empleado identificado", "Combustible", "Galones", "Monto", "Estado", "Acciones"].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{rows.slice(page * 25, page * 25 + 25).map(g => {
            const f = g.fila, unidad = sugerenciaVehiculo(f, cat), piloto = revisionExtra ? identificarEmpleado(f.origen?.piloto ?? "", cat.empleados ?? []) : sugerenciaPiloto(f, cat), vehiculo = cat.vehiculos.find(v => String(v.id) === g.vehiculoId);
            const fuente = identificacion(g, cat, manuales);
            const avisosGrupo = [...new Set(g.activas.flatMap(f => avisosDetallados(f).map(a => `${a.nivel}: ${a.mensaje}`)))];
            const pilotoRevisado = piloto.candidatos.find(p => String(p.id) === pilotosRevisados[g.clave]);
            const decision = decisiones[g.clave] ?? {};
            const empleadoId = decision.empleadoId === undefined ? identificarEmpleado(f.origen?.piloto ?? "", cat.empleados ?? []).propuesta?.id : decision.empleadoId;
            const empleado = cat.empleados?.find(e => e.id === empleadoId);
            const producto = decision.productoClasificado ?? clasificarProducto(f.origen?.producto);
            const pendiente = revisionExtra && !producto ? "Falta clasificar combustible." : !g.vehiculoId || !vehiculo ? "Selecciona una unidad válida." : decision.empleadoId != null && !empleado ? "El empleado elegido no está disponible; revisa el catálogo." : "Revisa la compatibilidad de la unidad y su justificación.";
            const abierto = !!abiertos[g.clave], detalleId = `${panelId}-${g.clave}`;
            return <Fragment key={g.clave}><tr data-candidato={g.clave} data-excluded={!!omitidos[g.clave]} className={styles.consumptionRow}>
                <td><input type="checkbox" aria-label={`Seleccionar consumo vale ${f.vale}`} checked={g.seleccionado} disabled={disabled || !g.unidadValida} onChange={e => elegir(g, e.target.checked)}/></td>
                <td><strong>{f.vale || "Sin vale"}</strong><small>{f.hoja}:{f.fila}{g.apariciones.length > 1 ? ` · ${g.apariciones.length} apariciones` : ""}</small></td>
                <td className={styles.numeric}>{f.fecha || "Sin fecha"}</td>
                <td><strong>{vehiculo?.placa || "Sin unidad"}</strong><small>Excel: {f.placa || "Sin placa"}</small><small>{fuente === "MANUAL" ? "Elección manual" : fuente === "AUTOMATICA" ? "Automática" : "Unidad pendiente"}</small></td>
                <td className={styles.originalText}>{f.origen?.piloto || "No informado"}</td>
                <td>{empleado?.nombre ?? (empleadoId ? "Empleado no disponible" : "Sin vínculo")}<small>{decision.empleadoId !== undefined ? decision.empleadoId === null ? "Borrado manual" : "Elección manual" : empleado ? piloto.estado === "EXACTA" ? "Autopropuesta exacta única" : "Autopropuesta única por tokens completos" : piloto.estado === "AMBIGUA" ? "Ambigua · selección manual" : "Piloto pendiente"}</small></td>
                <td>{producto ? etiquetasProducto[producto] : "Falta clasificar combustible"}<small>Excel: {f.origen?.producto || "No informado"}</small></td>
                <td className={styles.numeric}>{f.galones ?? "—"}</td>
                <td className={styles.numeric}><strong>{f.monto ?? "—"}</strong><small>{f.moneda}</small></td>
                <td><EstadoCB2 estado={omitidos[g.clave] ? "EXCLUIDO" : g.estado}/><small>{g.conAdvertencias ? `${avisosGrupo.length} avisos · ${g.advertenciasPendientes ? "por revisar" : "revisados"}` : "Sin advertencias"}</small></td>
                <td><button id={`${detalleId}-toggle`} type="button" className={button} aria-label={`${abierto ? "Cerrar" : "Editar"} consumo vale ${f.vale}`} aria-expanded={abierto} aria-controls={detalleId} onClick={() => setAbiertos(prev => ({ ...prev, [g.clave]: !prev[g.clave] }))}>{abierto ? "Cerrar" : "Editar"}</button></td>
            </tr><tr id={detalleId} hidden={!abierto} className={styles.detailRow} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setAbiertos(prev => ({ ...prev, [g.clave]: false })); document.getElementById(`${detalleId}-toggle`)?.focus(); } }}><td colSpan={11}><div className={styles.editGrid}>
                <section aria-label={`Unidad y placa del vale ${f.vale}`}><h3>Unidad y placa</h3><strong>{vehiculo?.placa || (g.vehiculoId ? `Unidad #${g.vehiculoId} no disponible` : "Sin unidad")}</strong><p className="text-xs">{fuente === "AUTOMATICA" ? "Identificada automáticamente" : fuente === "MANUAL" ? "Elegida manualmente" : fuente === "AMBIGUA" ? "Resolver ambigüedad" : fuente === "INEXISTENTE" ? "Vehículo no encontrado" : "Unidad pendiente"} · {unidad.estado}</p>
                    {g.estado !== "BLOQUEADO" && g.estado !== "RESUELTO" && <fieldset disabled={disabled}>
                        {unidad.candidatos.length === 1 && <p className="text-xs">Unidad sugerida: {unidad.candidatos[0].placa}</p>}
                        <CatalogoSearchSelect label={`Unidad para vale ${f.vale}, ${f.hoja}:${f.fila}`} placeholder="Buscar placa o unidad" value={g.vehiculoId} onChange={value => asignar(g.clave, value)} options={opcionesVehiculo(cat.vehiculos)} inputClassName={input}/>
                        {unidad.candidatos.length === 1 && ["EXACTA", "ABREVIADA"].includes(unidad.estado) && !g.vehiculoId && <button type="button" className={button} onClick={() => asignar(g.clave, String(unidad.candidatos[0].id))}>Usar sugerencia para vale {f.vale}</button>}
                    </fieldset>}
                    {g.vehiculoId && !g.unidadValida && g.estado !== "RESUELTO" && !omitidos[g.clave] && <button type="button" className={button} disabled={disabled} onClick={() => elegir(g, false)}>Excluir vale {f.vale} de esta confirmación</button>}
                    {g.unidadValida && decisiones[g.clave]?.motivoUnidad && !placaCompatible(f.placaNormalizada || f.placa, Number(g.vehiculoId), cat.vehiculos) && <p className="text-xs">Excepción manual justificada: {decisiones[g.clave].motivoUnidad}. La placa original se conserva.</p>}
                </section>
                {revisionExtra && <section aria-label={`Empleado y combustible del vale ${f.vale}`}><h3>Empleado y combustible</h3>{revisionExtra(g)}</section>}
                <section aria-label={`Validez del vale ${f.vale}`}><h3>Estado de revisión</h3><EstadoCB2 estado={g.estado}/><p className="text-xs">{g.estado === "LISTO" ? "✓ Elegible; el servidor revalida al confirmar." : g.estado === "BLOQUEADO" ? "⊘ No se puede confirmar. Consulta la evidencia original." : g.estado === "RESUELTO" ? "Ya procesado; solo trazabilidad." : pendiente}</p><span className="text-xs">{g.seleccionado ? "SELECCIONADO" : "NO SELECCIONADO"}</span></section>
                <section aria-label={`Evidencia del vale ${f.vale}`}><h3>Advertencias y evidencia original</h3><details open={g.estado === "BLOQUEADO"}><summary>Revisar consumo y evidencia ({avisosGrupo.length} avisos)</summary>
                    {g.apariciones.map(a => <div key={`${a.hoja}:${a.fila}`} className="mb-2 text-xs"><strong>{a.hoja}:{a.fila} · Lote {a.lote || "No informado"}</strong>{evidencia(a)}</div>)}
                    {unidad.estado === "AMBIGUA" && <p className="text-xs">Varias unidades coinciden: {unidad.candidatos.map(v => v.placa).join(" / ")}. Elige manualmente una unidad autorizada y justifica la decision; nunca se infiere una unidad ambigua.</p>}
                    {unidad.estado === "APROXIMADA" && <p className="text-xs">Sugerencias aproximadas (selección manual): {unidad.candidatos.map(v => v.placa).join(" / ")}. No se asignan por similitud; una unidad distinta exige justificacion explicita.</p>}
                    {g.conAdvertencias && <label className="text-xs"><input type="checkbox" checked={!!marcas[g.clave]} disabled={disabled} onChange={e => revisar(g.clave, e.target.checked)}/>Advertencias revisadas para vale {f.vale}</label>}
                    {!revisionExtra && <details><summary>Piloto: {piloto.estado} · revisión informativa</summary><p>Piloto leído: {f.origen?.piloto || "No informado"}</p><p>Piloto sugerido: {piloto.estado} · {piloto.candidatos.map(p => p.nombre).join(" / ") || "Sin coincidencia"}</p>
                        {["APROXIMADA", "AMBIGUA"].includes(piloto.estado) && <fieldset disabled={disabled}><p>Requiere confirmación explícita de revisión. No asocia ni persiste una persona y no bloquea el consumo.</p><label>Candidato de piloto para vale {f.vale}<select className={input} value={pilotosPendientes[g.clave] ?? ""} onChange={e => { setPilotosPendientes(prev => ({ ...prev, [g.clave]: e.target.value })); setPilotosRevisados(prev => ({ ...prev, [g.clave]: "" })); }}><option value="">Seleccionar para revisar</option>{piloto.candidatos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><button type="button" className={button} disabled={!piloto.candidatos.some(p => String(p.id) === pilotosPendientes[g.clave])} onClick={() => setPilotosRevisados(prev => ({ ...prev, [g.clave]: pilotosPendientes[g.clave] }))}>Confirmar revisión informativa de piloto para vale {f.vale}</button></fieldset>}
                        {pilotoRevisado && <p role="status">Sugerencia revisada: {pilotoRevisado.nombre}. Sin asociación persistida.</p>}
                    </details>}
                </details><span className="text-xs">{g.conAdvertencias ? `${avisosGrupo.length} avisos · ${g.advertenciasPendientes ? "por revisar" : "revisados"}` : "Sin advertencias"} · Piloto {piloto.estado}</span></section>
            </div></td></tr></Fragment>;
        })}</tbody></table></div>
        {!rows.length && <p>No hay consumos para estos filtros.</p>}
        <Paginas pagina={page} total={rows.length} cambiar={setPagina} anterior="Anterior" siguiente="Siguiente"/>
        {!!sinIdentidad.length && <details open><summary>{sinIdentidad.length} apariciones bloqueadas sin identidad</summary><p>No cuentan como candidatos ni pueden seleccionarse.</p>{sinIdentidad.slice(blockedPage * 25, blockedPage * 25 + 25).map(f => <div key={`${f.hoja}:${f.fila}`}><strong>{f.hoja}:{f.fila}</strong>{evidencia(f)}</div>)}<Paginas pagina={blockedPage} total={sinIdentidad.length} cambiar={setBloqueadasPagina} anterior="Bloqueadas anteriores" siguiente="Bloqueadas siguientes"/></details>}
        <details><summary>Ver filas ignoradas ({ignoradas.length})</summary><p className="text-xs">Evidencia sin operación; no se selecciona ni se suma.</p><div className="overflow-x-auto"><table className={styles.reviewTable}><thead><tr><th>Hoja / fila / lote</th><th>Contenido y motivo</th></tr></thead><tbody>{ignoradas.slice(ignoredPage * 25, ignoredPage * 25 + 25).map(f => <tr key={`${f.hoja}:${f.fila}`}><td>{f.hoja}:{f.fila} · {f.lote || "No informado"}</td><td>{f.vale} {f.placa}<details><summary>Ver evidencia ignorada</summary>{evidencia(f)}</details></td></tr>)}</tbody></table></div><Paginas pagina={ignoredPage} total={ignoradas.length} cambiar={setIgnoradasPagina} anterior="Ignoradas anteriores" siguiente="Ignoradas siguientes"/></details>
    </section>;
}
