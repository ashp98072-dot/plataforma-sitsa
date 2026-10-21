import type { RowDataPacket } from "mysql2";
import { getPool } from "@/lib/db";
import { listarCargosPlan, resumenCargosDePlanes } from "./cargos-adicionales";
import type { EstadoLiquidacionViaje } from "./liquidacion-viaje-shared";
import {
  MOTIVO_MARGEN_NO_DISPONIBLE,
  NO_CONSOLIDADO_FASE5,
  construirBloqueComercial,
  difiereSnapshot,
  estadoLiquidacionResumen,
  montoDecimal,
  subtotalComercial,
  sumaMontos,
  type BloqueCostosInternos,
  type CategoriaCosto,
  type ResumenLiquidacionViaje,
  type SnapshotComercialLiquidacion,
} from "./resumen-liquidacion-shared";

/**
 * TMS — RESUMEN COMERCIAL DE LIQUIDACIÓN POR VIAJE (Fase 5). SOLO LECTURA.
 *
 * Qué consolida (cada fuente acotada por `empresa_id` + `plan_id`):
 *   - tarifa base (`tms_planes_viaje.tarifa_comercial`, moneda del snapshot de tarifa del viaje);
 *   - cargos adicionales VIGENTES (`activo = 1`) con su total exacto (Decimal);
 *   - estado de liquidación y lo congelado por la última liquidación (snapshot del evento LIQUIDADO/RELIQUIDADO, si existe);
 *   - bloque SEPARADO de costos internos, solo si el llamador está autorizado (el SQL de gastos/fondos ni se ejecuta si no).
 *
 * Qué NO hace: no calcula IVA, no factura, no genera asientos, no escribe nada, no suma jamás gastos/fondos al subtotal
 * comercial y no calcula margen (no existe un costo interno real y completo por viaje; ver MOTIVO_MARGEN_NO_DISPONIBLE).
 *
 * Fuente de los importes (decisión): el resumen muestra los datos ACTUALES (plan + cargos vigentes) y, aparte, lo CONGELADO por
 * la última liquidación (snapshot append-only, sin inventar uno nuevo) con la marca `difiereDelActual`.
 */

const sinTabla = (e: unknown) => (e as { errno?: number }).errno === 1146;
const sinColumna = (e: unknown) => (e as { errno?: number }).errno === 1054;

type Entrada = { incluirCostos: boolean };

/** Resumen de UN viaje. `null` si el viaje no existe en la empresa (otra empresa = inexistente). */
export async function obtenerResumenLiquidacionViaje(
  empresaId: number,
  planId: number,
  { incluirCostos }: Entrada,
): Promise<ResumenLiquidacionViaje | null> {
  const pool = getPool();
  const [filas] = await pool.query<(RowDataPacket & {
    id: number; codigo: string; estado: string; fecha_plan: string; tarifa_comercial: string | null; moneda: string | null;
    cliente: string | null; ruta_codigo: string | null; origen: string | null; destino: string | null;
  })[]>(
    `SELECT p.id, p.codigo, p.estado, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan, p.tarifa_comercial,
            p.tarifa_moneda_historico AS moneda, c.nombre AS cliente, p.ruta_codigo_historico AS ruta_codigo,
            lc.nombre AS origen, COALESCE(p.lugar_descarga_historico, ld.nombre) AS destino
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
       LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id AND lc.empresa_id = p.empresa_id
       LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id AND ld.empresa_id = p.empresa_id
      WHERE p.empresa_id = ? AND p.id = ?`,
    [empresaId, planId],
  );
  const p = filas[0];
  if (!p) return null;

  // Liquidación vigente (tolerante: sin tablas aún ⇒ sin liquidación).
  let estadoLiq: EstadoLiquidacionViaje | null = null;
  let versionLiq: number | null = null;
  try {
    const [l] = await pool.query<(RowDataPacket & { estado: EstadoLiquidacionViaje; version: number })[]>(
      "SELECT estado, version FROM tms_viaje_liquidaciones WHERE empresa_id = ? AND plan_id = ?",
      [empresaId, planId],
    );
    if (l[0]) {
      estadoLiq = l[0].estado;
      versionLiq = Number(l[0].version);
    }
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }

  const cargos = (await listarCargosPlan(empresaId, planId)).filter((c) => c.activo);
  const comercial = construirBloqueComercial({
    tarifaBase: p.tarifa_comercial,
    moneda: p.moneda,
    cargosVigentes: cargos.map((c) => ({ id: c.id, concepto: c.concepto, monto: c.monto, observacion: c.observacion })),
  });

  const snapshotComercial = await leerSnapshotComercial(empresaId, planId, comercial.subtotalComercial);
  const costos = incluirCostos ? await leerCostosInternos(empresaId, planId) : null;

  return {
    plan: {
      id: Number(p.id),
      codigo: String(p.codigo),
      estado: String(p.estado),
      fechaPlan: String(p.fecha_plan),
      cliente: p.cliente ? String(p.cliente) : null,
      ruta: {
        codigo: p.ruta_codigo ? String(p.ruta_codigo) : null,
        origen: p.origen ? String(p.origen) : null,
        destino: p.destino ? String(p.destino) : null,
      },
    },
    liquidacion: { estado: estadoLiq, version: versionLiq, ...estadoLiquidacionResumen(estadoLiq) },
    comercial,
    snapshotComercial,
    costosAutorizado: incluirCostos,
    costos,
    margen: { disponible: false, motivo: MOTIVO_MARGEN_NO_DISPONIBLE },
    noConsolidado: [...NO_CONSOLIDADO_FASE5],
  };
}

