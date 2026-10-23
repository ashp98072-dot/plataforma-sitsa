"use client";
import { useState } from "react";
import { etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
import type { consolidarMes } from "@/lib/flota/cb2/resumen-mensual";
import { button } from "./controles";
type Resumen = ReturnType<typeof consolidarMes>;
const origen = (s: string) => s === "CB2" ? "Consumos HALEL/SHELL" : "Cargas históricas aprobadas";
function prueba(firma: string) {
    const [proveedor,unidad,vale,fecha,galones,precio,monto] = JSON.parse(firma);
    return `Proveedor #${proveedor}, unidad #${unidad}, vale ${vale}, fecha ${fecha}: ${galones} gal × Q ${precio}, monto Q ${monto}`;
}
export function ResumenIntegradoCB2({ resumen, mes }: { resumen: Resumen; mes: string }) {
    const [pagina,setPagina] = useState(0), ultima = Math.max(0,Math.ceil(resumen.excluidas.length/25)-1), page = Math.min(pagina,ultima);
    return <section className="space-y-3 rounded border border-[var(--border)] p-3">
        <h3>Resumen consolidado HALEL/SHELL y cargas aprobadas</h3>
        <p>Mes {mes}. Histórico por fecha de registro; CB2 por fecha de consumo. Otras monedas se muestran aparte.</p>
        <p><strong>Total consolidado GTQ: {resumen.totalGTQ.galones} gal / Q {resumen.totalGTQ.monto}</strong>{resumen.provisional && " (PROVISIONAL: coincidencias pendientes de resolver)"}</p>
        <ul>{Object.entries(resumen.subtotales).map(([key,v]) => { const [fuente,moneda]=key.split(":");return <li key={key}>{origen(fuente)} · {moneda}: {v.galones} gal / {v.monto}</li>; })}</ul>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Consumo mensual por origen, unidad, combustible y moneda</caption><thead><tr><th>Origen</th><th>Unidad</th><th>Combustible</th><th>Galones</th><th>Importe</th></tr></thead><tbody>{resumen.grupos.map((g,i) => <tr key={i}><td>{origen(g.origen)}</td><td>{g.placa}</td><td>{etiquetasProducto[g.combustible as Producto] ?? (g.combustible === "GASOLINA_HISTORICA_SIN_VARIANTE" ? "Gasolina histórica sin variante" : "NO DETERMINADO")}</td><td>{g.galones}</td><td>{g.moneda} {g.monto}</td></tr>)}</tbody></table></div>
        <details><summary>Conciliación verificable ({resumen.excluidas.length} exclusiones)</summary><p>Solo se excluye CB2 frente a una carga aprobada si existe una pareja única con proveedor, vale, unidad, fecha de consumo, galones, precio y monto exactamente iguales. Los registros no se modifican.</p><p>Se conserva el corte por registro del histórico: una carga aprobada registrada en otro mes no se traslada a este mes.</p>{resumen.excluidas.slice(page*25,page*25+25).map(e => <p key={e.consumoId}>Consumo CB2 #{e.consumoId} / carga #{e.cargaId}: {prueba(e.firma)}</p>)}<div className="flex flex-wrap gap-2"><button className={button} disabled={!page} onClick={()=>setPagina(page-1)}>Exclusiones anteriores</button><span>Página {page+1} de {ultima+1}</span><button className={button} disabled={page===ultima} onClick={()=>setPagina(page+1)}>Exclusiones siguientes</button></div></details>
        {resumen.ambiguas.length>0 && <details open><summary>{resumen.ambiguas.length} consumos requieren conciliación manual</summary><p role="alert">Coincidencias múltiples o con diferencias: {resumen.ambiguas.join(", ")}. Se conservan ambos orígenes y el total se marca provisional; no se deduplican por similitud.</p></details>}
    </section>;
}
