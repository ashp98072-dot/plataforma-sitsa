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
  /** REPORTES-VIATICOS-GASTOS-DETALLE-1 (§3 del ticket) — filtro "empleado" por id real (gastos: tms_gastos_operativos.empleado_id). Distinto de `empleadoNombre` (texto exacto, usado por el reporte de fondos sobre un snapshot). */
  empleadoId?: number;
  /** REPORTES-VIATICOS-GASTOS-DETALLE-1 — filtro "estado" del reporte de viáticos (tms_viaticos.estado: PROGRAMADO/AUTORIZADO/RECHAZADO/ENTREGADO/LIQUIDADO). Distinto de `estadoFondo` (estado de tms_solicitudes_fondo) y del "activo" de gastos operativos (ver `activo` abajo). */
  estadoViatico?: string;
  /** REPORTES-VIATICOS-GASTOS-DETALLE-1 — filtro "estado" del detalle de gastos operativos: true=solo activos, false=solo anulados, undefined=todos. */
  activo?: boolean;
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
  /**
   * REPORTES-MENSUALES-CONSOLIDADOS-1 — filtro "Requirente" del reporte de
   * fondos por el usuario requirente real (tms_solicitudes_fondo.
   * requirente_usuario_id). El catálogo ya existe (usuarios con acceso a
   * la empresa, `usuarios` en /tms/gastos/catalogos).
   */
  requirenteUsuarioId?: number;
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (v: string | null): string | undefined => (v && FECHA_RE.test(v) ? v : undefined);

/** Compartido por el endpoint de listado y el de exportación — mismo criterio que filtrosReporteDesdeUrl en reportes-viajes.ts. */
export function filtrosReporteGastosDesdeUrl(url: URL): FiltrosReporteGastos {
  const p = url.searchParams;
  const clienteId = Number(p.get("clienteId"));
  const vehiculoId = Number(p.get("vehiculoId"));
  const planId = Number(p.get("planId"));
  const empleadoId = Number(p.get("empleadoId"));
  const requirenteUsuarioId = Number(p.get("requirenteUsuarioId"));
  const activoRaw = p.get("activo");
  return {
    fechaDesde: fechaValida(p.get("fechaDesde")),
    fechaHasta: fechaValida(p.get("fechaHasta")),
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    vehiculoId: Number.isInteger(vehiculoId) && vehiculoId > 0 ? vehiculoId : undefined,
    planId: Number.isInteger(planId) && planId > 0 ? planId : undefined,
    empleadoId: Number.isInteger(empleadoId) && empleadoId > 0 ? empleadoId : undefined,
    categoria: p.get("categoria") || undefined,
    estadoViatico: p.get("estadoViatico")?.trim() || undefined,
    activo: activoRaw === "1" ? true : activoRaw === "0" ? false : undefined,
    fechaSolicitudDesde: fechaValida(p.get("fechaSolicitudDesde")),
    fechaSolicitudHasta: fechaValida(p.get("fechaSolicitudHasta")),
    fechaViajeDesde: fechaValida(p.get("fechaViajeDesde")),
    fechaViajeHasta: fechaValida(p.get("fechaViajeHasta")),
    placa: p.get("placa")?.trim() || undefined,
    empleadoNombre: p.get("empleadoNombre")?.trim() || undefined,
    cargo: p.get("cargo")?.trim() || undefined,
    estadoFondo: p.get("estadoFondo")?.trim() || undefined,
    descripcion: p.get("descripcion")?.trim() || undefined,
    requirenteUsuarioId: Number.isInteger(requirenteUsuarioId) && requirenteUsuarioId > 0 ? requirenteUsuarioId : undefined,
  };
}

export const TIPOS_REPORTE_GASTOS = ["viaje", "unidad", "cliente", "categoria", "periodo", "viaticos", "rentabilidad", "fondos", "gastosDetalle"] as const;
export type TipoReporteGastos = (typeof TIPOS_REPORTE_GASTOS)[number];

