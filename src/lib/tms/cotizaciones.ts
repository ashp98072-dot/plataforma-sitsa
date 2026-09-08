import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * COTIZADOR-TMS-1 (fase 1) — cotizaciones comerciales de TMS. Reutiliza
 * catálogos existentes, no duplica nada:
 *   - tms_clientes      -> clienteId (mismo maestro que tms_planes_viaje/
 *                          tms_cliente_rutas/tms_gastos_operativos)
 *   - tms_cliente_rutas -> rutaId opcional (SNAPSHOT, sin FK — mismo
 *                          criterio que tms_planes_viaje.ruta_id: al
 *                          elegir una ruta se COPIA tarifa_referencia/
 *                          costo_operativo/origen/destino a la cotización;
 *                          cambios futuros de la ruta maestra NUNCA
 *                          alteran una cotización ya guardada)
 *   - auditoria         -> registrarAuditoria/registrarAuditoriaTx, sin
 *                          bitácora paralela de cambios de estado.
 *
 * Esquema: NO se crea/altera desde este módulo — asume que
 * sql/migrate-2026-09-cotizador-tms.sql ya se aplicó manualmente (mismo
 * criterio que cliente-rutas.ts/gastos.ts/fondos.ts).
 */

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}
async function executeConn(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result;
}

export const ESTADOS_COTIZACION = ["Borrador", "Enviada", "Aceptada", "Rechazada", "Vencida"] as const;
export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];

/** Borrador -> Enviada -> Aceptada/Rechazada/Vencida. Nunca hacia atrás; los 3 estados finales no admiten más transiciones. */
const TRANSICIONES_COTIZACION: Record<EstadoCotizacion, EstadoCotizacion[]> = {
  Borrador: ["Enviada"],
  Enviada: ["Aceptada", "Rechazada", "Vencida"],
  Aceptada: [],
  Rechazada: [],
  Vencida: [],
};

/**
 * Guatemala: tasa legal fija de IVA. No existe un catálogo/configuración
 * de IVA reutilizable en el resto de la app (revisado facturacion/*,
 * rrhh/* — "incluye_iva" en el cuestionario de facturación es solo una
 * pregunta informativa, no un porcentaje configurable) — se usa una
 * constante en vez de inventar una tabla de configuración para un único
 * valor legal fijo.
 */
export const IVA_PORCENTAJE = 0.12;

export type DesgloseIva = { subtotal: number; iva: number; total: number };

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * `incluyeIva=true`: tarifaCotizada YA incluye el IVA (es el total que
 * paga el cliente) — se retro-calcula el subtotal. `incluyeIva=false`:
 * tarifaCotizada es el subtotal (antes de IVA) — se le suma el IVA.
 */
export function calcularIva(tarifaCotizada: number, incluyeIva: boolean): DesgloseIva {
  if (incluyeIva) {
    const subtotal = tarifaCotizada / (1 + IVA_PORCENTAJE);
    return { subtotal: redondear(subtotal), iva: redondear(tarifaCotizada - subtotal), total: redondear(tarifaCotizada) };
  }
  const iva = tarifaCotizada * IVA_PORCENTAJE;
  return { subtotal: redondear(tarifaCotizada), iva: redondear(iva), total: redondear(tarifaCotizada + iva) };
}

export type Cotizacion = {
  id: number;
  empresaId: number;
  codigo: string;
  clienteId: number;
  clienteNombre: string;
  rutaId: number | null;
  rutaCodigoHistorico: string | null;
  origenTexto: string | null;
  destinoTexto: string | null;
  tarifaReferencia: number | null;
  costoOperativoReferencia: number | null;
  tarifaCotizada: number;
  incluyeIva: boolean;
  moneda: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  estado: EstadoCotizacion;
  pilotoIncluido: boolean;
  gpsIncluido: boolean;
  seguroMercaderiaIncluido: boolean;
  seguroTercerosIncluido: boolean;
  kmIncluidos: number | null;
  tarifaKmAdicional: number | null;
  condicionesAdicionales: string | null;
  observaciones: string | null;
  creadoPor: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
};

