import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { ETIQUETA_AREA, esModuloEntrega, type AreaEntrega, type EstadoEntrega, type ModoEntrega, type ModuloEntrega } from "./catalogo";
import { calcularCustodia } from "./reglas";
import { textoEntregaPendiente, type ResumenEntregaDocumento } from "./presentacion";

/** Tope de documentos por consulta (una página del listado). */
export const MAX_IDS_RESUMEN = 500;

/**
 * Resumen de entregas de varios documentos en UNA consulta (para pintar el listado sin N peticiones ni polling). Siempre
 * acotado por `empresa_id` y módulo: un id de otra empresa simplemente no tiene entregas aquí y queda con la custodia inicial.
 */
export async function resumenEntregasDocumentos(
  empresaId: number,
  modulo: ModuloEntrega,
  ids: number[],
): Promise<Record<number, ResumenEntregaDocumento>> {
  if (!esModuloEntrega(modulo)) throw new RangeError("Módulo de entrega inválido.");
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_IDS_RESUMEN);
  const salida: Record<number, ResumenEntregaDocumento> = {};
  if (!unicos.length) return salida;
  const filas = await query<RowDataPacket[]>(
    `SELECT id, entidad_id, estado, etapa_destino, modo FROM documento_entregas
     WHERE empresa_id = ? AND modulo = ? AND entidad_id IN (${unicos.map(() => "?").join(", ")}) ORDER BY id`,
    [empresaId, modulo, ...unicos],
  );
  const porDocumento = new Map<number, { id: number; estado: EstadoEntrega; etapaDestino: AreaEntrega; modo: ModoEntrega }[]>();
  for (const f of filas) {
    const lista = porDocumento.get(Number(f.entidad_id)) ?? [];
    lista.push({ id: Number(f.id), estado: String(f.estado) as EstadoEntrega, etapaDestino: String(f.etapa_destino) as AreaEntrega, modo: String(f.modo) as ModoEntrega });
    porDocumento.set(Number(f.entidad_id), lista);
  }
  for (const id of unicos) {
    const entregas = porDocumento.get(id) ?? [];
    const { area, pendiente } = calcularCustodia(modulo, entregas);
    salida[id] = {
      custodia: area,
      custodiaEtiqueta: ETIQUETA_AREA[area],
      pendiente: pendiente
        ? { id: pendiente.id, destino: pendiente.etapaDestino, destinoEtiqueta: ETIQUETA_AREA[pendiente.etapaDestino], modo: pendiente.modo, texto: textoEntregaPendiente(pendiente.etapaDestino) }
        : null,
      total: entregas.length,
      recibidas: entregas.filter((e) => e.estado === "RECIBIDA").length,
      hayCerradasSinRecepcion: entregas.some((e) => e.estado === "RECHAZADA" || e.estado === "ANULADA"),
    };
  }
  return salida;
}
