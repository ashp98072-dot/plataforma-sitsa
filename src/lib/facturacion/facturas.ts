import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { asegurarVinculosTmsClientes } from "@/lib/clientes/repository";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import { resolverUnidadViaje } from "@/lib/facturacion/unidad-viaje";
import { esEsquemaPendiente, MENSAJE_FALTA_MIGRACION_FACT4 } from "@/lib/facturacion/contexto-factura";
import { calcularRetencionIva } from "@/lib/facturacion/poliza-venta";
import {
  calcularLineasFactura,
  CONDICIONES_PAGO,
  esRetencionIvaValida,
  type ClasificacionLinea,
  type CondicionPago,
  type LineaFacturaCalculada,
  type LineaFacturaEntrada,
  type ResultadoLineas,
} from "@/lib/facturacion/lineas-factura";
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
  /**
   * Unidad que se muestra (ya resuelta): placa interna en viajes propios; placa externa —o «Tercerizado»— en viajes
   * tercerizados. Ver src/lib/facturacion/unidad-viaje.ts. Se mantiene el nombre `placa` por compatibilidad.
   */
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

/** MariaDB: la tabla no existe (el código de FACT-3 se desplegó antes de aplicar sql/migrate-2026-10-fact-3-…). */
function esTablaInexistente(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_NO_SUCH_TABLE" || err?.errno === 1146;
}

/**
 * FACT-3 — histórico de las líneas de una factura ANULADA. `fact_factura_viajes` contiene SOLO vínculos ACTIVOS (un viaje
 * a lo sumo en una fila viva: UNIQUE(plan_id) y todos sus lectores —viajes pendientes, reportes TMS, notificaciones,
 * limpiezas— dependen de eso). Al anular, la línea (con su fotografía fiscal) se COPIA aquí y recién entonces se borra la
 * activa, en la misma transacción: el viaje queda libre y la factura conserva su detalle.
 */
const TABLA_LINEAS_ANULADAS = "fact_factura_viajes_anuladas";
const MENSAJE_FALTA_MIGRACION_FACT3 =
  "No se puede anular: falta aplicar la migración FACT-3 (tabla fact_factura_viajes_anuladas). La factura NO se modificó.";

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

/** Quién y cuándo anuló la factura, tomado de la auditoría (`anular_factura`). `fecha` = «YYYY-MM-DD HH:MM». */
export type AnulacionFactura = { fecha: string; usuario: string | null };

/**
 * Líneas de la factura. Una factura ANULADA lee SIEMPRE su histórico (`fact_factura_viajes_anuladas`, solo su fotografía:
 * nunca datos vivos del viaje); el resto, sus vínculos activos. La factura ya fue buscada por empresa_id: aquí no hay
 * otra forma de llegar a las líneas de otra empresa.
 */
async function leerLineasFactura(facturaId: number, anulada: boolean): Promise<RowDataPacket[]> {
  if (!anulada) {
    return query<RowDataPacket[]>(
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
    );
  }
  try {
    return await query<RowDataPacket[]>(
      `SELECT h.id, h.plan_id, h.codigo_viaje_snapshot AS codigo,
              DATE_FORMAT(h.fecha_viaje_snapshot, '%Y-%m-%d') AS fecha_plan,
              h.monto_asignado, h.descripcion, h.ruta_codigo_snapshot, h.origen_snapshot,
              h.destino_snapshot, h.cantidad, h.precio_incluye_iva, h.porcentaje_iva,
              h.base_monto, h.iva_monto, h.total_linea
       FROM ${TABLA_LINEAS_ANULADAS} h
       WHERE h.factura_id = ?
       ORDER BY h.fecha_viaje_snapshot, h.id`,
      [facturaId],
    );
  } catch (e) {
    if (esTablaInexistente(e)) return []; // código desplegado antes de la migración: se ve como antes (sin detalle)
    throw e;
  }
}

/** FACT-4 — línea de factura tal como se muestra: cantidad × precio unitario = valor, con los viajes de origen. */
export type FacturaLineaDetalle = {
  id: number;
  orden: number;
  cantidad: number;
  descripcion: string;
  precioUnitario: number;
  /** Lo capturado: ROUND(cantidad × precioUnitario, 2). */
  valor: number;
  /** null en facturas anteriores a FACT-4 (nunca se clasificaron). */
  clasificacion: ClasificacionLinea | null;
  precioIncluyeIva: boolean | null;
  porcentajeIva: number | null;
  base: number | null;
  iva: number | null;
  total: number | null;
  viajes: { planId: number | null; codigo: string }[];
};

/** Decisiones de contabilidad congeladas en la factura (FACT-4). Nada de esto genera asientos todavía. */
export type ContabilidadFactura = {
  /** true = las líneas guardadas son la fuente de los totales; false = modelo anterior (línea implícita por viaje). */
  modeloLineas: boolean;
  entidadId: number | null;
  entidadNombre: string | null;
  condicionPago: CondicionPago | null;
  cuentaBancaria: CuentaBancariaSnapshot | null;
  /** `monto` = retención congelada (IVA × %); `netoCobrar` = total − retención. Regla confirmada por Contabilidad. */
  retencionIva: { aplicadaPct: number; clientePct: number | null; monto: number };
  /** true si la migración FACT-4 aún no está aplicada (todo lo anterior queda en sus valores por defecto). */
  esquemaPendiente: boolean;
};

const CONTABILIDAD_POR_DEFECTO: ContabilidadFactura = {
  modeloLineas: false, entidadId: null, entidadNombre: null, condicionPago: null, cuentaBancaria: null,
  retencionIva: { aplicadaPct: 0, clientePct: null, monto: 0 }, esquemaPendiente: false,
};

