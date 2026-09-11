import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — gastos operativos asociados
 * opcionalmente a un viaje/plan. Reutiliza catálogos existentes, no
 * duplica nada:
 *   - empleados        -> empleadoId (persona/cargo real, RRHH)
 *   - flota_vehiculos  -> vehiculoId (placa/unidad)
 *   - tms_clientes     -> clienteId (mismo maestro que tms_planes_viaje)
 *   - tms_planes_viaje -> planId (el "viaje")
 * NO duplica viáticos: tms_viaticos sigue siendo la única fuente de
 * viáticos por viaje/piloto/auxiliar (ver src/lib/tms/viaticos.ts y
 * reportes-gastos.ts, que LEE de tms_viaticos, nunca copia sus montos
 * aquí).
 *
 * Esquema: NO se crea/altera desde este módulo — asume que
 * sql/migrate-2026-09-tms-gastos-reportes.sql ya se aplicó manualmente
 * (mismo criterio que cliente-rutas.ts / cliente-contactos.ts).
 */

/** Catálogo FIJO en código — no una tabla nueva (mismo criterio que empleados.categoria_ops / tms_personal.tipo). */
export const CATEGORIAS_GASTO = [
  "Combustible",
  "Hospedaje",
  "Parqueo",
  "Cuadrilla",
  "Auxiliar extra",
  "Mantenimiento",
  "Arbitrios",
  "Transporte",
  // GASTOS-OPERATIVOS-DETALLE-FORMATO-1: categorías del Excel operativo
  // real que faltaban. La clasificación por categoría es INTERNA — la
  // descripción sigue siendo texto libre y no se sustituye por ésta.
  "Comida",
  "Aceite",
  "Medicamento",
  "Bonificación",
  "Otros",
] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export const METODOS_PAGO_GASTO = ["Efectivo", "Transferencia", "Transferencia móvil", "Tarjeta", "Cheque", "Otro"] as const;
export type MetodoPagoGasto = (typeof METODOS_PAGO_GASTO)[number];

/**
 * FONDOS-GASTOS-METODO-PAGO-1 — el destino de pago vive en UN solo campo
 * físico por módulo (numero_cuenta_pago aquí, `cuenta` en fondos.ts); solo
 * cambia su ETIQUETA visible según el método ("Cuenta" o "Número"), nunca
 * se duplica en dos columnas. Esta función es la única puerta de
 * normalización/validación de ese campo y la reutilizan tanto Gastos como
 * Fondos (fondos.ts) para no duplicar la regla.
 *
 * - Métodos distintos a "Transferencia móvil": el campo sigue siendo
 *   opcional, mismo comportamiento que antes de este cambio (solo trim).
 * - "Transferencia móvil": obligatorio; acepta espacios/guiones en la
 *   entrada pero los normaliza (los quita) antes de guardar; el "+" solo
 *   se acepta al inicio; exige 8-15 dígitos reales, sin contar el "+".
 */
const REGEX_TRANSFERENCIA_MOVIL = /^\+?\d{8,15}$/;

export function normalizarDestinoPago(
  metodoPago: string | null | undefined,
  valor: string | null | undefined,
): string | null {
  const limpio = valor?.trim() || null;
  if (metodoPago !== "Transferencia móvil") return limpio;
  if (!limpio) throw new Error("Ingresa el número de transferencia móvil.");
  const normalizado = limpio.replace(/[\s-]/g, "");
  if (!REGEX_TRANSFERENCIA_MOVIL.test(normalizado)) {
    throw new Error('El número de transferencia móvil debe tener entre 8 y 15 dígitos (puede iniciar con "+").');
  }
  return normalizado;
}

