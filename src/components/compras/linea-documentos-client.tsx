"use client";
import { useCallback, useEffect, useState } from "react";
import { ETIQUETAS_TIPO_LINEA_DOCUMENTO, TIPOS_LINEA_DOCUMENTO, type TipoLineaDocumento } from "@/lib/compras/linea-documentos-schema";

type Doc = {
  id: number;
  tipo: TipoLineaDocumento;
  nombreOriginal: string;
  subidoEn: string;
};

type Props = {
  slug: string;
  requerimientoId: number;
  lineaId: number;
  puedeSubir: boolean;
  puedeEliminar: boolean;
};

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — sección "Documentos" inline por línea
 * (no modal, no recarga la página completa). Mismo patrón ya probado en
 * RRHH (DocumentosModal): fetch on mount + subir + eliminar, sin
 * optimistic update — siempre se vuelve a pedir la lista al servidor tras
 * un cambio.
 *
 * La factura NO es obligatoria al crear la línea: este componente solo se
 * monta para líneas que YA tienen id (persistidas) — ver
 * requerimiento-form-client.tsx — y puede quedar vacío indefinidamente
 * (0, 1 o varios documentos).
 */
export function LineaDocumentosClient({ slug, requerimientoId, lineaId, puedeSubir, puedeEliminar }: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tipo, setTipo] = useState<TipoLineaDocumento>("FACTURA");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  // Arranca en true: se muestra "Cargando…" hasta que resuelva el primer
  // fetch, SIN necesitar un setLoading(true) síncrono dentro del efecto de
  // montaje (eso es justo lo que dispara react-hooks/set-state-in-effect —
  // ver la cadena .then()/.catch()/.finally() de cargar() más abajo, que
  // nunca llama a un setState de forma síncrona en el cuerpo del efecto).
  const [loading, setLoading] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  const base = `/api/empresas/${slug}/compras/requerimientos/${requerimientoId}/lineas/${lineaId}/documentos`;

  // cargar() nunca ejecuta un setState de forma síncrona antes del primer
  // punto de suspensión (fetch): todo setState vive dentro de
  // .then()/.catch()/.finally(), que corren en un microtask posterior a
  // que el efecto de montaje ya haya retornado. Es el mismo criterio que
  // ya usa el fetch de catálogos más abajo en requerimiento-form-client.tsx
  // (.then(setCatalogos).catch(...)), que tampoco dispara el lint.
  const cargar = useCallback(() => {
    return fetch(base, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        setDocs(data.documentos ?? []);
        setError("");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [base]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir() {
    if (!puedeSubir || !file) return;
    setError("");
    setMensaje("");
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo", tipo);
      const res = await fetch(base, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir el documento.");
      setMensaje(data.mensaje ?? "Documento subido.");
      setFile(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red al subir");
    } finally {
      setSubiendo(false);
    }
  }

  async function eliminar(id: number) {
    if (!puedeEliminar) return;
    if (!confirm("¿Eliminar este documento?")) return;
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/compras/requerimientos/documentos/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo eliminar.");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    }
  }

  const estilo = "block w-full rounded border border-[var(--border)] bg-[var(--input)] p-2";
  const boton = "rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50";

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] p-3 text-sm">
      <p className="font-medium">Documentos ({docs.length})</p>
      {loading ? (
        <p className="text-[var(--muted)]">Cargando…</p>
      ) : docs.length === 0 ? (
        <p className="text-[var(--muted)]">Sin documentos.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <p className="text-xs text-[var(--muted)]">{ETIQUETAS_TIPO_LINEA_DOCUMENTO[d.tipo] ?? d.tipo}</p>
                <p className="truncate">{d.nombreOriginal}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a
                  href={`/api/empresas/${slug}/compras/requerimientos/documentos/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={boton}
                >
                  Ver
                </a>
                {puedeEliminar ? (
                  <button type="button" className={boton} onClick={() => void eliminar(d.id)}>
                    Eliminar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="text-[#f0a0a0]">{error}</p> : null}
      {mensaje ? <p className="text-[#8fd4a0]">{mensaje}</p> : null}
      {puedeSubir ? (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <label className="text-xs text-[var(--muted)]">
            Tipo documento
            <select className={estilo} value={tipo} onChange={(e) => setTipo(e.target.value as TipoLineaDocumento)}>
              {TIPOS_LINEA_DOCUMENTO.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETAS_TIPO_LINEA_DOCUMENTO[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Seleccionar archivo
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              className="block text-xs"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" className={boton} disabled={!file || subiendo} onClick={() => void subir()}>
            {subiendo ? "Subiendo…" : "Subir documento"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
