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
  /**
   * SOLICITUD-FONDOS-REPORTE-1 — filtros propios del reporte "fondos"
   * (tipo === "fondos"), sin efecto en ningún otro tipo de reporte de
   * este mismo archivo (mismo criterio que categoria/vehiculoId/planId
   * arriba: cada tipo usa solo el subconjunto de filtros que le aplica).
   * "fechaSolicitud" y "fechaViaje" van SEPARADOS (a diferencia de
   * fechaDesde/fechaHasta de arriba, que en gastos es un solo rango
   * combinado) porque una solicitud de fondo puede cubrir viajes con
   * fecha distinta a la fecha en que se pidió el fondo.
   */
  fechaSolicitudDesde?: string;
  fechaSolicitudHasta?: string;
  fechaViajeDesde?: string;
  fechaViajeHasta?: string;
  /** Placa SNAPSHOT de la línea (tms_solicitud_fondo_lineas.placa) — texto exacto, mismo criterio que "unidad" en Programación. */
  placa?: string;
  /** Nombre SNAPSHOT del empleado de la línea — texto exacto. */
  empleadoNombre?: string;
  /** Cargo SNAPSHOT de la línea — texto exacto. */
  cargo?: string;
  /** Estado de la SOLICITUD (tms_solicitudes_fondo.estado) — no confundir con ningún estado de viaje. */
  estadoFondo?: string;
  /** Búsqueda LIKE por descripción de línea — mismo patrón ya usado en listarRutas()/cliente-rutas.ts (q LIKE). */
  descripcion?: string;
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (v: string | null): string | undefined => (v && FECHA_RE.test(v) ? v : undefined);

/** Compartido por el endpoint de listado y el de exportación — mismo criterio que filtrosReporteDesdeUrl en reportes-viajes.ts. */
export function filtrosReporteGastosDesdeUrl(url: URL): FiltrosReporteGastos {
  const p = url.searchParams;
  const clienteId = Number(p.get("clienteId"));
  const vehiculoId = Number(p.get("vehiculoId"));
  const planId = Number(p.get("planId"));
  return {
    fechaDesde: fechaValida(p.get("fechaDesde")),
    fechaHasta: fechaValida(p.get("fechaHasta")),
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    vehiculoId: Number.isInteger(vehiculoId) && vehiculoId > 0 ? vehiculoId : undefined,
    planId: Number.isInteger(planId) && planId > 0 ? planId : undefined,
    categoria: p.get("categoria") || undefined,
    fechaSolicitudDesde: fechaValida(p.get("fechaSolicitudDesde")),
    fechaSolicitudHasta: fechaValida(p.get("fechaSolicitudHasta")),
    fechaViajeDesde: fechaValida(p.get("fechaViajeDesde")),
    fechaViajeHasta: fechaValida(p.get("fechaViajeHasta")),
    placa: p.get("placa")?.trim() || undefined,
    empleadoNombre: p.get("empleadoNombre")?.trim() || undefined,
    cargo: p.get("cargo")?.trim() || undefined,
    estadoFondo: p.get("estadoFondo")?.trim() || undefined,
    descripcion: p.get("descripcion")?.trim() || undefined,
  };
}

export const TIPOS_REPORTE_GASTOS = ["viaje", "unidad", "cliente", "categoria", "periodo", "viaticos", "rentabilidad", "fondos"] as const;
export type TipoReporteGastos = (typeof TIPOS_REPORTE_GASTOS)[number];

export type ResultadoReporteGastos =
  | { tipo: "viaje" | "unidad" | "cliente" | "categoria" | "periodo"; etiqueta: string; filas: FilaAgregadaGasto[] }
  | { tipo: "viaticos"; filas: FilaViaticoReporte[] }
  | { tipo: "rentabilidad"; filas: FilaRentabilidadViaje[] }
  | { tipo: "fondos"; filas: FilaSolicitudFondoReporte[] };

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
    case "fondos": return { tipo, filas: await reporteSolicitudesFondo(empresaId, filtros) };
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
  gastos: number;
  viaticos: number;
  utilidad: number;
};

