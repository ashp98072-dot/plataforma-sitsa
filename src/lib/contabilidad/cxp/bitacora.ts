import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";

/**
 * Bitácora de Cuentas por pagar. SOLO LECTURA sobre la tabla `auditoria` existente (los eventos ya se escriben en la MISMA transacción del
 * movimiento: ver facturas.ts, pagos.ts y proveedor-fiscal.ts). No hay tabla ni escritura nuevas. `detalle` es JSON con `entidadId`, por eso
 * la consulta se acota SIEMPRE por empresa y por entidad (libro) y descarta filas cuyo detalle no sea JSON.
 */
export const ACCIONES_BITACORA_CXP = [
  "cxp_registrar_factura", "cxp_anular_factura", "cxp_registrar_pago", "cxp_reversar_pago", "cxp_crear_config_proveedor", "cxp_actualizar_config_proveedor",
] as const;
export type AccionBitacoraCxp = (typeof ACCIONES_BITACORA_CXP)[number];
export const ETIQUETA_ACCION_CXP: Record<AccionBitacoraCxp, string> = {
  cxp_registrar_factura: "Registró factura", cxp_anular_factura: "Anuló factura", cxp_registrar_pago: "Registró pago", cxp_reversar_pago: "Reversó pago",
  cxp_crear_config_proveedor: "Configuró proveedor (fiscal)", cxp_actualizar_config_proveedor: "Actualizó configuración fiscal del proveedor",
};

export type Cambio = { campo: string; antes: string | null; despues: string | null };
export type EventoBitacoraCxp = {
  id: number; fecha: string; usuario: string | null; usuarioId: number | null; accion: string; etiqueta: string; proveedorId: number | null; proveedor: string | null;
  documento: string | null; pagoId: number | null; facturaId: number | null; monto: string | null; referencia: string | null; motivo: string | null; cambios: Cambio[]; resumen: string;
};

const q2 = (n: unknown) => `Q${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const txt = (v: unknown) => (v == null || v === "" ? null : String(v));
const numero = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

const ETIQUETA_CAMPO: Record<string, string> = {
  regimenFiscal: "Régimen", sujetoIsr: "Sujeto a ISR", cuentaProveedorId: "Cuenta de proveedores", cuentaAnticipoId: "Cuenta de anticipo", cuentaGastoId: "Cuenta de gasto", activo: "Activo",
};
const valorCampo = (v: unknown) => (v == null ? null : typeof v === "boolean" ? (v ? "Sí" : "No") : String(v));

/** Cambios de la configuración fiscal (antes → después) campo por campo; PURO. */
export function cambiosConfig(antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): Cambio[] {
  const out: Cambio[] = [];
  for (const campo of Object.keys(ETIQUETA_CAMPO)) {
    const a = valorCampo(antes?.[campo]), d = valorCampo(despues?.[campo]);
    if (a !== d) out.push({ campo: ETIQUETA_CAMPO[campo], antes: a, despues: d });
  }
  return out;
}

type Resolucion = { proveedores: Map<number, string>; facturas: Map<number, { documento: string; proveedorId: number; total: string }> };

/** Evento de `auditoria` → evento legible. PURO: lo que falte (eventos anteriores a este detalle) se completa con `res`. */
export function parsearEventoCxp(r: RowDataPacket | { id: unknown; usuario: unknown; accion: unknown; detalle: unknown; creado_en: unknown }, res?: Resolucion): EventoBitacoraCxp {
  let d: Record<string, unknown> = {};
  try { const j = JSON.parse(String(r.detalle ?? "")); if (j && typeof j === "object" && !Array.isArray(j)) d = j as Record<string, unknown>; } catch { d = {}; }
  const accion = String(r.accion);
  const etiqueta = (ETIQUETA_ACCION_CXP as Record<string, string>)[accion] ?? accion;
  const facturaId = numero(d.facturaId), pagoId = numero(d.pagoId);
  const fac = facturaId != null ? res?.facturas.get(facturaId) : undefined;
  const proveedorId = numero(d.proveedorId) ?? fac?.proveedorId ?? null;
  const proveedor = proveedorId != null ? res?.proveedores.get(proveedorId) ?? null : null;
  const aplicaciones = Array.isArray(d.aplicaciones) ? (d.aplicaciones as Record<string, unknown>[]) : [];
  const docsAplicados = aplicaciones
    .map((a) => txt(a.documento) ?? (numero(a.facturaId) != null ? res?.facturas.get(Number(a.facturaId))?.documento ?? null : null))
    .filter((x): x is string => !!x);
  const esPago = accion === "cxp_registrar_pago" || accion === "cxp_reversar_pago";
  const esConfig = accion === "cxp_crear_config_proveedor" || accion === "cxp_actualizar_config_proveedor";
  const documento = txt(d.documento) ?? fac?.documento ?? (docsAplicados.length ? docsAplicados.join(", ") : null);
  const monto = esConfig ? null : txt(d.montoTotal) ?? txt(d.total) ?? fac?.total ?? null;
  const motivo = txt(d.motivo), referencia = txt(d.referencia);
  const cambios = esConfig ? cambiosConfig((d.antes as Record<string, unknown>) ?? null, (d.despues as Record<string, unknown>) ?? null) : [];
  const sufijo = esPago ? (pagoId != null ? ` #${pagoId}` : "") : esConfig ? "" : documento ? ` ${documento}` : facturaId != null ? ` #${facturaId}` : "";
  const partes = [`${etiqueta}${sufijo}`];
  if (proveedor) partes.push(proveedor);
  if (monto != null) partes.push(q2(monto));
  if (accion === "cxp_registrar_factura" && txt(d.isr) && Number(d.isr) > 0) partes.push(`ISR ${q2(d.isr)} · Pagadero ${q2(d.neto)}`);
  if (esPago) {
    if (txt(d.medioPago)) partes.push(String(d.medioPago));
    if (referencia) partes.push(`Ref. ${referencia}`);
    if (docsAplicados.length) partes.push(`Facturas: ${docsAplicados.join(", ")}`);
  }
  if (motivo) partes.push(`Motivo: ${motivo}`);
  return {
    id: Number(r.id), fecha: String(r.creado_en ?? "").replace("T", " ").slice(0, 19), usuario: r.usuario != null ? String(r.usuario) : null, usuarioId: numero(d.usuarioId),
    accion, etiqueta, proveedorId, proveedor, documento, pagoId, facturaId, monto, referencia, motivo, cambios, resumen: partes.join(" · "),
  };
}

