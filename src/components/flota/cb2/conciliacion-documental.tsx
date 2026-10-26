"use client";
import { Fragment, useEffect, useState } from "react";
import { jsonCB2, type CatalogosCB2 } from "./client";
import { button, input } from "./controles";
import { cifraConsumo } from "./formatos-consumos";
import { estadosDocumentales, DecimalDocumental, type PaginaDocumental, type FacturaDocumental, type ConsumoDocumental } from "@/lib/flota/cb2/conciliacion-documental-model";
import styles from "./panel.module.css";

function usePagina<T extends { id: number }>(api: string, consulta: string, activo: boolean, refresh: number) {
    const [cursores, setCursores] = useState([0]);
    const url = `${api}?${consulta}&limite=25&despues=${cursores.at(-1)}`, key = `${url}:${refresh}`;
    const [respuesta, setRespuesta] = useState<{ key: string; data?: PaginaDocumental<T>; error?: string }>({ key: "" });
    useEffect(() => {
        if (!activo) return;
        const ac = new AbortController();
        jsonCB2<PaginaDocumental<T>>(url, { signal: ac.signal }).then(data => {
            if (!Array.isArray(data.filas)) throw new Error("Respuesta documental inválida.");
            if (!ac.signal.aborted) setRespuesta({ key, data });
        }).catch(e => { if (!ac.signal.aborted) setRespuesta({ key, error: e.message }); });
        return () => ac.abort();
    }, [url, key, activo]);
    const actual = respuesta.key === key ? respuesta : undefined;
    return { filas: actual?.data?.filas ?? [], error: actual?.error, cargando: activo && !actual,
        pagina: cursores.length, anterior: () => setCursores(s => s.slice(0, -1)),
        siguiente: actual?.data?.siguiente, avanzar: () => { if (actual?.data?.siguiente) setCursores(s => [...s, actual.data!.siguiente!]); } };
}
function Paginacion({ lista }: { lista: ReturnType<typeof usePagina> }) {
    return <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={lista.pagina === 1 || lista.cargando} onClick={lista.anterior}>Anterior</button><span>Página {lista.pagina}</span><button className={button} disabled={lista.siguiente == null || lista.cargando} onClick={lista.avanzar}>Siguiente</button></div>;
}
function importe(valor: string | null, moneda: string) { return valor === null ? "No declarado" : `${moneda} ${cifraConsumo(valor, 2, 6)}`; }
function diferenciaTexto(f: FacturaDocumental) {
    if (f.diferencia === null) return "No calculable";
    const d = new DecimalDocumental(f.diferencia);
    return `${importe(f.diferencia, f.moneda)} · ${d.isZero() ? "Sin diferencia" : d.isPositive() ? "Documento mayor" : "Consumos mayores"}`;
}
function Detalle({ api, factura, refresh }: { api: string; factura: FacturaDocumental; refresh: number }) {
    const lista = usePagina<ConsumoDocumental>(`${api}/${factura.id}/consumos`, `proveedorId=${factura.proveedorId}`, true, refresh);
    return <section className="space-y-3" aria-label={`Consumos de factura ${factura.serie} ${factura.numero}`}><h3>Consumos efectivamente asociados · {factura.moneda}</h3>
        <p>Incluye todas las importaciones y fechas de consumo. El período de la tabla principal corresponde a la fecha documental.</p>
        {lista.cargando && <p role="status">Cargando consumos asociados…</p>}{lista.error && <p role="alert">{lista.error}</p>}
        <table className={styles.documentTable}><thead><tr>{["Vale", "Fecha de consumo", "Placa", "Importación", "Galones", "Monto"].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{lista.filas.map(c => <tr key={c.id}><td>{c.vale}</td><td>{c.fecha}</td><td>{c.placa}</td><td>#{c.importacionId}</td><td>{cifraConsumo(c.galones, 0, 6)}</td><td>{importe(c.monto, c.moneda)}</td></tr>)}</tbody></table>
        {!lista.cargando && !lista.error && !lista.filas.length && <p>Sin consumos asociados de esta moneda.</p>}<Paginacion lista={lista}/>
    </section>;
}
function Tabla({ api, consulta, activo, refresh }: { api: string; consulta: string; activo: boolean; refresh: number }) {
    const lista = usePagina<FacturaDocumental>(api, consulta, activo, refresh), [abierta, setAbierta] = useState<number | null>(null);
    return <div className="space-y-3">{lista.cargando && <p role="status">Cargando conciliación documental…</p>}{lista.error && <p role="alert">{lista.error}</p>}
        <div className={styles.reviewScroll} role="region" aria-label="Tabla de conciliación documental" tabIndex={0}><table className={styles.documentTable}>
            <caption className="sr-only">Balance informativo por factura, sin cierre ni modificaciones</caption>
            <thead><tr>{["Proveedor", "Serie / número", "Fecha documental", "Moneda", "Total documental", "Consumos", "Galones", "Monto asociado", "Diferencia documental − consumos", "Estado informativo", "Detalle"].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead>
            <tbody>{lista.filas.map(f => <Fragment key={f.id}><tr><td>{f.proveedor}</td><td><strong>{f.serie} / {f.numero}</strong></td><td>{f.fecha ?? "Sin fecha"}</td><td>{f.moneda}</td><td>{importe(f.totalDocumental, f.moneda)}</td><td>{f.cantidad}</td><td>{cifraConsumo(f.galones, 0, 6)}</td><td>{importe(f.montoConsumos, f.moneda)}</td><td><strong>{diferenciaTexto(f)}</strong></td><td><span className="rounded border border-[var(--border)] px-2 py-1 text-xs font-semibold">{f.estado.replaceAll("_", " ")}</span></td><td><button className={button} aria-expanded={abierta === f.id} aria-controls={`documental-${f.id}`} onClick={() => setAbierta(abierta === f.id ? null : f.id)}>{abierta === f.id ? "Cerrar" : "Ver consumos"}</button></td></tr>
                {abierta === f.id && <tr id={`documental-${f.id}`}><td colSpan={11}><Detalle api={api} factura={f} refresh={refresh}/></td></tr>}
            </Fragment>)}</tbody>
        </table></div>{!lista.cargando && !lista.error && !lista.filas.length && <p>No hay facturas para estos filtros.</p>}<Paginacion lista={lista}/>
    </div>;
}
export function ConciliacionDocumentalCB2({ api, cat, activo, refresh }: { api: string; cat: CatalogosCB2; activo: boolean; refresh: number }) {
    const [consulta, setConsulta] = useState(""), [fecha, setFecha] = useState("TODAS"), [error, setError] = useState("");
    return <section className="space-y-4" aria-label="Conciliación documental"><h2 className="text-lg font-semibold">Conciliación documental de facturas</h2>
        <p>Vista informativa de solo lectura. Cuadrada no significa conciliación definitiva ni cierre. Diferencia = total documental − monto asociado; tolerancia inclusiva de 0.01 en la moneda de la factura.</p>
        <p>Sin total documental tiene prioridad sobre sin consumos. El estado FACTURADO de los consumos se conserva.</p>
        <form className="grid gap-3 rounded-xl border border-[var(--border)] p-3 md:grid-cols-3" onSubmit={e => {
            e.preventDefault(); const data = new FormData(e.currentTarget), q = new URLSearchParams();
            for (const [k, v] of data) if (typeof v === "string" && v.trim()) q.set(k, v.trim());
            if (q.get("desde") && q.get("hasta") && q.get("desde")! > q.get("hasta")!) { setError("El inicio debe ser anterior o igual al fin."); return; }
            setError(""); setConsulta(q.toString());
        }}><label>Proveedor<select className={input} name="proveedorId"><option value="">Todos</option>{cat.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <label>Serie o número<input className={input} name="buscar" maxLength={128}/></label>
            <label>Estado de conciliación<select className={input} name="estado"><option value="">Todos</option>{estadosDocumentales.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>
            <label>Fecha documental<select className={input} name="fecha" value={fecha} onChange={e => setFecha(e.target.value)}><option value="TODAS">Todas</option><option value="CON_FECHA">Con fecha</option><option value="SIN_FECHA">Sin fecha</option></select></label>
            <label>Desde (inclusive)<input className={input} name="desde" type="date" disabled={fecha === "SIN_FECHA"}/></label><label>Hasta (inclusive)<input className={input} name="hasta" type="date" disabled={fecha === "SIN_FECHA"}/></label><button className={button}>Aplicar filtros</button>
        </form>{error && <p role="alert">{error}</p>}<Tabla key={`${api}:${consulta}`} api={`${api}/conciliacion-documental`} consulta={consulta} activo={activo} refresh={refresh}/>
    </section>;
}
