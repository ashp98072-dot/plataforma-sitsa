import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarSnapshotCosteoTx, type CosteoPreparado } from "./cotizacion-costeo-db";
import {
  DOCUMENTO_EMISOR_DEFAULT,
  LIMITE_TEXTO_DOCUMENTO,
  LIMITE_TEXTO_MENSAJE_COMERCIAL,
  esDocumentoEmisor,
  normalizarDocumentoEmisor,
  textoOpcional,
  type DocumentoEmisor,
} from "./cotizacion-documento";

/**
 * COTIZADOR-TMS-1 (fase 1) — cotizaciones comerciales de TMS. Reutiliza
 * catálogos existentes, no duplica nada:
 *   - tms_clientes      -> clienteId (mismo maestro que tms_planes_viaje/
 *                          tms_cliente_rutas/tms_gastos_operativos)
 *   - tms_cliente_rutas -> rutaId opcional (SNAPSHOT, sin FK — mismo
 *                          criterio que tms_planes_viaje.ruta_id: al
 *                          elegir una ruta se COPIA tarifa_referencia/
 *                          origen/destino a la cotización; cambios
 *                          futuros de la ruta maestra NUNCA alteran una
 *                          cotización ya guardada)
 *   - auditoria         -> registrarAuditoria/registrarAuditoriaTx, sin
 *                          bitácora paralela de cambios de estado.
 *
 * Esquema: NO se crea/altera desde este módulo — asume que
 * sql/migrate-2026-09-cotizador-tms.sql ya se aplicó manualmente (mismo
 * criterio que cliente-rutas.ts/gastos.ts/fondos.ts).
 *
 * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo" ya
 * no se utiliza: ya no se copia de la ruta, no se muestra y no entra en
 * ningún cálculo. `tms_cotizaciones.costo_operativo_referencia` NO se
 * eliminó (sin DROP, sin migración destructiva) — queda en BD con los
 * datos históricos de cotizaciones previas, simplemente esta capa ya no
 * la selecciona ni la escribe para cotizaciones nuevas.
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

/**
 * Línea ADICIONAL de una cotización con varias rutas/destinos (tabla
 * tms_cotizacion_lineas, ver sql/migrate-2026-09-cotizaciones-lineas.sql).
 * La línea PRINCIPAL (orden 1) nunca vive aquí: son las propias columnas
 * origenTexto/destinoTexto/unidadDescripcion/tarifaCotizada de la
 * cotización — el costeo interno solo lee esas, nunca esta tabla.
 */
export type LineaAdicional = {
  id: number;
  orden: number;
  origenTexto: string | null;
  destinoTexto: string | null;
  unidadDescripcion: string | null;
  tarifaCotizada: number;
};

export type LineaAdicionalInput = {
  origenTexto?: string | null;
  destinoTexto?: string | null;
  unidadDescripcion?: string | null;
  tarifaCotizada: number;
};

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
  servicioRefrigerado?: boolean;
  kmIncluidos: number | null;
  tarifaKmAdicional: number | null;
  condicionesAdicionales: string | null;
  observaciones: string | null;
  /** FASE 6 — datos del documento comercial, guardados en la fila (histórico inmutable tras Enviada). */
  documentoEmisor: DocumentoEmisor;
  atencionNombre: string | null;
  atencionCargo: string | null;
  unidadDescripcion: string | null;
  /** Snapshot del texto del PDF — ver mensajeComercial en cotizacion-documento.ts (fallback determinista si es null). */
  mensajeComercial: string | null;
  cierreComercial: string | null;
  creadoPor: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
  /** Rutas/destinos adicionales a la línea principal (orden 2 en adelante). Ver LineaAdicional. */
  lineasAdicionales: LineaAdicional[];
};

function mapLineaRow(r: RowDataPacket): LineaAdicional {
  return {
    id: Number(r.id),
    orden: Number(r.orden),
    origenTexto: r.origen_texto != null ? String(r.origen_texto) : null,
    destinoTexto: r.destino_texto != null ? String(r.destino_texto) : null,
    unidadDescripcion: r.unidad_descripcion != null ? String(r.unidad_descripcion) : null,
    tarifaCotizada: Number(r.tarifa_cotizada ?? 0),
  };
}

