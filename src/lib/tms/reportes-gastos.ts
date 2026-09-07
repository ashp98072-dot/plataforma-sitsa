import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — reportes iniciales sobre
 * tms_gastos_operativos, tms_viaticos y tms_planes_viaje. Solo LEE — no
 * duplica ninguna tabla, agrega en SQL sobre las mismas fuentes ya
 * usadas por el resto de TMS (mismo criterio que
 * src/lib/tms/reportes-viajes.ts).
 */

export type FiltrosReporteGastos = {
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: number;
  vehiculoId?: number;
  categoria?: string;
  planId?: number;
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Compartido por el endpoint de listado y el de exportación — mismo criterio que filtrosReporteDesdeUrl en reportes-viajes.ts. */
export function filtrosReporteGastosDesdeUrl(url: URL): FiltrosReporteGastos {
  const p = url.searchParams;
  const fechaDesde = p.get("fechaDesde");
  const fechaHasta = p.get("fechaHasta");
  const clienteId = Number(p.get("clienteId"));
  const vehiculoId = Number(p.get("vehiculoId"));
  const planId = Number(p.get("planId"));
  return {
    fechaDesde: fechaDesde && FECHA_RE.test(fechaDesde) ? fechaDesde : undefined,
    fechaHasta: fechaHasta && FECHA_RE.test(fechaHasta) ? fechaHasta : undefined,
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    vehiculoId: Number.isInteger(vehiculoId) && vehiculoId > 0 ? vehiculoId : undefined,
    planId: Number.isInteger(planId) && planId > 0 ? planId : undefined,
    categoria: p.get("categoria") || undefined,
  };
}

export const TIPOS_REPORTE_GASTOS = ["viaje", "unidad", "cliente", "categoria", "periodo", "viaticos", "rentabilidad"] as const;
export type TipoReporteGastos = (typeof TIPOS_REPORTE_GASTOS)[number];

export type ResultadoReporteGastos =
  | { tipo: "viaje" | "unidad" | "cliente" | "categoria" | "periodo"; etiqueta: string; filas: FilaAgregadaGasto[] }
  | { tipo: "viaticos"; filas: FilaViaticoReporte[] }
  | { tipo: "rentabilidad"; filas: FilaRentabilidadViaje[] };

/**
 * Único punto que decide qué consulta corre para cada `tipo` — reutilizado
 * por el endpoint de listado y por el de exportación (nunca dos criterios
 * que puedan divergir), mismo espíritu que construirCondiciones en
 * reportes-viajes.ts.
 */
export async function obtenerReporteGastosPorTipo(
  empresaId: number,
  tipo: TipoReporteGastos,
  filtros: FiltrosReporteGastos,
): Promise<ResultadoReporteGastos> {
  switch (tipo) {
    case "viaje": return { tipo, etiqueta: "Viaje", filas: await reporteGastosPorViaje(empresaId, filtros) };
    case "unidad": return { tipo, etiqueta: "Unidad", filas: await reporteGastosPorUnidad(empresaId, filtros) };
    case "cliente": return { tipo, etiqueta: "Cliente", filas: await reporteGastosPorCliente(empresaId, filtros) };
    case "categoria": return { tipo, etiqueta: "Categoría", filas: await reporteGastosPorCategoria(empresaId, filtros) };
    case "periodo": return { tipo, etiqueta: "Período", filas: await reporteGastosPorPeriodo(empresaId, filtros) };
    case "viaticos": return { tipo, filas: await reporteViaticosPorViajeEmpleado(empresaId, filtros) };
    case "rentabilidad": return { tipo, filas: await reporteRentabilidadPorViaje(empresaId, filtros) };
  }
}

function condicionesGastos(empresaId: number, f: FiltrosReporteGastos): { where: string; params: (string | number)[] } {
  const condiciones = ["g.empresa_id = ?", "g.activo = 1"];
  const params: (string | number)[] = [empresaId];
  if (f.fechaDesde) { condiciones.push("COALESCE(g.fecha_viaje, g.fecha_solicitud) >= ?"); params.push(f.fechaDesde); }
  if (f.fechaHasta) { condiciones.push("COALESCE(g.fecha_viaje, g.fecha_solicitud) <= ?"); params.push(f.fechaHasta); }
  if (f.clienteId) { condiciones.push("g.cliente_id = ?"); params.push(f.clienteId); }
  if (f.vehiculoId) { condiciones.push("g.vehiculo_id = ?"); params.push(f.vehiculoId); }
  if (f.categoria) { condiciones.push("g.categoria = ?"); params.push(f.categoria); }
  if (f.planId) { condiciones.push("g.plan_id = ?"); params.push(f.planId); }
  return { where: condiciones.join(" AND "), params };
}

export type FilaAgregadaGasto = {
  clave: string;
  etiqueta: string;
  registros: number;
  totalMonto: number;
};

function mapAgregada(r: RowDataPacket): FilaAgregadaGasto {
  return {
    clave: String(r.clave ?? ""),
    etiqueta: String(r.etiqueta ?? r.clave ?? "—"),
    registros: Number(r.registros ?? 0),
    totalMonto: Number(r.total_monto ?? 0),
  };
}

/** Gastos por viaje (plan) — solo viajes con al menos un gasto registrado. */
export async function reporteGastosPorViaje(empresaId: number, f: FiltrosReporteGastos = {}): Promise<FilaAgregadaGasto[]> {
  const { where, params } = condicionesGastos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT CAST(g.plan_id AS CHAR) AS clave, COALESCE(plan.codigo, 'Sin viaje') AS etiqueta,
            COUNT(*) AS registros, SUM(g.cantidad * g.monto) AS total_monto
     FROM tms_gastos_operativos g
     LEFT JOIN tms_planes_viaje plan ON plan.id = g.plan_id AND plan.empresa_id = g.empresa_id
     WHERE ${where}
     GROUP BY g.plan_id, plan.codigo
     ORDER BY total_monto DESC`,
    params,
  );
  return rows.map(mapAgregada);
}

/** Gastos por unidad (vehículo/placa). */
export async function reporteGastosPorUnidad(empresaId: number, f: FiltrosReporteGastos = {}): Promise<FilaAgregadaGasto[]> {
  const { where, params } = condicionesGastos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT CAST(g.vehiculo_id AS CHAR) AS clave, COALESCE(veh.placa, 'Sin unidad') AS etiqueta,
            COUNT(*) AS registros, SUM(g.cantidad * g.monto) AS total_monto
     FROM tms_gastos_operativos g
     LEFT JOIN flota_vehiculos veh ON veh.id = g.vehiculo_id AND veh.empresa_id = g.empresa_id
     WHERE ${where}
     GROUP BY g.vehiculo_id, veh.placa
     ORDER BY total_monto DESC`,
    params,
  );
  return rows.map(mapAgregada);
}

