"use client";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { clasificarProducto, identificarEmpleado, productos, etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
import type { CatalogosCB2, FilaCB2 } from "./client";
import { input } from "./controles";
export type DecisionAsignacion = { exigirProducto?: boolean; empleadoId?: number | null; productoClasificado?: Producto; motivoUnidad?: string; asociacionExternaId?: number | null };
export function AsignacionCB2({ fila, cat, value, onChange, disabled }: { fila: FilaCB2; cat: CatalogosCB2; value: DecisionAsignacion; onChange: (v: DecisionAsignacion) => void; disabled: boolean }) {
    const match = identificarEmpleado(fila.origen?.piloto ?? "", cat.empleados ?? []);
    const empleado = value.empleadoId === undefined ? match.propuesta?.id : value.empleadoId;
    const producto = value.productoClasificado ?? clasificarProducto(fila.origen?.producto);
    const externa = cat.terceros?.find(a => a.id === (value.asociacionExternaId === undefined ? fila.asociacionExterna?.id : value.asociacionExternaId));
    return <div className="space-y-4">
        {cat.tercerosHabilitados && <label>Asociación tercerizada verificada<select className={input} disabled={disabled} value={value.asociacionExternaId ?? fila.asociacionExterna?.id ?? ""} onChange={e => onChange({ ...value, empleadoId: null, asociacionExternaId: e.target.value ? Number(e.target.value) : null })}><option value="">Sin asociación externa</option>{(cat.terceros ?? []).filter(a => a.estado === "VERIFICADA").map(a => <option key={a.id} value={a.id}>{a.nombre} · piloto #{a.piloto_id} · {a.placa} · {a.tipo} · unidad #{a.unidad_id} · {a.descripcion}</option>)}</select></label>}
        <p>Piloto original: {fila.origen?.piloto || "No informado"}. {match.estado}: {match.motivo}.</p>
        <p>Candidatos: {match.candidatos.map(p => p.nombre).join(" / ") || "Sin coincidencia"}</p>
        <p>{value.empleadoId !== undefined ? "Elección manual" : match.metodo === "TOKENS_COMPLETOS_UNICOS" ? "Autopropuesta única por tokens completos" : match.propuesta ? "Autopropuesta exacta única" : "Piloto pendiente"}: {(cat.empleados ?? []).find(p => p.id === empleado)?.nombre ?? "Sin empleado vinculado"}</p>
        {externa ? <p>Piloto externo verificado: {externa.nombre} · identidad #{externa.piloto_id} · {externa.relacion}. No se vincula a empleados.</p> : <CatalogoSearchSelect label={`Empleado para vale ${fila.vale}`} placeholder="Buscar empleado de la empresa" inputClassName={input} value={empleado ? String(empleado) : ""} options={(cat.empleados ?? []).map(p => ({ value: String(p.id), label: p.nombre }))} onChange={v => onChange({ ...value, empleadoId: v ? Number(v) : null })}/>}
        <p>Producto original: {fila.origen?.producto || "No informado"}. No se infiere por proveedor o placa.</p>
        <label>Combustible para vale {fila.vale}<select className={input} disabled={disabled} value={producto ?? ""} onChange={e => onChange({ ...value, productoClasificado: e.target.value ? e.target.value as Producto : undefined })}><option value="">Clasificar obligatoriamente</option>{productos.map(p => <option key={p} value={p}>{etiquetasProducto[p]}</option>)}</select></label>
        <label>Justificación de unidad manual (solo si no coincide)<textarea className={input} disabled={disabled} minLength={10} maxLength={1000} value={value.motivoUnidad ?? ""} onChange={e => onChange({ ...value, motivoUnidad: e.target.value })}/></label><p>Una unidad distinta requiere justificación de al menos 10 caracteres y acceso vigente. La confirmación guarda la decisión y la evidencia original por separado.</p>
    </div>;
}