async function leerContabilidadFactura(empresaId: number, facturaId: number): Promise<ContabilidadFactura> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT f.entidad_id, e.nombre AS entidad_nombre, f.modelo_lineas, f.condicion_pago, f.cuenta_bancaria_snapshot,
              f.retencion_iva_pct, f.retencion_iva_cliente_pct, f.retencion_iva_monto
       FROM fact_facturas f
       LEFT JOIN cont_entidades e ON e.empresa_id = f.empresa_id AND e.id = f.entidad_id
       WHERE f.id = ? AND f.empresa_id = ? LIMIT 1`,
      [facturaId, empresaId],
    );
    const r = rows[0];
    if (!r) return CONTABILIDAD_POR_DEFECTO;
    let snap: CuentaBancariaSnapshot | null = null;
    if (r.cuenta_bancaria_snapshot != null) {
      try { snap = JSON.parse(String(r.cuenta_bancaria_snapshot)) as CuentaBancariaSnapshot; } catch { snap = null; }
    }
    const cond = r.condicion_pago != null ? String(r.condicion_pago) : null;
    return {
      modeloLineas: Number(r.modelo_lineas ?? 0) === 1,
      entidadId: r.entidad_id != null ? Number(r.entidad_id) : null,
      entidadNombre: r.entidad_nombre != null ? String(r.entidad_nombre) : null,
      condicionPago: cond === "CREDITO" || cond === "CONTADO" ? cond : null,
      cuentaBancaria: snap,
      retencionIva: {
        aplicadaPct: Number(r.retencion_iva_pct ?? 0),
        clientePct: r.retencion_iva_cliente_pct != null ? Number(r.retencion_iva_cliente_pct) : null,
        monto: Number(r.retencion_iva_monto ?? 0),
      },
      esquemaPendiente: false,
    };
  } catch (e) {
    if (esEsquemaPendiente(e)) return { ...CONTABILIDAD_POR_DEFECTO, esquemaPendiente: true };
    throw e;
  }
}

async function leerLineasGuardadas(facturaId: number): Promise<FacturaLineaDetalle[]> {
  const [lineas, vinculos] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT id, orden, cantidad, descripcion, precio_unitario, valor, clasificacion, precio_incluye_iva, porcentaje_iva,
              base_monto, iva_monto, total_linea
       FROM fact_factura_lineas WHERE factura_id = ? ORDER BY orden, id`,
      [facturaId],
    ),
    query<RowDataPacket[]>(
      `SELECT lv.linea_id, lv.plan_id, lv.codigo_viaje_snapshot
       FROM fact_factura_linea_viajes lv
       INNER JOIN fact_factura_lineas l ON l.id = lv.linea_id
       WHERE l.factura_id = ? ORDER BY lv.id`,
      [facturaId],
    ),
  ]);
  const porLinea = new Map<number, { planId: number | null; codigo: string }[]>();
  for (const v of vinculos) {
    const k = Number(v.linea_id);
    const lista = porLinea.get(k) ?? [];
    lista.push({ planId: v.plan_id != null ? Number(v.plan_id) : null, codigo: v.codigo_viaje_snapshot != null ? String(v.codigo_viaje_snapshot) : "—" });
    porLinea.set(k, lista);
  }
  return lineas.map((r) => ({
    id: Number(r.id),
    orden: Number(r.orden),
    cantidad: Number(r.cantidad),
    descripcion: String(r.descripcion),
    precioUnitario: Number(r.precio_unitario),
    valor: Number(r.valor),
    clasificacion: r.clasificacion === "BIEN" ? "BIEN" : r.clasificacion === "SERVICIO" ? "SERVICIO" : null,
    precioIncluyeIva: r.precio_incluye_iva != null ? Number(r.precio_incluye_iva) === 1 : null,
    porcentajeIva: r.porcentaje_iva != null ? Number(r.porcentaje_iva) : null,
    base: r.base_monto != null ? Number(r.base_monto) : null,
    iva: r.iva_monto != null ? Number(r.iva_monto) : null,
    total: r.total_linea != null ? Number(r.total_linea) : null,
    viajes: porLinea.get(Number(r.id)) ?? [],
  }));
}

/** Facturas anteriores a FACT-4: una línea implícita por viaje (solo lectura; nada de esto se guarda). */
function lineasImplicitas(viajes: FacturaViajeLinea[]): FacturaLineaDetalle[] {
  return viajes.map((v, i) => ({
    id: v.id,
    orden: i + 1,
    cantidad: v.cantidad,
    descripcion: v.descripcion ?? `Viaje ${v.codigo}`,
    precioUnitario: v.montoAsignado,
    valor: v.montoAsignado,
    clasificacion: null,
    precioIncluyeIva: v.precioIncluyeIva,
    porcentajeIva: v.porcentajeIva,
    base: v.base,
    iva: v.iva,
    total: v.total,
    viajes: [{ planId: v.planId || null, codigo: v.codigo }],
  }));
}