function mapRow(r: RowDataPacket): Cotizacion {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    codigo: String(r.codigo),
    clienteId: Number(r.cliente_id),
    clienteNombre: String(r.cliente_nombre),
    rutaId: r.ruta_id != null ? Number(r.ruta_id) : null,
    rutaCodigoHistorico: r.ruta_codigo_historico != null ? String(r.ruta_codigo_historico) : null,
    origenTexto: r.origen_texto != null ? String(r.origen_texto) : null,
    destinoTexto: r.destino_texto != null ? String(r.destino_texto) : null,
    tarifaReferencia: r.tarifa_referencia != null ? Number(r.tarifa_referencia) : null,
    costoOperativoReferencia: r.costo_operativo_referencia != null ? Number(r.costo_operativo_referencia) : null,
    tarifaCotizada: Number(r.tarifa_cotizada ?? 0),
    incluyeIva: Number(r.incluye_iva ?? 0) === 1,
    moneda: String(r.moneda ?? "GTQ"),
    fechaEmision: String(r.fecha_emision),
    fechaVencimiento: r.fecha_vencimiento != null ? String(r.fecha_vencimiento) : null,
    estado: String(r.estado) as EstadoCotizacion,
    pilotoIncluido: Number(r.piloto_incluido ?? 0) === 1,
    gpsIncluido: Number(r.gps_incluido ?? 0) === 1,
    seguroMercaderiaIncluido: Number(r.seguro_mercaderia_incluido ?? 0) === 1,
    seguroTercerosIncluido: Number(r.seguro_terceros_incluido ?? 0) === 1,
    kmIncluidos: r.km_incluidos != null ? Number(r.km_incluidos) : null,
    tarifaKmAdicional: r.tarifa_km_adicional != null ? Number(r.tarifa_km_adicional) : null,
    condicionesAdicionales: r.condiciones_adicionales != null ? String(r.condiciones_adicionales) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: r.creado_en != null ? String(r.creado_en) : null,
    actualizadoEn: r.actualizado_en != null ? String(r.actualizado_en) : null,
  };
}

const SELECT = `
  SELECT id, empresa_id, codigo, cliente_id, cliente_nombre, ruta_id, ruta_codigo_historico,
         origen_texto, destino_texto, tarifa_referencia, costo_operativo_referencia, tarifa_cotizada,
         incluye_iva, moneda, DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS fecha_emision,
         DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento, estado,
         piloto_incluido, gps_incluido, seguro_mercaderia_incluido, seguro_terceros_incluido,
         km_incluidos, tarifa_km_adicional, condiciones_adicionales, observaciones,
         creado_por, creado_en, actualizado_en
  FROM tms_cotizaciones
`;

export type FiltrosCotizaciones = {
  clienteId?: number;
  estado?: EstadoCotizacion;
  fechaDesde?: string;
  fechaHasta?: string;
};

