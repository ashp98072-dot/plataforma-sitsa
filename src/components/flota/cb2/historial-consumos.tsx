"use client";
import { useEffect, useState } from "react";
import { jsonCB2, type CatalogosCB2, type Registro } from "./client";
import { button, input } from "./controles";

type Cursor = { corte: number; fecha: string; id: number };
type Pagina = { items: Registro[]; siguiente: Cursor | null };
export function HistorialConsumosCB2({ api, cat }: { api: string; cat: CatalogosCB2 }) {
 const [query, setQuery] = useState("");
 const [cursores, setCursores] = useState<(Cursor | null)[]>([null]);
 const [resultado, setResultado] = useState<{ clave: string; pagina: Pagina | null; error: string }>({ clave: "", pagina: null, error: "" });
 const [revision, setRevision] = useState(0);
 const cursor = cursores.at(-1);
 const clave = JSON.stringify([query, cursor, revision]);
 const busy = resultado.clave !== clave, pagina = busy ? null : resultado.pagina, error = busy ? "" : resultado.error;
 useEffect(() => {
  const ac = new AbortController();
  const q = new URLSearchParams(query);
  if (cursor) { q.set("corte", String(cursor.corte)); q.set("fechaCursor", cursor.fecha); q.set("idCursor", String(cursor.id)); }
  jsonCB2<Pagina>(`${api}/historial-consumos?${q}`, { signal: ac.signal }).then(data => { if (!ac.signal.aborted) setResultado({ clave, pagina: data, error: "" }); }).catch(e => { if (!ac.signal.aborted) setResultado({ clave, pagina: null, error: e.message }); });
  return () => ac.abort();
 }, [api, query, cursor, clave]);
 return <section aria-label="Historial cronológico de consumos" className="space-y-4"><h2 className="text-lg font-semibold">Historial cronológico de consumos</h2>
  <p>Orden por fecha de consumo e ID descendentes. La fecha registrada no incluye hora. Este listado no es una instantánea: cambios o confirmaciones tardías pueden afectar páginas posteriores; vuelve a consultar para actualizarlas.</p>
  <form className="grid gap-3 md:grid-cols-4" onSubmit={e => { e.preventDefault(); const q = new URLSearchParams(); for (const [k,v] of new FormData(e.currentTarget)) if (typeof v === "string" && v.trim()) q.set(k,v.trim()); setCursores([null]); setQuery(q.toString()); setRevision(n=>n+1); }}>
   <label>Desde<input className={input} type="date" name="desde"/></label><label>Hasta<input className={input} type="date" name="hasta"/></label><label>Piloto<input className={input} name="piloto" maxLength={160}/></label><label>Proveedor<select className={input} name="proveedorId"><option value="">Todos</option>{cat.proveedores.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><button className={button}>Consultar</button>
  </form>{busy && <p role="status">Cargando historial…</p>}{error && <p role="alert">{error}</p>}
  {pagina && <><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Piloto", "Unidad / placa", "Proveedor", "Vale", "Producto", "Galones", "Importe consumo", "Factura", "Origen"].map(x=><th className="p-2 text-left" key={x}>{x}</th>)}</tr></thead><tbody>{pagina.items.map(r=><tr className="border-t border-[var(--border)]" key={r.id}><td>{String(r.fecha)}</td><td>{String(r.empleado_nombre ?? r.piloto_informado ?? "No informado")}</td><td>{String(r.unidad_placa ?? "No informada")} {r.vehiculo_id != null ? `· Unidad #${r.vehiculo_id}` : r.unidad_externa_id != null ? `· Externa #${r.unidad_externa_id}` : ""}</td><td>{String(r.proveedor ?? `#${r.proveedor_id}`)}</td><td>{String(r.numero_vale ?? "—")}</td><td>{String(r.producto ?? "No informado")}</td><td>{String(r.galones ?? "—")}</td><td>{String(r.moneda ?? "")} {String(r.monto ?? "—")}</td><td>{r.factura_id == null ? "Sin factura" : `${r.factura_serie ?? ""} ${r.factura_numero ?? ""} (#${r.factura_id})`}</td><td>{String(r.perfil ?? "")} · Importación #{String(r.importacion_origen_id)} · Consumo #{r.id}</td></tr>)}</tbody></table></div>{!pagina.items.length && <p>No hay consumos para estos filtros.</p>}<div className="flex gap-2"><button className={button} type="button" disabled={busy || cursores.length === 1} onClick={()=>setCursores(c=>c.slice(0,-1))}>Anterior</button><span>Página {cursores.length}</span><button className={button} type="button" disabled={busy || !pagina.siguiente} onClick={()=>pagina.siguiente && setCursores(c=>[...c,pagina.siguiente])}>Siguiente</button></div></>}
 </section>;
}