export type FiltrosBitacoraCxp = { accion?: AccionBitacoraCxp; usuario?: string; fechaDesde?: string; fechaHasta?: string; page?: number; pageSize?: number };
const ACCIONES_SQL = ACCIONES_BITACORA_CXP.map((a) => `'${a}'`).join(",");

async function resolver(empresaId: number, entidadId: number, filas: RowDataPacket[]): Promise<Resolucion> {
  const facturaIds = new Set<number>(), proveedorIds = new Set<number>();
  for (const f of filas) {
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(String(f.detalle ?? "")) ?? {}; } catch { d = {}; }
    if (numero(d.facturaId) != null) facturaIds.add(Number(d.facturaId));
    if (numero(d.proveedorId) != null) proveedorIds.add(Number(d.proveedorId));
    if (Array.isArray(d.aplicaciones)) for (const a of d.aplicaciones as Record<string, unknown>[]) if (numero(a?.facturaId) != null) facturaIds.add(Number(a.facturaId));
  }
  const facturas = new Map<number, { documento: string; proveedorId: number; total: string }>();
  if (facturaIds.size) {
    const ids = [...facturaIds];
    const rows = await query<RowDataPacket[]>(
      `SELECT id, proveedor_id, serie, numero, total_documento FROM cxp_facturas WHERE empresa_id = ? AND entidad_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [empresaId, entidadId, ...ids]);
    for (const r of rows) {
      facturas.set(Number(r.id), { documento: `${r.serie ? `${r.serie}-` : ""}${r.numero}`, proveedorId: Number(r.proveedor_id), total: String(r.total_documento) });
      proveedorIds.add(Number(r.proveedor_id));
    }
  }
  const proveedores = new Map<number, string>();
  if (proveedorIds.size) {
    const ids = [...proveedorIds];
    const rows = await query<RowDataPacket[]>(`SELECT id, nombre_comercial FROM compras_proveedores WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [empresaId, ...ids]);
    for (const r of rows) proveedores.set(Number(r.id), String(r.nombre_comercial));
  }
  return { proveedores, facturas };
}

/** Historial de CxP de UN libro (más reciente primero). Siempre acotado por empresa + entidad (de la sesión/ámbito, nunca del cuerpo). */
export async function listarBitacoraCxp(empresaId: number, entidadId: number, f: FiltrosBitacoraCxp = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const w = ["a.empresa_id = ?", "a.modulo = 'contabilidad'", `a.accion IN (${ACCIONES_SQL})`, "JSON_VALID(a.detalle) = 1", "CAST(JSON_UNQUOTE(JSON_EXTRACT(a.detalle, '$.entidadId')) AS UNSIGNED) = ?"];
  const p: (string | number)[] = [empresaId, entidadId];
  if (f.accion) { w.push("a.accion = ?"); p.push(f.accion); }
  if (f.usuario?.trim()) { w.push("a.usuario = ?"); p.push(f.usuario.trim().slice(0, 100)); }
  if (f.fechaDesde) { w.push("a.creado_en >= ?"); p.push(`${f.fechaDesde} 00:00:00`); }
  if (f.fechaHasta) { w.push("a.creado_en <= ?"); p.push(`${f.fechaHasta} 23:59:59`); }
  const desde = `FROM auditoria a WHERE ${w.join(" AND ")}`;
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${desde}`, p);
  const rows = await query<RowDataPacket[]>(
    `SELECT a.id, a.usuario, a.accion, a.detalle, DATE_FORMAT(a.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en ${desde} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  const res = await resolver(empresaId, entidadId, rows);
  return { eventos: rows.map((r) => parsearEventoCxp(r, res)), totalReal: Number(tot?.n ?? 0), page, pageSize };
}