/**
 * Rentabilidad por viaje: tarifa_comercial (capturada en el propio plan)
 * menos gastos operativos (tms_gastos_operativos) menos viáticos
 * (tms_viaticos, monto_asignado). Los 4 componentes (tarifa/gastos/
 * viáticos/utilidad) se muestran SEPARADOS siempre — nunca se mezclan ni
 * se ocultan, incluso cuando alguno es 0.
 *
 * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo" ya
 * no se utiliza: se retiró de la fórmula de utilidad (antes restaba
 * costo_operativo_referencia) y de esta fila — ya no se selecciona
 * p.costo_operativo_referencia. La columna sigue existiendo en
 * tms_planes_viaje (sin DROP, sin migración destructiva) con los datos
 * históricos intactos, simplemente este reporte ya no la usa.
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
    const gastos = Number(r.total_gastos ?? 0);
    const viaticos = Number(r.total_viaticos ?? 0);
    return {
      planId: Number(r.plan_id),
      planCodigo: String(r.plan_codigo),
      fechaPlan: String(r.fecha_plan),
      clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
      tarifaComercial: tarifa,
      gastos,
      viaticos,
      utilidad: tarifa - gastos - viaticos,
    };
  });
}

/**
 * SOLICITUD-FONDOS-REPORTE-1 — una fila por LÍNEA de solicitud de fondo
 * (no por solicitud completa): "Fecha solicitud" | "Fecha viaje" |
 * "Nombre" | "Cargo" | "Placa" | "Cliente" | "Cantidad" | "Descripción" |
 * "Total" — formato pedido explícitamente por Operaciones/Contabilidad.
 *
 * Reutiliza tms_solicitud_fondo_lineas/tms_solicitudes_fondo TAL CUAL
 * (mismas tablas que src/lib/tms/fondos.ts, sin duplicar ningún modelo) —
 * este archivo es de SOLO LECTURA, igual que el resto de reportes-gastos.ts.
 *
 * "Fecha solicitud" viene del ENCABEZADO (s.fecha_requerimiento) — una
 * solicitud tiene una única fecha de requerimiento para todas sus líneas,
 * así que no se duplica esa fecha como columna propia de la línea (ver
 * comentario de diseño en sql/migrate-2026-09-solicitud-fondos-reporte.sql).
 * "Nombre"/"Cargo"/"Placa"/"Cliente" salen de las columnas SNAPSHOT de la
 * línea (empleado_nombre/cargo/placa/cliente_nombre) — NUNCA de un JOIN en
 * vivo a empleados/flota_vehiculos/tms_clientes — para que el reporte
 * histórico no cambie si esos catálogos cambian después (mismo pedido
 * explícito del ticket que ya se resolvió al guardar la línea, ver
 * resolverSnapshotLineaTx en fondos.ts). "Total" = cantidad × monto de
 * la línea (el total de la SOLICITUD completa, tms_solicitudes_fondo.total,
 * es la suma de sus líneas — no es lo que pide esta vista por fila).
 */
export type FilaSolicitudFondoReporte = {
  lineaId: number;
  solicitudId: number;
  solicitudCodigo: string;
  fechaSolicitud: string;
  fechaViaje: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  cargo: string | null;
  vehiculoId: number | null;
  placa: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  planId: number | null;
  cantidad: number;
  descripcion: string | null;
  monto: number;
  total: number;
  estadoFondo: string;
};

function condicionesFondos(empresaId: number, f: FiltrosReporteGastos): { where: string; params: (string | number)[] } {
  const condiciones = ["l.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (f.fechaSolicitudDesde) { condiciones.push("s.fecha_requerimiento >= ?"); params.push(f.fechaSolicitudDesde); }
  if (f.fechaSolicitudHasta) { condiciones.push("s.fecha_requerimiento <= ?"); params.push(f.fechaSolicitudHasta); }
  if (f.fechaViajeDesde) { condiciones.push("l.fecha_viaje >= ?"); params.push(f.fechaViajeDesde); }
  if (f.fechaViajeHasta) { condiciones.push("l.fecha_viaje <= ?"); params.push(f.fechaViajeHasta); }
  if (f.clienteId) { condiciones.push("l.cliente_id = ?"); params.push(f.clienteId); }
  if (f.vehiculoId) { condiciones.push("l.vehiculo_id = ?"); params.push(f.vehiculoId); }
  if (f.placa) { condiciones.push("l.placa = ?"); params.push(f.placa); }
  if (f.empleadoNombre) { condiciones.push("l.empleado_nombre = ?"); params.push(f.empleadoNombre); }
  if (f.cargo) { condiciones.push("l.cargo = ?"); params.push(f.cargo); }
  if (f.estadoFondo) { condiciones.push("s.estado = ?"); params.push(f.estadoFondo); }
  if (f.descripcion) { condiciones.push("l.descripcion LIKE ?"); params.push(`%${f.descripcion}%`); }
  return { where: condiciones.join(" AND "), params };
}

export async function reporteSolicitudesFondo(
  empresaId: number,
  f: FiltrosReporteGastos = {},
): Promise<FilaSolicitudFondoReporte[]> {
  const { where, params } = condicionesFondos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT l.id AS linea_id, l.solicitud_id, s.codigo AS solicitud_codigo,
            DATE_FORMAT(s.fecha_requerimiento, '%Y-%m-%d') AS fecha_solicitud,
            DATE_FORMAT(l.fecha_viaje, '%Y-%m-%d') AS fecha_viaje,
            l.empleado_id, l.empleado_nombre, l.cargo,
            l.vehiculo_id, l.placa,
            l.cliente_id, l.cliente_nombre,
            l.plan_id, l.cantidad, l.descripcion, l.monto,
            s.estado
     FROM tms_solicitud_fondo_lineas l
     INNER JOIN tms_solicitudes_fondo s ON s.id = l.solicitud_id AND s.empresa_id = l.empresa_id
     WHERE ${where}
     ORDER BY s.fecha_requerimiento DESC, l.solicitud_id DESC, l.orden, l.id`,
    params,
  );
  return rows.map((r) => {
    const cantidad = Number(r.cantidad ?? 1);
    const monto = Number(r.monto ?? 0);
    return {
      lineaId: Number(r.linea_id),
      solicitudId: Number(r.solicitud_id),
      solicitudCodigo: String(r.solicitud_codigo),
      fechaSolicitud: String(r.fecha_solicitud),
      fechaViaje: r.fecha_viaje != null ? String(r.fecha_viaje) : null,
      empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
      empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
      cargo: r.cargo != null ? String(r.cargo) : null,
      vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
      placa: r.placa != null ? String(r.placa) : null,
      clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
      clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
      planId: r.plan_id != null ? Number(r.plan_id) : null,
      cantidad,
      descripcion: r.descripcion != null ? String(r.descripcion) : null,
      monto,
      total: cantidad * monto,
      estadoFondo: String(r.estado),
    };
  });
}