export async function obtenerFactura(
  empresaId: number,
  facturaId: number,
): Promise<{
  factura: Factura;
  viajes: FacturaViajeLinea[];
  pagos: PagoFactura[];
  anulacion: AnulacionFactura | null;
  /** Líneas de la factura: las guardadas (FACT-4) o, en facturas anteriores, una implícita por viaje. */
  lineas: FacturaLineaDetalle[];
  contabilidad: ContabilidadFactura;
} | null> {
  const rows = await query<RowDataPacket[]>(
    `${FACTURA_SELECT} WHERE f.id = ? AND f.empresa_id = ? LIMIT 1`,
    [facturaId, empresaId],
  );
  if (!rows[0]) return null;
  const anulada = String(rows[0].estado_admin) === "Anulada";
  const [viajesRows, pagosRows, anulacionRows] = await Promise.all([
    leerLineasFactura(facturaId, anulada),
    query<RowDataPacket[]>(
      `SELECT id, DATE_FORMAT(fecha_pago, '%Y-%m-%d') AS fecha_pago, monto, referencia, medio_pago,
              observaciones, registrado_por, creado_en
       FROM fact_pagos WHERE factura_id = ? AND empresa_id = ? ORDER BY fecha_pago, id`,
      [facturaId, empresaId],
    ),
    anulada
      ? query<RowDataPacket[]>(
          // La auditoría es por empresa; «Factura #12 anulada…» no coincide con «#123» (sigue un espacio).
          `SELECT usuario, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i') AS cuando
           FROM auditoria
           WHERE empresa_id = ? AND modulo = 'facturacion' AND accion = 'anular_factura' AND detalle LIKE ?
           ORDER BY id DESC LIMIT 1`,
          [empresaId, `Factura #${facturaId} anulada%`],
        )
      : Promise.resolve([] as RowDataPacket[]),
  ]);
  const contabilidad = await leerContabilidadFactura(empresaId, facturaId);
  const viajes: FacturaViajeLinea[] = viajesRows.map((r) => ({
      id: Number(r.id), planId: r.plan_id != null ? Number(r.plan_id) : 0, codigo: r.codigo != null ? String(r.codigo) : "—",
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
  }));
  // Las líneas guardadas sobreviven a la anulación (no participan de UNIQUE(plan_id)); el detalle de viajes de una
  // anulada viene de su histórico (FACT-3).
  const lineas = contabilidad.modeloLineas ? await leerLineasGuardadas(facturaId) : lineasImplicitas(viajes);
  return {
    factura: mapFactura(rows[0]),
    anulacion: anulacionRows[0]
      ? { fecha: String(anulacionRows[0].cuando), usuario: anulacionRows[0].usuario != null ? String(anulacionRows[0].usuario) : null }
      : null,
    viajes,
    lineas,
    contabilidad,
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
 * en fact_factura_viajes — como anular BORRA esa fila (FACT-3: antes copia
 * la línea a fact_factura_viajes_anuladas, que NO participa de esta
 * condición), "sin fila" es siempre sinónimo de "nunca facturado o la
 * factura que lo tenía se anuló". Esta es la única fuente para armar una
 * factura NUEVA.
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
              cli.id AS cliente_id, cli.nombre AS cliente, u.placa AS placa_interna, p.tipo_viaje,
              p.unidad_externa_placa, p.tarifa_comercial,
              DATE_FORMAT(p.cerrado_en, '%Y-%m-%dT%H:%i') AS cerrado_en,
              p.estado, p.tarifa_moneda_historico, NULLIF(TRIM(p.ruta_codigo_historico), '') AS ruta_codigo,
              lc.nombre AS origen,
              COALESCE(NULLIF(TRIM(p.lugar_descarga_historico), ''), ld.nombre) AS destino,
              COALESCE(pil.nombre, NULLIF(TRIM(p.piloto_externo_nombre), '')) AS piloto
       ${from}
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id AND u.empresa_id = p.empresa_id
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
      placa: resolverUnidadViaje({
        tipoViaje: r.tipo_viaje != null ? String(r.tipo_viaje) : null,
        placaInterna: r.placa_interna != null ? String(r.placa_interna) : null,
        placaExterna: r.unidad_externa_placa != null ? String(r.unidad_externa_placa) : null,
      }),
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
   * servidor): una misma factura puede mezclar ambos. (FACT-4: con `lineas` el tratamiento vive en la línea de
   * factura y este valor solo siembra el texto/monto por defecto del viaje.)
   */
  precioIncluyeIva: boolean;
};
/**
 * FACT-4 — lo que se decide al preparar la factura y se CONGELA con ella. Todo es opcional para los llamadores internos
 * anteriores a FACT-4 (que siguen produciendo el modelo anterior: una línea implícita por viaje); el borde HTTP
 * (rutas) siempre envía líneas, condición de pago, entidad y retención.
 */
export type DatosFacturaFact4 = {
  /** Líneas preparadas (agrupables). Presente = modelo de líneas: los totales salen de ellas, no de los viajes. */
  lineas?: LineaFacturaEntrada[];
  /** Entidad contable emisora (libro). NULL si la empresa no tiene entidades configuradas. */
  entidadId?: number | null;
  /** CREDITO | CONTADO. No depende del tipo de documento FEL. */
  condicionPago?: CondicionPago | null;
  /** Solo CONTADO: cuenta bancaria (cont_cuentas_bancarias.id) donde se recibe el pago. */
  cuentaBancariaId?: number | null;
  /** Retención de IVA APLICADA a esta factura (0/15/30), ya autorizada por el caller. */
  retencionIvaPct?: number | null;
  /** Retención configurada para el cliente al preparar la factura (auditoría de cambios). */
  retencionIvaClientePct?: number | null;
};

export type DatosFactura = {
  clienteId: number;
  planes: LineaFacturaInput[];

  numeroFactura?: string | null;
  fechaEmision?: string | null;
  observaciones?: string | null;
} & DatosFacturaFact4;

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

