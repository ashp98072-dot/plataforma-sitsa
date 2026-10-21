"use client";
import { useEffect, useRef, useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import type { PerfilProveedor, PreviewProveedorV2 } from "@/lib/flota/combustible-importacion-v2-types";

export function TablaPreviewProveedorV2({ data }: { data: PreviewProveedorV2 }) {
  const [filtro, setFiltro] = useState("OPERATIVAS"), [q, setQ] = useState(""), [pagina, setPagina] = useState(0);
  const filas = data.filas.filter(f => (filtro === "TODAS" || (filtro === "OPERATIVAS" ? f.estado !== "IGNORADA" : filtro === "CONFLICTOS" ? f.conflicto : filtro === "DUPLICADOS" ? f.duplicadoDe != null || f.posiblePrevio : f.estado === filtro)) && `${f.vale} ${f.placaOriginal} ${f.serie} ${f.factura} ${f.hoja}`.toLowerCase().includes(q.toLowerCase()));
  const page = Math.min(pagina, Math.max(0, Math.ceil(filas.length / 100) - 1));
  const r = data.resumen;
  return <section className="space-y-3">
    <p>Contrato v{data.versionContrato} · {data.perfil} · lector v{data.versionParser}</p>
    <p>Apariciones: {r.apariciones} · Consumos candidatos: {r.candidatos} · Candidatos bloqueados: {r.bloqueados} · Duplicados: {r.duplicados} · Conflictos bloqueados: {r.conflictos} · Errores: {r.invalidas} · Ignoradas: {r.ignoradas} · Posibles previos: {r.posiblesPrevios}</p>
    <p>Elegibles para revisión: {r.elegibles} · Galones: {r.galonesElegibles} · Monto reportado (Q): {r.montoElegible}. Excluye duplicados, conflictos, inválidas y posibles previos. No representa aprobación ni movimiento financiero.</p>
    <p>{data.coberturaPrevios}</p>
    <label>Buscar vale, placa, factura u hoja <input value={q} onChange={e => { setQ(e.target.value); setPagina(0); }} className="rounded border p-2" /></label>{" "}
    <label>Mostrar <select value={filtro} onChange={e => { setFiltro(e.target.value); setPagina(0); }} className="rounded border p-2">{["OPERATIVAS", "TODAS", "CONFLICTOS", "DUPLICADOS", "INVALIDA", "ADVERTENCIA", "IGNORADA"].map(s => <option key={s}>{s}</option>)}</select></label>
    <div className="overflow-auto"><table className="w-full text-xs"><thead><tr>{["Hoja / fila", "Fecha de consumo", "Vale", "Placa original / normalizada", "Piloto informado", "Producto", "Galones", "Precio", "Monto", "Km / lote", "Serie / factura", "Estado / observaciones", "Evidencia"].map(s => <th className="p-2 text-left" key={s}>{s}</th>)}</tr></thead>
      <tbody>{filas.slice(page * 100, page * 100 + 100).map(f => <tr key={`${f.hoja}:${f.fila}`} className="border-t">
        <td>{f.hoja} / {f.fila}</td><td>{f.fechaConsumo ?? "Sin fecha válida"}</td><td>{f.vale}</td><td>{f.placaOriginal}<br />{f.placaNormalizada}</td><td>{f.pilotoInformado ?? "Sin determinar"}</td><td>{f.producto ?? "No informado"}</td>
        <td>{f.galones ?? "No verificable"}{f.galonesCalculados && " (calculados)"}</td><td>{f.precio}</td><td>{f.monto}</td><td>{f.kilometraje ?? f.textos.km} / {f.lote ?? "Sin lote"}</td><td>{f.serie || "Sin serie"} / {f.factura || "Sin factura"}</td>
        <td>{f.estado}{f.conflicto && <strong className="block">CONFLICTO BLOQUEADO</strong>}{f.duplicadoDe != null && <span className="block">Repite {data.filas[f.duplicadoDe].hoja}:{data.filas[f.duplicadoDe].fila}</span>}{f.posiblePrevio && <span className="block">Posible previo</span>}<ul>{f.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul></td>
        <td><details><summary>Celdas originales</summary><pre className="max-w-md whitespace-pre-wrap">{JSON.stringify(f.celdas, null, 2)}</pre></details></td>
      </tr>)}</tbody></table></div>
    <p>{filas.length} filas · Página {page + 1}</p><button type="button" disabled={!page} onClick={() => setPagina(page - 1)}>Anterior</button>{" "}<button type="button" disabled={(page + 1) * 100 >= filas.length} onClick={() => setPagina(page + 1)}>Siguiente</button>
  </section>;
}

export function PreviewCombustibleV2({ slug }: { slug: string }) {
  const [perfil, setPerfil] = useState<PerfilProveedor>("HALEL"), [proveedor, setProveedor] = useState(""), [file, setFile] = useState<File | null>(null);
  const [proveedores, setProveedores] = useState<{ id: number; nombre: string }[]>([]), [data, setData] = useState<PreviewProveedorV2 | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const enCurso = useRef(false), revision = useRef(0);
  function invalidar() { revision.current++; setData(null); setError(""); }
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/flota/combustible/importaciones/preview-v2`, { signal: ac.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "No se pudieron cargar proveedores"); if (!ac.signal.aborted) setProveedores(d.proveedores); }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [slug]);
  async function analizar() {
    if (enCurso.current || !file || !proveedor) return;
    enCurso.current = true; setBusy(true); setData(null); setError(""); const actual = revision.current;
    try {
      const form = new FormData(); form.set("perfil", perfil); form.set("proveedorId", proveedor); form.set("file", file);
      const res = await fetch(`/api/empresas/${slug}/flota/combustible/importaciones/preview-v2`, { method: "POST", body: form }); const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo analizar");
      if (actual === revision.current) setData(d);
    } catch (e) { if (actual === revision.current) setError(e instanceof Error ? e.message : "No se pudo analizar"); }
    finally { enCurso.current = false; setBusy(false); }
  }
  return <section className="space-y-4">
    <h2>Vista previa HALEL / SHELL</h2><p>Analiza consumos candidatos y conserva sus apariciones en pantalla. Esta vista previa no guarda archivos ni registros; la confirmación de consumos estará disponible en una fase posterior.</p>
    <form onSubmit={e => { e.preventDefault(); void analizar(); }}><fieldset disabled={busy} className="space-y-3">
      <label>Formato <select value={perfil} onChange={e => { setPerfil(e.target.value as PerfilProveedor); invalidar(); }}><option>HALEL</option><option>SHELL</option></select></label>
      <CatalogoSearchSelect label="Proveedor de la empresa" placeholder="Buscar proveedor..." value={proveedor} onChange={v => { setProveedor(v); invalidar(); }} options={proveedores.map(p => ({ value: String(p.id), label: p.nombre }))} inputClassName="rounded border p-2" />
      <label>Excel .xlsx (máximo 50 MB)<input type="file" accept=".xlsx" required onChange={e => { setFile(e.target.files?.[0] ?? null); invalidar(); }} /></label>
      <button disabled={busy || !file || !proveedor}>{busy ? "Analizando…" : "Analizar archivo"}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}{data && <TablaPreviewProveedorV2 key={`${perfil}:${proveedor}`} data={data} />}
  </section>;
}
