"use client";
import { useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { productos, etiquetasProducto, type Producto } from "@/lib/flota/cb2/clasificacion";
import { jsonCB2, type Registro, type CatalogosCB2 } from "./client";
import { button, input } from "./controles";
import type { EjecutarCB2 } from "./importar";
export type BorradorCorreccionCB2 = { unidad: string; empleado: string; producto: string; motivo: string; revision: number };
const inicial = (r: Registro): BorradorCorreccionCB2 => ({ unidad: String(r.vehiculo_id ?? ""), empleado: String(r.empleado_id ?? ""), producto: String(r.producto_clasificado ?? ""), motivo: "", revision: Number(r.revision_asignacion ?? 0) });
export function CorregirCB2({ r, cat, api, run, locked, borrador, onBorradorChange }: { r: Registro; cat: CatalogosCB2; api: string; run: EjecutarCB2; locked: boolean; borrador?: BorradorCorreccionCB2; onBorradorChange?: (v: BorradorCorreccionCB2 | undefined) => void }) {
    const [local, setLocal] = useState(() => inicial(r)), [acepta, setAcepta] = useState(false), [error, setError] = useState("");
    const { unidad, empleado, producto, motivo, revision } = borrador ?? local;
    function cambiar(v: Partial<Omit<BorradorCorreccionCB2, "revision">>) {
        const nuevo = { ...(borrador ?? local), ...v };
        if (onBorradorChange) onBorradorChange(nuevo); else setLocal(nuevo);
        setAcepta(false);
    }
    function descartar() { setLocal(inicial(r)); onBorradorChange?.(undefined); setAcepta(false); setError(""); }
    async function guardar() {
        if (!acepta || locked || !unidad || !producto || motivo.trim().length < 10) return;
        const datos = { proveedorId: Number(r.proveedor_id), consumoId: r.id, revision, vehiculoId: Number(unidad), empleadoId: empleado ? Number(empleado) : null, productoClasificado: producto, motivo: motivo.trim() };
        try { await run("corregir", datos, clave => jsonCB2(`${api}/corregir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...datos, clave }) })); descartar(); }
        catch (e) { setError(e instanceof Error ? e.message : "No se pudo corregir."); }
    }
    return <details><summary>Corregir asignación registrada #{r.id}</summary><fieldset disabled={locked} className="space-y-2"><p>Actualiza este consumo, conserva su evidencia original y registra anterior, nuevo, motivo y responsable. No reimporta.</p>
        {onBorradorChange && <p role="note">El borrador se conserva por consumo al paginar o filtrar mientras esta pantalla permanezca abierta. Al regresar debes confirmar nuevamente.</p>}
        {borrador && revision !== Number(r.revision_asignacion ?? 0) && <p role="alert">La revisión del consumo cambió. Este borrador conserva la revisión {revision}; descártalo para empezar con los datos actuales.</p>}
        <CatalogoSearchSelect label={`Unidad corregida #${r.id}`} placeholder="Buscar unidad autorizada" inputClassName={input} value={unidad} options={cat.vehiculos.map(v => ({value:String(v.id),label:v.placa}))} onChange={v => cambiar({ unidad: v })}/>
        <CatalogoSearchSelect label={`Empleado corregido #${r.id}`} placeholder="Buscar empleado activo" inputClassName={input} value={empleado} options={(cat.empleados ?? []).map(v => ({value:String(v.id),label:v.nombre}))} onChange={v => cambiar({ empleado: v })}/>
        <label>Combustible corregido<select className={input} value={producto} onChange={e => cambiar({ producto: e.target.value })}><option value="">Seleccionar</option>{productos.map(p => <option key={p} value={p}>{etiquetasProducto[p as Producto]}</option>)}</select></label>
        <label>Justificacion de correccion<textarea className={input} minLength={10} maxLength={1000} value={motivo} onChange={e => cambiar({ motivo: e.target.value })}/></label>
        <p>Nuevo: unidad {cat.vehiculos.find(v => String(v.id) === unidad)?.placa ?? "Sin unidad"}; empleado {cat.empleados?.find(e => String(e.id) === empleado)?.nombre ?? "Sin vínculo"}; combustible {producto || "Pendiente"}.</p>
        <label><input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)}/>Confirmo esta corrección auditada</label><button className={button} disabled={!acepta || !unidad || !producto || motivo.trim().length<10} onClick={() => void guardar()}>Guardar corrección #{r.id}</button>{borrador && <button type="button" className={button} onClick={descartar}>Descartar borrador #{r.id}</button>}{error && <p role="alert">{error}</p>}
    </fieldset></details>;
}