/**
 * Inserta las filas de viaje del documento. `conFiscal`: en el modelo anterior cada viaje lleva su desglose de IVA; en el
 * modelo de líneas (FACT-4) el desglose fiscal vive en la LÍNEA y aquí quedan en NULL (monto_asignado = monto del viaje).
 */
async function insertarLineasBorrador(conn: PoolConnection, facturaId: number, b: BorradorCalculado, conFiscal = true): Promise<boolean> {
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
          l.origen, l.destino, l.descripcion, l.cantidad,
          conFiscal ? (l.precioIncluyeIva ? 1 : 0) : null, conFiscal ? l.porcentajeIva : null,
          conFiscal ? l.base : null, conFiscal ? l.iva : null, conFiscal ? l.total : null,
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

/** Fotografía de la cuenta bancaria elegida (se congela en la factura; no depende de cambios posteriores del catálogo). */
export type CuentaBancariaSnapshot = {
  cuentaBancariaId: number;
  entidadId: number;
  entidadNombre: string;
  banco: string;
  alias: string;
  referencia: string | null;
  moneda: string;
  cuentaContableId: number;
  cuentaContableCodigo: string;
  cuentaContableNombre: string;
};

export type PreviewFactura = {
  cliente: { id: number; nombre: string; nit: string | null; direccion: string | null };
  cantidadViajes: number;
  /** Viajes y sus textos congelados. Con líneas, sus totales son los de las líneas. */
  borrador: BorradorCalculado;
  /** FACT-4 — líneas calculadas (null en el modelo anterior). */
  lineas: LineaFacturaCalculada[] | null;
  entidadId: number | null;
  condicionPago: CondicionPago | null;
  cuentaBancaria: CuentaBancariaSnapshot | null;
  retencionIva: { aplicadaPct: number | null; clientePct: number | null; monto: number | null; netoCobrar: number | null };
};

/** ¿Este payload usa algo de FACT-4 (y por tanto requiere el esquema nuevo)? */
export function usaFact4(d: DatosFacturaFact4): boolean {
  return d.lineas != null || d.entidadId != null || d.condicionPago != null || d.cuentaBancariaId != null
    || d.retencionIvaPct != null || d.retencionIvaClientePct != null;
}

type ContextoFact4 =
  | {
      ok: true;
      entidadId: number | null;
      condicionPago: CondicionPago | null;
      cuentaBancariaId: number | null;
      cuentaBancaria: CuentaBancariaSnapshot | null;
      retencionIvaPct: number;
      retencionIvaClientePct: number | null;
    }
  | { ok: false; error: string; status: number };

const rechazo = (error: string): { ok: false; error: string; status: number } => ({ ok: false, error, status: 400 });

/**
 * Valida y resuelve entidad emisora, condición de pago y cuenta bancaria, y la retención de IVA. Con `leer` de una
 * transacción o del pool. Nada de esto crea asientos ni calcula retención: solo decide qué se congela.
 *  - CONTADO exige una cuenta bancaria ACTIVA de la empresa (cuenta contable y entidad activas) en la MISMA moneda y, si
 *    se indicó entidad, de ESA entidad; CRÉDITO no lleva banco.
 *  - La entidad, si se indica, debe ser una entidad ACTIVA de la empresa; si no se indica y hay banco, se deriva de él.
 */
async function resolverContextoFact4(leer: Lector, empresaId: number, d: DatosFacturaFact4, moneda: string): Promise<ContextoFact4> {
  if (d.retencionIvaPct != null && !esRetencionIvaValida(d.retencionIvaPct)) return rechazo("La retención de IVA debe ser 0, 15 o 30 %.");
  if (d.retencionIvaClientePct != null && !esRetencionIvaValida(d.retencionIvaClientePct)) return rechazo("La retención de IVA configurada del cliente no es válida.");
  const condicion = d.condicionPago ?? null;
  if (condicion != null && !(CONDICIONES_PAGO as readonly string[]).includes(condicion)) return rechazo("La condición de pago debe ser CRÉDITO o CONTADO.");

  // Con líneas (modelo FACT-4) la condición de pago es obligatoria: no se guarda una factura sin ella.
  if (d.lineas != null && condicion == null) return rechazo("La condición de pago (CRÉDITO o CONTADO) es obligatoria.");

  let entidadId = d.entidadId ?? null;
  let cuentaBancaria: CuentaBancariaSnapshot | null = null;

  if (condicion === "CREDITO" && d.cuentaBancariaId != null) return rechazo("Una venta a crédito no lleva cuenta bancaria.");
  if (condicion !== "CONTADO" && d.cuentaBancariaId != null) return rechazo("La cuenta bancaria solo aplica a ventas al contado.");
  if (condicion === "CONTADO") {
    if (d.cuentaBancariaId == null) return rechazo("Elige la cuenta bancaria donde se recibe el pago al contado.");
    const rows = await leer(
      `SELECT b.id, b.entidad_id, e.nombre AS entidad_nombre, b.banco, b.alias, b.referencia, b.moneda, b.cuenta_id,
              c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre
       FROM cont_cuentas_bancarias b
       INNER JOIN cont_entidades e ON e.empresa_id = b.empresa_id AND e.id = b.entidad_id
       INNER JOIN cont_cuentas c ON c.empresa_id = b.empresa_id AND c.entidad_id = b.entidad_id AND c.id = b.cuenta_id
       WHERE b.id = ? AND b.empresa_id = ? AND b.activa = 1 AND e.activa = 1 AND c.activa = 1 LIMIT 1`,
      [d.cuentaBancariaId, empresaId],
    );
    const r = rows[0];
    if (!r) return rechazo("La cuenta bancaria seleccionada no es válida.");
    if (entidadId != null && Number(r.entidad_id) !== entidadId) return rechazo("La cuenta bancaria no pertenece a la entidad emisora seleccionada.");
    if (String(r.moneda).toUpperCase() !== moneda) return rechazo(`La cuenta bancaria es en ${String(r.moneda)} y la factura en ${moneda}.`);
    entidadId = Number(r.entidad_id);
    cuentaBancaria = {
      cuentaBancariaId: Number(r.id),
      entidadId: Number(r.entidad_id),
      entidadNombre: String(r.entidad_nombre),
      banco: String(r.banco),
      alias: String(r.alias),
      referencia: r.referencia != null ? String(r.referencia) : null,
      moneda: String(r.moneda),
      cuentaContableId: Number(r.cuenta_id),
      cuentaContableCodigo: String(r.cuenta_codigo),
      cuentaContableNombre: String(r.cuenta_nombre),
    };
  }

  if (entidadId != null && cuentaBancaria == null) {
    const rows = await leer("SELECT id FROM cont_entidades WHERE id = ? AND empresa_id = ? AND activa = 1 LIMIT 1", [entidadId, empresaId]);
    if (!rows[0]) return rechazo("La entidad emisora no es válida.");
  }

  // La entidad emisora es obligatoria con CRÉDITO y con CONTADO (al contado puede derivarse del banco).
  if (entidadId == null) return rechazo("La entidad emisora es obligatoria.");

  return {
    ok: true,
    entidadId,
    condicionPago: condicion,
    cuentaBancariaId: cuentaBancaria?.cuentaBancariaId ?? null,
    cuentaBancaria,
    retencionIvaPct: d.retencionIvaPct ?? 0,
    retencionIvaClientePct: d.retencionIvaClientePct ?? null,
  };
}

/** Calcula las líneas si el payload las trae (modelo FACT-4); null si es el modelo anterior. */
function calcularModeloLineas(datos: DatosFacturaFact4, planIds: number[]): ResultadoLineas | null {
  if (datos.lineas == null) return null;
  return calcularLineasFactura({ lineas: datos.lineas, planIdsFactura: planIds });
}

/** Con líneas, los totales del encabezado SON los de las líneas; los de los viajes solo siembran los textos. */
function conTotalesDeLineas(b: BorradorCalculado, lc: Extract<ResultadoLineas, { ok: true }> | null): BorradorCalculado {
  if (!lc) return b;
  return { ...b, subtotal: lc.subtotal, iva: lc.iva, total: lc.total, porcentajeIva: lc.porcentajeIva, precioIncluyeIva: lc.precioIncluyeIva };
}

async function insertarLineasFactura(
  conn: PoolConnection,
  facturaId: number,
  lc: Extract<ResultadoLineas, { ok: true }>,
  codigosPorPlan: Map<number, string>,
): Promise<void> {
  for (const l of lc.lineas) {
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO fact_factura_lineas
         (factura_id, orden, cantidad, descripcion, precio_unitario, valor, clasificacion, precio_incluye_iva, porcentaje_iva,
          base_monto, iva_monto, total_linea)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [facturaId, l.orden, l.cantidad, l.descripcion, l.precioUnitario, l.valor, l.clasificacion, l.precioIncluyeIva ? 1 : 0, l.porcentajeIva, l.base, l.iva, l.total],
    );
    const lineaId = Number(r.insertId);
    for (const planId of l.planIds) {
      await conn.execute(
        `INSERT INTO fact_factura_linea_viajes (linea_id, plan_id, codigo_viaje_snapshot) VALUES (?, ?, ?)`,
        [lineaId, planId, codigosPorPlan.get(planId) ?? null],
      );
    }
  }
}

