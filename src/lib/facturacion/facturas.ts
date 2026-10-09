import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { asegurarVinculosTmsClientes } from "@/lib/clientes/repository";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import {
  construirBorrador,
  EQUIVALENTES_GTQ,
  evaluarPlanFacturable,
  normalizarMoneda,
  type BorradorCalculado,
  type PlanParaFactura,
  type SnapshotLineaPrevio,
} from "@/lib/facturacion/borrador-calculo";

/**
 * FACT-1 — Facturas de cliente vinculadas a viajes TMS Cerrados, y sus
 * pagos. Diseño aprobado (FACT-1-DISEÑO) con los 3 ajustes de
 * FACT-1-IMPLEMENTACIÓN-1:
 *   A) el estado del viaje se deriva de estado_admin de la factura
 *      vinculada (Borrador -> "en borrador de factura", Emitida ->
 *      "Facturado"; Anulada NUNCA cuenta como facturación activa —
 *      anular BORRA la fila de fact_factura_viajes, así que "existe
 *      fila" siempre implica una factura viva, nunca una anulada).
 *   B) numero_factura/fecha_emision son NULL mientras Borrador; se
 *      exigen recién al emitir.
 *   C) los pagos pertenecen a la FACTURA — nunca prorrateados por viaje.
 *
 * NUNCA toca tms_planes_viaje.estado, ni ningún otro módulo (viáticos,
 * multas, cont_cxc). Solo lee tarifa_comercial/estado/empresa_id/
 * cliente_id de tms_planes_viaje.
 *
 * IMPORTANTE — dos espacios de ID de cliente distintos: fact_facturas.
 * cliente_id referencia `clientes.id` (catálogo compartido Facturación/
 * Contabilidad, mismo que ya usa fact_cliente_perfil), mientras que
 * tms_planes_viaje.cliente_id referencia `tms_clientes.id` (catálogo
 * propio de TMS/Programación — confirmado por src/lib/tms/reportes-
 * viajes.ts). Se puentean vía `clientes.tms_cliente_id = tms_clientes.id`
 * (mismo bridge ya usado por asegurarVinculosTmsClientes en
 * src/lib/clientes/repository.ts) — NUNCA se comparan directamente.
 */

export type EstadoAdminFactura = "Borrador" | "Emitida" | "Anulada";
export type EstadoFinancieroFactura = "Sin pagos" | "Pago parcial" | "Cobrado";

export type ActorFacturacion = { empresaId: number; usuarioId: number; usuario: string };

export type ResultadoFactura =
  | { ok: true; facturaId: number }
  | { ok: false; error: string; status: number };

export type ResultadoSimple =
  | { ok: true }
  | { ok: false; error: string; status: number };

export type ViajePendiente = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  /**
   * HOTFIX PRE-MERGE PR #114 (Hallazgo 1): NUNCA null aquí — la condición
   * `cli.id IS NOT NULL` en `condicionesViajesPendientes` garantiza que
   * todo viaje devuelto por listarViajesPendientes tiene un `clientes.id`
   * real vinculado. Un viaje sin bridge simplemente no aparece.
   */
  clienteId: number;
  cliente: string;
  placa: string | null;
  tarifaComercial: number | null;
  cerradoEn: string | null;
  /** FACT-2 — contexto para que Facturación identifique el servicio sin abrir TMS. */
  rutaCodigo: string | null;
  origen: string | null;
  destino: string | null;
  /** Nombre del piloto asignado (solo el nombre). Para viajes tercerizados, el nombre externo. */
  piloto: string | null;
  estado: string;
  /** Código normalizado (GTQ por defecto): una factura admite una sola moneda. */
  moneda: string;
};

export type Factura = {
  id: number;
  clienteId: number;
  cliente: string;
  numeroFactura: string | null;
  fechaEmision: string | null;
  montoTotal: number;
  estadoAdmin: EstadoAdminFactura;
  observaciones: string | null;
  creadoPor: number;
  creadoEn: string;
  actualizadoPor: number | null;
  actualizadoEn: string | null;
  totalPagado: number;
  saldo: number;
  /** null si la factura no está Emitida (Borrador/Anulada no tienen estado financiero). */
  estadoFinanciero: EstadoFinancieroFactura | null;
  /**
   * FACT-2 — desglose congelado al crear el borrador. `null` en facturas anteriores a FACT-2 (sin snapshot):
   * para esas solo existe `montoTotal`. `montoTotal` es siempre el TOTAL con IVA.
   * `precioIncluyeIva` es solo un RESUMEN: true/false si todas las líneas coinciden y `null` si hay MEZCLA (o es una
   * factura anterior a FACT-2). La fuente de verdad del tratamiento es cada línea (`FacturaViajeLinea`).
   */
  moneda: string;
  subtotal: number | null;
  iva: number | null;
  porcentajeIva: number | null;
  precioIncluyeIva: boolean | null;
  clienteNit: string | null;
  clienteDireccion: string | null;
};

export type FacturaViajeLinea = {
  id: number;
  planId: number;
  codigo: string;
  fechaPlan: string;
  montoAsignado: number;
  /** FACT-2 — fotografía de la línea (null en líneas anteriores a FACT-2). */
  descripcion: string | null;
  rutaCodigo: string | null;
  origen: string | null;
  destino: string | null;
  cantidad: number;
  /** Tratamiento de IVA congelado de ESTA línea (null en líneas anteriores a esta versión): es la fuente de verdad. */
  precioIncluyeIva: boolean | null;
  porcentajeIva: number | null;
  base: number | null;
  iva: number | null;
  total: number | null;
};
export type PagoFactura = {
  id: number;
  fechaPago: string;
  monto: number;
  referencia: string | null;
  medioPago: string | null;
  observaciones: string | null;
  registradoPor: number;
  creadoEn: string;
};

// FACT-1-TMS-REPORTES — exportada para que reportes-viajes.ts derive el
// mismo "estado de cobro" (Sin pagos/Pago parcial/Cobrado) SIN duplicar
// la regla aquí (nunca dos criterios que puedan divergir).
export function estadoFinancieroDe(montoTotal: number, totalPagado: number): EstadoFinancieroFactura {
  if (totalPagado <= 0) return "Sin pagos";
  if (totalPagado >= montoTotal) return "Cobrado";
  return "Pago parcial";
}

/** HOTFIX PRE-MERGE PR #113 (Hallazgo 2) — paginación server-side. */
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

export type Paginacion = { page?: number; pageSize?: number };
export type ResultadoPaginado<T> = { items: T[]; totalReal: number; page: number; pageSize: number };