/**
 * Lo congelado por la ÚLTIMA liquidación (evento LIQUIDADO/RELIQUIDADO). Los snapshots anteriores a los cargos adicionales no
 * traen `operativo.cargos`: se marca `incluyeCargos: false` y NO se infiere un total.
 */
async function leerSnapshotComercial(
  empresaId: number,
  planId: number,
  subtotalActual: string | null,
): Promise<SnapshotComercialLiquidacion | null> {
  try {
    const [r] = await getPool().query<(RowDataPacket & { version: number; snapshot_json: string | null; creado_en: string })[]>(
      `SELECT version, snapshot_json, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
         FROM tms_viaje_liquidacion_eventos
        WHERE empresa_id = ? AND plan_id = ? AND tipo IN ('LIQUIDADO', 'RELIQUIDADO')
        ORDER BY version DESC LIMIT 1`,
      [empresaId, planId],
    );
    const e = r[0];
    if (!e?.snapshot_json) return null;
    const snap = JSON.parse(e.snapshot_json) as {
      tarifaComercial?: string | null;
      operativo?: { tarifa?: { comercial?: string | null; moneda?: string | null }; cargos?: { total?: string } | null };
    };
    const tarifaBase = montoDecimal(snap.operativo?.tarifa?.comercial ?? snap.tarifaComercial ?? null);
    const incluyeCargos = snap.operativo?.cargos != null && typeof snap.operativo.cargos === "object";
    const cargosTotal = incluyeCargos ? montoDecimal(snap.operativo!.cargos!.total ?? "0") : null;
    const congelado = tarifaBase == null ? null : subtotalComercial(tarifaBase, incluyeCargos ? cargosTotal : "0");
    return {
      version: Number(e.version),
      liquidadoEn: String(e.creado_en),
      tarifaBase,
      moneda: snap.operativo?.tarifa?.moneda ?? null,
      incluyeCargos,
      cargosTotal,
      // Sin cargos en el snapshot, solo la tarifa estaba congelada: el subtotal congelado es incompleto, no se presenta.
      subtotalComercial: incluyeCargos ? congelado : null,
      difiereDelActual: incluyeCargos ? difiereSnapshot(subtotalActual, congelado) : false,
    };
  } catch (e) {
    if (sinTabla(e)) return null;
    throw e;
  }
}