/** Gastos por cliente. */
export async function reporteGastosPorCliente(empresaId: number, f: FiltrosReporteGastos = {}): Promise<FilaAgregadaGasto[]> {
  const { where, params } = condicionesGastos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT CAST(g.cliente_id AS CHAR) AS clave, COALESCE(cli.nombre, 'Sin cliente') AS etiqueta,
            COUNT(*) AS registros, SUM(g.cantidad * g.monto) AS total_monto
     FROM tms_gastos_operativos g
     LEFT JOIN tms_clientes cli ON cli.id = g.cliente_id AND cli.empresa_id = g.empresa_id
     WHERE ${where}
     GROUP BY g.cliente_id, cli.nombre
     ORDER BY total_monto DESC`,
    params,
  );
  return rows.map(mapAgregada);
}

/** Gastos por categoría (Combustible, Hospedaje, ...). */
export async function reporteGastosPorCategoria(empresaId: number, f: FiltrosReporteGastos = {}): Promise<FilaAgregadaGasto[]> {
  const { where, params } = condicionesGastos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT g.categoria AS clave, g.categoria AS etiqueta, COUNT(*) AS registros, SUM(g.cantidad * g.monto) AS total_monto
     FROM tms_gastos_operativos g
     WHERE ${where}
     GROUP BY g.categoria
     ORDER BY total_monto DESC`,
    params,
  );
  return rows.map(mapAgregada);
}

