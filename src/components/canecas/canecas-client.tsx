"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ComprobanteVenta } from "./comprobante-venta";

type Fila = Record<string, string | number | null>;
type Campo = { nombre: string; etiqueta: string; tipo?: string; opciones?: string; opcional?: boolean; decimal?: boolean; hoy?: boolean; ayuda?: string };
const campos: Record<string, Campo[]> = {
  productos: [{nombre:"precio_venta_referencia",etiqueta:"Precio de venta de referencia en Q (opcional)",tipo:"number",decimal:true,opcional:true}],
  ubicaciones: [{nombre:"nombre",etiqueta:"Nombre de bodega o ubicación"}],
  ventas: [{nombre:"cliente_id",etiqueta:"Cliente",opciones:"clientes"},{nombre:"ubicacion_id",etiqueta:"Sale de",opciones:"ubicaciones"},{nombre:"direccion_entrega",etiqueta:"Entregar en (dirección de entrega)"},{nombre:"quien_lleva",etiqueta:"Quién lleva (opcional)",opcional:true},{nombre:"quien_recibe",etiqueta:"Quién recibe (opcional)",opcional:true},{nombre:"cantidad",etiqueta:"Canecas vendidas",tipo:"number"},{nombre:"precio_unitario",etiqueta:"Precio por caneca en Q",tipo:"number",decimal:true}],
  anular_venta: [{nombre:"venta_id",etiqueta:"Número de venta"},{nombre:"motivo",etiqueta:"Motivo de la anulación"}],
  redistribuciones: [{nombre:"compra_id",etiqueta:"Compra",opciones:"compras"},{nombre:"ubicacion_id",etiqueta:"Ubicación",opciones:"ubicaciones"},{nombre:"cantidad_final",etiqueta:"Canecas que quedan después del ajuste",tipo:"number"},{nombre:"motivo",etiqueta:"Motivo (por ejemplo: se repartió el aceite y salieron canecas extra)"}],
  reversar_redistribucion: [{nombre:"redistribucion_id",etiqueta:"Número de ajuste"},{nombre:"motivo",etiqueta:"Motivo para revertir"}],
  proveedor_rapido: [{nombre:"nombre_comercial",etiqueta:"Nombre del proveedor"}],
  proveedores: [{nombre:"nombre_comercial",etiqueta:"Nombre comercial"},{nombre:"nit",etiqueta:"NIT (opcional)",opcional:true},{nombre:"telefono",etiqueta:"Teléfono (opcional)",opcional:true},{nombre:"direccion",etiqueta:"Dirección (opcional)",opcional:true}],
  clientes: [{nombre:"nombre_comercial",etiqueta:"Nombre comercial o nombre del cliente"},{nombre:"nit",etiqueta:"NIT (opcional)",opcional:true},{nombre:"telefono",etiqueta:"Teléfono (opcional)",opcional:true},{nombre:"direccion",etiqueta:"Dirección (opcional)",opcional:true}],
  compras: [{nombre:"proveedor_id",etiqueta:"Proveedor",opciones:"proveedores"},{nombre:"ubicacion_id",etiqueta:"Ingresa a (bodega)",opciones:"ubicaciones"},{nombre:"recibido_por_empleado_id",etiqueta:"Recibido por",opciones:"empleados"},{nombre:"cantidad",etiqueta:"Canecas compradas",tipo:"number"},{nombre:"precio_compra",etiqueta:"Precio de compra por caneca en Q",tipo:"number",decimal:true}],
  valoracion_inicial: [{nombre:"producto_id",etiqueta:"Caneca",opciones:"productos"},{nombre:"ubicacion_id",etiqueta:"Ubicación",opciones:"ubicaciones"},{nombre:"cantidad",etiqueta:"Cantidad existente sin capa",tipo:"number"},{nombre:"costo",etiqueta:"Costo unitario respaldado en Q",tipo:"number",decimal:true},{nombre:"documento",etiqueta:"Documento de respaldo"},{nombre:"motivo",etiqueta:"Motivo"}],
  gastos_posteriores: [{nombre:"compra_id",etiqueta:"Compra",opciones:"compras"},{nombre:"importe",etiqueta:"Importe en Q",tipo:"number",decimal:true},{nombre:"fecha_documento",etiqueta:"Fecha del documento",tipo:"date"},{nombre:"referencia",etiqueta:"Documento"},{nombre:"motivo",etiqueta:"Motivo"}],
  precio_referencia: [{nombre:"producto_id",etiqueta:"Caneca",opciones:"productos"},{nombre:"precio_venta_referencia",etiqueta:"Precio de venta de referencia en Q (vacío: no definido)",tipo:"number",decimal:true,opcional:true}],
  salidas: [{nombre:"producto_id",etiqueta:"Caneca",opciones:"productos"},{nombre:"ubicacion_id",etiqueta:"Ubicación",opciones:"ubicaciones"},{nombre:"cantidad",etiqueta:"Cantidad",tipo:"number"},{nombre:"documento",etiqueta:"Documento"}],
  reversar_salida: [{nombre:"salida_id",etiqueta:"ID de salida"},{nombre:"motivo",etiqueta:"Motivo del reverso"}],
};
const columnasCatalogo: [string,string][] = [["nombre_comercial","Nombre comercial"],["nit","NIT"],["telefono","Teléfono"],["direccion","Dirección"],["estado","Estado"],["creado_en","Creado"]];
const columnas: Record<string, [string,string][]> = {
  ventas: [["id","N.º"],["fecha","Fecha"],["documento","Documento"],["cliente","Cliente"],["direccion_entrega","Entregar en"],["cantidad","Canecas"],["precio_unitario","Precio"],["total","Importe"],["costo_fifo","Costo FIFO"],["utilidad","Utilidad bruta"],["estado","Estado"],["usuario","Registró"],["anulada_por","Anuló"],["motivo_anulacion","Motivo"]],
  redistribuciones: [["id","N.º"],["compra","Compra"],["ubicacion","Ubicación"],["cantidad_origen","Antes"],["cantidad_resultante","Después"],["diferencia","Diferencia"],["costo_total","Costo total conservado"],["motivo","Motivo"],["estado","Estado"],["usuario","Registró"],["creado_en","Fecha"]],
  proveedores: columnasCatalogo,
  clientes: columnasCatalogo,
  productos: [["codigo","Código"],["nombre","Caneca"],["precio_referencia","Precio de venta de referencia"],["activo","Activo"]],
  ubicaciones: [["nombre","Ubicación"],["activo","Activa"]],
  compras: [["referencia","N.º de compra"],["proveedor","Proveedor"],["cantidad","Cantidad"],["precio_compra_visible","Precio unitario"],["gastos_visible","Gastos atribuibles"],["creado_en","Fecha"]],
  inventario: [["nombre","Caneca"],["ubicacion","Ubicación"],["fisico","Físico"],["reservado","Reservado"],["disponible","Disponible"],["sin_capa","Unidades sin capa"],["con_costo_pendiente","En capas sin costo"]],
  valoracion_inventario: [["nombre","Caneca"],["ubicacion","Ubicación"],["unidades","Unidades con costo"],["costo_conocido","Subtotal de costo conocido"]],
  salidas: [["id","ID"],["documento","Documento"],["producto","Caneca"],["ubicacion","Ubicación"],["cantidad","Cantidad"],["costo","Costo FIFO"],["usuario","Registró"],["creado_en","Fecha"],["reversado_en","Fecha de reverso"],["reversado_por","Reversó"],["motivo_reverso","Motivo del reverso"],["movimiento_reverso_id","Movimiento inverso"]],
  movimientos: [["tipo","Tipo"],["producto","Caneca"],["ubicacion","Ubicación"],["cantidad","Cantidad"],["documento","Documento"],["recibido_por","Recibió"],["usuario","Confirmó"],["creado_en","Fecha"]],
  valoracion_inicial: [["producto","Caneca"],["ubicacion","Ubicación"],["cantidad","Cantidad"],["costo","Costo unitario"],["documento","Documento"],["motivo","Motivo"],["usuario","Responsable"],["creado_en","Registro"]],
  gastos_posteriores: [["compra","Compra"],["importe","Importe pendiente"],["fecha_documento","Fecha del documento"],["estado","Estado"],["referencia","Documento"],["motivo","Motivo"],["usuario","Responsable"],["creado_en","Registro"]],
};
/** Recursos nuevos (#688); las rutas históricas siguen existiendo para clientes anteriores. */
const ENDPOINT: Record<string,string> = { compras:"compras_ingreso", ventas:"ventas_pos", productos:"caneca_unica" };
const titulos: Record<string,string> = { panel:"Panel general", ventas:"Ventas", redistribuciones:"Ajuste de canecas", proveedores:"Proveedores de Canecas", clientes:"Clientes de Canecas", productos:"Canecas", ubicaciones:"Ubicaciones", compras:"Compras", inventario:"Existencias", movimientos:"Historial de movimientos", salidas:"Salidas FIFO" };
export function CanecasClient({ slug, vista, permisos, empresaId, usuarioId, empresaNombre, logoUrl }: { slug: string; vista: string; permisos: Record<string, boolean>; empresaId?: number; usuarioId?: number; empresaNombre?: string; logoUrl?: string | null }) {
  const [datos,setDatos] = useState<Record<string,Fila[]>>({});
  const [mensaje,setMensaje] = useState("");
  const [cargando,setCargando] = useState(true);
  const [errorCarga,setErrorCarga] = useState("");
  const [buscar,setBuscar] = useState("");
  const [formAbierto,setFormAbierto] = useState(false);
  const [ocupado,setOcupado] = useState(false);
  const [editando,setEditando] = useState<Fila | null>(null);
  const [comprobante,setComprobante] = useState<Fila | null>(null);
  const enviando = useRef(false);
  const [totalForm,setTotalForm] = useState("");
  const [formVersion,setFormVersion] = useState(0); // cambia tras cada operación confirmada: el formulario se vacía y no puede reenviarse por accidente
  const [listaDesactualizada,setListaDesactualizada] = useState(false);
  const recursos = vista === "panel" ? ["inventario","movimientos"] : Array.from(new Set([vista,...(campos[vista] ?? []).flatMap(c => c.opciones ? [c.opciones] : []),...(vista === "compras" ? ["proveedores",...(permisos.compras ? ["gastos_posteriores"] : [])] : []),...(vista === "inventario" ? ["productos","ubicaciones",...(permisos.confirmar ? ["valoracion_inicial"] : []),...(permisos.compras ? ["valoracion_inventario"] : [])] : [])]));
  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga("");
    try {
      const resultados = await Promise.all(recursos.map(async r => {
        const response = await fetch(`/api/empresas/${encodeURIComponent(slug)}/canecas/${r}`, { cache:"no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "No se pudieron consultar los datos.");
        return [r,json.datos] as const;
      }));
      setDatos(Object.fromEntries(resultados));
      return true;
    } catch (error) { setErrorCarga(error instanceof Error ? error.message : "Error de consulta."); return false; } finally { setCargando(false); }
  // La lista depende de la vista y de los permisos de costos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug,vista,permisos.compras,permisos.confirmar]);
  useEffect(() => { const timer = setTimeout(() => { void cargar(); }, 0); return () => clearTimeout(timer); }, [cargar]);
  async function enviar(recurso: string, payload: Record<string,FormDataEntryValue | number>) {
    if (enviando.current) return;
    enviando.current = true;
    setOcupado(true); setMensaje(""); setListaDesactualizada(false);
    const destino = ENDPOINT[recurso] ?? recurso;
    // La clave de la operación se guarda en el navegador junto con la huella del formulario y se delimita por empresa y usuario (terminales
    // compartidas): si la respuesta se pierde o se recarga la página, reenviar el MISMO formulario reutiliza la clave y el servidor no duplica.
    const llave = `canecas:${slug}:${empresaId ?? "?"}:${usuarioId ?? "?"}:${destino}`;
    const huella = JSON.stringify(Object.entries(payload).sort(([a],[b]) => a.localeCompare(b)));
    let definitivo = false;
    let confirmada: string | null = null;
    try {
      try {
        if (["compras", "recepciones", "valoracion_inicial", "gastos_posteriores", "salidas", "ventas", "redistribuciones"].includes(recurso)) {
          let k = "";
          try { const g = JSON.parse(window.localStorage.getItem(llave) ?? "null"); if (g && g.huella === huella && typeof g.clave === "string") k = g.clave; } catch { /* sin almacenamiento: la clave solo vive en memoria */ }
          if (!k) k = crypto.randomUUID();
          try { window.localStorage.setItem(llave, JSON.stringify({ clave: k, huella })); } catch { /* ignorado */ }
          payload.clave_operacion = k;
        }
        const res = await fetch(`/api/empresas/${encodeURIComponent(slug)}/canecas/${destino}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
        const result = await res.json();
        definitivo = res.status < 500; // éxito o rechazo definitivo: la clave ya no sirve; con fallas del servidor/red se conserva para reintentar
        if (!res.ok) throw new Error(result.error || "No se pudo guardar.");
        confirmada = typeof result.mensaje === "string" && result.mensaje ? result.mensaje : "Operación registrada correctamente.";
      } catch (error) { setMensaje(error instanceof Error ? error.message : "Error de operación."); }
      finally { if (definitivo) { try { window.localStorage.removeItem(llave); } catch { /* ignorado */ } } }
      if (confirmada) {
        // El POST ya se confirmó: lo que ocurra al refrescar la lista NUNCA lo convierte en un aparente fallo de guardado. El formulario se
        // cierra y se vacía: otra operación exige abrir uno nuevo de forma explícita (clave nueva), no reenviar este.
        setFormAbierto(false); setEditando(null); setFormVersion(v => v + 1); setTotalForm("");
        setMensaje(confirmada);
        if (!(await cargar())) { setListaDesactualizada(true); setMensaje(`${confirmada} Guardado correctamente, pero no se pudo actualizar la lista: use «Actualizar lista» antes de registrar otra operación.`); }
      }
    } finally { enviando.current = false; setOcupado(false); }
  }
  async function actualizarLista() { if (await cargar()) { setListaDesactualizada(false); setMensaje(m => m.replace(/ Guardado correctamente, pero no se pudo actualizar la lista.*$/, "")); } }
  async function editar(recurso: string, id: string | number | null, payload: Record<string,FormDataEntryValue | number>) {
    if (enviando.current) return;
    enviando.current = true;
    setOcupado(true); setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${encodeURIComponent(slug)}/canecas/${recurso}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id:Number(id), ...payload }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "No se pudo guardar.");
      setMensaje("Registro actualizado."); setEditando(null); setFormAbierto(false); await cargar();
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
  const permisoFormulario = ["ventas","redistribuciones"].includes(vista) ? "ventas" : vista === "salidas" ? "confirmar" : vista === "compras" ? "compras" : "catalogo";
  /** Total en vivo (cantidad × precio) y, en ventas, dirección sugerida desde el cliente elegido (editable). */
  function alAcumular(e: React.FormEvent<HTMLFormElement>, recurso: string) {
    const f = e.currentTarget, valor = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? "";
    if (!["ventas","compras"].includes(recurso)) return;
    const precio = valor(recurso === "compras" ? "precio_compra" : "precio_unitario"), cantidad = Number(valor("cantidad"));
    setTotalForm(/^\d{1,9}(\.\d{1,2})?$/.test(precio) && Number.isInteger(cantidad) && cantidad > 0 ? `Q ${((Math.round(Number(precio) * 100) * cantidad) / 100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "");
    const objetivo = e.target as HTMLInputElement;
    const dir = f.elements.namedItem("direccion_entrega") as HTMLInputElement | null;
    if (recurso === "ventas" && dir && objetivo.name === "cliente_id") {
      if (!dir.value || dir.dataset.auto === "1") { dir.value = String((datos.clientes ?? []).find(c => String(c.id) === objetivo.value)?.direccion ?? ""); dir.dataset.auto = "1"; }
    } else if (objetivo.name === "direccion_entrega") dir!.dataset.auto = "0";
  }
  const puedeForm = vista === "compras" ? Boolean(permisos.compras && permisos.recepciones && permisos.confirmar) : Boolean(permisos[permisoFormulario]);
  function formulario(recurso: string, camposDe: string = recurso) {
    const enEdicion = editando && ["proveedores","clientes"].includes(recurso) ? editando : null;
    return <form key={enEdicion ? `editar-${String(enEdicion.id)}` : `nuevo-${recurso}-${formVersion}`} className="my-4 grid min-w-0 gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 md:grid-cols-2 xl:grid-cols-3" onInput={e => alAcumular(e, recurso)} onSubmit={e => { e.preventDefault(); const datos = Object.fromEntries(new FormData(e.currentTarget)); if (enEdicion) void editar(recurso,enEdicion.id,datos); else void enviar(recurso,datos); }}>
      {(campos[camposDe] ?? []).map(c => <label className="grid min-w-0 content-start gap-1.5 text-sm font-medium" key={c.nombre}>{c.etiqueta}{c.opciones ? <select className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" name={c.nombre} required defaultValue=""><option value="">Seleccione</option>{(datos[c.opciones] ?? []).filter(x => x.activo !== 0).map(x => <option key={String(x.id)} value={String(x.id)}>{String(x.nombre_comercial ?? x.nombre ?? x.referencia ?? x.id)}{x.presentacion ? ` — ${x.presentacion}` : ""}{x.producto ? ` — ${x.producto}` : ""}</option>)}</select> : <input className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" name={c.nombre} defaultValue={enEdicion ? String(enEdicion[c.nombre] ?? "") : c.nombre === "unidad_inventario" ? "caneca" : c.hoy ? new Date().toISOString().slice(0,10) : undefined} readOnly={c.nombre === "unidad_inventario"} type={c.decimal ? "text" : c.tipo ?? "text"} inputMode={c.decimal ? "decimal" : undefined} pattern={c.decimal ? "[0-9]+([.][0-9]{1,2})?" : undefined} required={c.nombre !== "marca" && !c.opcional} min={c.tipo === "number" ? (c.nombre === "capacidad" ? "0.001" : c.decimal ? "0" : "1") : undefined} step={c.nombre === "capacidad" ? "0.001" : c.decimal ? "0.01" : undefined} />}</label>)}
      {["ventas","compras"].includes(recurso) && <p className="self-end text-sm font-semibold" aria-live="polite">Total: {totalForm || "Q 0.00"}</p>}
      <button disabled={ocupado} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50">{enEdicion ? "Guardar cambios" : "Guardar"}</button>{enEdicion && <button type="button" disabled={ocupado} className="rounded-lg border border-[var(--border)] px-4 py-2" onClick={() => { setEditando(null); setFormAbierto(false); }}>Cancelar edición</button>}
    </form>;
  }
  function tabla(recurso: string, filas: Fila[]) {
    // Costos y utilidad solo se muestran con permiso de costos.
    const cols = (columnas[recurso] ?? []).filter(([k]) => permisos.compras || !["costo_fifo","utilidad","costo_total"].includes(k));
    const visibles = (cargando || errorCarga ? [] : filas).filter(row => cols.some(([k]) => String(row[k] ?? "").toLocaleLowerCase().includes(buscar.trim().toLocaleLowerCase())));
    return <div className="table-scroll min-w-0 max-w-full rounded-xl border border-[var(--border)] bg-[var(--card)]"><table className="w-full text-left text-sm"><thead className="bg-[var(--thead)] text-[var(--muted)]"><tr>{cols.map(([k,l]) => <th className="whitespace-nowrap px-4 py-3" key={k}>{l}</th>)}{((["productos","ubicaciones","proveedores","clientes"].includes(recurso) && permisos.catalogo)) && <th className="px-4 py-3">Acción</th>}{recurso === "ventas" && <th className="px-4 py-3">Comprobante</th>}</tr></thead><tbody>{visibles.map((row,i) => <tr className="border-t border-[var(--border)]" key={String(row.id ?? i)}>{cols.map(([k]) => <td className="whitespace-nowrap px-4 py-3" key={k}>{String(row[k] ?? "—")}</td>)}{recurso === "ventas" && <td className="whitespace-nowrap px-4 py-3">{row.estado === "ACTIVA" ? <button type="button" className="underline" onClick={() => setComprobante(row)}>Imprimir comprobante</button> : "—"}</td>}{["productos","ubicaciones","proveedores","clientes"].includes(recurso) && permisos.catalogo && <td className="whitespace-nowrap px-4 py-3">{["proveedores","clientes"].includes(recurso) && <button disabled={ocupado} className="mr-3 underline" onClick={() => { setEditando(row); setFormAbierto(true); }}>Editar</button>}<button disabled={ocupado} className="underline" onClick={() => void cambiarEstado(recurso,row)}>{row.activo ? "Desactivar" : "Activar"}</button></td>}</tr>)}{!visibles.length && <tr><td colSpan={cols.length + 2} className="px-4 py-8 text-center text-[var(--muted)]">{cargando ? "Cargando registros…" : errorCarga ? "No se pudieron cargar los registros." : buscar ? "No hay resultados para esta búsqueda." : "No hay registros para mostrar."}</td></tr>}</tbody></table></div>;
  }
  return <main className="min-w-0 max-w-full space-y-6 p-4 md:p-6"><header className="flex min-w-0 flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium text-[var(--muted)]">Gestión de Canecas</p><h1 className="mt-1 text-2xl font-semibold">{titulos[vista]}</h1><p className="mt-2 text-sm text-[var(--muted)]">Consulta y administra la información de {titulos[vista].toLocaleLowerCase()}.</p></div>{campos[vista] && puedeForm && (vista !== "salidas" || permisos.compras) && <button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white" aria-expanded={formAbierto} onClick={() => { setEditando(null); setFormAbierto(!formAbierto); }}>{formAbierto ? "Cerrar formulario" : "Nuevo registro"}</button>}</header>{errorCarga && <p role="alert" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{errorCarga}</p>}{listaDesactualizada && <button type="button" disabled={cargando} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => void actualizarLista()}>Actualizar lista</button>}{mensaje && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{mensaje}</p>}
    {vista === "panel" ? <><section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"><p className="text-sm text-[var(--muted)]">Existencias disponibles</p><p className="mt-2 text-3xl font-semibold">{cargando || errorCarga ? "?" : (datos.inventario ?? []).reduce((n,r) => n+Number(r.disponible),0)}</p><p className="text-sm text-[var(--muted)]">canecas</p></section><section className="min-w-0 space-y-3"><h2 className="text-lg font-semibold">Existencias por ubicación</h2>{tabla("inventario",datos.inventario ?? [])}</section><section className="space-y-3"><h2 className="text-lg font-semibold">Movimientos recientes</h2>{tabla("movimientos",(datos.movimientos ?? []).slice(0,10))}</section><div className="flex flex-wrap gap-4 text-sm"><a className="text-[var(--accent)] underline" href={`/e/${slug}/canecas/compras`}>Ver compras</a>{permisos.confirmar && permisos.compras && <a className="text-[var(--accent)] underline" href={`/e/${slug}/canecas/salidas`}>Registrar salidas</a>}</div></> : <>{formAbierto && campos[vista] && puedeForm && (vista !== "salidas" || permisos.compras) && formulario(vista)}{vista === "ventas" && permisos.ventas && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Anular una venta</summary><p className="text-sm">La venta queda registrada como anulada y las canecas regresan al inventario con su costo original. No se borra nada.</p>{formulario("anular_venta")}</details>}{vista === "redistribuciones" && permisos.ventas && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Revertir un ajuste</summary><p className="text-sm">Solo es posible si las canecas del ajuste no se han vendido ni ajustado de nuevo.</p>{formulario("reversar_redistribucion")}</details>}{vista === "salidas" && permisos.confirmar && permisos.compras && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Reversar salida</summary>{formulario("reversar_salida")}</details>}{vista === "compras" && permisos.catalogo && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Registrar proveedor comercial</summary>{formulario("proveedores","proveedor_rapido")}</details>}{vista === "productos" && permisos.catalogo && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Actualizar precio de venta de referencia</summary><p className="text-sm">El precio de referencia no modifica operaciones anteriores.</p>{formulario("precio_referencia")}</details>}{vista === "inventario" && permisos.confirmar && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Conciliar existencia inicial</summary><p className="text-sm">Solo unidades existentes sin capa. Si no conoce su costo, consérvelas pendientes hasta tener respaldo.</p>{formulario("valoracion_inicial")}{tabla("valoracion_inicial",datos.valoracion_inicial ?? [])}</details>}{vista === "compras" && permisos.compras && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><summary className="cursor-pointer font-medium">Registrar gasto posterior</summary><p className="text-sm">Queda pendiente de aplicación contable; no altera costos históricos.</p>{formulario("gastos_posteriores")}{tabla("gastos_posteriores",datos.gastos_posteriores ?? [])}</details>}<section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Registros</h2><label className="grid gap-1 text-sm text-[var(--muted)]">Buscar<input className="w-full max-w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar en registros" /></label></div>{tabla(vista,datos[vista] ?? [])}</section>{vista === "inventario" && permisos.compras && <section className="space-y-3"><h2 className="text-lg font-semibold">Costo conocido en Q</h2><p className="text-sm text-[var(--muted)]">Subtotal parcial: no incluye unidades sin capa ni capas con costo pendiente.</p>{tabla("valoracion_inventario",datos.valoracion_inventario ?? [])}</section>}</>}
    {comprobante && <ComprobanteVenta onCerrar={() => setComprobante(null)} datos={{ empresaNombre: empresaNombre ?? "", logoUrl, documento: String(comprobante.documento ?? ""), fecha: String(comprobante.fecha ?? ""), cliente: String(comprobante.cliente ?? ""), origen: String(comprobante.ubicacion ?? ""), destino: String(comprobante.direccion_entrega ?? ""), producto: String(comprobante.producto ?? ""), cantidad: String(comprobante.cantidad ?? ""), precioUnitario: String(comprobante.precio_unitario ?? ""), total: String(comprobante.total ?? ""), quienLleva: String(comprobante.quien_lleva ?? ""), quienRecibe: String(comprobante.quien_recibe ?? "") }} />}
  </main>;
}