/** Resumen auditable en el modelo de líneas: totales de las líneas y los viajes de origen (sin el desglose por viaje). */
function detalleViajesLineas(b: BorradorCalculado): string {
  return ` · ${b.moneda} · subtotal ${b.subtotal} · IVA ${b.iva} (${b.porcentajeIva} %) · viajes: ${b.lineas.map((l) => l.codigo).join(", ")}`;
}

function detalleLineas(lc: Extract<ResultadoLineas, { ok: true }> | null, ctx: Extract<ContextoFact4, { ok: true }> | null): string {
  if (!lc) return "";
  const partes = [`${lc.lineas.length} línea(s)`];
  if (ctx?.condicionPago) partes.push(ctx.condicionPago === "CONTADO" ? "CONTADO" : "CRÉDITO");
  if (ctx?.retencionIvaPct) partes.push(`retención IVA ${ctx.retencionIvaPct} %${ctx.retencionIvaClientePct != null && ctx.retencionIvaClientePct !== ctx.retencionIvaPct ? ` (cliente: ${ctx.retencionIvaClientePct} %)` : ""}`);
  return ` · ${partes.join(" · ")}`;
}

/**
 * Vista previa del borrador: valida y recalcula EN EL SERVIDOR exactamente igual que `crearFactura`, pero SIN
 * escribir nada y sin reservar los viajes (sin transacción, sin FOR UPDATE, sin auditoría). Al guardar se
 * revalida de forma transaccional: una preview correcta NO garantiza que el viaje siga libre un segundo después.
 */