export type GastoOperativo = {
  id: number;
  empresaId: number;
  fechaSolicitud: string;
  fechaViaje: string | null;
  empleadoId: number | null;
  empleadoCodigo: string | null;
  empleadoNombre: string | null;
  empleadoCargo: string | null;
  vehiculoId: number | null;
  vehiculoPlaca: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  planId: number | null;
  planCodigo: string | null;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  metodoPago: string | null;
  numeroCuentaPago: string | null;
  tieneFactura: boolean;
  facturaNombreOriginal: string | null;
  facturaTamano: number | null;
  observaciones: string | null;
  activo: boolean;
  creadoPor: string | null;
  creadoEn: string | null;
  actualizadoEn: string | null;
  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 1 — SOLO lectura/mapeo, sin escritura
   * todavía) — mismos conceptos administrativos que ya tiene Fondos
   * (tms_solicitudes_fondo), pero cada gasto es su propia unidad
   * administrativa (opción B: sin encabezado/lote nuevo, sin líneas).
   * `estado === null` significa histórico/legado ya aceptado — NUNCA
   * "pendiente de autorizar" — porque la migración (ver
   * sql/migrate-2026-09-gastos-administrativo.sql) agrega estas columnas
   * sin backfill y sin DEFAULT. `crearGasto`/`actualizarGasto` todavía NO
   * escriben ninguno de estos campos en esta fase.
   */
  entidadRequirenteId: number | null;
  entidadRequirenteNombre: string | null;
  requirenteEmpleadoId: number | null;
  requirenteNombre: string | null;
  requirenteUsuarioId: number | null;
  solicitanteUsuarioId: number | null;
  solicitanteNombre: string | null;
  autorizanteEmpleadoId: number | null;
  autorizanteNombre: string | null;
  autorizanteUsuarioId: number | null;
  estado: string | null;
  autorizadoEn: string | null;
  rechazadoEn: string | null;
  motivoRechazo: string | null;
};

function mapRow(r: RowDataPacket): GastoOperativo {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    fechaSolicitud: String(r.fecha_solicitud),
    fechaViaje: r.fecha_viaje != null ? String(r.fecha_viaje) : null,
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    empleadoCodigo: r.empleado_codigo != null ? String(r.empleado_codigo) : null,
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
    empleadoCargo: r.empleado_cargo != null ? String(r.empleado_cargo) : null,
    vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
    vehiculoPlaca: r.vehiculo_placa != null ? String(r.vehiculo_placa) : null,
    clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
    clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
    planCodigo: r.plan_codigo != null ? String(r.plan_codigo) : null,
    categoria: String(r.categoria),
    descripcion: r.descripcion != null ? String(r.descripcion) : null,
    cantidad: Number(r.cantidad ?? 1),
    monto: Number(r.monto ?? 0),
    metodoPago: r.metodo_pago != null ? String(r.metodo_pago) : null,
    numeroCuentaPago: r.numero_cuenta_pago != null ? String(r.numero_cuenta_pago) : null,
    tieneFactura: Number(r.tiene_factura ?? 0) === 1,
    facturaNombreOriginal: r.factura_nombre_original != null ? String(r.factura_nombre_original) : null,
    facturaTamano: r.factura_tamano != null ? Number(r.factura_tamano) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    activo: Number(r.activo ?? 1) === 1,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: r.creado_en != null ? String(r.creado_en) : null,
    actualizadoEn: r.actualizado_en != null ? String(r.actualizado_en) : null,
    entidadRequirenteId: r.entidad_requirente_id != null ? Number(r.entidad_requirente_id) : null,
    entidadRequirenteNombre: r.entidad_requirente_nombre != null ? String(r.entidad_requirente_nombre) : null,
    requirenteEmpleadoId: r.requirente_empleado_id != null ? Number(r.requirente_empleado_id) : null,
    requirenteNombre: r.requirente_nombre != null ? String(r.requirente_nombre) : null,
    requirenteUsuarioId: r.requirente_usuario_id != null ? Number(r.requirente_usuario_id) : null,
    solicitanteUsuarioId: r.solicitante_usuario_id != null ? Number(r.solicitante_usuario_id) : null,
    solicitanteNombre: r.solicitante_nombre != null ? String(r.solicitante_nombre) : null,
    autorizanteEmpleadoId: r.autorizante_empleado_id != null ? Number(r.autorizante_empleado_id) : null,
    autorizanteNombre: r.autorizante_nombre != null ? String(r.autorizante_nombre) : null,
    autorizanteUsuarioId: r.autorizante_usuario_id != null ? Number(r.autorizante_usuario_id) : null,
    estado: r.estado != null ? String(r.estado) : null,
    autorizadoEn: r.autorizado_en != null ? String(r.autorizado_en) : null,
    rechazadoEn: r.rechazado_en != null ? String(r.rechazado_en) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
  };
}

