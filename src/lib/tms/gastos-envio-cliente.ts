/**
 * ENVÍO DE UN GASTO DESDE EL FORMULARIO (cliente) — crear/editar y adjuntar el comprobante.
 *
 * Se extrae de la página para poder probar el caso crítico sin renderizar React: el POST del gasto se confirma, la subida
 * del comprobante falla y el usuario vuelve a presionar Guardar. Como el reintento manda la MISMA clave de envío, el
 * servidor devuelve el gasto ya creado (no crea otro) y aquí se vuelve a subir el comprobante a ese mismo id.
 *
 * Este módulo no toca React ni el DOM: recibe `fetchFn` para poder simularlo.
 */

type RespuestaHttp = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchGasto = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData }) => Promise<RespuestaHttp>;

export type ResultadoEnvioGasto =
  /** El gasto NO quedó guardado (validación, 409 de idempotencia, error del servidor). */
  | { fase: "crear"; ok: false; status: number; data: Record<string, unknown> }
  /** El gasto SÍ quedó guardado pero el comprobante no se pudo adjuntar: reintentar con la misma clave. */
  | { fase: "comprobante"; ok: false; gastoId: number; data: Record<string, unknown>; subidaData: Record<string, unknown> }
  /** Todo confirmado: gasto (y comprobante, si había). */
  | { fase: "completo"; ok: true; gastoId: number | null; data: Record<string, unknown> };

async function leerJson(res: RespuestaHttp): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function enviarGasto(opts: {
  fetchFn: FetchGasto;
  slug: string;
  /** Presente = edición (PATCH sobre un id existente, sin clave: no crea registros). Ausente = creación (POST con clave). */
  editandoId: number | null;
  payload: Record<string, unknown>;
  claveIdempotencia: string;
  comprobante: File | null;
}): Promise<ResultadoEnvioGasto> {
  const { fetchFn, slug, editandoId, payload, claveIdempotencia, comprobante } = opts;
  const url = editandoId ? `/api/empresas/${slug}/tms/gastos/${editandoId}` : `/api/empresas/${slug}/tms/gastos`;
  const cuerpo = editandoId ? payload : { ...payload, claveIdempotencia };
  const res = await fetchFn(url, { method: editandoId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const data = await leerJson(res);
  if (!res.ok) return { fase: "crear", ok: false, status: res.status, data };

  const gasto = data.gasto as { id?: unknown } | undefined;
  const gastoId = editandoId ?? (typeof gasto?.id === "number" ? gasto.id : null);
  if (comprobante && gastoId) {
    const archivos = new FormData();
    archivos.set("file", comprobante);
    const subida = await fetchFn(`/api/empresas/${slug}/tms/gastos/${gastoId}/comprobante`, { method: "POST", body: archivos });
    if (!subida.ok) return { fase: "comprobante", ok: false, gastoId, data, subidaData: await leerJson(subida) };
  }
  return { fase: "completo", ok: true, gastoId, data };
}