/** Trae las líneas adicionales de varias cotizaciones en una sola consulta (aislada por empresa_id). */
async function lineasDeCotizaciones(empresaId: number, cotizacionIds: number[]): Promise<Map<number, LineaAdicional[]>> {
  const mapa = new Map<number, LineaAdicional[]>();
  if (!cotizacionIds.length) return mapa;
  const placeholders = cotizacionIds.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT id, cotizacion_id, orden, origen_texto, destino_texto, unidad_descripcion, tarifa_cotizada
     FROM tms_cotizacion_lineas
     WHERE empresa_id = ? AND cotizacion_id IN (${placeholders})
     ORDER BY cotizacion_id, orden`,
    [empresaId, ...cotizacionIds],
  );
  for (const r of rows) {
    const cotizacionId = Number(r.cotizacion_id);
    const arr = mapa.get(cotizacionId) ?? [];
    arr.push(mapLineaRow(r));
    mapa.set(cotizacionId, arr);
  }
  return mapa;
}

function mapRow(r: RowDataPacket): Omit<Cotizacion, "lineasAdicionales"> {
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
    servicioRefrigerado: Number(r.servicio_refrigerado ?? 0) === 1,
    kmIncluidos: r.km_incluidos != null ? Number(r.km_incluidos) : null,
    tarifaKmAdicional: r.tarifa_km_adicional != null ? Number(r.tarifa_km_adicional) : null,
    condicionesAdicionales: r.condiciones_adicionales != null ? String(r.condiciones_adicionales) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    documentoEmisor: normalizarDocumentoEmisor(r.documento_emisor),
    atencionNombre: r.atencion_nombre != null ? String(r.atencion_nombre) : null,
    atencionCargo: r.atencion_cargo != null ? String(r.atencion_cargo) : null,
    unidadDescripcion: r.unidad_descripcion != null ? String(r.unidad_descripcion) : null,
    mensajeComercial: r.mensaje_comercial != null ? String(r.mensaje_comercial) : null,
    cierreComercial: r.cierre_comercial != null ? String(r.cierre_comercial) : null,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: r.creado_en != null ? String(r.creado_en) : null,
    actualizadoEn: r.actualizado_en != null ? String(r.actualizado_en) : null,
  };
}

const SELECT = `
  SELECT id, empresa_id, codigo, cliente_id, cliente_nombre, ruta_id, ruta_codigo_historico,
         origen_texto, destino_texto, tarifa_referencia, tarifa_cotizada,
         incluye_iva, moneda, DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS fecha_emision,
         DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento, estado,
         piloto_incluido, gps_incluido, seguro_mercaderia_incluido, seguro_terceros_incluido, servicio_refrigerado,
         km_incluidos, tarifa_km_adicional, condiciones_adicionales, observaciones,
         documento_emisor, atencion_nombre, atencion_cargo, unidad_descripcion,
         mensaje_comercial, cierre_comercial,
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
  const cotizaciones = rows.map(mapRow);
  const mapaLineas = await lineasDeCotizaciones(empresaId, cotizaciones.map((c) => c.id));
  return cotizaciones.map((c) => ({ ...c, lineasAdicionales: mapaLineas.get(c.id) ?? [] }));
}

