"use client";
import { useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { productos, etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
import { jsonCB2, type Registro, type CatalogosCB2 } from "./client";
import { button, input } from "./controles";
import type { EjecutarCB2 } from "./importar";
export function CorregirCB2({ r, cat, api, run, locked }: { r: Registro; cat: CatalogosCB2; api: string; run: EjecutarCB2; locked: boolean }) {
    const [unidad, setUnidad] = useState(String(r.vehiculo_id ?? "")), [empleado, setEmpleado] = useState(String(r.empleado_id ?? "")), [producto, setProducto] = useState(String(r.producto_clasificado ?? "")), [motivo, setMotivo] = useState(""), [acepta, setAcepta] = useState(false), [error, setError] = useState("");
    const invalidar = () => setAcepta(false);
    async function guardar() {
        if (!acepta || locked || !unidad || !producto || motivo.trim().length < 10) return;
        const datos = { proveedorId: Number(r.proveedor_id), consumoId: r.id, revision: Number(r.revision_asignacion ?? 0), vehiculoId: Number(unidad), empleadoId: empleado ? Number(empleado) : null, productoClasificado: producto, motivo: motivo.trim() };
        try { await run("corregir", datos, clave => jsonCB2(`${api}/corregir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...datos, clave }) })); }
        catch (e) { setError(e instanceof Error ? e.message : "No se pudo corregir."); }
    }
    return <details><summary>Corregir asignación registrada #{r.id}</summary><fieldset disabled={locked} className="space-y-2"><p>Actualiza este consumo, conserva su evidencia original y registra anterior, nuevo, motivo y responsable. No reimporta.</p>
        <CatalogoSearchSelect label={`Unidad corregida #${r.id}`} placeholder="Buscar unidad autorizada" inputClassName={input} value={unidad} options={cat.vehiculos.map(v => ({value:String(v.id),label:v.placa}))} onChange={v => {setUnidad(v);invalidar();}}/>
        <CatalogoSearchSelect label={`Empleado corregido #${r.id}`} placeholder="Buscar empleado activo" inputClassName={input} value={empleado} options={(cat.empleados ?? []).map(v => ({value:String(v.id),label:v.nombre}))} onChange={v => {setEmpleado(v);invalidar();}}/>
        <label>Combustible corregido<select className={input} value={producto} onChange={e => {setProducto(e.target.value);invalidar();}}><option value="">Seleccionar</option>{productos.map(p => <option key={p} value={p}>{etiquetasProducto[p as Producto]}</option>)}</select></label>
        <label>Justificacion de correccion<textarea className={input} minLength={10} maxLength={1000} value={motivo} onChange={e => {setMotivo(e.target.value);invalidar();}}/></label>
        <p>Nuevo: unidad {cat.vehiculos.find(v => String(v.id) === unidad)?.placa ?? "Sin unidad"}; empleado {cat.empleados?.find(e => String(e.id) === empleado)?.nombre ?? "Sin vínculo"}; combustible {producto || "Pendiente"}.</p>
        <label><input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)}/>Confirmo esta corrección auditada</label><button className={button} disabled={!acepta || !unidad || !producto || motivo.trim().length<10} onClick={() => void guardar()}>Guardar corrección #{r.id}</button>{error && <p role="alert">{error}</p>}
    </fieldset></details>;
}
