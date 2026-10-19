import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * Bitácora de Facturación + CxC. REUTILIZA la tabla `auditoria` existente (append-only: solo INSERT; nunca UPDATE/DELETE) y `registrarAuditoriaTx`,
 * en la MISMA transacción del movimiento (si hace rollback, el evento también). No hay una segunda bitácora ni cambio de esquema.
 *
 * Formato de `detalle` (compatible con los eventos históricos, que son solo texto que empieza por «Factura #<id> »):
 *   «<texto legible> | #BIT <JSON>»
 * El prefijo «Factura #<id> » permite consultar por factura; el JSON lleva lo estructurado (usuario ID, entidad, número visible, monto, medio,
 * referencia, motivo, cambios). Solo se guardan campos explícitos y acotados: nunca contraseñas, tokens ni cuerpos de solicitud.
 */
export const MARCA_BIT = " | #BIT ";

export type Cambio = { campo: string; antes: string | null; despues: string | null };
export type DatosBitacora = {
  facturaId: number;
  usuarioId: number;
  numero?: string | null;
  entidadId?: number | null;
  monto?: string | null;
  medioPago?: string | null;
  referencia?: string | null;
  motivo?: string | null;
  cambios?: Cambio[];
};
type ActorBit = { empresaId: number; usuario: string; usuarioId: number };

export const ACCIONES_BITACORA = [
  "crear_factura", "editar_factura_borrador", "emitir_factura", "anular_factura", "registrar_pago", "confirmar_ingreso_bancario", "anular_confirmacion_bancaria",
] as const;
export type AccionBitacora = (typeof ACCIONES_BITACORA)[number];
export const ETIQUETA_ACCION: Record<AccionBitacora, string> = {
  crear_factura: "Creó borrador", editar_factura_borrador: "Editó borrador", emitir_factura: "Emitió factura", anular_factura: "Anuló factura",
  registrar_pago: "Registró cobro", confirmar_ingreso_bancario: "Confirmó ingreso bancario", anular_confirmacion_bancaria: "Anuló confirmación bancaria",
};

const acotar = (v: string | null | undefined, max: number) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, max) || null);

/** Diferencias entre dos fotografías (solo los campos que cambiaron). Los valores se normalizan a texto acotado. */
export function diferencias(antes: Record<string, unknown>, despues: Record<string, unknown>): Cambio[] {
  const out: Cambio[] = [];
  for (const campo of Object.keys(despues)) {
    const a = antes[campo] == null ? null : String(antes[campo]);
    const d = despues[campo] == null ? null : String(despues[campo]);
    if (a !== d) out.push({ campo, antes: acotar(a, 200), despues: acotar(d, 200) });
  }
  return out;
}

export function formatearDetalle(texto: string, datos: DatosBitacora): string {
  const limpio = {
    v: 1, facturaId: datos.facturaId, usuarioId: datos.usuarioId, numero: acotar(datos.numero, 60), entidadId: datos.entidadId ?? null,
    monto: acotar(datos.monto, 20), medioPago: acotar(datos.medioPago, 40), referencia: acotar(datos.referencia, 120), motivo: acotar(datos.motivo, 500),
    cambios: (datos.cambios ?? []).slice(0, 30),
  };
  return `${texto}${MARCA_BIT}${JSON.stringify(limpio)}`;
}

/** Registra el evento dentro de la transacción del movimiento. `texto` debe empezar por «Factura #<id> ». */
export async function registrarBitacoraFactura(conn: PoolConnection, actor: ActorBit, accion: AccionBitacora, texto: string, datos: Omit<DatosBitacora, "usuarioId">): Promise<void> {
  if (!texto.startsWith(`Factura #${datos.facturaId} `)) throw new Error("El detalle de bitácora debe iniciar con «Factura #<id> ».");
  await registrarAuditoriaTx(conn, {
    empresaId: actor.empresaId, usuario: actor.usuario, modulo: "facturacion", accion,
    detalle: formatearDetalle(texto, { ...datos, usuarioId: actor.usuarioId }),
  });
}

export type EventoBitacora = {
  id: number; fecha: string; usuario: string | null; usuarioId: number | null; accion: string; etiqueta: string; facturaId: number | null; numeroFactura: string | null;
  entidadId: number | null; monto: string | null; medioPago: string | null; referencia: string | null; motivo: string | null; cambios: Cambio[]; resumen: string;
};

