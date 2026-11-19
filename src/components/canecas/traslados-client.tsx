"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Opcion = { id: number; nombre: string; presentacion?: string; activo?: number };
type Partida = { id: number; producto: string; presentacion: string; cantidad: number; recibido: number; faltante: number; transito: number };
type Traslado = { id: number; numero: string; estado: string; origen: string; destino: string; versiones: number; partidas: Partida[] };
const campo = "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2";
const boton = "rounded-lg bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50";

export function TrasladosClient({ slug, permisos }: { slug: string; permisos: Record<string, boolean> }) {
  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [productos, setProductos] = useState<Opcion[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Opcion[]>([]);
  const [lineas, setLineas] = useState([{ productoId: "", cantidad: "" }]);
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const llaves = useRef<Record<string, string>>({});
  const enviando = useRef(false);
  const base = `/api/empresas/${encodeURIComponent(slug)}/canecas`;
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const resultados = await Promise.all(["traslados", "productos", "ubicaciones"].map(async r => {
        const res = await fetch(`${base}/${r}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al consultar datos.");
        return json.datos;
      }));
      setTraslados(resultados[0]); setProductos(resultados[1]); setUbicaciones(resultados[2]);
    } catch (error) { setMensaje(error instanceof Error ? error.message : "No se pudo consultar."); }
    finally { setCargando(false); }
  }, [base]);
  useEffect(() => { const timer = setTimeout(() => void cargar(), 0); return () => clearTimeout(timer); }, [cargar]);
  async function ejecutar(clave: string, payload: Record<string, unknown>, conLlave: boolean) {
    if (enviando.current) return;
    enviando.current = true; setOcupado(true); setMensaje("");
    try {
      if (conLlave) { llaves.current[clave] ??= crypto.randomUUID(); payload.clave = llaves.current[clave]; }
      const res = await fetch(`${base}/traslados`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo completar la operación.");
      delete llaves.current[clave]; setMensaje("Operación registrada correctamente."); await cargar();
    } catch (error) { setMensaje(error instanceof Error ? error.message : "No se pudo completar la operación."); }
    finally { enviando.current = false; setOcupado(false); }
  }
  return <main className="min-w-0 max-w-full space-y-6 p-4 md:p-6">
    <header><p className="text-sm text-[var(--muted)]">Gestión de Canecas</p><h1 className="mt-1 text-2xl font-semibold">Traslados</h1><p className="mt-2 text-sm text-[var(--muted)]">Consulte los traslados y sus comprobantes.</p></header>
    {mensaje && <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{mensaje}</p>}
    {permisos.recepciones && <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"><summary className="cursor-pointer font-medium">Nuevo traslado</summary>
      <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void ejecutar("crear", { accion: "crear", origenId: Number(f.get("origen")), destinoId: Number(f.get("destino")), entrega: f.get("entrega"), transporte: f.get("transporte"), observaciones: f.get("observaciones"), partidas: lineas.map(l => ({ productoId: Number(l.productoId), cantidad: Number(l.cantidad) })) }, true); }}>
        {["origen", "destino"].map(n => <label className="grid gap-1" key={n}>{n === "origen" ? "Origen" : "Destino"}<select className={campo} name={n} required defaultValue=""><option value="">Seleccione</option>{ubicaciones.filter(u => u.activo !== 0).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>)}
        {[ ["entrega", "Quien entrega"], ["transporte", "Responsable del transporte"], ["observaciones", "Observaciones"] ].map(([n,l]) => <label className="grid gap-1" key={n}>{l}<input className={campo} name={n} required={n === "entrega"} maxLength={n === "observaciones" ? 1000 : 200} /></label>)}
        <fieldset className="space-y-3 md:col-span-2"><legend>Productos</legend>{lineas.map((l,i) => <div className="flex flex-wrap gap-2" key={i}><select className={campo} required value={l.productoId} onChange={e => setLineas(v => v.map((x,j) => i === j ? { ...x, productoId: e.target.value } : x))}><option value="">Seleccione producto</option>{productos.filter(p => p.activo !== 0).map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.presentacion}</option>)}</select><input aria-label="Cantidad" className={campo} type="number" min="1" step="1" required value={l.cantidad} onChange={e => setLineas(v => v.map((x,j) => i === j ? { ...x, cantidad: e.target.value } : x))} />{lineas.length > 1 && <button type="button" className="underline" onClick={() => setLineas(v => v.filter((_,j) => j !== i))}>Quitar</button>}</div>)}<button type="button" className="underline" onClick={() => setLineas(v => [...v, { productoId: "", cantidad: "" }])}>Agregar producto</button></fieldset>
        <button className={boton} disabled={ocupado}>Guardar borrador</button>
      </form></details>}
    <section className="space-y-4"><h2 className="text-lg font-semibold">Historial</h2>{cargando && <p>Cargando traslados…</p>}{!cargando && !traslados.length && <p>No hay traslados registrados.</p>}{traslados.map(t => <article key={t.id} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="font-semibold">{t.numero} · {t.estado}</h3><p>{t.origen} → {t.destino}</p>
      <div className="table-scroll max-w-full"><table className="w-full text-left text-sm"><thead><tr>{["Producto", "Presentación", "Enviado", "Recibido", "Faltante", "En tránsito"].map(x => <th key={x} className="whitespace-nowrap p-2">{x}</th>)}</tr></thead><tbody>{t.partidas.map(p => <tr key={p.id} className="border-t border-[var(--border)]">{[p.producto,p.presentacion,p.cantidad,p.recibido,p.faltante,p.transito].map((v,i) => <td key={i} className="whitespace-nowrap p-2">{v}</td>)}</tr>)}</tbody></table></div>
      {t.estado === "BORRADOR" && permisos.confirmar && <button className={boton} disabled={ocupado} onClick={() => void ejecutar(`enviar-${t.id}`, { accion: "enviar", id: t.id }, false)}>Confirmar envío</button>}
      {Number(t.versiones) > 0 && <p className="flex flex-wrap gap-3">{Array.from({ length: Number(t.versiones) }, (_, i) => <a key={i} className="text-[var(--accent)] underline" target="_blank" rel="noreferrer" href={`${base}/traslados/${t.id}/comprobante?version=${i + 1}`}>Comprobante v{i + 1}</a>)}</p>}
      {t.estado === "ENVIADO" && permisos.confirmar && <details><summary className="cursor-pointer underline">Registrar recepción o faltante</summary><form className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const partidas = t.partidas.map(p => ({ partidaId: p.id, recibido: Number(f.get(`recibido-${p.id}`)), faltante: Number(f.get(`faltante-${p.id}`)), motivo: String(f.get(`motivo-${p.id}`) || "") })).filter(p => p.recibido || p.faltante); void ejecutar(`recibir-${t.id}`, { accion: "recibir", id: t.id, recibe: f.get("recibe"), condicion: f.get("condicion"), observaciones: f.get("obs") || "", partidas }, true); }}>
        <label>Quien recibe<input className={campo} name="recibe" required maxLength={200} /></label><label>Condición de entrega<input className={campo} name="condicion" required maxLength={500} /></label><label>Observaciones<input className={campo} name="obs" maxLength={1000} /></label>
        {t.partidas.filter(p => p.transito > 0).map(p => <fieldset key={p.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 md:grid-cols-3"><legend>{p.producto} — pendiente: {p.transito}</legend><label>Recibido<input className={campo} type="number" min="0" max={p.transito} step="1" defaultValue="0" name={`recibido-${p.id}`} /></label><label>Faltante<input className={campo} type="number" min="0" max={p.transito} step="1" defaultValue="0" name={`faltante-${p.id}`} /></label><label>Motivo del faltante<input className={campo} name={`motivo-${p.id}`} maxLength={500} /></label></fieldset>)}<button className={boton} disabled={ocupado}>Confirmar recepción</button></form></details>}
    </article>)}</section>
  </main>;
}