const SELECT = `
  SELECT g.id, g.empresa_id, DATE_FORMAT(g.fecha_solicitud, '%Y-%m-%d') AS fecha_solicitud,
         DATE_FORMAT(g.fecha_viaje, '%Y-%m-%d') AS fecha_viaje,
         g.empleado_id, emp.codigo AS empleado_codigo, emp.nombre AS empleado_nombre, emp.puesto AS empleado_cargo,
         g.vehiculo_id, veh.placa AS vehiculo_placa,
         g.cliente_id, cli.nombre AS cliente_nombre,
         g.plan_id, plan.codigo AS plan_codigo,
         g.categoria, g.descripcion, g.cantidad, g.monto, g.metodo_pago, g.numero_cuenta_pago,
         g.tiene_factura, g.factura_nombre_original, g.factura_tamano,
         g.observaciones, g.activo, g.creado_por, g.creado_en, g.actualizado_en,
         g.entidad_requirente_id, g.entidad_requirente_nombre,
         g.requirente_empleado_id, g.requirente_nombre, g.requirente_usuario_id,
         g.solicitante_usuario_id, g.solicitante_nombre,
         g.autorizante_empleado_id, g.autorizante_nombre, g.autorizante_usuario_id,
         g.estado, g.autorizado_en, g.rechazado_en, g.motivo_rechazo
  FROM tms_gastos_operativos g
  LEFT JOIN empleados emp ON emp.id = g.empleado_id AND emp.empresa_id = g.empresa_id
  LEFT JOIN flota_vehiculos veh ON veh.id = g.vehiculo_id AND veh.empresa_id = g.empresa_id
  LEFT JOIN tms_clientes cli ON cli.id = g.cliente_id AND cli.empresa_id = g.empresa_id
  LEFT JOIN tms_planes_viaje plan ON plan.id = g.plan_id AND plan.empresa_id = g.empresa_id
`;

export type FiltrosGastos = {
  fechaDesde?: string;
  fechaHasta?: string;
  categoria?: string;
  clienteId?: number;
  vehiculoId?: number;
  planId?: number;
  empleadoId?: number;
  incluirInactivos?: boolean;
};