export async function obtenerCotizacion(empresaId: number, id: number): Promise<Cotizacion | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? AND empresa_id = ? LIMIT 1`, [id, empresaId]);
  if (!rows[0]) return null;
  const cotizacion = mapRow(rows[0]);
  const mapaLineas = await lineasDeCotizaciones(empresaId, [cotizacion.id]);
  return { ...cotizacion, lineasAdicionales: mapaLineas.get(cotizacion.id) ?? [] };
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
  servicioRefrigerado?: boolean;
  kmIncluidos?: number | null;
  tarifaKmAdicional?: number | null;
  condicionesAdicionales?: string | null;
  observaciones?: string | null;
  documentoEmisor?: DocumentoEmisor;
  atencionNombre?: string | null;
  atencionCargo?: string | null;
  unidadDescripcion?: string | null;
  /** Snapshot del texto del PDF; si se omite al CREAR, el llamador (route.ts) resuelve el default de Ajustes/fallback antes de llamar. */
  mensajeComercial?: string | null;
  cierreComercial?: string | null;
  /**
   * Rutas/destinos adicionales a la línea principal (orden 2 en adelante).
   * CREAR: si se omite, la cotización queda con una sola línea (comportamiento
   * de siempre). EDITAR (CotizacionUpdate = Partial<CotizacionInput>): si se
   * omite (undefined), las líneas existentes NO se tocan; si se manda un
   * arreglo (incluido vacío []), REEMPLAZA por completo las líneas
   * adicionales existentes — nunca se intenta diffear id por id.
   */
  lineasAdicionales?: LineaAdicionalInput[];
};

type SnapshotRuta = {
  rutaCodigoHistorico: string;
  tarifaReferencia: number | null;
  origenDefault: string | null;
  destinoDefault: string | null;
};

/**
 * AISLAMIENTO MULTIEMPRESA — el snapshot SIEMPRE se resuelve del lado del
 * servidor, releyendo tms_cliente_rutas por (id, empresa_id); nunca se
 * confía en un tarifaReferencia que el cliente pretenda haber copiado de
 * una ruta. Si el id no existe en esta empresa, se rechaza — nunca se
 * acepta silenciosamente una ruta de otra empresa.
 *
 * TMS-SIN-COSTO-OPERATIVO-1 — ya no se lee/copia costo_operativo de la
 * ruta (negocio confirmó que ya no se utiliza).
 */
async function resolverSnapshotRuta(
  conn: PoolConnection,
  empresaId: number,
  rutaId: number | null | undefined,
): Promise<SnapshotRuta | null> {
  if (rutaId == null) return null;
  const rows = await queryConn<RowDataPacket[]>(conn,
    `SELECT codigo, tarifa_referencia, lugar_carga_texto, destino_descripcion
     FROM tms_cliente_rutas WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [rutaId, empresaId],
  );
  if (!rows[0]) throw new Error("La ruta indicada no pertenece a esta empresa.");
  const r = rows[0];
  return {
    rutaCodigoHistorico: String(r.codigo),
    tarifaReferencia: r.tarifa_referencia != null ? Number(r.tarifa_referencia) : null,
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

/** Marca del documento: solo valores del catálogo cerrado (KUIQTRANS | MONACO); cualquier otro se rechaza. */
function validarDocumentoEmisor(valor: unknown) {
  if (valor !== undefined && !esDocumentoEmisor(valor)) throw new Error("Documento emisor inválido.");
}

/** Atención / cargo / unidad: opcionales; con texto, no pueden exceder la columna VARCHAR(160). */
function validarTextosDocumento(input: Pick<CotizacionInput, "atencionNombre" | "atencionCargo" | "unidadDescripcion">) {
  for (const [valor, etiqueta] of [
    [input.atencionNombre, "La atención"], [input.atencionCargo, "El cargo / referencia"], [input.unidadDescripcion, "La unidad"],
  ] as const) {
    if ((textoOpcional(valor)?.length ?? 0) > LIMITE_TEXTO_DOCUMENTO) {
      throw new Error(`${etiqueta} no puede exceder ${LIMITE_TEXTO_DOCUMENTO} caracteres.`);
    }
  }
}

/** Mensaje/cierre comercial: opcionales; con texto, no pueden exceder LIMITE_TEXTO_MENSAJE_COMERCIAL. */
function validarMensajesComerciales(input: Pick<CotizacionInput, "mensajeComercial" | "cierreComercial">) {
  for (const [valor, etiqueta] of [
    [input.mensajeComercial, "El mensaje para el cliente"], [input.cierreComercial, "El cierre comercial"],
  ] as const) {
    if ((textoOpcional(valor)?.length ?? 0) > LIMITE_TEXTO_MENSAJE_COMERCIAL) {
      throw new Error(`${etiqueta} no puede exceder ${LIMITE_TEXTO_MENSAJE_COMERCIAL} caracteres.`);
    }
  }
}

const LIMITE_LINEAS_ADICIONALES = 50;
/** Mismo límite que las columnas origen_texto/destino_texto de tms_cotizaciones (VARCHAR(300)). */
const LIMITE_TEXTO_UBICACION = 300;

/** Rutas/destinos adicionales: precio > 0 y textos dentro del límite de columna — igual criterio que la línea principal. */
function validarLineasAdicionales(lineas: LineaAdicionalInput[] | undefined) {
  if (lineas === undefined) return;
  if (lineas.length > LIMITE_LINEAS_ADICIONALES) {
    throw new Error(`No se pueden agregar más de ${LIMITE_LINEAS_ADICIONALES} líneas adicionales.`);
  }
  lineas.forEach((linea, i) => {
    const numero = i + 2; // la línea 1 es siempre la principal
    if (!(linea.tarifaCotizada > 0)) throw new Error(`El precio de la línea ${numero} debe ser mayor a cero.`);
    for (const [valor, etiqueta] of [
      [linea.origenTexto, "El punto de carga"], [linea.destinoTexto, "El punto de descarga"],
    ] as const) {
      if ((textoOpcional(valor)?.length ?? 0) > LIMITE_TEXTO_UBICACION) {
        throw new Error(`${etiqueta} de la línea ${numero} no puede exceder ${LIMITE_TEXTO_UBICACION} caracteres.`);
      }
    }
    if ((textoOpcional(linea.unidadDescripcion)?.length ?? 0) > LIMITE_TEXTO_DOCUMENTO) {
      throw new Error(`La unidad de la línea ${numero} no puede exceder ${LIMITE_TEXTO_DOCUMENTO} caracteres.`);
    }
  });
}

function validarInput(input: Pick<CotizacionInput, "fechaEmision" | "tarifaCotizada" | "clienteId" | "documentoEmisor" | "atencionNombre" | "atencionCargo" | "unidadDescripcion" | "mensajeComercial" | "cierreComercial">) {
  if (!input.clienteId) throw new Error("Cliente requerido.");
  if (!input.fechaEmision) throw new Error("Fecha de emisión requerida.");
  if (!(input.tarifaCotizada > 0)) throw new Error("La tarifa cotizada debe ser mayor a cero.");
  validarDocumentoEmisor(input.documentoEmisor);
  validarTextosDocumento(input);
  validarMensajesComerciales(input);
}

/** INSERT puro (sin DELETE previo) — usado al crear. orden empieza en 2 (1 es la línea principal). */
async function insertarLineasAdicionalesTx(conn: PoolConnection, empresaId: number, cotizacionId: number, lineas: LineaAdicionalInput[]): Promise<void> {
  let orden = 2;
  for (const linea of lineas) {
    await executeConn(conn,
      `INSERT INTO tms_cotizacion_lineas (empresa_id, cotizacion_id, orden, origen_texto, destino_texto, unidad_descripcion, tarifa_cotizada)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, cotizacionId, orden, textoOpcional(linea.origenTexto), textoOpcional(linea.destinoTexto), textoOpcional(linea.unidadDescripcion), linea.tarifaCotizada],
    );
    orden += 1;
  }
}

/** Reemplazo completo — usado al editar (DELETE + INSERT en la misma transacción; nunca UPDATE id por id). */
async function reemplazarLineasAdicionalesTx(conn: PoolConnection, empresaId: number, cotizacionId: number, lineas: LineaAdicionalInput[]): Promise<void> {
  await executeConn(conn, "DELETE FROM tms_cotizacion_lineas WHERE empresa_id = ? AND cotizacion_id = ?", [empresaId, cotizacionId]);
  await insertarLineasAdicionalesTx(conn, empresaId, cotizacionId, lineas);
}

/**
 * `costeo` (opcional, COTIZACIONES-COSTEO Fase 3): costeo YA calculado en
 * servidor. Si viene, el snapshot se guarda en la MISMA transacción que la
 * cotización — si falla cualquier parte, rollback completo (nunca queda una
 * cotización sin el snapshot que el usuario pidió guardar). Sin `costeo`,
 * el comportamiento es idéntico al de siempre.
 */
export async function crearCotizacion(
  empresaId: number,
  input: CotizacionInput,
  creadoPor?: string | null,
  costeo?: CosteoPreparado | null,
): Promise<Cotizacion> {
  validarInput(input);
  validarLineasAdicionales(input.lineasAdicionales);
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
         tarifa_referencia, tarifa_cotizada, incluye_iva, fecha_emision, fecha_vencimiento,
         piloto_incluido, gps_incluido, seguro_mercaderia_incluido, seguro_terceros_incluido, servicio_refrigerado,
         km_incluidos, tarifa_km_adicional, condiciones_adicionales, observaciones, creado_por,
         documento_emisor, atencion_nombre, atencion_cargo, unidad_descripcion,
         mensaje_comercial, cierre_comercial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.tarifaCotizada,
        input.incluyeIva ? 1 : 0,
        input.fechaEmision,
        input.fechaVencimiento ?? null,
        input.pilotoIncluido === false ? 0 : 1,
        input.gpsIncluido ? 1 : 0,
        input.seguroMercaderiaIncluido ? 1 : 0,
        input.seguroTercerosIncluido ? 1 : 0,
        input.servicioRefrigerado ? 1 : 0,
        input.kmIncluidos ?? null,
        input.tarifaKmAdicional ?? null,
        input.condicionesAdicionales?.trim() || null,
        input.observaciones?.trim() || null,
        creadoPor ?? null,
        input.documentoEmisor ?? DOCUMENTO_EMISOR_DEFAULT,
        textoOpcional(input.atencionNombre),
        textoOpcional(input.atencionCargo),
        textoOpcional(input.unidadDescripcion),
        textoOpcional(input.mensajeComercial),
        textoOpcional(input.cierreComercial),
      ],
    );
    cotizacionId = Number(r.insertId);
    const codigo = `COT-${String(cotizacionId).padStart(6, "0")}`;
    await executeConn(conn, "UPDATE tms_cotizaciones SET codigo = ? WHERE id = ? AND empresa_id = ?", [codigo, cotizacionId, empresaId]);
    if (input.lineasAdicionales?.length) {
      await insertarLineasAdicionalesTx(conn, empresaId, cotizacionId, input.lineasAdicionales);
    }
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: creadoPor ?? null,
      accion: "crear",
      modulo: "tms_cotizaciones",
      detalle: `Cotización #${cotizacionId} ${codigo} creada para cliente ${clienteNombre} por Q${input.tarifaCotizada.toFixed(2)}.`,
    });
    if (costeo) {
      await guardarSnapshotCosteoTx(conn, { empresaId, cotizacionId, cotizacionCodigo: codigo, usuario: creadoPor ?? null, costeo });
    }
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

/**
 * Solo editable mientras estado = 'Borrador' — una vez Enviada, el contenido queda fijo (solo cambia de estado).
 * `costeo` (opcional): registra el snapshot por PRIMERA vez dentro de esta transacción; si la cotización ya
 * tiene uno, falla (ErrorCosteoYaRegistrado) y se revierte todo — el snapshot es inmutable.
 */
export async function actualizarCotizacion(
  empresaId: number,
  id: number,
  cambios: CotizacionUpdate,
  costeo?: CosteoPreparado | null,
  usuario?: string | null,
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
    validarDocumentoEmisor(cambios.documentoEmisor);
    validarTextosDocumento(cambios);
    validarMensajesComerciales(cambios);
    validarLineasAdicionales(cambios.lineasAdicionales);

    const origenTexto = cambios.origenTexto !== undefined
      ? (cambios.origenTexto?.trim() || snapshot?.origenDefault || null)
      : actual.origenTexto;
    const destinoTexto = cambios.destinoTexto !== undefined
      ? (cambios.destinoTexto?.trim() || snapshot?.destinoDefault || null)
      : actual.destinoTexto;

    await executeConn(conn,
      `UPDATE tms_cotizaciones SET
         cliente_id = ?, cliente_nombre = ?, ruta_id = ?, ruta_codigo_historico = ?, origen_texto = ?, destino_texto = ?,
         tarifa_referencia = ?, tarifa_cotizada = ?, incluye_iva = ?,
         fecha_emision = ?, fecha_vencimiento = ?, piloto_incluido = ?, gps_incluido = ?,
         seguro_mercaderia_incluido = ?, seguro_terceros_incluido = ?, servicio_refrigerado = ?, km_incluidos = ?, tarifa_km_adicional = ?,
         condiciones_adicionales = ?, observaciones = ?,
         documento_emisor = ?, atencion_nombre = ?, atencion_cargo = ?, unidad_descripcion = ?,
         mensaje_comercial = ?, cierre_comercial = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        clienteId,
        clienteNombre,
        rutaId,
        cambios.rutaId !== undefined ? (snapshot?.rutaCodigoHistorico ?? null) : actual.rutaCodigoHistorico,
        origenTexto,
        destinoTexto,
        cambios.rutaId !== undefined ? (snapshot?.tarifaReferencia ?? null) : actual.tarifaReferencia,
        tarifaCotizada,
        cambios.incluyeIva !== undefined ? (cambios.incluyeIva ? 1 : 0) : actual.incluyeIva ? 1 : 0,
        cambios.fechaEmision ?? actual.fechaEmision,
        cambios.fechaVencimiento !== undefined ? cambios.fechaVencimiento : actual.fechaVencimiento,
        cambios.pilotoIncluido !== undefined ? (cambios.pilotoIncluido ? 1 : 0) : actual.pilotoIncluido ? 1 : 0,
        cambios.gpsIncluido !== undefined ? (cambios.gpsIncluido ? 1 : 0) : actual.gpsIncluido ? 1 : 0,
        cambios.seguroMercaderiaIncluido !== undefined ? (cambios.seguroMercaderiaIncluido ? 1 : 0) : actual.seguroMercaderiaIncluido ? 1 : 0,
        cambios.seguroTercerosIncluido !== undefined ? (cambios.seguroTercerosIncluido ? 1 : 0) : actual.seguroTercerosIncluido ? 1 : 0,
        cambios.servicioRefrigerado !== undefined ? (cambios.servicioRefrigerado ? 1 : 0) : actual.servicioRefrigerado ? 1 : 0,
        cambios.kmIncluidos !== undefined ? cambios.kmIncluidos : actual.kmIncluidos,
        cambios.tarifaKmAdicional !== undefined ? cambios.tarifaKmAdicional : actual.tarifaKmAdicional,
        cambios.condicionesAdicionales !== undefined ? cambios.condicionesAdicionales?.trim() || null : actual.condicionesAdicionales,
        cambios.observaciones !== undefined ? cambios.observaciones?.trim() || null : actual.observaciones,
        cambios.documentoEmisor ?? actual.documentoEmisor,
        cambios.atencionNombre !== undefined ? textoOpcional(cambios.atencionNombre) : actual.atencionNombre,
        cambios.atencionCargo !== undefined ? textoOpcional(cambios.atencionCargo) : actual.atencionCargo,
        cambios.unidadDescripcion !== undefined ? textoOpcional(cambios.unidadDescripcion) : actual.unidadDescripcion,
        cambios.mensajeComercial !== undefined ? textoOpcional(cambios.mensajeComercial) : actual.mensajeComercial,
        cambios.cierreComercial !== undefined ? textoOpcional(cambios.cierreComercial) : actual.cierreComercial,
        id,
        empresaId,
      ],
    );
    if (cambios.lineasAdicionales !== undefined) {
      await reemplazarLineasAdicionalesTx(conn, empresaId, id, cambios.lineasAdicionales);
    }
    if (costeo) {
      await guardarSnapshotCosteoTx(conn, { empresaId, cotizacionId: id, cotizacionCodigo: actual.codigo, usuario: usuario ?? null, costeo });
    }
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
 * (cliente, ruta, tarifas, condiciones, marca/atención/cargo/unidad del
 * documento comercial) a una cotización NUEVA en
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
    servicioRefrigerado: original.servicioRefrigerado,
    kmIncluidos: original.kmIncluidos,
    tarifaKmAdicional: original.tarifaKmAdicional,
    condicionesAdicionales: original.condicionesAdicionales,
    observaciones: original.observaciones,
    documentoEmisor: original.documentoEmisor,
    atencionNombre: original.atencionNombre,
    atencionCargo: original.atencionCargo,
    unidadDescripcion: original.unidadDescripcion,
    mensajeComercial: original.mensajeComercial,
    cierreComercial: original.cierreComercial,
    lineasAdicionales: original.lineasAdicionales.map((l) => ({
      origenTexto: l.origenTexto,
      destinoTexto: l.destinoTexto,
      unidadDescripcion: l.unidadDescripcion,
      tarifaCotizada: l.tarifaCotizada,
    })),
  }, creadoPor);
}
