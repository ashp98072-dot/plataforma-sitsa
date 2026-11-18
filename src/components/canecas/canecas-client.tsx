"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Fila = Record<string, string | number | null>;
type Campo = { nombre: string; etiqueta: string; tipo?: string; opciones?: string };
const campos: Record<string, Campo[]> = {
  productos: [{nombre:"codigo",etiqueta:"Código"},{nombre:"nombre",etiqueta:"Aceite"},{nombre:"marca",etiqueta:"Marca"},{nombre:"presentacion",etiqueta:"Presentación"},{nombre:"capacidad",etiqueta:"Capacidad",tipo:"number"},{nombre:"unidad_capacidad",etiqueta:"Unidad de capacidad"},{nombre:"unidad_inventario",etiqueta:"Unidad de inventario"}],
  ubicaciones: [{nombre:"nombre",etiqueta:"Nombre de bodega o ubicación"}],
  proveedores: [{nombre:"nombre_comercial",etiqueta:"Nombre del proveedor"}],
  compras: [{nombre:"proveedor_id",etiqueta:"Proveedor",opciones:"proveedores"},{nombre:"producto_id",etiqueta:"Aceite",opciones:"productos"},{nombre:"referencia",etiqueta:"Referencia documental"},{nombre:"cantidad",etiqueta:"Canecas compradas",tipo:"number"}],
  recepciones: [{nombre:"compra_id",etiqueta:"Compra",opciones:"compras"},{nombre:"ubicacion_id",etiqueta:"Ubicación",opciones:"ubicaciones"},{nombre:"recibido_por_empleado_id",etiqueta:"Recibido físicamente por",opciones:"empleados"},{nombre:"cantidad",etiqueta:"Canecas recibidas",tipo:"number"}],
};
const columnas: Record<string, [string,string][]> = {
  productos: [["codigo","Código"],["nombre","Aceite"],["marca","Marca"],["presentacion","Presentación"],["capacidad","Capacidad"],["unidad_capacidad","Unidad"],["activo","Activo"]],
  ubicaciones: [["nombre","Ubicación"],["activo","Activa"]],
  compras: [["referencia","Documento"],["proveedor","Proveedor"],["producto","Aceite"],["cantidad","Cantidad"],["creado_en","Fecha"]],
  recepciones: [["referencia","Documento"],["producto","Aceite"],["ubicacion","Ubicación"],["cantidad","Cantidad"],["recibido_por","Recibió"],["estado","Estado"],["confirmado_usuario","Confirmó"],["confirmado_en","Fecha"]],
  inventario: [["nombre","Aceite"],["presentacion","Presentación"],["ubicacion","Ubicación"],["fisico","Físico"],["reservado","Reservado"],["disponible","Disponible"]],
  movimientos: [["tipo","Tipo"],["producto","Aceite"],["presentacion","Presentación"],["ubicacion","Ubicación"],["cantidad","Cantidad"],["documento","Documento"],["recibido_por","Recibió"],["usuario","Confirmó"],["creado_en","Fecha"]],
};
const titulos: Record<string,string> = { panel:"Panel general", productos:"Aceites y presentaciones", ubicaciones:"Ubicaciones", compras:"Compras", recepciones:"Recepciones", inventario:"Existencias", movimientos:"Historial de movimientos" };
export function CanecasClient({ slug, vista }: { slug: string; vista: string }) {
  const [datos,setDatos] = useState<Record<string,Fila[]>>({});
  const [mensaje,setMensaje] = useState("");
  const [ocupado,setOcupado] = useState(false);
  const [claves,setClaves] = useState<Record<string,string>>({});
  const enviando = useRef(false);
  const recursos = vista === "panel" ? ["inventario","movimientos"] : Array.from(new Set([vista,...(campos[vista] ?? []).flatMap(c => c.opciones ? [c.opciones] : []),...(vista === "compras" ? ["proveedores"] : [])]));
  const cargar = useCallback(async () => {
    try {
      const resultados = await Promise.all(recursos.map(async r => {
        const response = await fetch(`/api/empresas/${encodeURIComponent(slug)}/canecas/${r}`, { cache:"no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "No se pudieron consultar los datos.");
        return [r,json.datos] as const;
      }));
      setDatos(Object.fromEntries(resultados));
    } catch (error) { setMensaje(error instanceof Error ? error.message : "Error de consulta."); }
  // La lista depende únicamente de la vista.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug,vista]);
  useEffect(() => { const timer = setTimeout(() => { void cargar(); }, 0); return () => clearTimeout(timer); }, [cargar]);
  async function enviar(recurso: string, payload: Record<string,FormDataEntryValue | number>) {
    if (enviando.current) return;
    enviando.current = true;
    setOcupado(true); setMensaje("");
    try {
      if (recurso === "compras" || recurso === "recepciones") {
        const k = claves[recurso] ?? crypto.randomUUID();
        setClaves(old => ({...old,[recurso]:k})); payload.clave_operacion = k;
      }
      const res = await fetch(`/api/empresas/${encodeURIComponent(slug)}/canecas/${recurso}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "No se pudo guardar.");
      setClaves(old => { const copy={...old}; delete copy[recurso]; return copy; });
      setMensaje("Operación registrada correctamente."); await cargar();
    } catch (error) { setMensaje(error instanceof Error ? error.message : "Error de operación."); }
    finally { enviando.current = false; setOcupado(false); }
  }
  async function cambiarEstado(recurso: string, row: Fila) {
    if (ocupado) return;
    setOcupado(true); setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${encodeURIComponent(slug)}/canecas/${recurso}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:row.id,activo:!Boolean(row.activo)}) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "No se pudo cambiar el estado.");
      setMensaje("Estado actualizado."); await cargar();
    } catch (error) { setMensaje(error instanceof Error ? error.message : "Error de operación."); }
    finally { setOcupado(false); }
  }
  function formulario(recurso: string) {
    return <form className="my-4 grid gap-3 rounded border p-4 md:grid-cols-3" onSubmit={e => { e.preventDefault(); void enviar(recurso,Object.fromEntries(new FormData(e.currentTarget))); }}>
      {(campos[recurso] ?? []).map(c => <label className="grid gap-1" key={c.nombre}>{c.etiqueta}{c.opciones ? <select className="rounded border p-2" name={c.nombre} required defaultValue=""><option value="">Seleccione</option>{(datos[c.opciones] ?? []).filter(x => x.activo !== 0).map(x => <option key={String(x.id)} value={String(x.id)}>{String(x.nombre_comercial ?? x.nombre ?? x.referencia ?? x.id)}{x.presentacion ? ` — ${x.presentacion}` : ""}{x.producto ? ` — ${x.producto}` : ""}</option>)}</select> : <input className="rounded border p-2" name={c.nombre} type={c.tipo ?? "text"} required={c.nombre !== "marca"} min={c.tipo === "number" ? (c.nombre === "capacidad" ? "0.001" : "1") : undefined} step={c.nombre === "capacidad" ? "0.001" : undefined} />}</label>)}
      <button disabled={ocupado} className="rounded bg-blue-700 p-2 text-white disabled:opacity-50">Guardar</button>
    </form>;
  }
  function tabla(recurso: string, filas: Fila[]) {
    return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{(columnas[recurso] ?? []).map(([k,l]) => <th className="p-2" key={k}>{l}</th>)}{["recepciones","productos","ubicaciones"].includes(recurso) && <th>Acción</th>}</tr></thead><tbody>{filas.map((row,i) => <tr className="border-t" key={String(row.id ?? i)}>{(columnas[recurso] ?? []).map(([k]) => <td className="p-2" key={k}>{String(row[k] ?? "—")}</td>)}{recurso === "recepciones" && <td>{row.estado === "BORRADOR" && <button disabled={ocupado} className="rounded bg-blue-700 p-2 text-white" onClick={() => void enviar("confirmar",{id:Number(row.id)})}>Confirmar recepción física</button>}</td>}{["productos","ubicaciones"].includes(recurso) && <td><button disabled={ocupado} className="underline" onClick={() => void cambiarEstado(recurso,row)}>{row.activo ? "Desactivar" : "Activar"}</button></td>}</tr>)}</tbody></table></div>;
  }
  return <main className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Gestión de Canecas — {titulos[vista]}</h1>{mensaje && <p role="status" className="rounded border p-3">{mensaje}</p>}
    {vista === "panel" ? <><p>Existencias disponibles: {(datos.inventario ?? []).reduce((n,r) => n+Number(r.disponible),0)} canecas</p>{tabla("inventario",datos.inventario ?? [])}<h2 className="text-xl">Movimientos recientes</h2>{tabla("movimientos",(datos.movimientos ?? []).slice(0,10))}<p><a className="underline" href={`/e/${slug}/canecas/recepciones`}>Registrar recepción</a> · <a className="underline" href={`/e/${slug}/canecas/compras`}>Registrar compra</a></p></> : <>{vista === "compras" && <details><summary>Registrar proveedor comercial</summary>{formulario("proveedores")}</details>}{campos[vista] && formulario(vista)}{tabla(vista,datos[vista] ?? [])}</>}
  </main>;
}
