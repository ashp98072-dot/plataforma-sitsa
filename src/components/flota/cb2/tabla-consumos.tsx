"use client";
import { Fragment, useId, useState } from "react";
import type { CatalogosCB2, Registro } from "./client";
import type { EjecutarCB2 } from "./importar";
import { button } from "./controles";
import { EstadoCB2 } from "./presentacion";
import { DetalleConsumoCB2 } from "./detalle-consumo";
import { CorregirCB2, type BorradorCorreccionCB2 } from "./corregir";
import { cifraConsumo, combustibleConsumo, galonesRedondeados, importeConsumo } from "./formatos-consumos";
import styles from "./panel.module.css";

type Props = {
    rows: Registro[]; seleccion: Record<number, Registro>; onSeleccionar: (r: Registro, valor: boolean) => void;
    canWrite: boolean; admin: boolean; locked: boolean; preparando: boolean;
    api: string; cat: CatalogosCB2; run: EjecutarCB2;
};

export function TablaConsumosCB2({ rows, seleccion, onSeleccionar, canWrite, admin, locked, preparando, api, cat, run }: Props) {
    const prefijo = useId(), [abiertos, setAbiertos] = useState<Record<number, boolean>>({});
    const [borradores, setBorradores] = useState<Record<string, BorradorCorreccionCB2>>({});
    return <div className={styles.reviewScroll} role="region" aria-label="Tabla de consumos registrados" tabIndex={0}>
        <table className={`${styles.consumptionTable} ${styles.registeredTable}`}>
            <caption className="sr-only">Consumos de la empresa activa</caption>
            <thead><tr>{["Selección", "Vale", "Fecha", "Placa / unidad", "Proveedor", "Galones", "Precio unitario", "Monto", "Factura", "Empleado", "Combustible", "Acciones"].map(t => <th key={t} scope="col">{t}</th>)}</tr></thead>
            <tbody>{rows.map(r => {
                const id = `${prefijo}-${r.id}`, abierto = !!abiertos[r.id];
                const claveBorrador = `${api}:${r.proveedor_id}:${r.id}`;
                const producto = combustibleConsumo(r.producto_clasificado);
                return <Fragment key={r.id}>
                    <tr className={styles.consumptionRow} data-consumo={r.id}>
                        <td>{canWrite && <input type="checkbox" aria-label={`Seleccionar consumo ${r.id}`} disabled={locked || preparando} checked={!!seleccion[r.id]} onChange={e => onSeleccionar(r, e.target.checked)}/>}</td>
                        <td><strong>{String(r.numero_vale ?? "Sin vale")}</strong></td>
                        <td className={styles.numeric}>{r.fecha_consumo ? String(r.fecha_consumo).slice(0, 10) : "Sin fecha"}</td>
                        <td><strong>{String(r.unidad_placa ?? r.placa_original ?? "Sin unidad")}</strong><small>Original: {String(r.placa_original ?? "No informada")}</small></td>
                        <td>{cat.proveedores.find(p => p.id === Number(r.proveedor_id))?.nombre ?? String(r.proveedor_nombre ?? `Proveedor #${r.proveedor_id}`)}</td>
                        <td className={styles.numeric} title={`Valor original: ${String(r.galones ?? "No informado")}`}><span>{cifraConsumo(r.galones, 0, 3)}</span>{galonesRedondeados(r.galones) && <details><summary aria-label={`Consultar galones originales del consumo ${r.id}`}>Redondeado · ver original</summary><span>Valor original: {String(r.galones)} galones</span></details>}</td>
                        <td className={styles.numeric} title={`Valor original: ${String(r.precio ?? "No informado")}`}>{importeConsumo(r.precio, r.moneda, true)}</td>
                        <td className={styles.numeric} title={`Valor original: ${String(r.monto ?? "No informado")}`}><strong>{importeConsumo(r.monto, r.moneda)}</strong></td>
                        <td><EstadoCB2 estado={String(r.estado_factura ?? "NO INFORMADO")}/><small>{r.factura_id == null ? "Sin documento" : r.factura_serie != null && r.factura_numero != null ? `${r.factura_serie} / ${r.factura_numero}` : `Documento #${r.factura_id}`}</small></td>
                        <td>{r.empleado_id == null ? "Sin vínculo" : String(r.empleado_nombre ?? `Empleado #${r.empleado_id} · nombre no disponible`)}</td>
                        <td>{producto}</td>
                        <td><button id={`${id}-boton`} className={button} type="button" aria-label={`${abierto ? "Cerrar detalles" : "Detalles"} del consumo ${r.id}`} aria-expanded={abierto} aria-controls={id} onClick={() => setAbiertos(prev => ({ ...prev, [r.id]: !prev[r.id] }))}>{abierto ? "Cerrar" : "Detalles"}</button></td>
                    </tr>
                    <tr id={id} className={styles.detailRow} hidden={!abierto} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setAbiertos(prev => ({ ...prev, [r.id]: false })); document.getElementById(`${id}-boton`)?.focus(); } }}><td colSpan={12}><div className={styles.editGrid}>
                        <section aria-label={`Procedencia del consumo ${r.id}`}><h3>Importación y trazabilidad</h3><p>Importacion #{String(r.importacion_origen_id)} / Consumo #{r.id}</p><p>Documento: {r.factura_id == null ? "Sin documento" : `#${r.factura_id}`}</p><DetalleConsumoCB2 r={r}/></section>
                        <section aria-label={`Valores originales del consumo ${r.id}`}><h3>Valores originales registrados</h3><p>Galones: {String(r.galones ?? "No informado")} · Precio: {String(r.precio ?? "No informado")} · Monto: {String(r.monto ?? "No informado")} · Moneda: {String(r.moneda ?? "No informada")}</p><p>La tabla redondea solo para mostrar. Los datos y las operaciones conservan su precisión original.</p><details><summary>Evidencia recibida completa de este consumo</summary><pre className="max-w-full whitespace-pre-wrap break-all text-xs">{JSON.stringify(r, null, 2)}</pre></details></section>
                        {canWrite && admin && <section aria-label={`Corrección del consumo ${r.id}`}><h3>Corrección de asignación registrada</h3><CorregirCB2 key={`${claveBorrador}:${r.revision_asignacion ?? 0}`} r={r} cat={cat} api={api} run={run} locked={locked} borrador={borradores[claveBorrador]} onBorradorChange={v => setBorradores(prev => { const next = { ...prev }; if (v) next[claveBorrador] = v; else delete next[claveBorrador]; return next; })}/></section>}
                    </div></td></tr>
                </Fragment>;
            })}</tbody>
        </table>
    </div>;
}
