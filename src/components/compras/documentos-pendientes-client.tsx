"use client";
import { useState } from "react";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";
import { ETIQUETAS_TIPO_LINEA_DOCUMENTO, TIPOS_LINEA_DOCUMENTO, type TipoLineaDocumento } from "@/lib/compras/linea-documentos-schema";

export type DocumentoPendienteCompra = { key: string; tipo: TipoLineaDocumento; file: File };
export function DocumentosPendientesClient({ documentos, onChange, disabled }: { documentos: DocumentoPendienteCompra[]; onChange: (docs: DocumentoPendienteCompra[]) => void; disabled: boolean }) {
  const [tipo, setTipo] = useState<TipoLineaDocumento>("FACTURA");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  return <fieldset disabled={disabled} className="space-y-2 rounded-lg border border-[var(--border)] p-3 text-sm"><legend>Documentos de la línea</legend>
    <label>Tipo documento<select value={tipo} onChange={e => setTipo(e.target.value as TipoLineaDocumento)} className="ml-2 rounded bg-[var(--input)] p-2">{TIPOS_LINEA_DOCUMENTO.map(t => <option key={t} value={t}>{ETIQUETAS_TIPO_LINEA_DOCUMENTO[t]}</option>)}</select></label>
    <label className="block">Archivo<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
    <button type="button" className="rounded border border-[var(--border)] px-2 py-1" onClick={() => {
      if (!file) { setError("Seleccione un archivo."); return; }
      if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) { setError("Formato no permitido. Use PDF, JPG/JPEG, PNG o WEBP."); return; }
      if (file.size > MAX_UPLOAD_BYTES) { setError("El archivo supera el tamaño permitido."); return; }
      onChange([...documentos, { key: crypto.randomUUID(), tipo, file }]); setFile(null); setError("");
    }}>Agregar documento</button>
    <ul className="space-y-2">{documentos.map(doc => <li key={doc.key}><p>{ETIQUETAS_TIPO_LINEA_DOCUMENTO[doc.tipo]}</p>{doc.file.name}{" "}<button type="button" onClick={() => onChange(documentos.filter(v => v.key !== doc.key))} className="text-red-400">Quitar</button></li>)}</ul>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <p className="text-xs text-[var(--muted)]">Los documentos se subirán después de guardar la línea.</p>
  </fieldset>;
}

/** No lanza tras guardar el JSON: los errores de documentos nunca convierten una creación exitosa en fallida. */
export async function subirPendientesCompra(slug: string, id: number, lineas: { documentosPendientes?: DocumentoPendienteCompra[] }[]): Promise<number> {
  const total = lineas.reduce((sum, l) => sum + (l.documentosPendientes?.length ?? 0), 0);
  if (!total) return 0;
  const base = `/api/empresas/${slug}/compras/requerimientos/${id}`;
  try {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return total;
    const persistidas = data.requerimiento.lineas as { id: number; orden: number }[];
    const porOrden = new Map(persistidas.map(l => [l.orden, l.id]));
    // Validar TODO el contrato antes del primer upload; nunca adivinar por datos que pueden repetirse.
    if (persistidas.length !== lineas.length || porOrden.size !== lineas.length || lineas.some((_, i) => !Number.isInteger(porOrden.get(i + 1)) || (porOrden.get(i + 1) ?? 0) <= 0)) return total;
    let fallidos = 0;
    for (const [indice, linea] of lineas.entries()) for (const doc of linea.documentosPendientes ?? []) {
      const form = new FormData(); form.append("tipo", doc.tipo); form.append("file", doc.file);
      try { const upload = await fetch(`${base}/lineas/${porOrden.get(indice + 1)}/documentos`, { method: "POST", body: form }); if (!upload.ok) fallidos++; }
      catch { fallidos++; }
    }
    return fallidos;
  } catch { return total; }
}