export async function previsualizarFactura(
  actor: ActorFacturacion,
  datos: { clienteId: number; planes: LineaFacturaInput[] } & DatosFacturaFact4,
): Promise<{ ok: true; preview: PreviewFactura } | { ok: false; error: string; status: number }> {
  if (datos.lineas == null && !tratamientosIvaValidos(datos.planes)) return ERROR_TRATAMIENTO_IVA_REQUERIDO;
  try {
    const cliente = await leerClienteFactura(lectorPool, actor.empresaId, datos.clienteId);
    if (!cliente) return { ok: false, error: "Cliente no encontrado.", status: 404 };
    if (cliente.tmsClienteId == null) return { ok: false, error: MENSAJE_CLIENTE_SIN_TMS, status: 409 };

    const validacion = await validarPlanesParaFactura(
      lectorPool, actor.empresaId, cliente.tmsClienteId, datos.planes, null, false,
    );
    if (!validacion.ok) return validacion;
    const modelo = datos.lineas != null;
    const calculo = construirBorrador(modelo ? validacion.lineas.map((l) => ({ ...l, precioIncluyeIva: true })) : validacion.lineas);
    if (!calculo.ok) return calculo;
    const lc = calcularModeloLineas(datos, validacion.lineas.map((l) => l.plan.id));
    if (lc && !lc.ok) return lc;
    const contexto = usaFact4(datos) ? await resolverContextoFact4(lectorPool, actor.empresaId, datos, calculo.borrador.moneda) : null;
    if (contexto && !contexto.ok) return contexto;
    return {
      ok: true,
      preview: {
        cliente: { id: cliente.id, nombre: cliente.nombre, nit: cliente.nit, direccion: cliente.direccion },
        cantidadViajes: calculo.borrador.lineas.length,
        borrador: conTotalesDeLineas(calculo.borrador, lc && lc.ok ? lc : null),
        lineas: lc && lc.ok ? lc.lineas : null,
        entidadId: contexto?.entidadId ?? null,
        condicionPago: contexto?.condicionPago ?? null,
        cuentaBancaria: contexto?.cuentaBancaria ?? null,
        retencionIva: (() => {
          const bp = conTotalesDeLineas(calculo.borrador, lc && lc.ok ? lc : null);
          const monto = contexto ? calcularRetencionIva(bp.iva, contexto.retencionIvaPct) : null;
          return {
            aplicadaPct: contexto?.retencionIvaPct ?? null,
            clientePct: contexto?.retencionIvaClientePct ?? null,
            monto,
            netoCobrar: monto != null ? Number((bp.total - monto).toFixed(2)) : null,
          };
        })(),
      },
    };
  } catch (err) {
    if (usaFact4(datos) && esEsquemaPendiente(err)) return { ok: false, error: MENSAJE_FALTA_MIGRACION_FACT4, status: 503 };
    throw err;
  }
}

const COLUMNAS_FACT4 = "entidad_id, modelo_lineas, condicion_pago, cuenta_bancaria_id, cuenta_bancaria_snapshot, retencion_iva_pct, retencion_iva_cliente_pct, retencion_iva_monto";

export async function crearFactura(actor: ActorFacturacion, datos: DatosFactura): Promise<ResultadoFactura> {
  if (datos.lineas == null && !tratamientosIvaValidos(datos.planes)) return ERROR_TRATAMIENTO_IVA_REQUERIDO;
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
      const modelo = datos.lineas != null;
      const calculo = construirBorrador(modelo ? validacion.lineas.map((l) => ({ ...l, precioIncluyeIva: true })) : validacion.lineas);
      if (!calculo.ok) return calculo;
      const lc = calcularModeloLineas(datos, validacion.lineas.map((l) => l.plan.id));
      if (lc && !lc.ok) return lc;
      const ctx = usaFact4(datos) ? await resolverContextoFact4(lectorTx(conn), actor.empresaId, datos, calculo.borrador.moneda) : null;
      if (ctx && !ctx.ok) return ctx;
      const b = conTotalesDeLineas(calculo.borrador, lc && lc.ok ? lc : null);

      let facturaId: number;
      try {
        const base = [
          actor.empresaId, datos.clienteId, datos.numeroFactura ?? null, datos.fechaEmision ?? null,
          b.total, b.moneda, b.subtotal, b.iva, b.porcentajeIva, resumenIvaEncabezado(b),
          cliente.nombre, cliente.nit, cliente.direccion,
        ];
        const cierre = [datos.observaciones ?? null, actor.usuarioId];
        const sql = ctx && ctx.ok
          ? `INSERT INTO fact_facturas
              (empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, moneda, subtotal, iva_monto,
               porcentaje_iva, precio_incluye_iva, cliente_nombre_snapshot, cliente_nit_snapshot,
               cliente_direccion_snapshot, estado_admin, observaciones, creado_por, ${COLUMNAS_FACT4})
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Borrador', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          : `INSERT INTO fact_facturas
              (empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, moneda, subtotal, iva_monto,
               porcentaje_iva, precio_incluye_iva, cliente_nombre_snapshot, cliente_nit_snapshot,
               cliente_direccion_snapshot, estado_admin, observaciones, creado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Borrador', ?, ?)`;
        const extra = ctx && ctx.ok
          ? [ctx.entidadId, modelo ? 1 : 0, ctx.condicionPago, ctx.cuentaBancariaId, ctx.cuentaBancaria ? JSON.stringify(ctx.cuentaBancaria) : null, ctx.retencionIvaPct, ctx.retencionIvaClientePct, calcularRetencionIva(b.iva, ctx.retencionIvaPct)]
          : [];
        const [insertFactura] = await conn.execute<ResultSetHeader>(sql, [...base, ...cierre, ...extra]);
        facturaId = Number(insertFactura.insertId);
      } catch (err) {
        if (esDuplicadoNumeroFactura(err)) {
          return { ok: false, error: "Ya existe una factura con ese número.", status: 409 };
        }
        throw err;
      }

      if (!(await insertarLineasBorrador(conn, facturaId, b, !modelo))) return ERROR_VIAJE_YA_VINCULADO;
      if (lc && lc.ok) await insertarLineasFactura(conn, facturaId, lc, new Map(b.lineas.map((l) => [l.planId, l.codigo])));

      await registrarAuditoriaTx(conn, {
        empresaId: actor.empresaId,
        usuario: actor.usuario,
        modulo: "facturacion",
        accion: "crear_factura",
        detalle: `Factura #${facturaId} (Borrador) · cliente ${cliente.nombre} · ${calculo.borrador.lineas.length} viaje(s) · monto total Q${b.total}${detalleLineas(lc && lc.ok ? lc : null, ctx && ctx.ok ? ctx : null)}${lc && lc.ok ? detalleViajesLineas(b) : detalleBorrador(calculo.borrador)}${detalleAjustesMonto(calculo.borrador.lineas)}`,
      });

      return { ok: true, facturaId };
    }, { readCommitted: true });
  } catch (err) {
    if (esConflictoConcurrencia(err)) return ERROR_CONCURRENCIA;
    if (usaFact4(datos) && esEsquemaPendiente(err)) return { ok: false, error: MENSAJE_FALTA_MIGRACION_FACT4, status: 503 };
    throw err;
  }
}

