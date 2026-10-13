import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { bloquearAmbito, type AmbitoContable } from "./ambito";
import { asientoSchema, registrarAsientoTx } from "./asientos";
import { claveEventoContable, crearSnapshotContable, huellaContable, type TipoEvento } from "./evento-snapshot";
import { registrarAuditoriaTx } from "@/lib/auditoria";

export class EventoContableInvalido extends Error { readonly status = 409; }
type EntradaEvento = {
  facturaId: number; tipo: TipoEvento; eventoOrigenId?: number | null;
  snapshot: unknown; asiento: z.input<typeof asientoSchema>;
};
/** Infraestructura sin callers productivos. Requiere transacción externa; todo error obliga al llamador a rollback.
 * COBRO_CONFIRMADO está reservado pero bloqueado hasta PR B/D: no se aceptan referencias sin FK.
 */
export async function registrarEventoContableTx(conn: PoolConnection, empresaId: number, usuario: string, ambito: AmbitoContable, input: EntradaEvento) {
  const facturaId = z.number().int().positive().max(2147483647).parse(input.facturaId);
  if (input.tipo === "COBRO_CONFIRMADO") throw new EventoContableInvalido("Confirmaciones bancarias no implementadas en PR A.");
  const origen = input.eventoOrigenId ?? null;
  if ((input.tipo === "RETENCION_NO_EMITIDA") !== (origen !== null)) throw new EventoContableInvalido("Origen incompatible con el tipo de evento.");
  const snapshot = crearSnapshotContable(input.snapshot);
  const asiento = asientoSchema.parse(input.asiento);
  const clave = claveEventoContable(input.tipo, origen ?? facturaId);
  // Número/glosa identifican la representación, no el contenido económico del reintento.
  const huella = huellaContable({ empresaId, entidadId: ambito.entidadId, facturaId, tipo: input.tipo, origen,
    snapshot, fecha: asiento.fecha, lineas: asiento.lineas });
  await bloquearAmbito(conn, empresaId, ambito, true);
  const [previos] = await conn.query<RowDataPacket[]>(
    "SELECT id, asiento_id, huella FROM cont_eventos WHERE empresa_id = ? AND entidad_id = ? AND clave_evento = ? FOR UPDATE",
    [empresaId, ambito.entidadId, clave]);
  if (previos.length) {
    if (previos[0].huella !== huella) throw new EventoContableInvalido("La clave ya existe con contenido diferente.");
    return { eventoId: Number(previos[0].id), asientoId: Number(previos[0].asiento_id), reutilizado: true };
  }
  const [facturas] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM fact_facturas WHERE empresa_id = ? AND entidad_id = ? AND id = ? FOR UPDATE", [empresaId, ambito.entidadId, facturaId]);
  if (facturas.length !== 1) throw new EventoContableInvalido("Factura fuera del ámbito contable.");
  if (origen !== null) {
    const [eventos] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM cont_eventos WHERE empresa_id = ? AND entidad_id = ? AND factura_id = ? AND id = ? AND tipo_evento = 'FACTURA_EMITIDA' FOR UPDATE",
      [empresaId, ambito.entidadId, facturaId, origen]);
    if (eventos.length !== 1) throw new EventoContableInvalido("Evento de venta origen no disponible en este ámbito/factura.");
  }
  const asientoId = await registrarAsientoTx(conn, empresaId, usuario, asiento, ambito);
  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO cont_eventos (empresa_id, entidad_id, factura_id, tipo_evento, evento_origen_id, asiento_id,
      clave_evento, huella, fecha_contable, datos_snapshot, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, ambito.entidadId, facturaId, input.tipo, origen, asientoId, clave, huella, asiento.fecha, JSON.stringify(snapshot), ambito.usuarioId]);
  await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "contabilidad", accion: "registrar_evento",
    detalle: `Evento #${r.insertId}; ${input.tipo}; factura #${facturaId}; asiento #${asientoId}.` });
  return { eventoId: Number(r.insertId), asientoId, reutilizado: false };
}
