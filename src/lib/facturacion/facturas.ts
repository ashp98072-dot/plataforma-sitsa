import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { asegurarVinculosTmsClientes } from "@/lib/clientes/repository";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";

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
};

export type FacturaViajeLinea = { id: number; planId: number; codigo: string; fechaPlan: string; montoAsignado: number };
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

async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  let descartada = false;
  try {
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
    cliente: String(r.cliente),
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
  };
};

const FACTURA_SELECT = `
  SELECT f.id, f.cliente_id, c.nombre AS cliente, f.numero_factura,
         f.fecha_emision, f.monto_total, f.estado_admin, f.observaciones,
         f.creado_por, f.creado_en, f.actualizado_por, f.actualizado_en,
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
      `SELECT ffv.id, ffv.plan_id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan, ffv.monto_asignado
       FROM fact_factura_viajes ffv
       INNER JOIN tms_planes_viaje p ON p.id = ffv.plan_id
       WHERE ffv.factura_id = ?
       ORDER BY p.fecha_plan, ffv.id`,
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
  filtros: { clienteId?: number; fechaDesde?: string; fechaHasta?: string },
): { condiciones: string[]; params: (string | number)[] } {
  const condiciones = [
    "p.empresa_id = ?",
    "p.estado = 'Cerrado'",
    "NOT EXISTS (SELECT 1 FROM fact_factura_viajes ffv WHERE ffv.plan_id = p.id)",
    "cli.id IS NOT NULL",
  ];
  const params: (string | number)[] = [empresaId];
  // filtros.clienteId es un clientes.id (espacio de Facturación) — se
  // filtra vía el puente, NUNCA comparado directo contra p.cliente_id
  // (que es un tms_clientes.id).
  if (filtros.clienteId) { condiciones.push("cli.id = ?"); params.push(filtros.clienteId); }
  if (filtros.fechaDesde) { condiciones.push("p.fecha_plan >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("p.fecha_plan <= ?"); params.push(filtros.fechaHasta); }
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
  filtros: { clienteId?: number; fechaDesde?: string; fechaHasta?: string } & Paginacion,
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
  // Deliberadamente NO se seleccionan piloto/auxiliares/evidencias/paradas/
  // GPS — Facturador no necesita ni debe ver esos datos operativos.
  const [rows, countRows] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
              cli.id AS cliente_id, cli.nombre AS cliente, u.placa, p.tarifa_comercial,
              DATE_FORMAT(p.cerrado_en, '%Y-%m-%dT%H:%i') AS cerrado_en
       ${from}
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
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
    })),
    totalReal: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export type LineaFacturaInput = { planId: number; montoAsignado?: number };
export type DatosFactura = {
  clienteId: number;
  planes: LineaFacturaInput[];
  numeroFactura?: string | null;
  fechaEmision?: string | null;
  observaciones?: string | null;
};

/**
 * Valida y bloquea (FOR UPDATE) cada plan solicitado, dentro de la
 * transacción del caller. Nunca confía en el payload: empresa/cliente/
 * estado se releen de tms_planes_viaje. Devuelve el detalle para poder
 * calcular monto_total server-side y auditar diferencias vs
 * tarifa_comercial.
 *
 * `tmsClienteId` es el `tms_clientes.id` YA RESUELTO por el caller desde
 * el `clientes.id` de la factura (vía `clientes.tms_cliente_id`) — esta
 * función nunca compara un `clientes.id` directamente contra
 * `tms_planes_viaje.cliente_id` (espacios de ID distintos, ver comentario
 * de cabecera del archivo).
 */
async function validarYBloquearPlanes(
  conn: PoolConnection,
  empresaId: number,
  tmsClienteId: number,
  planes: LineaFacturaInput[],
  facturaIdExcluir: number | null,
): Promise<
  | { ok: true; lineas: { planId: number; codigo: string; montoAsignado: number; tarifaComercial: number | null }[] }
  | { ok: false; error: string; status: number }
> {
  if (!planes.length) {
    return { ok: false, error: "Selecciona al menos un viaje.", status: 400 };
  }
  const idsVistos = new Set<number>();
  const lineas: { planId: number; codigo: string; montoAsignado: number; tarifaComercial: number | null }[] = [];
  for (const linea of planes) {
    if (idsVistos.has(linea.planId)) {
      return { ok: false, error: `El viaje #${linea.planId} está repetido en la selección.`, status: 400 };
    }
    idsVistos.add(linea.planId);

    const [planRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, codigo, empresa_id, cliente_id, estado, tarifa_comercial
       FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [linea.planId, empresaId],
    );
    const plan = planRows[0];
    if (!plan) {
      return { ok: false, error: `Viaje #${linea.planId} no encontrado.`, status: 404 };
    }
    if (Number(plan.cliente_id) !== tmsClienteId) {
      return { ok: false, error: `El viaje ${plan.codigo} no pertenece al cliente seleccionado.`, status: 400 };
    }
    if (String(plan.estado) !== "Cerrado") {
      return { ok: false, error: `El viaje ${plan.codigo} no está Cerrado (estado actual: ${plan.estado}).`, status: 409 };
    }

    const [vinculoRows] = await conn.query<RowDataPacket[]>(
      `SELECT factura_id FROM fact_factura_viajes WHERE plan_id = ? FOR UPDATE`,
      [linea.planId],
    );
    const vinculoExistente = vinculoRows[0];
    if (vinculoExistente && Number(vinculoExistente.factura_id) !== facturaIdExcluir) {
      return { ok: false, error: `El viaje ${plan.codigo} ya está vinculado a otra factura.`, status: 409 };
    }

    const tarifa = plan.tarifa_comercial != null ? Number(plan.tarifa_comercial) : null;
    const montoAsignado = linea.montoAsignado != null ? Number(linea.montoAsignado) : (tarifa ?? 0);
    if (!Number.isFinite(montoAsignado) || montoAsignado < 0) {
      return { ok: false, error: `Monto inválido para el viaje ${plan.codigo}.`, status: 400 };
    }
    lineas.push({ planId: linea.planId, codigo: String(plan.codigo), montoAsignado, tarifaComercial: tarifa });
  }
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

