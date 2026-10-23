import { leerObjeto, type Registro } from "./client";
import { etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
function lista(v: unknown): Record<string, unknown>[] {
    try { const a = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(a) ? a.map(leerObjeto) : []; } catch { return []; }
}
export function DetalleConsumoCB2({ r }: { r: Registro }) {
    const origen = lista(r.origenes)[0];
    const producto = String(r.producto_clasificado ?? "NO_DETERMINADO") as Producto;
    return <details><summary>Empleado, combustible y trazabilidad</summary>
        <p className="whitespace-pre-wrap">Piloto original: {String(origen?.piloto ?? r.piloto_informado ?? "No informado")} · Empleado vinculado: {String(r.empleado_nombre ?? "Sin vínculo")}</p>
        <p className="whitespace-pre-wrap">Producto original: {String(origen?.producto ?? r.producto ?? "No informado")} · Clasificado: {etiquetasProducto[producto] ?? "NO DETERMINADO"}{r.producto_clasificado == null && " (clasificación histórica pendiente)"}</p>
        <p>Perfil {String(r.perfil ?? "No informado")} · Archivo {String(r.archivo_nombre ?? "No informado")} · Importado {String(r.importado_en ?? "No informado")} · Responsable {String(r.importado_usuario ?? r.importado_por ?? "No informado")}</p>
        <p>Factura {String(r.factura_serie ?? "Sin serie")} / {String(r.factura_numero ?? "Sin número")}</p>
        <ul>{lista(r.origenes).map((o,i) => <li key={i}>Hoja {String(o.hoja)} · Fila {String(o.fila)} · Lote {String(o.lote ?? "No informado")}<br/>Advertencias originales: {Array.isArray(o.motivos) ? o.motivos.join("; ") || "Sin advertencias" : String(o.motivos ?? "Sin advertencias")}</li>)}</ul>
        <p>Hasta 25 referencias de origen en esta vista. Para consultar todas las apariciones y el archivo original: Historial → Ver trazabilidad #{String(r.importacion_origen_id)}.</p>
        <details><summary>Correcciones auditadas ({lista(r.correcciones).length})</summary>{lista(r.correcciones).map((a,i) => { const anterior = leerObjeto(a.anterior), nuevo = leerObjeto(a.nuevo); return <p key={i}>Unidad #{String(anterior.vehiculo_id)} → #{String(nuevo.vehiculoId)}; empleado {String(anterior.empleado_id ?? "sin vínculo")} → {String(nuevo.empleadoId ?? "sin vínculo")}; combustible {String(anterior.producto_clasificado ?? "sin clasificación")} → {String(nuevo.productoClasificado)}. {String(a.motivo)} · Usuario #{String(a.usuario)} · {String(a.fecha)}</p>; })}</details>
    </details>;
}