export async function listarGastos(
  empresaId: number,
  filtros: FiltrosGastos = {},
): Promise<GastoOperativo[]> {
  const condiciones = ["g.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (!filtros.incluirInactivos) condiciones.push("g.activo = 1");
  if (filtros.fechaDesde) { condiciones.push("COALESCE(g.fecha_viaje, g.fecha_solicitud) >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("COALESCE(g.fecha_viaje, g.fecha_solicitud) <= ?"); params.push(filtros.fechaHasta); }
  if (filtros.categoria) { condiciones.push("g.categoria = ?"); params.push(filtros.categoria); }
  if (filtros.clienteId) { condiciones.push("g.cliente_id = ?"); params.push(filtros.clienteId); }
  if (filtros.vehiculoId) { condiciones.push("g.vehiculo_id = ?"); params.push(filtros.vehiculoId); }
  if (filtros.planId) { condiciones.push("g.plan_id = ?"); params.push(filtros.planId); }
  if (filtros.empleadoId) { condiciones.push("g.empleado_id = ?"); params.push(filtros.empleadoId); }
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE ${condiciones.join(" AND ")} ORDER BY COALESCE(g.fecha_viaje, g.fecha_solicitud) DESC, g.id DESC`,
    params,
  );
  return rows.map(mapRow);
}

export async function obtenerGasto(empresaId: number, id: number): Promise<GastoOperativo | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE g.id = ? AND g.empresa_id = ? LIMIT 1`, [id, empresaId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export type GastoOperativoInput = {
  fechaSolicitud: string;
  fechaViaje?: string | null;
  empleadoId?: number | null;
  vehiculoId?: number | null;
  clienteId?: number | null;
  planId?: number | null;
  categoria: string;
  descripcion?: string | null;
  cantidad?: number;
  monto: number;
  metodoPago?: string | null;
  numeroCuentaPago?: string | null;
  tieneFactura?: boolean;
  observaciones?: string | null;
};

/**
 * AISLAMIENTO MULTIEMPRESA (corrección post-revisión PR #204) — valida
 * ANTES de escribir que cada referencia opcional (empleado/vehículo/
 * cliente/plan) pertenezca a la MISMA empresa, aunque el id exista en la
 * tabla (de otra empresa). Esto da un mensaje claro; la FK compuesta
 * (empresa_id, xxx_id) en la base (ver
 * sql/migrate-2026-09-tms-gastos-reportes.sql) es la garantía real e
 * incondicional — esta validación es la primera línea de defensa, no la
 * única.
 */
async function validarReferenciasGasto(
  empresaId: number,
  input: Pick<GastoOperativoInput, "empleadoId" | "vehiculoId" | "clienteId" | "planId">,
): Promise<void> {
  const checks: Promise<void>[] = [];
  if (input.empleadoId != null) {
    checks.push(
      query<RowDataPacket[]>("SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [input.empleadoId, empresaId])
        .then((rows) => { if (!rows[0]) throw new Error("El empleado indicado no pertenece a esta empresa."); }),
    );
  }
  if (input.vehiculoId != null) {
    checks.push(
      query<RowDataPacket[]>("SELECT id FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1", [input.vehiculoId, empresaId])
        .then((rows) => { if (!rows[0]) throw new Error("El vehículo indicado no pertenece a esta empresa."); }),
    );
  }
  if (input.clienteId != null) {
    checks.push(
      query<RowDataPacket[]>("SELECT id FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [input.clienteId, empresaId])
        .then((rows) => { if (!rows[0]) throw new Error("El cliente indicado no pertenece a esta empresa."); }),
    );
  }
  if (input.planId != null) {
    checks.push(
      query<RowDataPacket[]>("SELECT id FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1", [input.planId, empresaId])
        .then((rows) => { if (!rows[0]) throw new Error("El viaje/plan indicado no pertenece a esta empresa."); }),
    );
  }
  await Promise.all(checks);
}

export async function crearGasto(
  empresaId: number,
  input: GastoOperativoInput,
  creadoPor?: string | null,
): Promise<GastoOperativo> {
  if (!input.fechaSolicitud) throw new Error("Fecha de solicitud requerida.");
  if (!input.categoria) throw new Error("Categoría de gasto requerida.");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a cero.");
  const numeroCuentaPago = normalizarDestinoPago(input.metodoPago ?? null, input.numeroCuentaPago);
  await validarReferenciasGasto(empresaId, input);
  const r = await execute(
    `INSERT INTO tms_gastos_operativos
       (empresa_id, fecha_solicitud, fecha_viaje, empleado_id, vehiculo_id, cliente_id, plan_id,
        categoria, descripcion, cantidad, monto, metodo_pago, numero_cuenta_pago, tiene_factura,
        observaciones, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      input.fechaSolicitud,
      input.fechaViaje ?? null,
      input.empleadoId ?? null,
      input.vehiculoId ?? null,
      input.clienteId ?? null,
      input.planId ?? null,
      input.categoria,
      input.descripcion?.trim() || null,
      input.cantidad ?? 1,
      input.monto,
      input.metodoPago ?? null,
      numeroCuentaPago,
      input.tieneFactura ? 1 : 0,
      input.observaciones?.trim() || null,
      creadoPor ?? null,
    ],
  );
  const creado = await obtenerGasto(empresaId, Number(r.insertId));
  if (!creado) throw new Error("No se pudo crear el gasto.");
  return creado;
}

export type GastoOperativoUpdate = Partial<GastoOperativoInput> & { activo?: boolean };

export async function actualizarGasto(
  empresaId: number,
  id: number,
  cambios: GastoOperativoUpdate,
): Promise<GastoOperativo | null> {
  const actual = await obtenerGasto(empresaId, id);
  if (!actual) return null;
  const monto = cambios.monto !== undefined ? cambios.monto : actual.monto;
  if (!(monto > 0)) throw new Error("El monto debe ser mayor a cero.");
  const metodoPago = cambios.metodoPago !== undefined ? cambios.metodoPago : actual.metodoPago;
  const numeroCuentaPago = normalizarDestinoPago(
    metodoPago,
    cambios.numeroCuentaPago !== undefined ? cambios.numeroCuentaPago : actual.numeroCuentaPago,
  );
  const empleadoId = cambios.empleadoId !== undefined ? cambios.empleadoId : actual.empleadoId;
  const vehiculoId = cambios.vehiculoId !== undefined ? cambios.vehiculoId : actual.vehiculoId;
  const clienteId = cambios.clienteId !== undefined ? cambios.clienteId : actual.clienteId;
  const planId = cambios.planId !== undefined ? cambios.planId : actual.planId;
  // Solo valida lo que REALMENTE cambia — las referencias ya guardadas
  // fueron validadas al crear el gasto (no se re-valida en cada edición
  // no relacionada; cambios.x en undefined significa "no tocar este campo").
  await validarReferenciasGasto(empresaId, cambios);
  await execute(
    `UPDATE tms_gastos_operativos SET
       fecha_solicitud = ?, fecha_viaje = ?, empleado_id = ?, vehiculo_id = ?, cliente_id = ?, plan_id = ?,
       categoria = ?, descripcion = ?, cantidad = ?, monto = ?, metodo_pago = ?, numero_cuenta_pago = ?,
       tiene_factura = ?, observaciones = ?, activo = ?
     WHERE id = ? AND empresa_id = ?`,
    [
      cambios.fechaSolicitud !== undefined ? cambios.fechaSolicitud : actual.fechaSolicitud,
      cambios.fechaViaje !== undefined ? cambios.fechaViaje : actual.fechaViaje,
      empleadoId,
      vehiculoId,
      clienteId,
      planId,
      cambios.categoria !== undefined ? cambios.categoria : actual.categoria,
      cambios.descripcion !== undefined ? cambios.descripcion?.trim() || null : actual.descripcion,
      cambios.cantidad !== undefined ? cambios.cantidad : actual.cantidad,
      monto,
      metodoPago,
      numeroCuentaPago,
      // Un comprobante almacenado es evidencia suficiente y prevalece
      // sobre un false enviado por cualquier cliente. Para pasar a 0 se
      // debe eliminar primero el archivo mediante su endpoint dedicado.
      actual.facturaNombreOriginal
        ? 1
        : cambios.tieneFactura !== undefined
          ? (cambios.tieneFactura ? 1 : 0)
          : actual.tieneFactura ? 1 : 0,
      cambios.observaciones !== undefined ? cambios.observaciones?.trim() || null : actual.observaciones,
      cambios.activo !== undefined ? (cambios.activo ? 1 : 0) : actual.activo ? 1 : 0,
      id,
      empresaId,
    ],
  );
  return obtenerGasto(empresaId, id);
}

/** Nunca DELETE físico — "eliminar" es desactivar (activo = 0), igual que contactos/rutas. */
export async function desactivarGasto(empresaId: number, id: number): Promise<GastoOperativo | null> {
  return actualizarGasto(empresaId, id, { activo: false });
}