export async function crearFactura(actor: ActorFacturacion, datos: DatosFactura): Promise<ResultadoFactura> {
  // HOTFIX PRE-MERGE PR #113 (Hallazgo 1) — nunca silenciado: un fallo de
  // schema/vínculo/DB/permisos aquí debe rechazar la operación completa,
  // no dejar pasar una factura que "parece válida" con un puente roto.
  await asegurarSchemaClientes();
  await asegurarVinculosTmsClientes(actor.empresaId);
  return tx(async (conn) => {
    const [clienteRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, nombre, tms_cliente_id FROM clientes WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [datos.clienteId, actor.empresaId],
    );
    if (!clienteRows[0]) {
      return { ok: false, error: "Cliente no encontrado.", status: 404 };
    }
    const tmsClienteId = clienteRows[0].tms_cliente_id != null ? Number(clienteRows[0].tms_cliente_id) : null;
    if (tmsClienteId == null) {
      return {
        ok: false,
        error: "Este cliente todavía no está vinculado a TMS (clientes.tms_cliente_id) — no tiene viajes asociables.",
        status: 409,
      };
    }

    const validacion = await validarYBloquearPlanes(conn, actor.empresaId, tmsClienteId, datos.planes, null);
    if (!validacion.ok) return validacion;
    const { lineas } = validacion;
    const montoTotal = lineas.reduce((s, l) => s + l.montoAsignado, 0);

    let facturaId: number;
    try {
      const [insertFactura] = await conn.execute<ResultSetHeader>(
        `INSERT INTO fact_facturas
          (empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, estado_admin, observaciones, creado_por)
         VALUES (?, ?, ?, ?, ?, 'Borrador', ?, ?)`,
        [
          actor.empresaId, datos.clienteId, datos.numeroFactura ?? null, datos.fechaEmision ?? null,
          montoTotal, datos.observaciones ?? null, actor.usuarioId,
        ],
      );
      facturaId = Number(insertFactura.insertId);
    } catch (err) {
      if (esDuplicadoNumeroFactura(err)) {
        return { ok: false, error: "Ya existe una factura con ese número.", status: 409 };
      }
      throw err;
    }

    for (const l of lineas) {
      await conn.execute(
        `INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, ?)`,
        [facturaId, l.planId, l.montoAsignado],
      );
    }

    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId,
      usuario: actor.usuario,
      modulo: "facturacion",
      accion: "crear_factura",
      detalle: `Factura #${facturaId} (Borrador) · cliente ${clienteRows[0].nombre} · ${lineas.length} viaje(s) · monto total Q${montoTotal}${detalleAjustesMonto(lineas)}`,
    });

    return { ok: true, facturaId };
  });
}