/** ¿La factura ya guarda líneas (FACT-4)? Tolera que el esquema aún no exista. */
async function facturaTieneLineas(conn: PoolConnection, facturaId: number): Promise<boolean> {
  try {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT modelo_lineas FROM fact_facturas WHERE id = ? LIMIT 1", [facturaId]);
    return Number(rows[0]?.modelo_lineas ?? 0) === 1;
  } catch (err) {
    if (esEsquemaPendiente(err)) return false;
    throw err;
  }
}

export async function actualizarFacturaBorrador(
  actor: ActorFacturacion,
  facturaId: number,
  datos: DatosFactura,
): Promise<ResultadoFactura> {
  if (datos.lineas == null && !tratamientosIvaValidos(datos.planes)) return ERROR_TRATAMIENTO_IVA_REQUERIDO;
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
      const modelo = datos.lineas != null;
      // Un borrador que ya tiene líneas no puede volver al modelo anterior: se editaría sin sus líneas.
      if (!modelo && (await facturaTieneLineas(conn, facturaId))) {
        return { ok: false, error: "Esta factura se prepara por líneas: envía las líneas al editarla.", status: 400 };
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
        validacion.lineas.map((l) => ({ ...l, precioIncluyeIva: modelo ? true : l.precioIncluyeIva, snapshotPrevio: previas.get(l.plan.id) ?? null })),
      );
      if (!calculo.ok) return calculo;
      const lc = calcularModeloLineas(datos, validacion.lineas.map((l) => l.plan.id));
      if (lc && !lc.ok) return lc;
      const ctx = usaFact4(datos) ? await resolverContextoFact4(lectorTx(conn), actor.empresaId, datos, calculo.borrador.moneda) : null;
      if (ctx && !ctx.ok) return ctx;
      const b = conTotalesDeLineas(calculo.borrador, lc && lc.ok ? lc : null);

      const mismoCliente = Number(factura.cliente_id) === datos.clienteId && factura.cliente_nombre_snapshot != null;
      const snapCliente = mismoCliente
        ? {
            nombre: String(factura.cliente_nombre_snapshot),
            nit: textoONull(factura.cliente_nit_snapshot),
            direccion: textoONull(factura.cliente_direccion_snapshot),
          }
        : { nombre: cliente.nombre, nit: cliente.nit, direccion: cliente.direccion };

      // Reemplaza el conjunto de viajes (y, en el modelo de líneas, sus líneas) por completo, dentro de la MISMA
      // transacción — sin ventana donde un viaje quede "huérfano" o libre para otra factura mientras se reconstruye.
      await conn.execute(`DELETE FROM fact_factura_viajes WHERE factura_id = ?`, [facturaId]);
      if (modelo) await conn.execute(`DELETE FROM fact_factura_lineas WHERE factura_id = ?`, [facturaId]);
      if (!(await insertarLineasBorrador(conn, facturaId, b, !modelo))) return ERROR_VIAJE_YA_VINCULADO;
      if (lc && lc.ok) await insertarLineasFactura(conn, facturaId, lc, new Map(b.lineas.map((l) => [l.planId, l.codigo])));

      try {
        const extraSet = ctx && ctx.ok
          ? `, entidad_id = ?, modelo_lineas = ?, condicion_pago = ?, cuenta_bancaria_id = ?, cuenta_bancaria_snapshot = ?,
               retencion_iva_pct = ?, retencion_iva_cliente_pct = ?, retencion_iva_monto = ?`
          : "";
        const extra = ctx && ctx.ok
          ? [ctx.entidadId, modelo ? 1 : 0, ctx.condicionPago, ctx.cuentaBancariaId, ctx.cuentaBancaria ? JSON.stringify(ctx.cuentaBancaria) : null, ctx.retencionIvaPct, ctx.retencionIvaClientePct, calcularRetencionIva(b.iva, ctx.retencionIvaPct)]
          : [];
        await conn.execute(
          `UPDATE fact_facturas
           SET cliente_id = ?, numero_factura = ?, fecha_emision = ?, monto_total = ?, moneda = ?, subtotal = ?,
               iva_monto = ?, porcentaje_iva = ?, precio_incluye_iva = ?, cliente_nombre_snapshot = ?,
               cliente_nit_snapshot = ?, cliente_direccion_snapshot = ?, observaciones = ?${extraSet},
               actualizado_por = ?, actualizado_en = NOW()
           WHERE id = ? AND empresa_id = ? AND estado_admin = 'Borrador'`,
          [
            datos.clienteId, datos.numeroFactura ?? null, datos.fechaEmision ?? null, b.total, b.moneda, b.subtotal,
            b.iva, b.porcentajeIva, resumenIvaEncabezado(b), snapCliente.nombre,
            snapCliente.nit, snapCliente.direccion, datos.observaciones ?? null, ...extra,
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
        detalle: `Factura #${facturaId} (Borrador) editada · cliente ${cliente.nombre} · ${calculo.borrador.lineas.length} viaje(s) · monto total Q${b.total}${detalleLineas(lc && lc.ok ? lc : null, ctx && ctx.ok ? ctx : null)}${lc && lc.ok ? detalleViajesLineas(b) : detalleBorrador(calculo.borrador)}${detalleAjustesMonto(calculo.borrador.lineas)}`,
      });

      return { ok: true, facturaId };
    }, { readCommitted: true });
  } catch (err) {
    if (esConflictoConcurrencia(err)) return ERROR_CONCURRENCIA;
    if (usaFact4(datos) && esEsquemaPendiente(err)) return { ok: false, error: MENSAJE_FALTA_MIGRACION_FACT4, status: 503 };
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

const ERROR_CONCURRENCIA_ANULAR: { ok: false; error: string; status: number } = {
  ok: false,
  error: "Otro usuario está modificando esta factura o sus viajes en este momento. Actualiza la pantalla y vuelve a intentar.",
  status: 409,
};

/**
 * Anula una factura (Borrador o Emitida sin pagos): conserva su detalle en el histórico y libera sus viajes, todo en una
 * transacción. READ COMMITTED (igual que crear/editar): con REPEATABLE READ el `INSERT … SELECT` de la copia tomaría
 * bloqueos compartidos sobre las filas leídas —entre ellas el viaje— y podría interbloquearse con otra factura que esté
 * tomando ese mismo viaje. El bloqueo de la fila de la factura serializa anulaciones/ediciones/emisiones/pagos.
 */
export async function anularFactura(actor: ActorFacturacion, facturaId: number): Promise<ResultadoSimple> {
  try {
    return await anularFacturaTx(actor, facturaId);
  } catch (err) {
    if (esConflictoConcurrencia(err)) return ERROR_CONCURRENCIA_ANULAR;
    throw err;
  }
}

async function anularFacturaTx(actor: ActorFacturacion, facturaId: number): Promise<ResultadoSimple> {
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
    // 1) CONSERVA el detalle: copia cada línea activa (con su fotografía fiscal) al histórico de anuladas. Las líneas
    //    anteriores a FACT-2 sin código/fecha congelados los toman del viaje en ESTE momento (lo mismo que mostraba la
    //    pantalla); nada más se infiere. Si la tabla no existe, NO se anula: borrar sin copiar sería perder el detalle.
    let copiadas: number;
    try {
      const [ins] = await conn.execute<ResultSetHeader>(
        `INSERT INTO ${TABLA_LINEAS_ANULADAS}
           (factura_id, plan_id, monto_asignado, codigo_viaje_snapshot, fecha_viaje_snapshot, ruta_codigo_snapshot,
            origen_snapshot, destino_snapshot, descripcion, cantidad, precio_incluye_iva, porcentaje_iva,
            base_monto, iva_monto, total_linea, linea_creada_en, anulada_por)
         SELECT ffv.factura_id, ffv.plan_id, ffv.monto_asignado,
                COALESCE(ffv.codigo_viaje_snapshot, p.codigo), COALESCE(ffv.fecha_viaje_snapshot, p.fecha_plan),
                ffv.ruta_codigo_snapshot, ffv.origen_snapshot, ffv.destino_snapshot, ffv.descripcion, ffv.cantidad,
                ffv.precio_incluye_iva, ffv.porcentaje_iva, ffv.base_monto, ffv.iva_monto, ffv.total_linea,
                ffv.creado_en, ?
         FROM fact_factura_viajes ffv
         LEFT JOIN tms_planes_viaje p ON p.id = ffv.plan_id
         WHERE ffv.factura_id = ?`,
        [actor.usuarioId, facturaId],
      );
      copiadas = Number(ins.affectedRows ?? 0);
    } catch (err) {
      if (esTablaInexistente(err)) return { ok: false, error: MENSAJE_FALTA_MIGRACION_FACT3, status: 503 };
      throw err;
    }

    // 2) LIBERA los viajes: se borra el vínculo ACTIVO (nunca se marca «inactivo») para que UNIQUE(plan_id) siga siendo
    //    una garantía real de base de datos; el histórico vive en la otra tabla y no participa de esa restricción.
    const [del] = await conn.execute<ResultSetHeader>(`DELETE FROM fact_factura_viajes WHERE factura_id = ?`, [facturaId]);
    if (Number(del.affectedRows ?? 0) !== copiadas) {
      // No debería ocurrir (la factura está bloqueada FOR UPDATE); si ocurre, se deshace todo: nunca liberar sin copiar.
      throw new Error(`Anulación inconsistente de la factura #${facturaId}: ${copiadas} línea(s) copiadas y ${del.affectedRows} borradas.`);
    }

    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      modulo: "facturacion",
      accion: "anular_factura",
      detalle: `Factura #${facturaId} anulada · ${copiadas} línea(s) conservadas en el histórico · viajes liberados para nueva facturación`,
    });

    return { ok: true };
  }, { readCommitted: true });
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
