"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { PreviewCombustibleV2 } from "./combustible-preview-v2";
import type { AnalisisImportacion, FilaImportada } from "@/lib/flota/combustible-importacion-parser";
const input = "rounded border border-[var(--border)] bg-[var(--input)] p-2";
type Resumen = AnalisisImportacion["resumen"];
type Cabecera = { id: number; archivo: string; proveedor: string; usuario: string; fecha: string; estado: string; resumen: string | Resumen };
const resumen = (r: string | Resumen): Resumen => typeof r === "string" ? JSON.parse(r) : r;
function ResumenImportacion({ data }: { data: Resumen }) {
  return <p>Filas originales: {data.filasOriginales} · Encontradas: {data.encontradas} · Válidas: {data.validas} · Advertencias: {data.advertencias} · Inválidas: {data.invalidas} · Ignoradas: {data.ignoradas} · Duplicados exactos internos: {data.duplicadosInternos} · Posibles internos: {data.posiblesDuplicados} · Posibles previos: {data.duplicadosPrevios} · Operaciones únicas estimadas: {data.operacionesUnicasEstimadas}</p>;
}
export function FilasImportacion({ filas }: { filas: FilaImportada[] }) {
  const [q, setQ] = useState(""), [hoja, setHoja] = useState(""), [estado, setEstado] = useState("OPERATIVAS"), [duplicados, setDuplicados] = useState(false), [pagina, setPagina] = useState(0);
  const filtradas = filas.filter(f => (!hoja || f.hoja === hoja) && (!estado || (estado === "OPERATIVAS" ? f.estado !== "IGNORADA" : f.estado === estado)) && (!duplicados || f.duplicado || f.duplicadoPrevio)
    && `${f.textos.vale} ${f.textos.placa} ${f.textos.factura}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()));
  const page = Math.min(pagina, Math.max(0, Math.ceil(filtradas.length / 100) - 1));
  return <section className="space-y-2"><div className="flex flex-wrap gap-2">
    <input className={input} placeholder="Buscar vale, placa o factura" value={q} onChange={e => { setQ(e.target.value); setPagina(0); }} />
    <select className={input} aria-label="Hoja" value={hoja} onChange={e => { setHoja(e.target.value); setPagina(0); }}><option value="">Todas las hojas</option>{[...new Set(filas.map(f => f.hoja))].map(h => <option key={h}>{h}</option>)}</select>
    <select className={input} aria-label="Estado de parsing" value={estado} onChange={e => { setEstado(e.target.value); setPagina(0); }}>{["OPERATIVAS", "", "VALIDA", "ADVERTENCIA", "INVALIDA", "IGNORADA"].map(s => <option value={s} key={s}>{s || "Todos los estados"}</option>)}</select>
    <label><input type="checkbox" checked={duplicados} onChange={e => setDuplicados(e.target.checked)} /> Solo duplicados/posibles</label>
  </div><p>{filtradas.length} filas filtradas; página {page + 1}. La fecha es de reporte, no certifica consumo. Las estimaciones no son conciliación ni total financiero.</p>
    <div className="overflow-auto"><table className="w-full text-xs"><thead><tr>{["Hoja", "Fila", "Fecha de reporte", "Placa", "Vale", "Galones", "Precio", "Total", "Kilometraje", "Piloto (proveedor)", "Serie", "Factura", "Parsing", "Duplicado", "Origen"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{filtradas.slice(page * 100, (page + 1) * 100).map(f => <tr key={`${f.hoja}:${f.fila}`} className="border-t border-[var(--border)]">
        <td className="p-2">{f.hoja}</td><td>{f.fila}</td><td>{f.textos.fecha}<small className="block">{f.fechaReporte ?? "Sin normalizar"}</small></td><td>{f.textos.placa}</td><td>{f.textos.vale}</td><td>{f.textos.galones}</td><td>{f.textos.precio}</td><td>{f.textos.total}</td><td>{f.textos.km}</td><td>{f.textos.piloto}</td><td>{f.textos.serie}</td><td>{f.textos.factura}</td>
        <td>{f.estado}<small className="block">{f.motivos.join(" · ")}</small></td><td>{f.duplicado ?? "—"}{f.duplicadoPrevio && <strong className="block">Operación posiblemente ya importada</strong>}{f.canonica != null && <small className="block">Referencia canónica: fila original #{f.canonica + 1}</small>}</td>
        <td><details><summary>Ver celdas originales</summary><pre className="max-w-md whitespace-pre-wrap">{JSON.stringify(f.raw, null, 2)}</pre></details></td>
      </tr>)}</tbody></table></div>
    <button type="button" disabled={page === 0} onClick={() => setPagina(page - 1)}>Anterior</button>{" "}<button type="button" disabled={(page + 1) * 100 >= filtradas.length} onClick={() => setPagina(page + 1)}>Siguiente</button>
  </section>;
}
export function NuevaImportacionCombustible({ slug }: { slug: string }) {
  const [legacy, setLegacy] = useState(true);
  return <section className="space-y-4 p-4"><h1>Importaciones de proveedor</h1>
    <Link prefetch={false} href={`/e/${slug}/combustibles/importaciones`}>Volver a importaciones</Link>
    <label className="block">Flujo <select value={legacy ? "legacy" : "v2"} onChange={e => setLegacy(e.target.value === "legacy")}>
      <option value="v2">Diagnóstico HALEL / SHELL (solo lectura)</option><option value="legacy">Importación histórica HALEL v1 (evidencia para conciliación)</option>
    </select></label>
    {legacy ? <NuevaImportacionLegacy slug={slug} /> : <PreviewCombustibleV2 slug={slug} />}
  </section>;
}
function NuevaImportacionLegacy({ slug }: { slug: string }) {
  const router = useRouter();
  const [proveedores, setProveedores] = useState<{ id: number; nombre: string }[]>([]), [proveedorId, setProveedor] = useState(""), [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<(AnalisisImportacion & { token: string; sha256: string }) | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const enCurso = useRef(false);
  useEffect(() => { const ac = new AbortController(); fetch(`/api/empresas/${slug}/flota/combustible/catalogos`, { signal: ac.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "No se pudieron cargar proveedores."); if (!ac.signal.aborted) setProveedores(data.proveedores); }).catch(e => { if (!ac.signal.aborted) setError(e.message); }); return () => ac.abort(); }, [slug]);
  async function enviar(confirmar: boolean) {
    if (enCurso.current || !file || !proveedorId || (confirmar && !preview)) return;
    enCurso.current = true; setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("proveedorId", proveedorId); if (preview) form.set("token", preview.token);
      const r = await fetch(`/api/empresas/${slug}/flota/combustible/importaciones${confirmar ? "" : "/preview"}`, { method: "POST", body: form }); const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "No se pudo procesar el archivo.");
      if (confirmar) router.push(`/e/${slug}/combustibles/importaciones/${data.id}`); else setPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de importación."); setPreview(null); }
    finally { enCurso.current = false; setBusy(false); }
  }
  return <section className="space-y-4 p-4"><h1>Importar reporte de proveedor</h1><Link prefetch={false} href={`/e/${slug}/combustibles/importaciones`}>Volver a importaciones</Link>
    <form onSubmit={e => { e.preventDefault(); void enviar(false); }}><fieldset disabled={busy} className="space-y-3">
      <CatalogoSearchSelect label="Proveedor" placeholder="Buscar proveedor..." value={proveedorId} onChange={v => { setProveedor(v); setPreview(null); }} inputClassName={input} options={proveedores.map(p => ({ value: String(p.id), label: p.nombre }))} />
      <label>Archivo .xlsx (máximo 50 MB)<input type="file" accept=".xlsx" required onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></label>
      <button disabled={!file || !proveedorId || busy}>{busy ? "Procesando…" : "Analizar / Preview"}</button>
      {preview && <button type="button" onClick={() => void enviar(true)}>Confirmar importación de todas las filas, incluidas advertencias e inválidas</button>}
    </fieldset></form>{error && <p role="alert" className="text-red-500">{error}</p>}
    {preview && <><p>SHA-256: {preview.sha256}. Se conservan todas las filas; duplicados no son consumos adicionales certificados.</p><ResumenImportacion data={preview.resumen} /><FilasImportacion filas={preview.filas} /></>}
  </section>;
}
export function ImportacionesCombustible({ slug, puedeImportar, id }: { slug: string; puedeImportar: boolean; id?: string }) {
  const [items, setItems] = useState<Cabecera[]>([]), [detalle, setDetalle] = useState<(Cabecera & { filas: FilaImportada[] }) | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/flota/combustible/importaciones${id ? `/${id}` : ""}`, { signal: ac.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "No se pudieron cargar las importaciones.");
      if (!ac.signal.aborted) { if (id) setDetalle(data); else setItems(data.items); }
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [slug, id]);
  return <section className="space-y-4 p-4"><h1>Importaciones de proveedor</h1><Link prefetch={false} href={`/e/${slug}/combustibles`}>Volver a Combustibles</Link>{" "}{puedeImportar && <Link prefetch={false} href={`/e/${slug}/combustibles/importaciones/nueva`}>Nueva importación</Link>}
    {error && <p role="alert">{error}</p>}{detalle ? <><h2>{detalle.archivo} · {detalle.proveedor}</h2><p>{String(detalle.fecha)} · {detalle.usuario} · {detalle.estado}</p><a href={`/api/empresas/${slug}/flota/combustible/importaciones/${detalle.id}/archivo`}>Descargar Excel original</a><ResumenImportacion data={resumen(detalle.resumen)} /><FilasImportacion filas={detalle.filas} /></> : !id && <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Proveedor", "Archivo", "Filas", "Duplicados exactos / posibles", "Usuario", "Estado"].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{items.map(i => <tr key={i.id}><td>{String(i.fecha)}</td><td>{i.proveedor}</td><td><Link prefetch={false} href={`/e/${slug}/combustibles/importaciones/${i.id}`}>{i.archivo}</Link></td><td>{resumen(i.resumen).filasOriginales}</td><td>{resumen(i.resumen).duplicadosInternos} / {resumen(i.resumen).posiblesDuplicados + resumen(i.resumen).duplicadosPrevios}</td><td>{i.usuario}</td><td>{i.estado}</td></tr>)}</tbody></table><p>Hasta 100 importaciones recientes.</p></div>}
  </section>;
}