export async function listarCotizaciones(empresaId: number, filtros: FiltrosCotizaciones = {}): Promise<Cotizacion[]> {
  const condiciones = ["empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtros.clienteId) { condiciones.push("cliente_id = ?"); params.push(filtros.clienteId); }
  if (filtros.estado) { condiciones.push("estado = ?"); params.push(filtros.estado); }
  if (filtros.fechaDesde) { condiciones.push("fecha_emision >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("fecha_emision <= ?"); params.push(filtros.fechaHasta); }
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE ${condiciones.join(" AND ")} ORDER BY fecha_emision DESC, id DESC`,
    params,
  );
  return rows.map(mapRow);
}

export async function obtenerCotizacion(empresaId: number, id: number): Promise<Cotizacion | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? AND empresa_id = ? LIMIT 1`, [id, empresaId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export type CotizacionInput = {
  clienteId: number;
  rutaId?: number | null;
  origenTexto?: string | null;
  destinoTexto?: string | null;
  tarifaCotizada: number;
  incluyeIva?: boolean;
  fechaEmision: string;
  fechaVencimiento?: string | null;
  pilotoIncluido?: boolean;
  gpsIncluido?: boolean;
  seguroMercaderiaIncluido?: boolean;
  seguroTercerosIncluido?: boolean;
  kmIncluidos?: number | null;
  tarifaKmAdicional?: number | null;
  condicionesAdicionales?: string | null;
  observaciones?: string | null;
};

type SnapshotRuta = {
  rutaCodigoHistorico: string;
  tarifaReferencia: number | null;
  costoOperativoReferencia: number | null;
  origenDefault: string | null;
  destinoDefault: string | null;
};

/**
 * AISLAMIENTO MULTIEMPRESA — el snapshot SIEMPRE se resuelve del lado del
 * servidor, releyendo tms_cliente_rutas por (id, empresa_id); nunca se
 * confía en un tarifaReferencia/costoOperativo que el cliente pretenda
 * haber copiado de una ruta. Si el id no existe en esta empresa, se
 * rechaza — nunca se acepta silenciosamente una ruta de otra empresa.
 */
async function resolverSnapshotRuta(
  conn: PoolConnection,
  empresaId: number,
  rutaId: number | null | undefined,
): Promise<SnapshotRuta | null> {
  if (rutaId == null) return null;
  const rows = await queryConn<RowDataPacket[]>(conn,
    `SELECT codigo, tarifa_referencia, costo_operativo, lugar_carga_texto, destino_descripcion
     FROM tms_cliente_rutas WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [rutaId, empresaId],
  );
  if (!rows[0]) throw new Error("La ruta indicada no pertenece a esta empresa.");
  const r = rows[0];
  return {
    rutaCodigoHistorico: String(r.codigo),
    tarifaReferencia: r.tarifa_referencia != null ? Number(r.tarifa_referencia) : null,
    costoOperativoReferencia: r.costo_operativo != null ? Number(r.costo_operativo) : null,
    origenDefault: r.lugar_carga_texto != null ? String(r.lugar_carga_texto) : null,
    destinoDefault: r.destino_descripcion != null ? String(r.destino_descripcion) : null,
  };
}

/** Mismo criterio: nunca se confía en un nombre de cliente enviado por el cliente HTTP — se relee tms_clientes por (id, empresa_id). */
async function resolverCliente(conn: PoolConnection, empresaId: number, clienteId: number): Promise<string> {
  const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [clienteId, empresaId]);
  if (!rows[0]) throw new Error("El cliente indicado no pertenece a esta empresa.");
  return String(rows[0].nombre);
}

function validarInput(input: Pick<CotizacionInput, "fechaEmision" | "tarifaCotizada" | "clienteId">) {
  if (!input.clienteId) throw new Error("Cliente requerido.");
  if (!input.fechaEmision) throw new Error("Fecha de emisión requerida.");
  if (!(input.tarifaCotizada > 0)) throw new Error("La tarifa cotizada debe ser mayor a cero.");
}

export async function crearCotizacion(
  empresaId: number,
  input: CotizacionInput,
  creadoPor?: string | null,
): Promise<Cotizacion> {
  validarInput(input);
  const conn = await getPool().getConnection();
  let cotizacionId = 0;
  try {
    await conn.beginTransaction();
    const clienteNombre = await resolverCliente(conn, empresaId, input.clienteId);
    const snapshot = await resolverSnapshotRuta(conn, empresaId, input.rutaId);
    const origenTexto = input.origenTexto?.trim() || snapshot?.origenDefault || null;
    const destinoTexto = input.destinoTexto?.trim() || snapshot?.destinoDefault || null;

    const r = await executeConn(conn,
      `INSERT INTO tms_cotizaciones
        (empresa_id, codigo, cliente_id, cliente_nombre, ruta_id, ruta_codigo_historico, origen_texto, destino_texto,
         tarifa_referencia, costo_operativo_referencia, tarifa_cotizada, incluye_iva, fecha_emision, fecha_vencimiento,
         piloto_incluido, gps_incluido, seguro_mercaderia_incluido, seguro_terceros_incluido,
         km_incluidos, tarifa_km_adicional, condiciones_adicionales, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        "", // se completa abajo, mismo criterio que fondos.ts (código derivado del id, sin condición de carrera)
        input.clienteId,
        clienteNombre,
        input.rutaId ?? null,
        snapshot?.rutaCodigoHistorico ?? null,
        origenTexto,
        destinoTexto,
        snapshot?.tarifaReferencia ?? null,
        snapshot?.costoOperativoReferencia ?? null,
        input.tarifaCotizada,
        input.incluyeIva ? 1 : 0,
        input.fechaEmision,
        input.fechaVencimiento ?? null,
        input.pilotoIncluido === false ? 0 : 1,
        input.gpsIncluido ? 1 : 0,
        input.seguroMercaderiaIncluido ? 1 : 0,
        input.seguroTercerosIncluido ? 1 : 0,
        input.kmIncluidos ?? null,
        input.tarifaKmAdicional ?? null,
        input.condicionesAdicionales?.trim() || null,
        input.observaciones?.trim() || null,
        creadoPor ?? null,
      ],
    );
    cotizacionId = Number(r.insertId);
    const codigo = `COT-${String(cotizacionId).padStart(6, "0")}`;
    await executeConn(conn, "UPDATE tms_cotizaciones SET codigo = ? WHERE id = ? AND empresa_id = ?", [codigo, cotizacionId, empresaId]);
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: creadoPor ?? null,
      accion: "crear",
      modulo: "tms_cotizaciones",
      detalle: `Cotización #${cotizacionId} ${codigo} creada para cliente ${clienteNombre} por Q${input.tarifaCotizada.toFixed(2)}.`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const creada = await obtenerCotizacion(empresaId, cotizacionId);
  if (!creada) throw new Error("No se pudo crear la cotización.");
  return creada;
}

export type CotizacionUpdate = Partial<CotizacionInput>;

/** Solo editable mientras estado = 'Borrador' — una vez Enviada, el contenido queda fijo (solo cambia de estado). */
export async function actualizarCotizacion(
  empresaId: number,
  id: number,
  cambios: CotizacionUpdate,
): Promise<Cotizacion | null> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const actualRows = await queryConn<RowDataPacket[]>(conn, `${SELECT} WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`, [id, empresaId]);
    if (!actualRows[0]) { await conn.rollback(); return null; }
    const actual = mapRow(actualRows[0]);
    if (actual.estado !== "Borrador") {
      throw new Error(`No se puede editar una cotización en estado "${actual.estado}" — solo mientras está en Borrador.`);
    }
    const clienteId = cambios.clienteId ?? actual.clienteId;
    const clienteNombre = cambios.clienteId != null ? await resolverCliente(conn, empresaId, clienteId) : actual.clienteNombre;
    const rutaId = cambios.rutaId !== undefined ? cambios.rutaId : actual.rutaId;
    const snapshot = cambios.rutaId !== undefined ? await resolverSnapshotRuta(conn, empresaId, rutaId) : null;
    const tarifaCotizada = cambios.tarifaCotizada ?? actual.tarifaCotizada;
    if (!(tarifaCotizada > 0)) throw new Error("La tarifa cotizada debe ser mayor a cero.");

    const origenTexto = cambios.origenTexto !== undefined
      ? (cambios.origenTexto?.trim() || snapshot?.origenDefault || null)
      : actual.origenTexto;
    const destinoTexto = cambios.destinoTexto !== undefined
      ? (cambios.destinoTexto?.trim() || snapshot?.destinoDefault || null)
      : actual.destinoTexto;

    await executeConn(conn,
      `UPDATE tms_cotizaciones SET
         cliente_id = ?, cliente_nombre = ?, ruta_id = ?, ruta_codigo_historico = ?, origen_texto = ?, destino_texto = ?,
         tarifa_referencia = ?, costo_operativo_referencia = ?, tarifa_cotizada = ?, incluye_iva = ?,
         fecha_emision = ?, fecha_vencimiento = ?, piloto_incluido = ?, gps_incluido = ?,
         seguro_mercaderia_incluido = ?, seguro_terceros_incluido = ?, km_incluidos = ?, tarifa_km_adicional = ?,
         condiciones_adicionales = ?, observaciones = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        clienteId,
        clienteNombre,
        rutaId,
        cambios.rutaId !== undefined ? (snapshot?.rutaCodigoHistorico ?? null) : actual.rutaCodigoHistorico,
        origenTexto,
        destinoTexto,
        cambios.rutaId !== undefined ? (snapshot?.tarifaReferencia ?? null) : actual.tarifaReferencia,
        cambios.rutaId !== undefined ? (snapshot?.costoOperativoReferencia ?? null) : actual.costoOperativoReferencia,
        tarifaCotizada,
        cambios.incluyeIva !== undefined ? (cambios.incluyeIva ? 1 : 0) : actual.incluyeIva ? 1 : 0,
        cambios.fechaEmision ?? actual.fechaEmision,
        cambios.fechaVencimiento !== undefined ? cambios.fechaVencimiento : actual.fechaVencimiento,
        cambios.pilotoIncluido !== undefined ? (cambios.pilotoIncluido ? 1 : 0) : actual.pilotoIncluido ? 1 : 0,
        cambios.gpsIncluido !== undefined ? (cambios.gpsIncluido ? 1 : 0) : actual.gpsIncluido ? 1 : 0,
        cambios.seguroMercaderiaIncluido !== undefined ? (cambios.seguroMercaderiaIncluido ? 1 : 0) : actual.seguroMercaderiaIncluido ? 1 : 0,
        cambios.seguroTercerosIncluido !== undefined ? (cambios.seguroTercerosIncluido ? 1 : 0) : actual.seguroTercerosIncluido ? 1 : 0,
        cambios.kmIncluidos !== undefined ? cambios.kmIncluidos : actual.kmIncluidos,
        cambios.tarifaKmAdicional !== undefined ? cambios.tarifaKmAdicional : actual.tarifaKmAdicional,
        cambios.condicionesAdicionales !== undefined ? cambios.condicionesAdicionales?.trim() || null : actual.condicionesAdicionales,
        cambios.observaciones !== undefined ? cambios.observaciones?.trim() || null : actual.observaciones,
        id,
        empresaId,
      ],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerCotizacion(empresaId, id);
}

/** Transición de estado — SIEMPRE valida contra TRANSICIONES_COTIZACION. Deja rastro en `auditoria`. */
export async function cambiarEstadoCotizacion(
  empresaId: number,
  id: number,
  destino: EstadoCotizacion,
  usuario?: string | null,
): Promise<Cotizacion | null> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rows = await queryConn<RowDataPacket[]>(conn,
      "SELECT id, estado FROM tms_cotizaciones WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
      [id, empresaId],
    );
    if (!rows[0]) { await conn.rollback(); return null; }
    const estadoActual = String(rows[0].estado) as EstadoCotizacion;
    if (!TRANSICIONES_COTIZACION[estadoActual].includes(destino)) {
      throw new Error(`No se puede pasar de "${estadoActual}" a "${destino}".`);
    }
    await executeConn(conn, "UPDATE tms_cotizaciones SET estado = ? WHERE id = ? AND empresa_id = ?", [destino, id, empresaId]);
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: usuario ?? null,
      accion: "cambiar_estado",
      modulo: "tms_cotizaciones",
      detalle: `Cotización #${id}: ${estadoActual} -> ${destino}.`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerCotizacion(empresaId, id);
}

/**
 * "Duplicar para crear una nueva versión" — copia los mismos datos
 * (cliente, ruta, tarifas, condiciones) a una cotización NUEVA en
 * Borrador con código propio y fecha de emisión de hoy; la original NO
 * se modifica. No requiere una columna de "versión anterior": es
 * simplemente un alta nueva pre-llenada, mismo criterio que "duplicar"
 * en cualquier otro formulario de la app.
 */
export async function duplicarCotizacion(
  empresaId: number,
  id: number,
  creadoPor?: string | null,
): Promise<Cotizacion | null> {
  const original = await obtenerCotizacion(empresaId, id);
  if (!original) return null;
  return crearCotizacion(empresaId, {
    clienteId: original.clienteId,
    rutaId: original.rutaId,
    origenTexto: original.origenTexto,
    destinoTexto: original.destinoTexto,
    tarifaCotizada: original.tarifaCotizada,
    incluyeIva: original.incluyeIva,
    fechaEmision: new Date().toISOString().slice(0, 10),
    fechaVencimiento: null,
    pilotoIncluido: original.pilotoIncluido,
    gpsIncluido: original.gpsIncluido,
    seguroMercaderiaIncluido: original.seguroMercaderiaIncluido,
    seguroTercerosIncluido: original.seguroTercerosIncluido,
    kmIncluidos: original.kmIncluidos,
    tarifaKmAdicional: original.tarifaKmAdicional,
    condicionesAdicionales: original.condicionesAdicionales,
    observaciones: original.observaciones,
  }, creadoPor);
}
