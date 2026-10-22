"use client";
import { useEffect, useState } from "react";
import type { Registro, CatalogosCB2 } from "./client";
import { jsonCB2 } from "./client";
import { button, input } from "./importar";
export function useListadoCB2(api: string, tipo: string, refresh: number, activo: boolean) {
    const [estado, setEstado] = useState({ query: "", cursors: [0] });
    const { query, cursors } = estado, cursor = cursors[cursors.length - 1];
    const url = `${api}/${tipo}?${query}&limite=50&despues=${cursor}`, requestKey = `${url}:${refresh}`;
    const [data, setData] = useState<{
        key: string;
        rows: Registro[];
        error: string;
    }>({ key: "", rows: [], error: "" });
    useEffect(() => {
        if (!activo)
            return;
        const ac = new AbortController();
        jsonCB2<Registro[]>(url, { signal: ac.signal }).then(r => {
            if (!Array.isArray(r))
                throw new Error("Listado inválido.");
            if (!ac.signal.aborted)
                setData({ key: requestKey, rows: r, error: "" });
        }).catch(e => {
            if (!ac.signal.aborted)
                setData({ key: requestKey, rows: [], error: e.message });
        });
        return () => ac.abort();
    }, [url, requestKey, activo]);
    const loading = activo && data.key !== requestKey, rows = data.key === requestKey ? data.rows : [], error = data.key === requestKey ? data.error : "";
    return { rows, loading, error, setQuery: (query: string) => setEstado({ query, cursors: [0] }), pagina: cursors.length, anterior: () => setEstado(s => ({ ...s, cursors: s.cursors.slice(0, -1) })), siguiente: () => {
            if (rows.length)
                setEstado(s => ({ ...s, cursors: [...s.cursors, rows[rows.length - 1].id] }));
        } };
}
export type ListadoCB2 = ReturnType<typeof useListadoCB2>;
export function FiltrosCB2({ tipo, cat, onApply }: {
    tipo: string;
    cat: CatalogosCB2;
    onApply: (q: string) => void;
}) {
    return <form className="grid gap-3 rounded border border-[var(--border)] p-3 md:grid-cols-3" onSubmit={e => {
            e.preventDefault();
            const data = new FormData(e.currentTarget), q = new URLSearchParams();
            for (const [k, v] of data)
                if (typeof v === "string" && v.trim())
                    q.set(k, v.trim());
            onApply(q.toString());
        }}><label>Buscar {tipo === "consumos" ? "vale o placa" : tipo === "facturas" ? "serie o número" : "archivo o proveedor"}<input className={input} name="buscar" maxLength={128}/></label><label>Proveedor<select name="proveedorId" className={input}><option value="">Todos los proveedores</option>{cat.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>{tipo !== "facturas" && <label>Estado<select className={input} name="estado"><option value="">Todos</option>{(tipo === "consumos" ? ["PENDIENTE_FACTURA", "FACTURADO"] : ["SOLO_EVIDENCIA", "PARCIAL", "COMPLETA"]).map(s => <option key={s}>{s}</option>)}</select></label>}{tipo === "consumos" && <><label>Desde<input className={input} name="desde" type="date"/></label><label>Hasta<input className={input} name="hasta" type="date"/></label></>}<button className={button}>Aplicar filtros</button></form>;
}
export function PaginacionCB2({ list }: {
    list: ListadoCB2;
}) { return <div className="flex items-center gap-3"><button className={button} disabled={list.pagina === 1 || list.loading} onClick={list.anterior}>Anterior</button><span>Página {list.pagina} · {list.rows.length} registros</span><button className={button} disabled={list.rows.length < 50 || list.loading} onClick={list.siguiente}>Siguiente</button></div>; }