export type ResultadoReporteGastos =
  | { tipo: "viaje" | "unidad" | "cliente" | "categoria" | "periodo"; etiqueta: string; filas: FilaAgregadaGasto[] }
  | { tipo: "viaticos"; filas: FilaViaticoReporte[] }
  | { tipo: "rentabilidad"; filas: FilaRentabilidadViaje[] }
  | { tipo: "fondos"; filas: FilaSolicitudFondoReporte[]; resumen: ResumenSolicitudesFondo }
  | { tipo: "gastosDetalle"; filas: FilaGastoDetalle[] };

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
    case "fondos": {
      const filas = await reporteSolicitudesFondo(empresaId, filtros);
      return { tipo, filas, resumen: resumirSolicitudesFondo(filas) };
    }
    case "gastosDetalle": return { tipo, filas: await reporteGastosDetalle(empresaId, filtros) };
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

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 — una fila por viático (persona +
 * viaje), con el detalle completo pedido por el ticket: fecha de
 * registro, fecha de viaje, código de viaje, ruta/destino (snapshot
 * histórico del plan — ruta_codigo_historico/lugar_descarga_historico,
 * NUNCA releídos de tms_cliente_rutas, que puede cambiar/desactivarse
 * después), nombre/cargo/cuenta bancaria del colaborador, placa,
 * cliente, concepto (rol Piloto/Auxiliar), monto, estado, autorización y
 * entrega, observaciones.
 *
 * `cuentaBancaria`/`cargo` se resuelven vía tms_personal.id_empleado ->
 * empleados (MISMO patrón ya usado repetidas veces en viaticos.ts,
 * p. ej. DETALLE_SELECT) — no existe un snapshot propio para esto en
 * tms_viaticos, así que esto no es "reconstruir un histórico que ya
 * existía" (§6 del ticket): simplemente no hay otra fuente. `estado`,
 * `autorizadoPor`/`entregadoPor` SÍ son columnas propias de tms_viaticos
 * (nunca se reconstruyen) — mismo criterio ya aceptado en el resto de la
 * app (viaticos-panel.tsx ya muestra `autorizadoPor` tal cual, sin
 * resolverlo a un nombre "real" por firma electrónica).
 *
 * `placa` = COALESCE(flota_vehiculos.placa, tms_unidades.placa): el
 * vínculo tms_unidades.flota_vehiculo_id es nullable a propósito
 * (backfill progresivo, ver unidad-flota.ts / schema.sql), así que no
 * toda unidad tiene todavía flota_vehiculo_id resuelto. tms_unidades.placa
 * SIEMPRE existe (NOT NULL) y es el mismo fallback que ya usa
 * resolverVehiculoDeUnidadTms — se prioriza flota_vehiculos.placa por ser
 * el dato maestro de Flota, pero nunca a costa de perder la placa cuando
 * el backfill todavía no llegó a esa unidad.
 */
export type FilaViaticoReporte = {
  viaticoId: number;
  fechaRegistro: string;
  fechaViaje: string;
  planId: number;
  planCodigo: string;
  rutaDestino: string | null;
  personalId: number;
  personalNombre: string;
  cargo: string | null;
  cuentaBancaria: string | null;
  placa: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  rol: string;
  montoSugerido: number;
  montoAsignado: number;
  estado: string;
  fechaAutorizacion: string | null;
  autorizadoPor: string | null;
  fechaEntrega: string | null;
  entregadoPor: string | null;
  observaciones: string | null;
};