function normalizarPaginacion(p: Paginacion): { page: number; pageSize: number; offset: number } {
  const pageSize = Math.min(Math.max(Math.trunc(p.pageSize ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const page = Math.max(Math.trunc(p.page ?? 1) || 1, 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * `fn` puede terminar de dos formas: lanzando (error inesperado, ver
 * catch abajo) o devolviendo `{ ok: false, ... }` (rechazo de validación
 * "normal", p.ej. "viaje no Cerrado") — en AMBOS casos la transacción
 * debe deshacerse, nunca confirmarse. Se detecta el segundo caso por
 * forma (todas las funciones de este archivo devuelven `{ok:true|false}`)
 * en vez de repetir `await conn.rollback()` antes de cada `return
 * {ok:false,...}` en cada función — un solo punto que nunca se puede
 * olvidar al agregar una validación nueva.
 */
function esResultadoFallido(v: unknown): boolean {
  return Boolean(v && typeof v === "object" && "ok" in v && (v as { ok: unknown }).ok === false);
}

/**
 * `readCommitted`: crear/editar un borrador usa READ COMMITTED (solo para esa transacción). Con el aislamiento por
 * defecto (REPEATABLE READ) el `SELECT … FROM fact_factura_viajes WHERE plan_id = ? FOR UPDATE` sobre una fila que
 * NO existe toma un bloqueo de HUECO en el índice UNIQUE; dos usuarios con viajes distintos (o traslapados) toman
 * huecos compatibles entre sí y luego sus INSERT se esperan mutuamente → deadlock (reproducido contra MariaDB real).
 * En READ COMMITTED no hay bloqueos de hueco: la serialización queda en el bloqueo de la fila del viaje, y el
 * UNIQUE(plan_id) sigue siendo la garantía final.
 */
async function tx<T>(fn: (conn: PoolConnection) => Promise<T>, opciones: { readCommitted?: boolean } = {}): Promise<T> {
  const conn = await getPool().getConnection();
  let descartada = false;
  try {
    if (opciones.readCommitted) await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const result = await fn(conn);
    if (esResultadoFallido(result)) {
      await conn.rollback();
    } else {
      await conn.commit();
    }
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      descartada = true;
      conn.destroy();
      console.error("Rollback facturación", rollbackError);
    }
    throw error;
  } finally {
    if (!descartada) conn.release();
  }
}

function esDuplicadoNumeroFactura(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_DUP_ENTRY" || err?.errno === 1062;
}

const mapFactura = (r: RowDataPacket): Factura => {
  const montoTotal = Number(r.monto_total);
  const totalPagado = Number(r.total_pagado ?? 0);
  const estadoAdmin = String(r.estado_admin) as EstadoAdminFactura;
  return {
    id: Number(r.id),
    clienteId: Number(r.cliente_id),
    // El nombre congelado en el borrador manda sobre el vivo: editar el cliente después no reescribe el documento.
    cliente: String(r.cliente_nombre_snapshot ?? r.cliente),
    numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null,
    fechaEmision: r.fecha_emision != null ? String(r.fecha_emision).slice(0, 10) : null,
    montoTotal,
    estadoAdmin,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    creadoPor: Number(r.creado_por),
    creadoEn: String(r.creado_en),
    actualizadoPor: r.actualizado_por != null ? Number(r.actualizado_por) : null,
    actualizadoEn: r.actualizado_en != null ? String(r.actualizado_en) : null,
    totalPagado,
    saldo: montoTotal - totalPagado,
    estadoFinanciero: estadoAdmin === "Emitida" ? estadoFinancieroDe(montoTotal, totalPagado) : null,
    moneda: r.moneda != null ? String(r.moneda) : "GTQ",
    subtotal: r.subtotal != null ? Number(r.subtotal) : null,
    iva: r.iva_monto != null ? Number(r.iva_monto) : null,
    porcentajeIva: r.porcentaje_iva != null ? Number(r.porcentaje_iva) : null,
    precioIncluyeIva: r.precio_incluye_iva != null ? Number(r.precio_incluye_iva) === 1 : null,
    clienteNit: r.cliente_nit_snapshot != null ? String(r.cliente_nit_snapshot) : null,
    clienteDireccion: r.cliente_direccion_snapshot != null ? String(r.cliente_direccion_snapshot) : null,
  };
};

const FACTURA_SELECT = `
  SELECT f.id, f.cliente_id, c.nombre AS cliente, f.numero_factura,
         DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha_emision, f.monto_total, f.estado_admin, f.observaciones,
         f.creado_por, f.creado_en, f.actualizado_por, f.actualizado_en,
         f.moneda, f.subtotal, f.iva_monto, f.porcentaje_iva, f.precio_incluye_iva,
         f.cliente_nombre_snapshot, f.cliente_nit_snapshot, f.cliente_direccion_snapshot,
         COALESCE(pg.total_pagado, 0) AS total_pagado
  FROM fact_facturas f
  INNER JOIN clientes c ON c.id = f.cliente_id
  LEFT JOIN (
    SELECT factura_id, SUM(monto) AS total_pagado FROM fact_pagos GROUP BY factura_id
  ) pg ON pg.factura_id = f.id
`;

export type FiltrosFacturas = {
  clienteId?: number;
  estadoAdmin?: EstadoAdminFactura;
  fechaDesde?: string;
  fechaHasta?: string;
} & Paginacion;

/** Condiciones+params compartidas EXACTAMENTE entre el listado paginado y el COUNT(*) independiente. */
function condicionesFacturas(empresaId: number, filtros: FiltrosFacturas): { condiciones: string[]; params: (string | number)[] } {
  const condiciones = ["f.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtros.clienteId) { condiciones.push("f.cliente_id = ?"); params.push(filtros.clienteId); }
  if (filtros.estadoAdmin) { condiciones.push("f.estado_admin = ?"); params.push(filtros.estadoAdmin); }
  if (filtros.fechaDesde) { condiciones.push("f.fecha_emision >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("f.fecha_emision <= ?"); params.push(filtros.fechaHasta); }
  return { condiciones, params };
}

export async function listarFacturas(empresaId: number, filtros: FiltrosFacturas): Promise<ResultadoPaginado<Factura>> {
  const { condiciones, params } = condicionesFacturas(empresaId, filtros);
  const { page, pageSize, offset } = normalizarPaginacion(filtros);
  const where = condiciones.join(" AND ");
  const [rows, countRows] = await Promise.all([
    query<RowDataPacket[]>(
      `${FACTURA_SELECT} WHERE ${where} ORDER BY f.creado_en DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    ),
    query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM fact_facturas f WHERE ${where}`, params),
  ]);
  return { items: rows.map(mapFactura), totalReal: Number(countRows[0]?.total ?? 0), page, pageSize };
}

export async function obtenerFactura(
  empresaId: number,
  facturaId: number,
): Promise<{ factura: Factura; viajes: FacturaViajeLinea[]; pagos: PagoFactura[] } | null> {
  const rows = await query<RowDataPacket[]>(
    `${FACTURA_SELECT} WHERE f.id = ? AND f.empresa_id = ? LIMIT 1`,
    [facturaId, empresaId],
  );
  if (!rows[0]) return null;
  const [viajesRows, pagosRows] = await Promise.all([
    query<RowDataPacket[]>(
      // Se prefiere SIEMPRE la fotografía de la línea; el dato vivo del viaje solo rellena filas anteriores a FACT-2.
      `SELECT ffv.id, ffv.plan_id, COALESCE(ffv.codigo_viaje_snapshot, p.codigo) AS codigo,
              DATE_FORMAT(COALESCE(ffv.fecha_viaje_snapshot, p.fecha_plan), '%Y-%m-%d') AS fecha_plan,
              ffv.monto_asignado, ffv.descripcion, ffv.ruta_codigo_snapshot, ffv.origen_snapshot,
              ffv.destino_snapshot, ffv.cantidad, ffv.precio_incluye_iva, ffv.porcentaje_iva,
              ffv.base_monto, ffv.iva_monto, ffv.total_linea
       FROM fact_factura_viajes ffv
       INNER JOIN tms_planes_viaje p ON p.id = ffv.plan_id
       WHERE ffv.factura_id = ?
       ORDER BY COALESCE(ffv.fecha_viaje_snapshot, p.fecha_plan), ffv.id`,
      [facturaId],
    ),
    query<RowDataPacket[]>(
      `SELECT id, DATE_FORMAT(fecha_pago, '%Y-%m-%d') AS fecha_pago, monto, referencia, medio_pago,
              observaciones, registrado_por, creado_en
       FROM fact_pagos WHERE factura_id = ? AND empresa_id = ? ORDER BY fecha_pago, id`,
      [facturaId, empresaId],
    ),
  ]);
  return {
    factura: mapFactura(rows[0]),
    viajes: viajesRows.map((r) => ({
      id: Number(r.id), planId: Number(r.plan_id), codigo: String(r.codigo),
      fechaPlan: String(r.fecha_plan), montoAsignado: Number(r.monto_asignado),
      descripcion: r.descripcion != null ? String(r.descripcion) : null,
      rutaCodigo: r.ruta_codigo_snapshot != null ? String(r.ruta_codigo_snapshot) : null,
      origen: r.origen_snapshot != null ? String(r.origen_snapshot) : null,
      destino: r.destino_snapshot != null ? String(r.destino_snapshot) : null,
      cantidad: r.cantidad != null ? Number(r.cantidad) : 1,
      precioIncluyeIva: r.precio_incluye_iva != null ? Number(r.precio_incluye_iva) === 1 : null,
      porcentajeIva: r.porcentaje_iva != null ? Number(r.porcentaje_iva) : null,
      base: r.base_monto != null ? Number(r.base_monto) : null,
      iva: r.iva_monto != null ? Number(r.iva_monto) : null,
      total: r.total_linea != null ? Number(r.total_linea) : null,
    })),
    pagos: pagosRows.map((r) => ({
      id: Number(r.id), fechaPago: String(r.fecha_pago), monto: Number(r.monto),
      referencia: r.referencia != null ? String(r.referencia) : null,
      medioPago: r.medio_pago != null ? String(r.medio_pago) : null,
      observaciones: r.observaciones != null ? String(r.observaciones) : null,
      registradoPor: Number(r.registrado_por), creadoEn: String(r.creado_en),
    })),
  };
}

/** Texto con al menos un carácter que no sea espacio en blanco (equivale a `trim() !== ""` del servidor). */
const SQL_NO_VACIO = (columna: string): string => `${columna} REGEXP '[^[:space:]]'`;
/** Negación segura frente a NULL: `NOT (NULL REGEXP …)` sería NULL (nunca verdadero) y ocultaría filas. */
const SQL_VACIO = (columna: string): string => `COALESCE(${columna}, '') NOT REGEXP '[^[:space:]]'`;
const SQL_MONEDA_GTQ = `(p.tarifa_moneda_historico IS NULL OR UPPER(TRIM(p.tarifa_moneda_historico)) IN (${EQUIVALENTES_GTQ.map((m) => `'${m}'`).join(", ")}))`;

/**
 * (Ajuste A) Solo viajes genuinamente libres: Cerrado y sin NINGUNA fila
 * en fact_factura_viajes — como anular BORRA esa fila, "sin fila" es
 * siempre sinónimo de "nunca facturado o la factura que lo tenía se
 * anuló". Esta es la única fuente para armar una factura NUEVA.
 *
 * HOTFIX PRE-MERGE PR #114 (Hallazgo 1): `cli.id IS NOT NULL` se agrega
 * AQUÍ (una sola vez, compartido por listado/COUNT/KPI — todos usan este
 * mismo array de condiciones sobre el mismo `LEFT JOIN clientes cli`) —
 * un viaje Cerrado sin bridge clientes.tms_cliente_id = tms_clientes.id
 * NUNCA debe aparecer como facturable, aunque técnicamente esté Cerrado y
 * sin factura viva: no hay ningún `clientes.id` al que asignárselo.
 */
function condicionesViajesPendientes(
  empresaId: number,
  filtros: { clienteId?: number; fechaDesde?: string; fechaHasta?: string; ruta?: string },
): { condiciones: string[]; params: (string | number)[] } {
  // "Facturable" NO es una columna: se deriva de estado + relaciones + facturación viva (ver docs/FACTURACION-VIAJES-FASE1.md).
  // Las mismas reglas las aplica en servidor `evaluarPlanFacturable` (borrador-calculo.ts) al crear/previsualizar.
  const condiciones = [
    "p.empresa_id = ?",
    "p.estado = 'Cerrado'",
    "NOT EXISTS (SELECT 1 FROM fact_factura_viajes ffv WHERE ffv.plan_id = p.id)",
    "cli.id IS NOT NULL",
    "p.tarifa_comercial > 0",
    // Solo GTQ en esta fase (ver MONEDA_SOPORTADA). Mismas equivalencias que `normalizarMoneda`: vacío/NULL, Q, QTZ, GTQ.
    SQL_MONEDA_GTQ,
    // Ruta/destino identificable — EXACTAMENTE lo que el servidor resuelve (`leerPlanParaFactura`): código de ruta,
    // destino congelado, o un destino de catálogo que EXISTE en la MISMA empresa y tiene nombre. Un lugar_descarga_id
    // huérfano o de otra empresa NO cuenta.
    `(${SQL_NO_VACIO("p.ruta_codigo_historico")}
      OR ${SQL_NO_VACIO("p.lugar_descarga_historico")}
      OR EXISTS (SELECT 1 FROM tms_lugares ldx
                 WHERE ldx.id = p.lugar_descarga_id AND ldx.empresa_id = p.empresa_id AND ${SQL_NO_VACIO("ldx.nombre")}))`,
  ];
  const params: (string | number)[] = [empresaId];
  // filtros.clienteId es un clientes.id (espacio de Facturación) — se
  // filtra vía el puente, NUNCA comparado directo contra p.cliente_id
  // (que es un tms_clientes.id).
  if (filtros.clienteId) { condiciones.push("cli.id = ?"); params.push(filtros.clienteId); }
  if (filtros.fechaDesde) { condiciones.push("p.fecha_plan >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("p.fecha_plan <= ?"); params.push(filtros.fechaHasta); }
  if (filtros.ruta) {
    // Busca por lo que la pantalla MUESTRA: el código de ruta, el destino congelado, o —si el viaje no tiene destino
    // congelado— el nombre del destino de catálogo de la MISMA empresa (mismo COALESCE que la columna «destino»).
    condiciones.push(`(p.ruta_codigo_historico LIKE ?
      OR p.lugar_descarga_historico LIKE ?
      OR (${SQL_VACIO("p.lugar_descarga_historico")}
          AND EXISTS (SELECT 1 FROM tms_lugares ldf
                      WHERE ldf.id = p.lugar_descarga_id AND ldf.empresa_id = p.empresa_id AND ldf.nombre LIKE ?)))`);
    params.push(`%${filtros.ruta}%`, `%${filtros.ruta}%`, `%${filtros.ruta}%`);
  }
  return { condiciones, params };
}

export type KpisFacturacion = {
  viajesPendientes: number;
  valorPendiente: number;
  facturasEmitidas: number;
  valorFacturado: number;
  pendienteCobro: number;
  cobrado: number;
};

/**
 * FACT-1-UI (Fase C) — KPI agregados con SQL (SUM/COUNT) sobre TODO el
 * universo de la empresa, nunca sobre una página del listado paginado.
 * Reutiliza EXACTAMENTE `condicionesViajesPendientes` (sin filtros) para
 * "viajes pendientes" — la misma condición que decide si un viaje puede
 * facturarse. Nunca se silencia el puente clientes↔TMS (mismo criterio
 * que listarViajesPendientes).
 */
export async function obtenerKpisFacturacion(empresaId: number): Promise<KpisFacturacion> {
  await asegurarSchemaClientes();
  await asegurarVinculosTmsClientes(empresaId);

  const { condiciones, params } = condicionesViajesPendientes(empresaId, {});
  const where = condiciones.join(" AND ");
  const [viajesRows, facturasRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(p.tarifa_comercial), 0) AS valor
       FROM tms_planes_viaje p
       LEFT JOIN clientes cli ON cli.tms_cliente_id = p.cliente_id AND cli.empresa_id = p.empresa_id
       WHERE ${where}`,
      params,
    ),
    query<RowDataPacket[]>(
      `SELECT COUNT(*) AS emitidas, COALESCE(SUM(f.monto_total), 0) AS valor_facturado,
              COALESCE(SUM(pg.total_pagado), 0) AS cobrado
       FROM fact_facturas f
       LEFT JOIN (SELECT factura_id, SUM(monto) AS total_pagado FROM fact_pagos GROUP BY factura_id) pg
         ON pg.factura_id = f.id
       WHERE f.empresa_id = ? AND f.estado_admin = 'Emitida'`,
      [empresaId],
    ),
  ]);
  const v = viajesRows[0] ?? {};
  const f = facturasRows[0] ?? {};
  const valorFacturado = Number(f.valor_facturado ?? 0);
  const cobrado = Number(f.cobrado ?? 0);
  return {
    viajesPendientes: Number(v.total ?? 0),
    valorPendiente: Number(v.valor ?? 0),
    facturasEmitidas: Number(f.emitidas ?? 0),
    valorFacturado,
    pendienteCobro: valorFacturado - cobrado,
    cobrado,
  };
}

export async function listarViajesPendientes(
  empresaId: number,
  filtros: { clienteId?: number; fechaDesde?: string; fechaHasta?: string; ruta?: string } & Paginacion,
): Promise<ResultadoPaginado<ViajePendiente>> {
  // Asegura el puente clientes.tms_cliente_id antes de leer — mismo
  // criterio ya usado por la pantalla de Facturación existente
  // (GET /facturacion/catalogos) para no depender de que alguien haya
  // abierto Programación primero. HOTFIX PRE-MERGE PR #113 (Hallazgo 1):
  // esto NUNCA se silencia — es información financiera. Si el schema, el
  // vínculo, la DB o los permisos fallan, la operación completa debe
  // fallar explícitamente, nunca degradar a "cliente sin vínculo" ni a
  // una lista incompleta de viajes.
  await asegurarSchemaClientes();
  await asegurarVinculosTmsClientes(empresaId);

  const { condiciones, params } = condicionesViajesPendientes(empresaId, filtros);
  const { page, pageSize, offset } = normalizarPaginacion(filtros);
  const where = condiciones.join(" AND ");
  const from = `FROM tms_planes_viaje p
     LEFT JOIN clientes cli ON cli.tms_cliente_id = p.cliente_id AND cli.empresa_id = p.empresa_id`;
  // FACT-2: se agrega SOLO el nombre del piloto (más ruta/origen/destino/moneda) a petición de Facturación.
  // Siguen fuera auxiliares/evidencias/paradas/GPS — Facturador no necesita ni debe ver esos datos operativos.
  // Los JOIN extra filtran por empresa_id: nunca se une un catálogo de otra empresa.
  const [rows, countRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
              cli.id AS cliente_id, cli.nombre AS cliente, u.placa, p.tarifa_comercial,
              DATE_FORMAT(p.cerrado_en, '%Y-%m-%dT%H:%i') AS cerrado_en,
              p.estado, p.tarifa_moneda_historico, NULLIF(TRIM(p.ruta_codigo_historico), '') AS ruta_codigo,
              lc.nombre AS origen,
              COALESCE(NULLIF(TRIM(p.lugar_descarga_historico), ''), ld.nombre) AS destino,
              COALESCE(pil.nombre, NULLIF(TRIM(p.piloto_externo_nombre), '')) AS piloto
       ${from}
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
       LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id AND lc.empresa_id = p.empresa_id
       LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id AND ld.empresa_id = p.empresa_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id AND pil.empresa_id = p.empresa_id
       WHERE ${where}
       ORDER BY p.fecha_plan DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    ),
    query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, params),
  ]);
  return {
    // `cli.id IS NOT NULL` en el WHERE ya garantiza que cliente_id/cliente
    // vienen siempre no nulos — Number()/String() aquí, nunca `??`/`| null`,
    // para que un cambio futuro que rompa esa garantía falle ruidosamente
    // (NaN/"null") en vez de colar silenciosamente un `null`.
    items: rows.map((r) => ({
      planId: Number(r.id), codigo: String(r.codigo), fechaPlan: String(r.fecha_plan),
      clienteId: Number(r.cliente_id),
      cliente: String(r.cliente),
      placa: r.placa != null ? String(r.placa) : null,
      tarifaComercial: r.tarifa_comercial != null ? Number(r.tarifa_comercial) : null,
      cerradoEn: r.cerrado_en != null ? String(r.cerrado_en) : null,
      rutaCodigo: r.ruta_codigo != null ? String(r.ruta_codigo) : null,
      origen: r.origen != null ? String(r.origen) : null,
      destino: r.destino != null ? String(r.destino) : null,
      piloto: r.piloto != null ? String(r.piloto) : null,
      estado: String(r.estado),
      moneda: normalizarMoneda(r.tarifa_moneda_historico != null ? String(r.tarifa_moneda_historico) : null),
    })),
    totalReal: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export type LineaFacturaInput = {
  planId: number;
  montoAsignado?: number;
  /**
   * Tratamiento de IVA de ESTA línea, elegido explícitamente por quien factura: `true` = el IVA ya está incluido en
   * la tarifa; `false` = el IVA se agrega a la tarifa. Obligatorio por línea (nunca se infiere ni se asume en el
   * servidor): una misma factura puede mezclar ambos.
   */
  precioIncluyeIva: boolean;
};
export type DatosFactura = {
  clienteId: number;
  planes: LineaFacturaInput[];

  numeroFactura?: string | null;
  fechaEmision?: string | null;
  observaciones?: string | null;
};

type SqlArg = string | number | null;
/** Ejecuta una lectura. En transacción usa la conexión (permite FOR UPDATE); en preview usa el pool, sin transacción. */
type Lector = (sql: string, params: SqlArg[]) => Promise<RowDataPacket[]>;
const lectorTx = (conn: PoolConnection): Lector => async (sql, params) => (await conn.query<RowDataPacket[]>(sql, params))[0];
const lectorPool: Lector = (sql, params) => query<RowDataPacket[]>(sql, params);

const textoONull = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

type ClienteFactura = { id: number; nombre: string; nit: string | null; direccion: string | null; tmsClienteId: number | null };

async function leerClienteFactura(leer: Lector, empresaId: number, clienteId: number): Promise<ClienteFactura | null> {
  const rows = await leer(
    `SELECT id, nombre, razon_social, nit, direccion, tms_cliente_id FROM clientes WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [clienteId, empresaId],
  );
  const c = rows[0];
  if (!c) return null;
  return {
    id: Number(c.id),
    // El nombre fiscal es la razón social cuando existe; si no, el nombre comercial.
    nombre: textoONull(c.razon_social) ?? String(c.nombre),
    nit: textoONull(c.nit),
    direccion: textoONull(c.direccion),
    tmsClienteId: c.tms_cliente_id != null ? Number(c.tms_cliente_id) : null,
  };
}

const ERROR_TRATAMIENTO_IVA_REQUERIDO: { ok: false; error: string; status: number } = {
  ok: false,
  error: "Indica el tratamiento de IVA de cada viaje: incluido en la tarifa o agregado a la tarifa.",
  status: 400,
};

/** El servidor no confía en la UI: CADA línea debe traer el tratamiento de IVA como booleano explícito. */
const tratamientosIvaValidos = (planes: { precioIncluyeIva?: unknown }[]): boolean =>
  Array.isArray(planes) && planes.every((p) => typeof p?.precioIncluyeIva === "boolean");

const MENSAJE_CLIENTE_SIN_TMS =
  "Este cliente todavía no está vinculado a TMS (clientes.tms_cliente_id) — no tiene viajes asociables.";

/** Un viaje tal como lo necesita el borrador, leído SIEMPRE de la DB (nunca del payload del cliente). */
async function leerPlanParaFactura(
  leer: Lector,
  empresaId: number,
  planId: number,
  bloquear: boolean,
): Promise<PlanParaFactura | null> {
  const planRows = await leer(
    `SELECT id, codigo, empresa_id, cliente_id, estado, tarifa_comercial,
            DATE_FORMAT(fecha_plan, '%Y-%m-%d') AS fecha_plan,
            ruta_codigo_historico, lugar_carga_id, lugar_descarga_id, lugar_descarga_historico,
            tarifa_moneda_historico
     FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1${bloquear ? " FOR UPDATE" : ""}`,
    [planId, empresaId],
  );
  const p = planRows[0];
  if (!p) return null;

  const nombreLugar = async (lugarId: unknown): Promise<string | null> => {
    if (lugarId == null) return null;
    const rows = await leer(`SELECT nombre FROM tms_lugares WHERE id = ? AND empresa_id = ? LIMIT 1`, [Number(lugarId), empresaId]);
    return textoONull(rows[0]?.nombre);
  };
  const origen = await nombreLugar(p.lugar_carga_id);
  // El destino congelado en el viaje manda sobre el catálogo vivo (mismo criterio que el reporte de viajes).
  const destino = textoONull(p.lugar_descarga_historico) ?? (await nombreLugar(p.lugar_descarga_id));

  return {
    id: Number(p.id),
    codigo: String(p.codigo),
    empresaId: Number(p.empresa_id),
    clienteTmsId: p.cliente_id != null ? Number(p.cliente_id) : null,
    estado: String(p.estado),
    fechaPlan: String(p.fecha_plan),
    tarifaComercial: p.tarifa_comercial != null ? Number(p.tarifa_comercial) : null,
    monedaRaw: textoONull(p.tarifa_moneda_historico),
    rutaCodigo: textoONull(p.ruta_codigo_historico),
    origen,
    destino,
  };
}

type PlanValidado = { plan: PlanParaFactura; montoAsignado: number; precioIncluyeIva: boolean };

/**
 * Valida cada plan solicitado. Con `bloquear` (transacción de crear/editar) toma FOR UPDATE sobre cada viaje —
 * esa fila es el punto de serialización entre dos usuarios que intentan facturar el mismo viaje; el UNIQUE
 * (plan_id) de fact_factura_viajes es la garantía final de base de datos. Sin `bloquear` (preview) solo lee.
 * Nunca confía en el payload: empresa/cliente/estado/tarifa se releen de tms_planes_viaje.
 *
 * `tmsClienteId` es el `tms_clientes.id` YA RESUELTO por el caller desde el `clientes.id` de la factura (vía
 * `clientes.tms_cliente_id`) — nunca se compara un `clientes.id` contra `tms_planes_viaje.cliente_id`
 * (espacios de ID distintos, ver comentario de cabecera del archivo).
 */
async function validarPlanesParaFactura(
  leer: Lector,
  empresaId: number,
  tmsClienteId: number,
  planes: LineaFacturaInput[],
  facturaIdExcluir: number | null,
  bloquear: boolean,
): Promise<{ ok: true; lineas: PlanValidado[] } | { ok: false; error: string; status: number }> {
  if (!planes.length) {
    return { ok: false, error: "Selecciona al menos un viaje.", status: 400 };
  }
  const idsVistos = new Set<number>();
  for (const linea of planes) {
    if (idsVistos.has(linea.planId)) {
      return { ok: false, error: `El viaje #${linea.planId} está repetido en la selección.`, status: 400 };
    }
    idsVistos.add(linea.planId);
  }

  // Orden de bloqueo estable (id ascendente): dos transacciones con viajes en común toman los locks en el mismo
  // orden, así no se interbloquean entre sí.
  const ordenadas = [...planes].sort((a, b) => a.planId - b.planId);
  const lineas: PlanValidado[] = [];
  for (const linea of ordenadas) {
    const plan = await leerPlanParaFactura(leer, empresaId, linea.planId, bloquear);
    if (!plan) {
      return { ok: false, error: `Viaje #${linea.planId} no encontrado.`, status: 404 };
    }
    const vinculoRows = await leer(
      `SELECT factura_id FROM fact_factura_viajes WHERE plan_id = ?${bloquear ? " FOR UPDATE" : ""}`,
      [linea.planId],
    );
    const evaluacion = evaluarPlanFacturable(plan, {
      empresaId,
      tmsClienteId,
      vinculoFacturaId: vinculoRows[0] ? Number(vinculoRows[0].factura_id) : null,
      facturaIdExcluir,
    });
    if (!evaluacion.ok) return evaluacion;

    const montoAsignado = linea.montoAsignado != null ? Number(linea.montoAsignado) : (plan.tarifaComercial ?? 0);
    if (!Number.isFinite(montoAsignado) || montoAsignado < 0) {
      return { ok: false, error: `Monto inválido para el viaje ${plan.codigo}.`, status: 400 };
    }
    lineas.push({ plan, montoAsignado, precioIncluyeIva: linea.precioIncluyeIva });
  }
  // Presentación estable: por fecha del viaje y luego por id.
  lineas.sort((a, b) => a.plan.fechaPlan.localeCompare(b.plan.fechaPlan) || a.plan.id - b.plan.id);
  return { ok: true, lineas };
}

function detalleAjustesMonto(
  lineas: { planId: number; codigo: string; montoAsignado: number; tarifaComercial: number | null }[],
): string {
  const ajustadas = lineas.filter((l) => l.tarifaComercial != null && l.montoAsignado !== l.tarifaComercial);
  if (!ajustadas.length) return "";
  return " · Montos ajustados: " + ajustadas
    .map((l) => `${l.codigo} (tarifa_comercial Q${l.tarifaComercial} → monto_asignado Q${l.montoAsignado})`)
    .join(", ");
}

/** Resumen auditable del borrador: totales, moneda, política de IVA y viajes. Sin datos fiscales del cliente. */
function detalleBorrador(b: BorradorCalculado): string {
  const incluidos = b.lineas.filter((l) => l.precioIncluyeIva).length;
  const tratamiento =
    incluidos === b.lineas.length ? "todas con IVA incluido"
      : incluidos === 0 ? "todas con IVA agregado"
        : `${incluidos} con IVA incluido y ${b.lineas.length - incluidos} con IVA agregado`;
  return ` · ${b.moneda} · subtotal ${b.subtotal} · IVA ${b.iva} (${b.porcentajeIva} %, ${tratamiento}) · viajes: ${b.lineas
    .map((l) => `${l.codigo} (${l.precioIncluyeIva ? "IVA incluido" : "IVA agregado"})`)
    .join(", ")}`;
}

/**
 * `fact_facturas.precio_incluye_iva` es solo un RESUMEN: 1/0 cuando TODAS las líneas coinciden y NULL cuando hay
 * mezcla. La fuente de verdad es `fact_factura_viajes.precio_incluye_iva` (por línea).
 */
const resumenIvaEncabezado = (b: BorradorCalculado): 0 | 1 | null => (b.precioIncluyeIva == null ? null : b.precioIncluyeIva ? 1 : 0);

function esConflictoConcurrencia(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_LOCK_DEADLOCK" || err?.errno === 1213 || err?.code === "ER_LOCK_WAIT_TIMEOUT" || err?.errno === 1205;
}

const ERROR_CONCURRENCIA: { ok: false; error: string; status: number } = {
  ok: false,
  error: "Otro usuario está facturando alguno de estos viajes en este momento. Actualiza la pantalla y vuelve a intentar.",
  status: 409,
};

const ERROR_VIAJE_YA_VINCULADO: { ok: false; error: string; status: number } = {
  ok: false,
  error: "Alguno de los viajes ya está vinculado a otra factura. Actualiza la pantalla.",
  status: 409,
};

async function insertarLineasBorrador(conn: PoolConnection, facturaId: number, b: BorradorCalculado): Promise<boolean> {
  for (const l of b.lineas) {
    try {
      await conn.execute(
        `INSERT INTO fact_factura_viajes
           (factura_id, plan_id, monto_asignado, codigo_viaje_snapshot, fecha_viaje_snapshot, ruta_codigo_snapshot,
            origen_snapshot, destino_snapshot, descripcion, cantidad, precio_incluye_iva, porcentaje_iva,
            base_monto, iva_monto, total_linea)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          facturaId, l.planId, l.montoAsignado, l.codigo, l.fechaPlan, l.rutaCodigo,
          l.origen, l.destino, l.descripcion, l.cantidad, l.precioIncluyeIva ? 1 : 0, l.porcentajeIva,
          l.base, l.iva, l.total,
        ],
      );
    } catch (err) {
      // UNIQUE (plan_id): última defensa si otra transacción se coló entre la validación y el INSERT.
      if (esDuplicadoNumeroFactura(err)) return false;
      throw err;
    }
  }
  return true;
}

export type PreviewFactura = {
  cliente: { id: number; nombre: string; nit: string | null; direccion: string | null };
  cantidadViajes: number;
  borrador: BorradorCalculado;
};

/**
 * Vista previa del borrador: valida y recalcula EN EL SERVIDOR exactamente igual que `crearFactura`, pero SIN
 * escribir nada y sin reservar los viajes (sin transacción, sin FOR UPDATE, sin auditoría). Al guardar se
 * revalida de forma transaccional: una preview correcta NO garantiza que el viaje siga libre un segundo después.
 */
export async function previsualizarFactura(
  actor: ActorFacturacion,
  datos: { clienteId: number; planes: LineaFacturaInput[] },
): Promise<{ ok: true; preview: PreviewFactura } | { ok: false; error: string; status: number }> {
  if (!tratamientosIvaValidos(datos.planes)) return ERROR_TRATAMIENTO_IVA_REQUERIDO;
  const cliente = await leerClienteFactura(lectorPool, actor.empresaId, datos.clienteId);
  if (!cliente) return { ok: false, error: "Cliente no encontrado.", status: 404 };
  if (cliente.tmsClienteId == null) return { ok: false, error: MENSAJE_CLIENTE_SIN_TMS, status: 409 };

  const validacion = await validarPlanesParaFactura(
    lectorPool, actor.empresaId, cliente.tmsClienteId, datos.planes, null, false,
  );
  if (!validacion.ok) return validacion;
  const calculo = construirBorrador(validacion.lineas);
  if (!calculo.ok) return calculo;
  return {
    ok: true,
    preview: {
      cliente: { id: cliente.id, nombre: cliente.nombre, nit: cliente.nit, direccion: cliente.direccion },
      cantidadViajes: calculo.borrador.lineas.length,
      borrador: calculo.borrador,
    },
  };
}

export async function crearFactura(actor: ActorFacturacion, datos: DatosFactura): Promise<ResultadoFactura> {
  if (!tratamientosIvaValidos(datos.planes)) return ERROR_TRATAMIENTO_IVA_REQUERIDO;
  // HOTFIX PRE-MERGE PR #113 (Hallazgo 1) — nunca silenciado: un fallo de
  // schema/vínculo/DB/permisos aquí debe rechazar la operación completa,
  // no dejar pasar una factura que "parece válida" con un puente roto.
  await asegurarSchemaClientes();
  await asegurarVinculosTmsClientes(actor.empresaId);
  try {
    return await tx(async (conn) => {
      const cliente = await leerClienteFactura(lectorTx(conn), actor.empresaId, datos.clienteId);
      if (!cliente) {
        return { ok: false, error: "Cliente no encontrado.", status: 404 };
      }
      if (cliente.tmsClienteId == null) {
        return { ok: false, error: MENSAJE_CLIENTE_SIN_TMS, status: 409 };
      }

      const validacion = await validarPlanesParaFactura(lectorTx(conn), actor.empresaId, cliente.tmsClienteId, datos.planes, null, true);
      if (!validacion.ok) return validacion;
      const calculo = construirBorrador(validacion.lineas);
      if (!calculo.ok) return calculo;
      const b = calculo.borrador;

      let facturaId: number;
      try {
        const [insertFactura] = await conn.execute<ResultSetHeader>(
          `INSERT INTO fact_facturas
            (empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, moneda, subtotal, iva_monto,
             porcentaje_iva, precio_incluye_iva, cliente_nombre_snapshot, cliente_nit_snapshot,
             cliente_direccion_snapshot, estado_admin, observaciones, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Borrador', ?, ?)`,
          [
            actor.empresaId, datos.clienteId, datos.numeroFactura ?? null, datos.fechaEmision ?? null,
            b.total, b.moneda, b.subtotal, b.iva, b.porcentajeIva, resumenIvaEncabezado(b),
            cliente.nombre, cliente.nit, cliente.direccion, datos.observaciones ?? null, actor.usuarioId,
          ],
        );
        facturaId = Number(insertFactura.insertId);
      } catch (err) {
        if (esDuplicadoNumeroFactura(err)) {
          return { ok: false, error: "Ya existe una factura con ese número.", status: 409 };
        }
        throw err;
      }

      if (!(await insertarLineasBorrador(conn, facturaId, b))) return ERROR_VIAJE_YA_VINCULADO;

      await registrarAuditoriaTx(conn, {
        empresaId: actor.empresaId,
        usuario: actor.usuario,
        modulo: "facturacion",
        accion: "crear_factura",
        detalle: `Factura #${facturaId} (Borrador) · cliente ${cliente.nombre} · ${b.lineas.length} viaje(s) · monto total Q${b.total}${detalleBorrador(b)}${detalleAjustesMonto(b.lineas)}`,
      });

      return { ok: true, facturaId };
    }, { readCommitted: true });
  } catch (err) {
    if (esConflictoConcurrencia(err)) return ERROR_CONCURRENCIA;
    throw err;
  }
}

export async function actualizarFacturaBorrador(
  actor: ActorFacturacion,
  facturaId: number,
  datos: DatosFactura,
): Promise<ResultadoFactura> {
  if (!tratamientosIvaValidos(datos.planes)) return ERROR_TRATAMIENTO_IVA_REQUERIDO;
  // HOTFIX PRE-MERGE PR #113 (Hallazgo 1) — igual que en crearFactura:
  // nunca silenciado.
  await asegurarSchemaClientes();
  await asegurarVinculosTmsClientes(actor.empresaId);
  try {
    return await tx(async (conn) => {
      const [facturaRows] = await conn.query<RowDataPacket[]>(
        `SELECT id, estado_admin, cliente_id, cliente_nombre_snapshot, cliente_nit_snapshot, cliente_direccion_snapshot
         FROM fact_facturas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
        [facturaId, actor.empresaId],
      );
      const factura = facturaRows[0];
      if (!factura) return { ok: false, error: "Factura no encontrada.", status: 404 };
      if (String(factura.estado_admin) !== "Borrador") {
        return { ok: false, error: "Solo se puede editar una factura en Borrador.", status: 409 };
      }

      const cliente = await leerClienteFactura(lectorTx(conn), actor.empresaId, datos.clienteId);
      if (!cliente) return { ok: false, error: "Cliente no encontrado.", status: 404 };
      if (cliente.tmsClienteId == null) return { ok: false, error: MENSAJE_CLIENTE_SIN_TMS, status: 409 };

      const validacion = await validarPlanesParaFactura(lectorTx(conn), actor.empresaId, cliente.tmsClienteId, datos.planes, facturaId, true);
      if (!validacion.ok) return validacion;

      // Editar el borrador NO refresca lo ya congelado: las líneas que siguen en el borrador conservan su
      // fotografía (descripción/ruta/origen/destino/fecha), y el cliente conserva la suya si no cambió de cliente.
      const [previasRows] = await conn.query<RowDataPacket[]>(
        `SELECT plan_id, DATE_FORMAT(fecha_viaje_snapshot, '%Y-%m-%d') AS fecha_viaje_snapshot, ruta_codigo_snapshot,
                origen_snapshot, destino_snapshot, descripcion
         FROM fact_factura_viajes WHERE factura_id = ?`,
        [facturaId],
      );
      const previas = new Map<number, SnapshotLineaPrevio>();
      for (const r of previasRows) {
        if (r.descripcion == null || r.fecha_viaje_snapshot == null) continue; // fila anterior a FACT-2: se fotografía ahora
        previas.set(Number(r.plan_id), {
          fechaPlan: String(r.fecha_viaje_snapshot).slice(0, 10),
          rutaCodigo: textoONull(r.ruta_codigo_snapshot),
          origen: textoONull(r.origen_snapshot),
          destino: textoONull(r.destino_snapshot),
          descripcion: String(r.descripcion),
        });
      }
      // El tratamiento de IVA de CADA línea es el que llega (la UI manda el congelado si no lo cambió): cada línea se
      // recalcula con el suyo y los totales son la suma. Los textos congelados se conservan. Solo un Borrador llega aquí.
      const calculo = construirBorrador(
        validacion.lineas.map((l) => ({ ...l, snapshotPrevio: previas.get(l.plan.id) ?? null })),
      );
      if (!calculo.ok) return calculo;
      const b = calculo.borrador;

      const mismoCliente = Number(factura.cliente_id) === datos.clienteId && factura.cliente_nombre_snapshot != null;
      const snapCliente = mismoCliente
        ? {
            nombre: String(factura.cliente_nombre_snapshot),
            nit: textoONull(factura.cliente_nit_snapshot),
            direccion: textoONull(factura.cliente_direccion_snapshot),
          }
        : { nombre: cliente.nombre, nit: cliente.nit, direccion: cliente.direccion };

      // Reemplaza el conjunto de viajes por completo, dentro de la MISMA
      // transacción — sin ventana donde un viaje quede "huérfano" o libre
      // para otra factura mientras se reconstruye la lista.
      await conn.execute(`DELETE FROM fact_factura_viajes WHERE factura_id = ?`, [facturaId]);
      if (!(await insertarLineasBorrador(conn, facturaId, b))) return ERROR_VIAJE_YA_VINCULADO;

      try {
        await conn.execute(
          `UPDATE fact_facturas
           SET cliente_id = ?, numero_factura = ?, fecha_emision = ?, monto_total = ?, moneda = ?, subtotal = ?,
               iva_monto = ?, porcentaje_iva = ?, precio_incluye_iva = ?, cliente_nombre_snapshot = ?,
               cliente_nit_snapshot = ?, cliente_direccion_snapshot = ?, observaciones = ?,
               actualizado_por = ?, actualizado_en = NOW()
           WHERE id = ? AND empresa_id = ? AND estado_admin = 'Borrador'`,
          [
            datos.clienteId, datos.numeroFactura ?? null, datos.fechaEmision ?? null, b.total, b.moneda, b.subtotal,
            b.iva, b.porcentajeIva, resumenIvaEncabezado(b), snapCliente.nombre,
            snapCliente.nit, snapCliente.direccion, datos.observaciones ?? null,
            actor.usuarioId, facturaId, actor.empresaId,
          ],
        );
      } catch (err) {
        if (esDuplicadoNumeroFactura(err)) {
          return { ok: false, error: "Ya existe una factura con ese número.", status: 409 };
        }
        throw err;
      }

      await registrarAuditoriaTx(conn, {
        empresaId: actor.empresaId,
        usuario: actor.usuario,
        modulo: "facturacion",
        accion: "editar_factura_borrador",
        detalle: `Factura #${facturaId} (Borrador) editada · cliente ${cliente.nombre} · ${b.lineas.length} viaje(s) · monto total Q${b.total}${detalleBorrador(b)}${detalleAjustesMonto(b.lineas)}`,
      });

      return { ok: true, facturaId };
    }, { readCommitted: true });
  } catch (err) {
    if (esConflictoConcurrencia(err)) return ERROR_CONCURRENCIA;
    throw err;
  }
}

export type EmitirInput = { numeroFactura?: string | null; fechaEmision?: string | null };

export async function emitirFactura(
  actor: ActorFacturacion,
  facturaId: number,
  input: EmitirInput = {},
): Promise<ResultadoSimple> {
  return tx(async (conn) => {
    const [facturaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado_admin, numero_factura, DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS fecha_emision, monto_total
       FROM fact_facturas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [facturaId, actor.empresaId],
    );
    const factura = facturaRows[0];
    if (!factura) return { ok: false, error: "Factura no encontrada.", status: 404 };
    if (String(factura.estado_admin) !== "Borrador") {
      return { ok: false, error: "Solo se puede emitir una factura en Borrador.", status: 409 };
    }

    const numeroFinal = (input.numeroFactura ?? (factura.numero_factura as string | null))?.toString().trim() || null;
    const fechaFinal = input.fechaEmision ?? factura.fecha_emision;
    if (!numeroFinal) {
      return { ok: false, error: "El número de factura es obligatorio para emitir.", status: 400 };
    }
    if (!fechaFinal) {
      return { ok: false, error: "La fecha de emisión es obligatoria para emitir.", status: 400 };
    }
    if (Number(factura.monto_total) <= 0) {
      return { ok: false, error: "La factura no tiene un monto total válido.", status: 400 };
    }

    const [lineasRows] = await conn.query<RowDataPacket[]>(
      `SELECT ffv.plan_id, p.codigo, p.estado
       FROM fact_factura_viajes ffv
       INNER JOIN tms_planes_viaje p ON p.id = ffv.plan_id
       WHERE ffv.factura_id = ? FOR UPDATE`,
      [facturaId],
    );
    if (!lineasRows.length) {
      return { ok: false, error: "La factura no tiene viajes vinculados.", status: 400 };
    }
    const noCerrados = lineasRows.filter((r) => String(r.estado) !== "Cerrado");
    if (noCerrados.length) {
      return {
        ok: false,
        error: `Los siguientes viajes ya no están Cerrados: ${noCerrados.map((r) => r.codigo).join(", ")}.`,
        status: 409,
      };
    }

    let upd: ResultSetHeader;
    try {
      [upd] = await conn.execute<ResultSetHeader>(
        `UPDATE fact_facturas
         SET numero_factura = ?, fecha_emision = ?, estado_admin = 'Emitida',
             actualizado_por = ?, actualizado_en = NOW()
         WHERE id = ? AND empresa_id = ? AND estado_admin = 'Borrador'`,
        [numeroFinal, fechaFinal, actor.usuarioId, facturaId, actor.empresaId],
      );
    } catch (err) {
      if (esDuplicadoNumeroFactura(err)) {
        return { ok: false, error: "Ya existe una factura con ese número.", status: 409 };
      }
      throw err;
    }
    if (!upd.affectedRows) {
      return { ok: false, error: "La factura ya fue modificada por otra solicitud. Actualiza la pantalla.", status: 409 };
    }

    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      modulo: "facturacion",
      accion: "emitir_factura",
      detalle: `Factura #${facturaId} emitida · número ${numeroFinal} · fecha ${fechaFinal} · monto Q${factura.monto_total} · ${lineasRows.length} viaje(s)`,
    });

    return { ok: true };
  });
}

export async function anularFactura(actor: ActorFacturacion, facturaId: number): Promise<ResultadoSimple> {
  return tx(async (conn) => {
    const [facturaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado_admin FROM fact_facturas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [facturaId, actor.empresaId],
    );
    const factura = facturaRows[0];
    if (!factura) return { ok: false, error: "Factura no encontrada.", status: 404 };
    if (String(factura.estado_admin) === "Anulada") {
      return { ok: false, error: "Esta factura ya está anulada.", status: 409 };
    }

    const [pagosRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM fact_pagos WHERE factura_id = ? FOR UPDATE`,
      [facturaId],
    );
    if (Number(pagosRows[0]?.c ?? 0) > 0) {
      return {
        ok: false,
        error: "No se puede anular una factura con pagos registrados; requiere nota de crédito/reversa (no implementado en esta fase).",
        status: 409,
      };
    }

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE fact_facturas SET estado_admin = 'Anulada', actualizado_por = ?, actualizado_en = NOW()
       WHERE id = ? AND empresa_id = ? AND estado_admin <> 'Anulada'`,
      [actor.usuarioId, facturaId, actor.empresaId],
    );
    if (!upd.affectedRows) {
      return { ok: false, error: "La factura ya fue modificada por otra solicitud. Actualiza la pantalla.", status: 409 };
    }
    // Libera los viajes de inmediato — mismo criterio ya usado en todo el
    // proyecto: borrar la relación (nunca marcarla "inactiva") para que
    // el UNIQUE(plan_id) siga siendo una garantía real.
    await conn.execute(`DELETE FROM fact_factura_viajes WHERE factura_id = ?`, [facturaId]);

    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      modulo: "facturacion",
      accion: "anular_factura",
      detalle: `Factura #${facturaId} anulada · viajes liberados para nueva facturación`,
    });

    return { ok: true };
  });
}

export type PagoInput = { fechaPago: string; monto: number; referencia?: string | null; medioPago?: string | null; observaciones?: string | null };

export async function registrarPago(actor: ActorFacturacion, facturaId: number, input: PagoInput): Promise<ResultadoSimple> {
  if (!Number.isFinite(input.monto) || input.monto <= 0) {
    return { ok: false, error: "El monto del pago debe ser mayor que cero.", status: 400 };
  }
  return tx(async (conn) => {
    const [facturaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado_admin, monto_total FROM fact_facturas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [facturaId, actor.empresaId],
    );
    const factura = facturaRows[0];
    if (!factura) return { ok: false, error: "Factura no encontrada.", status: 404 };
    if (String(factura.estado_admin) !== "Emitida") {
      return { ok: false, error: "Solo se pueden registrar pagos contra una factura Emitida.", status: 409 };
    }

    const [sumaRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM fact_pagos WHERE factura_id = ?`,
      [facturaId],
    );
    const totalPagado = Number(sumaRows[0]?.total ?? 0);
    const saldo = Number(factura.monto_total) - totalPagado;
    if (input.monto > saldo) {
      return {
        ok: false,
        error: `El pago (Q${input.monto}) excede el saldo pendiente (Q${saldo}).`,
        status: 409,
      };
    }

    await conn.execute(
      `INSERT INTO fact_pagos (empresa_id, factura_id, fecha_pago, monto, referencia, medio_pago, observaciones, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.empresaId, facturaId, input.fechaPago, input.monto,
        input.referencia ?? null, input.medioPago ?? null, input.observaciones ?? null, actor.usuarioId,
      ],
    );

    const nuevoSaldo = saldo - input.monto;
    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      modulo: "facturacion",
      accion: "registrar_pago",
      detalle: `Factura #${facturaId} · pago Q${input.monto} · saldo restante Q${nuevoSaldo}${input.referencia ? ` · ref. ${input.referencia}` : ""}`,
    });

    return { ok: true };
  });
}

export async function listarPagos(empresaId: number, facturaId: number): Promise<PagoFactura[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(fecha_pago, '%Y-%m-%d') AS fecha_pago, monto, referencia, medio_pago,
            observaciones, registrado_por, creado_en
     FROM fact_pagos WHERE factura_id = ? AND empresa_id = ? ORDER BY fecha_pago, id`,
    [facturaId, empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id), fechaPago: String(r.fecha_pago), monto: Number(r.monto),
    referencia: r.referencia != null ? String(r.referencia) : null,
    medioPago: r.medio_pago != null ? String(r.medio_pago) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    registradoPor: Number(r.registrado_por), creadoEn: String(r.creado_en),
  }));
}