export function parsearEvento(r: RowDataPacket | { id: unknown; usuario: unknown; accion: unknown; detalle: unknown; creado_en: unknown }): EventoBitacora {
  const detalle = r.detalle == null ? "" : String(r.detalle);
  const i = detalle.indexOf(MARCA_BIT);
  const texto = i >= 0 ? detalle.slice(0, i) : detalle;
  let datos: Partial<DatosBitacora> & { v?: number } = {};
  if (i >= 0) { try { datos = JSON.parse(detalle.slice(i + MARCA_BIT.length)); } catch { datos = {}; } }
  const accion = String(r.accion);
  const etiqueta = (ETIQUETA_ACCION as Record<string, string>)[accion] ?? accion;
  const facturaId = datos.facturaId ?? Number(/^Factura #(\d+) /.exec(texto)?.[1] ?? NaN);
  const doc = datos.numero ?? null;
  const partes = [`${etiqueta}${doc ? ` ${doc}` : Number.isFinite(facturaId) ? ` #${facturaId}` : ""}`];
  if (accion === "registrar_pago") {
    if (datos.monto) partes.push(`Q${Number(datos.monto).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    if (datos.medioPago) partes.push(datos.medioPago);
    if (datos.referencia) partes.push(datos.referencia);
  } else if (datos.motivo) partes.push(`Motivo: ${datos.motivo}`);
  return {
    id: Number(r.id), fecha: String(r.creado_en ?? "").replace("T", " ").slice(0, 19), usuario: r.usuario != null ? String(r.usuario) : null,
    usuarioId: datos.usuarioId ?? null, accion, etiqueta, facturaId: Number.isFinite(facturaId) ? Number(facturaId) : null, numeroFactura: doc,
    entidadId: datos.entidadId ?? null, monto: datos.monto ?? null, medioPago: datos.medioPago ?? null, referencia: datos.referencia ?? null, motivo: datos.motivo ?? null,
    cambios: Array.isArray(datos.cambios) ? datos.cambios : [], resumen: partes.join(" · "),
  };
}

const ACCIONES_SQL = ACCIONES_BITACORA.map((a) => `'${a}'`).join(",");

/** Historial de UNA factura de la empresa (más reciente primero). El prefijo «Factura #<id> » evita confundir #12 con #123. */
export async function listarBitacoraFactura(empresaId: number, facturaId: number, limite = 200): Promise<EventoBitacora[]> {
  const lim = Math.min(Math.max(limite, 1), 500);
  const rows = await query<RowDataPacket[]>(
    `SELECT id, usuario, accion, detalle, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en FROM auditoria
      WHERE empresa_id = ? AND modulo = 'facturacion' AND accion IN (${ACCIONES_SQL}) AND detalle LIKE ?
      ORDER BY id DESC LIMIT ${lim}`,
    [empresaId, `Factura #${facturaId} %`]);
  return rows.map(parsearEvento);
}

export type FiltrosBitacoraCxc = { facturaId?: number; accion?: AccionBitacora; usuario?: string; fechaDesde?: string; fechaHasta?: string; page?: number; pageSize?: number };

/**
 * Bitácora de CxC de UN libro: eventos de las facturas de esa entidad (la entidad se toma de la FACTURA, así también aparecen los eventos
 * anteriores a esta bitácora, que no traían entidad). Siempre acotado por empresa; las facturas sin entidad no pertenecen a ningún libro.
 */
export async function listarBitacoraCxc(empresaId: number, entidadId: number, f: FiltrosBitacoraCxc = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const w = ["a.empresa_id = ?", "a.modulo = 'facturacion'", `a.accion IN (${ACCIONES_SQL})`, "fa.empresa_id = a.empresa_id", "fa.entidad_id = ?"];
  const p: (string | number)[] = [empresaId, entidadId];
  if (f.facturaId) { w.push("fa.id = ?"); p.push(f.facturaId); }
  if (f.accion) { w.push("a.accion = ?"); p.push(f.accion); }
  if (f.usuario?.trim()) { w.push("a.usuario = ?"); p.push(f.usuario.trim().slice(0, 100)); }
  if (f.fechaDesde) { w.push("a.creado_en >= ?"); p.push(`${f.fechaDesde} 00:00:00`); }
  if (f.fechaHasta) { w.push("a.creado_en <= ?"); p.push(`${f.fechaHasta} 23:59:59`); }
  const desde = `FROM auditoria a JOIN fact_facturas fa ON fa.id = CAST(REGEXP_SUBSTR(a.detalle, '(?<=^Factura #)[0-9]+') AS UNSIGNED) WHERE ${w.join(" AND ")}`;
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${desde}`, p);
  const rows = await query<RowDataPacket[]>(
    `SELECT a.id, a.usuario, a.accion, a.detalle, DATE_FORMAT(a.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en ${desde} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  return { eventos: rows.map(parsearEvento), totalReal: Number(tot?.n ?? 0), page, pageSize };
}