function condicionesViaticos(empresaId: number, f: FiltrosReporteGastos): { where: string; params: (string | number)[] } {
  const condiciones = ["v.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (f.fechaDesde) { condiciones.push("p.fecha_plan >= ?"); params.push(f.fechaDesde); }
  if (f.fechaHasta) { condiciones.push("p.fecha_plan <= ?"); params.push(f.fechaHasta); }
  if (f.clienteId) { condiciones.push("p.cliente_id = ?"); params.push(f.clienteId); }
  if (f.planId) { condiciones.push("v.plan_id = ?"); params.push(f.planId); }
  if (f.placa) { condiciones.push("COALESCE(fv.placa, u.placa) = ?"); params.push(f.placa); }
  if (f.empleadoNombre) { condiciones.push("per.nombre LIKE ?"); params.push(`%${f.empleadoNombre}%`); }
  if (f.estadoViatico) { condiciones.push("v.estado = ?"); params.push(f.estadoViatico); }
  return { where: condiciones.join(" AND "), params };
}

/** Viáticos — detalle (§1 del ticket): una fila por viático (persona/viaje), lista para Excel/PDF y para agrupar en la UI. */
export async function reporteViaticosPorViajeEmpleado(
  empresaId: number,
  f: Pick<FiltrosReporteGastos, "fechaDesde" | "fechaHasta" | "clienteId" | "planId" | "placa" | "empleadoNombre" | "estadoViatico"> = {},
): Promise<FilaViaticoReporte[]> {
  const { where, params } = condicionesViaticos(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT v.id AS viatico_id, DATE_FORMAT(v.creado_en, '%Y-%m-%d') AS fecha_registro,
            v.plan_id, p.codigo AS plan_codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
            p.lugar_descarga_historico,
            v.personal_id, per.nombre AS personal_nombre,
            COALESCE(e.puesto, per.tipo) AS cargo, e.cuenta_bancaria,
            COALESCE(fv.placa, u.placa) AS placa,
            p.cliente_id, cli.nombre AS cliente_nombre,
            v.rol, v.monto_sugerido, v.monto_asignado, v.estado,
            DATE_FORMAT(v.autorizado_en, '%Y-%m-%d') AS fecha_autorizacion, v.autorizado_por,
            DATE_FORMAT(v.entregado_en, '%Y-%m-%d') AS fecha_entrega, v.entregado_por,
            v.observaciones_entrega, v.observaciones_liquidacion
     FROM tms_viaticos v
     INNER JOIN tms_planes_viaje p ON p.id = v.plan_id AND p.empresa_id = v.empresa_id
     INNER JOIN tms_personal per ON per.id = v.personal_id AND per.empresa_id = v.empresa_id
     LEFT JOIN empleados e ON e.id = per.id_empleado AND e.empresa_id = per.empresa_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id AND u.empresa_id = p.empresa_id
     LEFT JOIN flota_vehiculos fv ON fv.id = u.flota_vehiculo_id AND fv.empresa_id = p.empresa_id
     LEFT JOIN tms_clientes cli ON cli.id = p.cliente_id AND cli.empresa_id = p.empresa_id
     WHERE ${where}
     ORDER BY p.fecha_plan DESC, v.id DESC`,
    params,
  );
  return rows.map((r) => ({
    viaticoId: Number(r.viatico_id),
    fechaRegistro: String(r.fecha_registro),
    fechaViaje: String(r.fecha_plan),
    planId: Number(r.plan_id),
    planCodigo: String(r.plan_codigo),
    rutaDestino: r.lugar_descarga_historico != null ? String(r.lugar_descarga_historico) : null,
    personalId: Number(r.personal_id),
    personalNombre: String(r.personal_nombre),
    cargo: r.cargo != null ? String(r.cargo) : null,
    cuentaBancaria: r.cuenta_bancaria != null ? String(r.cuenta_bancaria) : null,
    placa: r.placa != null ? String(r.placa) : null,
    clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
    clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
    rol: String(r.rol),
    montoSugerido: Number(r.monto_sugerido ?? 0),
    montoAsignado: Number(r.monto_asignado ?? 0),
    estado: String(r.estado),
    fechaAutorizacion: r.fecha_autorizacion != null ? String(r.fecha_autorizacion) : null,
    autorizadoPor: r.autorizado_por != null ? String(r.autorizado_por) : null,
    fechaEntrega: r.fecha_entrega != null ? String(r.fecha_entrega) : null,
    entregadoPor: r.entregado_por != null ? String(r.entregado_por) : null,
    observaciones: r.observaciones_liquidacion != null ? String(r.observaciones_liquidacion) : (r.observaciones_entrega != null ? String(r.observaciones_entrega) : null),
  }));
}

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§2 del ticket) — detalle de Gastos
 * Operativos: una fila por gasto, nunca agrupado. `tms_gastos_operativos`
 * no tiene snapshot propio de empleado/vehículo/cliente (a diferencia de
 * tms_solicitud_fondo_lineas) — el JOIN en vivo es la ÚNICA fuente
 * posible, no hay histórico que "reconstruir" (§6 del ticket).
 * `numero_cuenta_pago` (columna propia del gasto, capturada al
 * registrarlo) NO se agrega aquí — el ticket no la pide para este
 * reporte (solo para Viáticos).
 */
export type FilaGastoDetalle = {
  id: number;
  fechaSolicitud: string;
  fechaViaje: string | null;
  planId: number | null;
  planCodigo: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  cargo: string | null;
  vehiculoId: number | null;
  placa: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  total: number;
  activo: boolean;
  registradoPor: string | null;
  observaciones: string | null;
};

function condicionesGastosDetalle(empresaId: number, f: FiltrosReporteGastos): { where: string; params: (string | number)[] } {
  const condiciones = ["g.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (f.activo !== undefined) { condiciones.push("g.activo = ?"); params.push(f.activo ? 1 : 0); }
  if (f.fechaDesde) { condiciones.push("COALESCE(g.fecha_viaje, g.fecha_solicitud) >= ?"); params.push(f.fechaDesde); }
  if (f.fechaHasta) { condiciones.push("COALESCE(g.fecha_viaje, g.fecha_solicitud) <= ?"); params.push(f.fechaHasta); }
  // GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — filtros SEPARADOS por fecha
  // solicitud y fecha viaje (además del rango combinado de arriba). Cada
  // uno pega contra su propia columna; no se solapan con fechaDesde/Hasta.
  if (f.fechaSolicitudDesde) { condiciones.push("g.fecha_solicitud >= ?"); params.push(f.fechaSolicitudDesde); }
  if (f.fechaSolicitudHasta) { condiciones.push("g.fecha_solicitud <= ?"); params.push(f.fechaSolicitudHasta); }
  if (f.fechaViajeDesde) { condiciones.push("g.fecha_viaje >= ?"); params.push(f.fechaViajeDesde); }
  if (f.fechaViajeHasta) { condiciones.push("g.fecha_viaje <= ?"); params.push(f.fechaViajeHasta); }
  if (f.clienteId) { condiciones.push("g.cliente_id = ?"); params.push(f.clienteId); }
  if (f.vehiculoId) { condiciones.push("g.vehiculo_id = ?"); params.push(f.vehiculoId); }
  if (f.empleadoId) { condiciones.push("g.empleado_id = ?"); params.push(f.empleadoId); }
  if (f.categoria) { condiciones.push("g.categoria = ?"); params.push(f.categoria); }
  if (f.planId) { condiciones.push("g.plan_id = ?"); params.push(f.planId); }
  return { where: condiciones.join(" AND "), params };
}

export async function reporteGastosDetalle(empresaId: number, f: FiltrosReporteGastos = {}): Promise<FilaGastoDetalle[]> {
  const { where, params } = condicionesGastosDetalle(empresaId, f);
  const rows = await query<RowDataPacket[]>(
    `SELECT g.id, DATE_FORMAT(g.fecha_solicitud, '%Y-%m-%d') AS fecha_solicitud,
            DATE_FORMAT(g.fecha_viaje, '%Y-%m-%d') AS fecha_viaje,
            g.plan_id, COALESCE(p.ruta_codigo_historico, p.codigo) AS plan_codigo,
            g.empleado_id, emp.nombre AS empleado_nombre, emp.puesto AS cargo,
            g.vehiculo_id, veh.placa,
            g.cliente_id, cli.nombre AS cliente_nombre,
            g.categoria, g.descripcion, g.cantidad, g.monto, g.activo, g.creado_por, g.observaciones
     FROM tms_gastos_operativos g
     LEFT JOIN tms_planes_viaje p ON p.id = g.plan_id AND p.empresa_id = g.empresa_id
     LEFT JOIN empleados emp ON emp.id = g.empleado_id AND emp.empresa_id = g.empresa_id
     LEFT JOIN flota_vehiculos veh ON veh.id = g.vehiculo_id AND veh.empresa_id = g.empresa_id
     LEFT JOIN tms_clientes cli ON cli.id = g.cliente_id AND cli.empresa_id = g.empresa_id
     WHERE ${where}
     ORDER BY COALESCE(g.fecha_viaje, g.fecha_solicitud) DESC, g.id DESC`,
    params,
  );
  return rows.map((r) => {
    const cantidad = Number(r.cantidad ?? 1);
    const monto = Number(r.monto ?? 0);
    return {
      id: Number(r.id),
      fechaSolicitud: String(r.fecha_solicitud),
      fechaViaje: r.fecha_viaje != null ? String(r.fecha_viaje) : null,
      planId: r.plan_id != null ? Number(r.plan_id) : null,
      planCodigo: r.plan_codigo != null ? String(r.plan_codigo) : null,
      empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
      empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
      cargo: r.cargo != null ? String(r.cargo) : null,
      vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
      placa: r.placa != null ? String(r.placa) : null,
      clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
      clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
      categoria: String(r.categoria),
      descripcion: r.descripcion != null ? String(r.descripcion) : null,
      cantidad,
      monto,
      total: cantidad * monto,
      activo: Number(r.activo ?? 1) === 1,
      registradoPor: r.creado_por != null ? String(r.creado_por) : null,
      observaciones: r.observaciones != null ? String(r.observaciones) : null,
    };
  });
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
  cuenta?: string | null;
  requirenteNombre?: string | null;
  solicitanteNombre?: string | null;
  autorizanteNombre?: string | null;
  fechaAutorizacion?: string | null;
  totalSolicitud?: number;
  estadoFondo: string;
};

/** REPORTES-VIATICOS-GASTOS-DETALLE-1 (§1 del ticket) — "totales por estado si ya existen": se calculan aquí, en JS puro, sobre las filas YA filtradas (nunca una segunda consulta) — mismo criterio ligero que resumirSolicitudesFondo() más abajo. */
export type ResumenPorEstado = Record<string, { cantidad: number; total: number }>;
export function resumirViaticosPorEstado(filas: FilaViaticoReporte[]): ResumenPorEstado {
  const resumen: ResumenPorEstado = {};
  for (const f of filas) {
    const actual = resumen[f.estado] ?? { cantidad: 0, total: 0 };
    actual.cantidad += 1;
    actual.total += f.montoAsignado;
    resumen[f.estado] = actual;
  }
  return resumen;
}

export type ResumenSolicitudesFondo = { cantidad: number; totalSolicitado: number; totalAutorizado: number; totalLiquidado: number; totalRechazado: number };

/** Resume encabezados únicos aunque el reporte tenga varias líneas por solicitud. */
export function resumirSolicitudesFondo(filas: FilaSolicitudFondoReporte[]): ResumenSolicitudesFondo {
  const solicitudes = new Map<number, { total: number; estado: string }>();
  for (const f of filas) solicitudes.set(f.solicitudId, { total: f.totalSolicitud ?? f.total, estado: f.estadoFondo });
  const valores = [...solicitudes.values()];
  return {
    cantidad: valores.length,
    totalSolicitado: valores.reduce((s, v) => s + v.total, 0),
    totalAutorizado: valores.filter((v) => v.estado === "Autorizada" || v.estado === "Liquidada").reduce((s, v) => s + v.total, 0),
    totalLiquidado: valores.filter((v) => v.estado === "Liquidada").reduce((s, v) => s + v.total, 0),
    totalRechazado: valores.filter((v) => v.estado === "Rechazada").reduce((s, v) => s + v.total, 0),
  };
}

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
  if (f.requirenteUsuarioId) { condiciones.push("s.requirente_usuario_id = ?"); params.push(f.requirenteUsuarioId); }
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
            l.empleado_id, l.empleado_nombre, l.cuenta, l.cargo,
            l.vehiculo_id, l.placa,
            l.cliente_id, l.cliente_nombre,
            l.plan_id, l.cantidad, l.descripcion, l.monto,
            s.requirente_nombre, s.solicitante_nombre, s.autorizante_nombre,
            DATE_FORMAT(s.autorizado_en, '%Y-%m-%d') AS fecha_autorizacion,
            s.total AS total_solicitud, s.estado
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
      cuenta: r.cuenta != null ? String(r.cuenta) : null,
      vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
      placa: r.placa != null ? String(r.placa) : null,
      clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
      clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
      planId: r.plan_id != null ? Number(r.plan_id) : null,
      cantidad,
      descripcion: r.descripcion != null ? String(r.descripcion) : null,
      monto,
      total: cantidad * monto,
      requirenteNombre: r.requirente_nombre != null ? String(r.requirente_nombre) : null,
      solicitanteNombre: r.solicitante_nombre != null ? String(r.solicitante_nombre) : null,
      autorizanteNombre: r.autorizante_nombre != null ? String(r.autorizante_nombre) : null,
      fechaAutorizacion: r.fecha_autorizacion != null ? String(r.fecha_autorizacion) : null,
      totalSolicitud: Number(r.total_solicitud ?? 0),
      estadoFondo: String(r.estado),
    };
  });
}

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — una solicitud de fondo con TODAS sus
 * líneas juntas, para el PDF mensual consolidado (cada solicitud es un
 * bloque independiente con su encabezado, su tabla de líneas, su total y
 * sus 3 firmas). Se arma en JS PURO sobre las filas que ya devolvió
 * `reporteSolicitudesFondo` (una fila por línea) — nunca una segunda
 * consulta.
 */
export type SolicitudFondoAgrupada = {
  solicitudId: number;
  solicitudCodigo: string;
  fechaSolicitud: string;
  estadoFondo: string;
  requirenteNombre: string | null;
  solicitanteNombre: string | null;
  autorizanteNombre: string | null;
  /** tms_solicitudes_fondo.total (suma server-side de sus líneas). */
  totalSolicitud: number;
  lineas: FilaSolicitudFondoReporte[];
};

export function agruparSolicitudesFondo(filas: FilaSolicitudFondoReporte[]): SolicitudFondoAgrupada[] {
  const mapa = new Map<number, SolicitudFondoAgrupada>();
  for (const f of filas) {
    let g = mapa.get(f.solicitudId);
    if (!g) {
      g = {
        solicitudId: f.solicitudId,
        solicitudCodigo: f.solicitudCodigo,
        fechaSolicitud: f.fechaSolicitud,
        estadoFondo: f.estadoFondo,
        requirenteNombre: f.requirenteNombre ?? null,
        solicitanteNombre: f.solicitanteNombre ?? null,
        autorizanteNombre: f.autorizanteNombre ?? null,
        totalSolicitud: f.totalSolicitud ?? 0,
        lineas: [],
      };
      mapa.set(f.solicitudId, g);
    }
    g.lineas.push(f);
  }
  // `reporteSolicitudesFondo` ya ordena por fecha desc, solicitud desc,
  // orden, id — el Map preserva ese orden de inserción.
  return [...mapa.values()];
}

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — resumen del mes para el pie del PDF
 * consolidado. Los CONTEOS son por estado ACTUAL de la solicitud. El
 * TOTAL GENERAL DEL MES suma `total_solicitud` UNA sola vez por solicitud
 * y SOLO de los estados Autorizada + Liquidada (una solicitud liquidada
 * ya pasó por autorizada, pero solo se cuenta una vez porque cada
 * solicitud aparece una sola vez aquí). Rechazada y Pendiente se excluyen.
 */
export type ResumenMensualFondos = {
  totalSolicitudes: number;
  autorizadas: number;
  liquidadas: number;
  rechazadas: number;
  pendientes: number;
  totalGeneral: number;
};

export function resumenMensualFondos(grupos: SolicitudFondoAgrupada[]): ResumenMensualFondos {
  const cuenta = (estado: string) => grupos.filter((g) => g.estadoFondo === estado).length;
  return {
    totalSolicitudes: grupos.length,
    autorizadas: cuenta("Autorizada"),
    liquidadas: cuenta("Liquidada"),
    rechazadas: cuenta("Rechazada"),
    pendientes: cuenta("Pendiente"),
    totalGeneral: grupos
      .filter((g) => g.estadoFondo === "Autorizada" || g.estadoFondo === "Liquidada")
      .reduce((suma, g) => suma + (g.totalSolicitud ?? 0), 0),
  };
}