/** Bloque SEPARADO de costos internos. Cada consulta acotada por empresa + plan; nunca se mezcla con lo comercial. */
async function leerCostosInternos(empresaId: number, planId: number): Promise<BloqueCostosInternos> {
  const pool = getPool();
  const vacio: BloqueCostosInternos = {
    costoRegistrado: null,
    noIncluidos: { pendientes: { cantidad: 0, total: "0.00" }, rechazados: { cantidad: 0 }, historicos: { cantidad: 0, total: "0.00" } },
    anticiposFondo: {
      lineas: 0,
      montoSolicitado: "0.00",
      porEstado: [],
      nota: "Lo solicitado como anticipo NO es el gasto real; no se suma al costo ni al subtotal comercial.",
    },
    costoTercerizado: null,
    moneda: "GTQ",
  };

  // Gastos operativos (dinero ya incurrido). Total real = SUM(cantidad × monto) (la cabecera es caché de sus líneas).
  try {
    const [g] = await pool.query<(RowDataPacket & { categoria: string; estado: string | null; n: number; total: string })[]>(
      `SELECT categoria, estado, COUNT(*) AS n, COALESCE(SUM(cantidad * monto), 0) AS total
         FROM tms_gastos_operativos
        WHERE empresa_id = ? AND plan_id = ? AND activo = 1
        GROUP BY categoria, estado`,
      [empresaId, planId],
    );
    const porCategoria: CategoriaCosto[] = [];
    let pendientes = { cantidad: 0, montos: [] as string[] };
    let historicos = { cantidad: 0, montos: [] as string[] };
    let rechazados = 0;
    for (const r of g) {
      const total = montoDecimal(r.total) ?? "0.00";
      const n = Number(r.n);
      if (r.estado === "Autorizada") porCategoria.push({ categoria: String(r.categoria), cantidad: n, total });
      else if (r.estado === "Pendiente") pendientes = { cantidad: pendientes.cantidad + n, montos: [...pendientes.montos, total] };
      else if (r.estado === "Rechazada") rechazados += n;
      else historicos = { cantidad: historicos.cantidad + n, montos: [...historicos.montos, total] }; // estado IS NULL: histórico
    }
    porCategoria.sort((a, b) => a.categoria.localeCompare(b.categoria, "es"));
    vacio.costoRegistrado = {
      total: sumaMontos(porCategoria.map((c) => c.total)),
      porCategoria,
      criterio: "Gastos operativos AUTORIZADOS y activos vinculados al viaje",
    };
    vacio.noIncluidos = {
      pendientes: { cantidad: pendientes.cantidad, total: sumaMontos(pendientes.montos) },
      rechazados: { cantidad: rechazados },
      historicos: { cantidad: historicos.cantidad, total: sumaMontos(historicos.montos) },
    };
  } catch (e) {
    // Sin tabla o sin la columna `estado` (migración de autorización no aplicada): no es consolidable, no se adivina.
    if (!sinTabla(e) && !sinColumna(e)) throw e;
  }

  // Solicitudes de fondo (anticipos): lo SOLICITADO por estado de la solicitud. Informativo.
  try {
    const [f] = await pool.query<(RowDataPacket & { estado: string; lineas: number; total: string })[]>(
      `SELECT s.estado, COUNT(*) AS lineas, COALESCE(SUM(l.cantidad * l.monto), 0) AS total
         FROM tms_solicitud_fondo_lineas l
         INNER JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
        WHERE l.empresa_id = ? AND l.plan_id = ?
        GROUP BY s.estado`,
      [empresaId, planId],
    );
    const porEstado = f
      .map((r) => ({ estado: String(r.estado), lineas: Number(r.lineas), montoSolicitado: montoDecimal(r.total) ?? "0.00" }))
      .sort((a, b) => a.estado.localeCompare(b.estado, "es"));
    vacio.anticiposFondo = {
      ...vacio.anticiposFondo,
      lineas: porEstado.reduce((n, x) => n + x.lineas, 0),
      montoSolicitado: sumaMontos(porEstado.map((x) => x.montoSolicitado)),
      porEstado,
    };
  } catch (e) {
    if (!sinTabla(e) && !sinColumna(e)) throw e;
  }

  // Costo del transportista externo (solo informativo, aparte).
  try {
    const [t] = await pool.query<(RowDataPacket & { costo_tercerizado: string | null })[]>(
      "SELECT costo_tercerizado FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?",
      [empresaId, planId],
    );
    vacio.costoTercerizado = montoDecimal(t[0]?.costo_tercerizado ?? null);
  } catch (e) {
    if (!sinColumna(e)) throw e;
  }
  return vacio;
}

export type ResumenComercialLote = { cargosCantidad: number; cargosTotal: string; subtotalComercial: string | null };

/**
 * Resumen comercial de VARIOS viajes (listados/reportes/Excel) en UNA consulta agrupada por plan (sin N+1): cargos vigentes por
 * `plan_id`, acotados por empresa; el subtotal se calcula en memoria con la tarifa que el listado ya trae.
 */
export async function resumenComercialDePlanes(
  empresaId: number,
  planes: { id: number; tarifaComercial: number | string | null }[],
): Promise<Map<number, ResumenComercialLote>> {
  const cargos = await resumenCargosDePlanes(empresaId, planes.map((p) => p.id));
  const mapa = new Map<number, ResumenComercialLote>();
  for (const p of planes) {
    const c = cargos.get(p.id);
    const total = c?.total ?? "0.00";
    mapa.set(p.id, { cargosCantidad: c?.cantidad ?? 0, cargosTotal: total, subtotalComercial: subtotalComercial(p.tarifaComercial, total) });
  }
  return mapa;
}
