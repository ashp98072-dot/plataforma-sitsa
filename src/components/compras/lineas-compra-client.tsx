"use client";
import { useEffect, useState } from "react";
import type { DetalleCompra } from "@/lib/compras/requerimiento-schema";
import { ETIQUETAS_TIPO_LINEA_DOCUMENTO, type TipoLineaDocumento } from "@/lib/compras/linea-documentos-schema";

type Documento = { id: number; tipo: TipoLineaDocumento; nombreOriginal: string };
type DocumentosLinea = { documentos: Documento[]; error?: string };
export type LineasCompraConsulta = { detalle: DetalleCompra; documentos: Record<number, DocumentosLinea> };
export const COLUMNAS_LINEAS_COMPRA = ["Fecha", "Unidad / placa", "Proveedor", "Repuesto / descripción", "Método de pago", "Condición de pago", "Serie factura", "No. factura", "Total", "Comprobante / Factura"];
export const monedaCompra = (total: string) => `Q${Number(total).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function obtener<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "No se pudieron cargar las líneas.");
  return data;
}

/** Solo consulta endpoints existentes; nunca necesita rutas físicas ni catálogos vivos. */
export async function cargarLineasCompra(slug: string, id: number, signal: AbortSignal): Promise<LineasCompraConsulta> {
  const base = `/api/empresas/${slug}/compras/requerimientos/${id}`;
  const { requerimiento: detalle } = await obtener<{ requerimiento: DetalleCompra }>(base, signal);
  const entradas = await Promise.all(detalle.lineas.map(async linea => {
    try {
      const { documentos } = await obtener<{ documentos: Documento[] }>(`${base}/lineas/${linea.id}/documentos`, signal);
      return [linea.id, { documentos }] as const;
    } catch (error) {
      if (signal.aborted) throw error;
      return [linea.id, { documentos: [], error: "No se pudieron cargar los documentos de esta línea." }] as const;
    }
  }));
  return { detalle, documentos: Object.fromEntries(entradas) };
}

export function TablaLineasCompra({ slug, datos }: { slug: string; datos: LineasCompraConsulta }) {
  return <>
    {datos.detalle.motivo_rechazo && <p className="mb-2 text-xs text-red-400">Motivo de rechazo: {datos.detalle.motivo_rechazo}</p>}
    <div className="overflow-x-auto rounded border border-[var(--border)]">
      <table className="w-full min-w-[1400px] text-left text-xs"><caption className="sr-only">Líneas de {datos.detalle.codigo}</caption>
        <thead className="bg-[var(--card)] text-[var(--muted)]"><tr>{COLUMNAS_LINEAS_COMPRA.map(columna => <th scope="col" key={columna} className="border-r border-[var(--border)] px-3 py-2">{columna}</th>)}</tr></thead>
        <tbody>{datos.detalle.lineas.map(linea => {
          const adjuntos = datos.documentos[linea.id];
          return <tr key={linea.id} className="border-t border-[var(--border)] align-top">
            {[linea.fecha, linea.unidad_descripcion || "—", linea.proveedor_nombre_snapshot, linea.repuesto_descripcion, linea.metodo_pago, linea.condicion_pago, linea.serie_factura || "—", linea.numero_factura || "—", monedaCompra(linea.total)].map((valor, i) => <td key={i} className={`border-r border-[var(--border)] px-3 py-2 ${i === 2 || i === 3 ? "min-w-48 whitespace-pre-wrap break-words" : "whitespace-nowrap"}`}>{valor}</td>)}
            <td className="min-w-56 px-3 py-2">{adjuntos?.error ? <p role="alert" className="text-red-400">{adjuntos.error}</p> : adjuntos?.documentos.length ? <ul className="space-y-2">{adjuntos.documentos.map(doc => <li key={doc.id}>
              <p className="text-[var(--muted)]">{ETIQUETAS_TIPO_LINEA_DOCUMENTO[doc.tipo] ?? doc.tipo}</p>
              <span className="break-all">{doc.nombreOriginal}</span>{" "}<a href={`/api/empresas/${slug}/compras/requerimientos/documentos/${doc.id}`} target="_blank" rel="noreferrer" className="text-[var(--accent)]">Ver</a>
            </li>)}</ul> : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}

/** Se monta únicamente al expandir. El cierre aborta solicitudes; la caché queda aislada por slug/id. */
export function LineasCompraClient({ slug, requerimientoId, cache }: { slug: string; requerimientoId: number; cache: Map<string, LineasCompraConsulta> }) {
  const clave = `${slug}/${requerimientoId}`;
  const [datos, setDatos] = useState<LineasCompraConsulta | null>(() => cache.get(clave) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cache.has(clave)) return;
    const controller = new AbortController();
    cargarLineasCompra(slug, requerimientoId, controller.signal).then(resultado => {
      if (controller.signal.aborted) return;
      // Un fallo parcial se muestra por línea y no se cachea, para permitir reintentar al reabrir.
      if (!Object.values(resultado.documentos).some(linea => linea.error)) cache.set(clave, resultado);
      setDatos(resultado);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudieron cargar las líneas.");
    });
    return () => controller.abort();
  }, [slug, requerimientoId, clave, cache]);
  return error ? <p role="alert" className="text-red-400">{error} Cierre y vuelva a abrir para reintentar.</p> : datos ? <TablaLineasCompra slug={slug} datos={datos} /> : <p role="status">Cargando líneas…</p>;
}
