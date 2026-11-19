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
export function CanecasClient({ slug, vista, permisos }: { slug: string; vista: string; permisos: Record<string, boolean> }) {
  const [datos,setDatos] = useState<Record<string,Fila[]>>({});
  const [mensaje,setMensaje] = useState("");
  const [cargando,setCargando] = useState(true);
  const [errorCarga,setErrorCarga] = useState(false);
  const [buscar,setBuscar] = useState("");
  const [formAbierto,setFormAbierto] = useState(false);
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
      setDatos(Object.fromEntries(resultados)); setErrorCarga(false);
    } catch (error) { setErrorCarga(true); setMensaje(error instanceof Error ? error.message : "Error de consulta."); } finally { setCargando(false); }
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
  const permisoFormulario = vista === "compras" ? "compras" : vista === "recepciones" ? "recepciones" : "catalogo";
  function formulario(recurso: string) {
    return <form className="my-4 grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 md:grid-cols-2 xl:grid-cols-3" onSubmit={e => { e.preventDefault(); void enviar(recurso,Object.fromEntries(new FormData(e.currentTarget))); }}>
      {(campos[recurso] ?? []).map(c => <label className="grid content-start gap-1.5 text-sm font-medium" key={c.nombre}>{c.etiqueta}{c.opciones ? <select className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" name={c.nombre} required defaultValue=""><option value="">Seleccione</option>{(datos[c.opciones] ?? []).filter(x => x.activo !== 0).map(x => <option key={String(x.id)} value={String(x.id)}>{String(x.nombre_comercial ?? x.nombre ?? x.referencia ?? x.id)}{x.presentacion ? ` — ${x.presentacion}` : ""}{x.producto ? ` — ${x.producto}` : ""}</option>)}</select> : <input className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" name={c.nombre} type={c.tipo ?? "text"} required={c.nombre !== "marca"} min={c.tipo === "number" ? (c.nombre === "capacidad" ? "0.001" : "1") : undefined} step={c.nombre === "capacidad" ? "0.001" : undefined} />}</label>)}
      <button disabled={ocupado} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50">Guardar</button>
    </form>;
  }
  function tabla(recurso: string, filas: Fila[]) {
    const visibles = filas.filter(row => (columnas[recurso] ?? []).some(([k]) => String(row[k] ?? "").toLocaleLowerCase().includes(buscar.trim().toLocaleLowerCase())));
    return <div className="table-scroll rounded-xl border border-[var(--border)] bg-[var(--card)]"><table className="w-full text-left text-sm"><thead className="bg-[var(--thead)] text-[var(--muted)]"><tr>{(columnas[recurso] ?? []).map(([k,l]) => <th className="whitespace-nowrap px-4 py-3" key={k}>{l}</th>)}{["recepciones","productos","ubicaciones"].includes(recurso) && <th>Acción</th>}</tr></thead><tbody>{visibles.map((row,i) => <tr className="border-t border-[var(--border)]" key={String(row.id ?? i)}>{(columnas[recurso] ?? []).map(([k]) => <td className="whitespace-nowrap px-4 py-3" key={k}>{String(row[k] ?? "—")}</td>)}{recurso === "recepciones" && permisos.confirmar && <td>{row.estado === "BORRADOR" && <button disabled={ocupado} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white" onClick={() => void enviar("confirmar",{id:Number(row.id)})}>Confirmar recepción física</button>}</td>}{["productos","ubicaciones"].includes(recurso) && permisos.catalogo && <td><button disabled={ocupado} className="underline" onClick={() => void cambiarEstado(recurso,row)}>{row.activo ? "Desactivar" : "Activar"}</button></td>}</tr>)}{!visibles.length && <tr><td colSpan={(columnas[recurso] ?? []).length + 1} className="px-4 py-8 text-center text-[var(--muted)]">{cargando ? "Cargando registros?" : errorCarga ? "No se pudieron cargar los registros." : buscar ? "No hay resultados para esta b?squeda." : "No hay registros para mostrar."}</td></tr>}</tbody></table></div>;
  }
  return <main className="space-y-6 p-4 md:p-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[var(--muted)]">Gesti?n de Canecas</p><h1 className="mt-1 text-2xl font-semibold">{titulos[vista]}</h1><p className="mt-2 text-sm text-[var(--muted)]">Consulta y administra la informaci?n de {titulos[vista].toLocaleLowerCase()}.</p></div>{campos[vista] && permisos[permisoFormulario] && <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white" aria-expanded={formAbierto} onClick={() => setFormAbierto(!formAbierto)}>{formAbierto ? "Cerrar formulario" : "Nuevo registro"}</button>}</header>{mensaje && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{mensaje}</p>}
    {vista === "panel" ? <><section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"><p className="text-sm text-[var(--muted)]">Existencias disponibles</p><p className="mt-2 text-3xl font-semibold">{cargando || errorCarga ? "?" : (datos.inventario ?? []).reduce((n,r) => n+Number(r.disponible),0)}</p><p className="text-sm text-[var(--muted)]">canecas</p></section><section className="space-y-3"><h2 className="text-lg font-semibold">Existencias por ubicaci?n</h2>{tabla("inventario",datos.inventario ?? [])}</section><section className="space-y-3"><h2 className="text-lg font-semibold">Movimientos recientes</h2>{tabla("movimientos",(datos.movimientos ?? []).slice(0,10))}</section><div className="flex flex-wrap gap-4 text-sm"><a className="text-[var(--accent)] underline" href={`/e/${slug}/canecas/recepciones`}>Ver recepciones</a><a className="text-[var(--accent)] underline" href={`/e/${slug}/canecas/compras`}>Ver compras</a></div></> : <>{formAbierto && campos[vista] && permisos[permisoFormulario] && formulario(vista)}{vista === "compras" && permisos.catalogo && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Registrar proveedor comercial</summary>{formulario("proveedores")}</details>}<section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Registros</h2><label className="grid gap-1 text-sm text-[var(--muted)]">Buscar<input className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar en registros" /></label></div>{tabla(vista,datos[vista] ?? [])}</section></>}
  </main>;
}