export async function actualizarFacturaBorrador(
  actor: ActorFacturacion,
  facturaId: number,
  datos: DatosFactura,
): Promise<ResultadoFactura> {
  // HOTFIX PRE-MERGE PR #113 (Hallazgo 1) — igual que en crearFactura:
  // nunca silenciado.
  await asegurarSchemaClientes();
  await asegurarVinculosTmsClientes(actor.empresaId);
  return tx(async (conn) => {
    const [facturaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado_admin, cliente_id FROM fact_facturas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [facturaId, actor.empresaId],
    );
    const factura = facturaRows[0];
    if (!factura) return { ok: false, error: "Factura no encontrada.", status: 404 };
    if (String(factura.estado_admin) !== "Borrador") {
      return { ok: false, error: "Solo se puede editar una factura en Borrador.", status: 409 };
    }

    const [clienteRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, nombre, tms_cliente_id FROM clientes WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [datos.clienteId, actor.empresaId],
    );
    if (!clienteRows[0]) return { ok: false, error: "Cliente no encontrado.", status: 404 };
    const tmsClienteId = clienteRows[0].tms_cliente_id != null ? Number(clienteRows[0].tms_cliente_id) : null;
    if (tmsClienteId == null) {
      return {
        ok: false,
        error: "Este cliente todavía no está vinculado a TMS (clientes.tms_cliente_id) — no tiene viajes asociables.",
        status: 409,
      };
    }

    const validacion = await validarYBloquearPlanes(conn, actor.empresaId, tmsClienteId, datos.planes, facturaId);
    if (!validacion.ok) return validacion;
    const { lineas } = validacion;
    const montoTotal = lineas.reduce((s, l) => s + l.montoAsignado, 0);

    // Reemplaza el conjunto de viajes por completo, dentro de la MISMA
    // transacción — sin ventana donde un viaje quede "huérfano" o libre
    // para otra factura mientras se reconstruye la lista.
    await conn.execute(`DELETE FROM fact_factura_viajes WHERE factura_id = ?`, [facturaId]);
    for (const l of lineas) {
      await conn.execute(
        `INSERT INTO fact_factura_viajes (factura_id, plan_id, monto_asignado) VALUES (?, ?, ?)`,
        [facturaId, l.planId, l.montoAsignado],
      );
    }

    try {
      await conn.execute(
        `UPDATE fact_facturas
         SET cliente_id = ?, numero_factura = ?, fecha_emision = ?, monto_total = ?, observaciones = ?,
             actualizado_por = ?, actualizado_en = NOW()
         WHERE id = ? AND empresa_id = ? AND estado_admin = 'Borrador'`,
        [
          datos.clienteId, datos.numeroFactura ?? null, datos.fechaEmision ?? null, montoTotal,
          datos.observaciones ?? null, actor.usuarioId, facturaId, actor.empresaId,
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
      detalle: `Factura #${facturaId} (Borrador) editada · cliente ${clienteRows[0].nombre} · ${lineas.length} viaje(s) · monto total Q${montoTotal}${detalleAjustesMonto(lineas)}`,
    });

    return { ok: true, facturaId };
  });
}

export type EmitirInput = { numeroFactura?: string | null; fechaEmision?: string | null };

export async function emitirFactura(
  actor: ActorFacturacion,
  facturaId: number,
  input: EmitirInput = {},
): Promise<ResultadoSimple> {
  return tx(async (conn) => {
    const [facturaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado_admin, numero_factura, fecha_emision, monto_total
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
