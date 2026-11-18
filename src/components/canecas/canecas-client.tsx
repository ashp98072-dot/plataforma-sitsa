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
  const [cargando,setCargando] = useState(true);
  const [errorConsulta,setErrorConsulta] = useState(false);
  const [buscar,setBuscar] = useState("");
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
      setDatos(Object.fromEntries(resultados)); setErrorConsulta(false);
    } catch (error) { setErrorConsulta(true); setMensaje(error instanceof Error ? error.message : "Error de consulta."); }
    finally { setCargando(false); }
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
  const inputClass = "w-full rounded border border-[var(--border)] bg-[var(--input)] p-2";
  const buttonClass = "rounded bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50";
  const panelClass = "rounded-xl border border-[var(--border)] bg-[var(--card)]";
  const descripciones: Record<string, string> = {
    panel: "Consulta las existencias disponibles y los movimientos recientes.",
    productos: "Administra el cat?logo de aceites y sus presentaciones.",
    ubicaciones: "Administra las bodegas y ubicaciones de almacenamiento.",
    compras: "Registra compras de canecas y consulta sus documentos.",
    recepciones: "Registra y confirma la recepci?n f?sica de las compras.",
    inventario: "Consulta las existencias f?sicas, reservadas y disponibles por ubicaci?n.",
    movimientos: "Consulta la trazabilidad de los movimientos registrados.",
  };
  function formulario(recurso: string) {
    return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void enviar(recurso,Object.fromEntries(new FormData(e.currentTarget))); }}>
      <fieldset disabled={ocupado} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(campos[recurso] ?? []).map(c => <label className="grid gap-1 text-sm" key={c.nombre}>{c.etiqueta}{c.opciones ? <select className={inputClass} name={c.nombre} required defaultValue=""><option value="">Seleccione</option>{(datos[c.opciones] ?? []).filter(x => x.activo !== 0).map(x => <option key={String(x.id)} value={String(x.id)}>{String(x.nombre_comercial ?? x.nombre ?? x.referencia ?? x.id)}{x.presentacion ? " ? " + x.presentacion : ""}{x.producto ? " ? " + x.producto : ""}</option>)}</select> : <input className={inputClass} name={c.nombre} type={c.tipo ?? "text"} required={c.nombre !== "marca"} min={c.tipo === "number" ? (c.nombre === "capacidad" ? "0.001" : "1") : undefined} step={c.nombre === "capacidad" ? "0.001" : undefined} />}</label>)}
      </fieldset>
      <button disabled={ocupado} className={buttonClass}>{ocupado ? "Guardando?" : "Guardar"}</button>
    </form>;
  }
  function tabla(recurso: string, filas: Fila[]) {
    const acciones = ["recepciones","productos","ubicaciones"].includes(recurso);
    const visibles = filas.filter(row => (columnas[recurso] ?? []).some(([k]) => String(row[k] ?? "").toLocaleLowerCase().includes(buscar.trim().toLocaleLowerCase())));
    return <div className={panelClass + " overflow-x-auto"}><table className="w-full text-left text-sm"><thead className="bg-[var(--thead)]"><tr>{(columnas[recurso] ?? []).map(([k,l]) => <th scope="col" className="whitespace-nowrap p-3" key={k}>{l}</th>)}{acciones && <th scope="col" className="p-3">Acci?n</th>}</tr></thead><tbody>{visibles.map((row,i) => <tr className="border-t border-[var(--border)]" key={String(row.id ?? i)}>{(columnas[recurso] ?? []).map(([k]) => <td className="p-3" key={k}>{k === "activo" ? (row[k] ? "Activo" : "Inactivo") : String(row[k] ?? "?")}</td>)}{recurso === "recepciones" && <td className="p-3">{row.estado === "BORRADOR" && <button disabled={ocupado} className={buttonClass} onClick={() => void enviar("confirmar",{id:Number(row.id)})}>Confirmar recepci?n f?sica</button>}</td>}{["productos","ubicaciones"].includes(recurso) && <td className="p-3"><button disabled={ocupado} className="underline disabled:opacity-50" onClick={() => void cambiarEstado(recurso,row)}>{row.activo ? "Desactivar" : "Activar"}</button></td>}</tr>)}{!visibles.length && <tr><td colSpan={(columnas[recurso] ?? []).length + Number(acciones)} className="p-5 text-[var(--muted)]">{buscar.trim() ? "No hay registros que coincidan con la b?squeda." : "No hay registros para mostrar."}</td></tr>}</tbody></table></div>;
  }
  function registro(recurso: string, titulo: string) {
    return <details className={panelClass + " p-5"}><summary className="cursor-pointer font-semibold">{titulo}</summary><div className="mt-4">{formulario(recurso)}</div></details>;
  }
  return <main className="space-y-5 p-4 sm:p-6">
    <header className="space-y-1"><p className="text-sm text-[var(--muted)]">Gesti?n de Canecas</p><h1 className="text-2xl font-semibold">{titulos[vista]}</h1><p className="text-sm text-[var(--muted)]">{descripciones[vista]}</p></header>
    {mensaje && <p role={errorConsulta ? "alert" : "status"} className={panelClass + " p-3"}>{mensaje}</p>}
    {cargando ? <p role="status">Cargando datos?</p> : errorConsulta ? <button type="button" className={buttonClass} onClick={() => { setCargando(true); void cargar(); }}>Reintentar</button> : <>
      {vista === "panel" ? <>
        <div className={panelClass + " p-5"}><p className="text-sm text-[var(--muted)]">Existencias disponibles</p><p className="mt-1 text-3xl font-semibold">{(datos.inventario ?? []).reduce((n,r) => n+Number(r.disponible),0)} <span className="text-base font-normal">canecas</span></p></div>
        <section className="space-y-3"><h2 className="text-lg font-semibold">Existencias por ubicaci?n</h2>{tabla("inventario",datos.inventario ?? [])}</section>
        <section className="space-y-3"><h2 className="text-lg font-semibold">Movimientos recientes</h2>{tabla("movimientos",(datos.movimientos ?? []).slice(0,10))}</section>
        <div className="flex flex-wrap gap-4 text-sm"><a className="underline" href={"/e/" + encodeURIComponent(slug) + "/canecas/recepciones"}>Registrar recepci?n</a><a className="underline" href={"/e/" + encodeURIComponent(slug) + "/canecas/compras"}>Registrar compra</a></div>
      </> : <>
        {campos[vista] && registro(vista, vista === "productos" ? "Registrar aceite" : vista === "ubicaciones" ? "Registrar ubicaci?n" : vista === "compras" ? "Registrar compra" : "Registrar recepci?n")}
        {vista === "compras" && registro("proveedores", "Registrar proveedor comercial")}
        <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Registros</h2><label className="grid gap-1 text-sm">Buscar registros<input className={inputClass} value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar" /></label></div>{tabla(vista,datos[vista] ?? [])}</section>
      </>}
    </>}
  </main>;
}