/** Gastos por período (mes calendario, según fecha_viaje o, si no hay, fecha_solicitud). */
export async function reporteGastosPorPeriodo(empresaId: number, f: FiltrosReporteGastos = {}): Promise<FilaAgregadaGasto[]> {
  const { where, params } = condicionesGastos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(COALESCE(g.fecha_viaje, g.fecha_solicitud), '%Y-%m') AS clave,
            DATE_FORMAT(COALESCE(g.fecha_viaje, g.fecha_solicitud), '%Y-%m') AS etiqueta,
            COUNT(*) AS registros, SUM(g.cantidad * g.monto) AS total_monto
     FROM tms_gastos_operativos g
     WHERE ${where}
     GROUP BY clave
     ORDER BY clave DESC`,
    params,
  );
  return rows.map(mapAgregada);
}

export type FilaViaticoReporte = {
  viaticoId: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  personalId: number;
  personalNombre: string;
  rol: string;
  montoSugerido: number;
  montoAsignado: number;
  estado: string;
};

/** Viáticos por viaje/empleado — detalle (una fila por viático), listo para agrupar en la UI/Excel por viaje o por persona. */
export async function reporteViaticosPorViajeEmpleado(
  empresaId: number,
  f: Pick<FiltrosReporteGastos, "fechaDesde" | "fechaHasta" | "clienteId" | "planId">= {},
): Promise<FilaViaticoReporte[]> {
  const condiciones = ["v.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (f.fechaDesde) { condiciones.push("p.fecha_plan >= ?"); params.push(f.fechaDesde); }
  if (f.fechaHasta) { condiciones.push("p.fecha_plan <= ?"); params.push(f.fechaHasta); }
  if (f.clienteId) { condiciones.push("p.cliente_id = ?"); params.push(f.clienteId); }
  if (f.planId) { condiciones.push("v.plan_id = ?"); params.push(f.planId); }
  const rows = await query<RowDataPacket[]>(
    `SELECT v.id AS viatico_id, v.plan_id, p.codigo AS plan_codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
            v.personal_id, per.nombre AS personal_nombre, v.rol, v.monto_sugerido, v.monto_asignado, v.estado
     FROM tms_viaticos v
     INNER JOIN tms_planes_viaje p ON p.id = v.plan_id AND p.empresa_id = v.empresa_id
     INNER JOIN tms_personal per ON per.id = v.personal_id AND per.empresa_id = v.empresa_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY p.fecha_plan DESC, v.id DESC`,
    params,
  );
  return rows.map((r) => ({
    viaticoId: Number(r.viatico_id),
    planId: Number(r.plan_id),
    planCodigo: String(r.plan_codigo),
    fechaPlan: String(r.fecha_plan),
    personalId: Number(r.personal_id),
    personalNombre: String(r.personal_nombre),
    rol: String(r.rol),
    montoSugerido: Number(r.monto_sugerido ?? 0),
    montoAsignado: Number(r.monto_asignado ?? 0),
    estado: String(r.estado),
  }));
}

export type FilaRentabilidadViaje = {
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  clienteNombre: string | null;
  tarifaComercial: number;
  /**
   * Snapshot histórico (tms_planes_viaje.costo_operativo_referencia),
   * copiado de la ruta al momento de programar el viaje — NUNCA el valor
   * ACTUAL de tms_cliente_rutas.costo_operativo (bloqueo 2, revisión PR
   * #204): si la ruta maestra cambia su costo operativo después, los
   * viajes ya guardados no deben verse afectados, igual que
   * tarifaComercial. null si nunca se capturó para este viaje.
   */
  costoOperativo: number | null;
  gastos: number;
  viaticos: number;
  utilidad: number;
};

/**
 * Rentabilidad por viaje: tarifa_comercial (capturada en el propio plan)
 * menos costo_operativo_referencia (snapshot histórico en el propio plan,
 * ver tipo arriba) menos gastos operativos (tms_gastos_operativos) menos
 * viáticos (tms_viaticos, monto_asignado). Los 4 componentes se muestran
 * SEPARADOS siempre — nunca se mezclan ni se ocultan, incluso cuando
 * alguno es 0 o null.
 */
export async function reporteRentabilidadPorViaje(
  empresaId: number,
  f: Pick<FiltrosReporteGastos, "fechaDesde" | "fechaHasta" | "clienteId" | "planId"> = {},
): Promise<FilaRentabilidadViaje[]> {
  const condiciones = ["p.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (f.fechaDesde) { condiciones.push("p.fecha_plan >= ?"); params.push(f.fechaDesde); }
  if (f.fechaHasta) { condiciones.push("p.fecha_plan <= ?"); params.push(f.fechaHasta); }
  if (f.clienteId) { condiciones.push("p.cliente_id = ?"); params.push(f.clienteId); }
  if (f.planId) { condiciones.push("p.id = ?"); params.push(f.planId); }
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id AS plan_id, p.codigo AS plan_codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
            cli.nombre AS cliente_nombre, p.tarifa_comercial,
            p.costo_operativo_referencia,
            COALESCE(g.total_gastos, 0) AS total_gastos,
            COALESCE(v.total_viaticos, 0) AS total_viaticos
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes cli ON cli.id = p.cliente_id AND cli.empresa_id = p.empresa_id
     LEFT JOIN (
       SELECT plan_id, SUM(cantidad * monto) AS total_gastos FROM tms_gastos_operativos
       WHERE empresa_id = ? AND activo = 1 GROUP BY plan_id
     ) g ON g.plan_id = p.id
     LEFT JOIN (
       SELECT plan_id, SUM(monto_asignado) AS total_viaticos FROM tms_viaticos
       WHERE empresa_id = ? GROUP BY plan_id
     ) v ON v.plan_id = p.id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY p.fecha_plan DESC, p.id DESC`,
    [empresaId, empresaId, ...params],
  );
  return rows.map((r) => {
    const tarifa = Number(r.tarifa_comercial ?? 0);
    const costoOperativo = r.costo_operativo_referencia != null ? Number(r.costo_operativo_referencia) : null;
    const gastos = Number(r.total_gastos ?? 0);
    const viaticos = Number(r.total_viaticos ?? 0);
    return {
      planId: Number(r.plan_id),
      planCodigo: String(r.plan_codigo),
      fechaPlan: String(r.fecha_plan),
      clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
      tarifaComercial: tarifa,
      costoOperativo,
      gastos,
      viaticos,
      utilidad: tarifa - (costoOperativo ?? 0) - gastos - viaticos,
    };
  });
}
