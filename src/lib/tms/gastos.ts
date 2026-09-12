import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  resolverEntidadRequirenteTx,
  resolverSolicitanteOperacionesTx,
  resolverUsuarioDeEmpresaTx,
  validarEmpleadoDeEmpresaTx,
} from "@/lib/tms/identidad-administrativa";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";

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

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3) — mismo patrón EXACTO que `ErrorMultas`
 * (src/lib/multas/reglas.ts): errores de negocio que necesitan un código
 * HTTP explícito y estable, para que la API los mapee por `instanceof` —
 * nunca clasificando por texto del mensaje (frágil ante un reordenamiento
 * de palabras). Solo se usa donde el status NO es el 400 por defecto de
 * un error de validación plano (ver bloquearGastoParaTransicionTx/
 * autorizarGasto) — el resto de errores de este archivo siguen siendo
 * `Error` simples, y la API los trata como 400, sin cambios.
 */
export class ErrorGasto extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Identidad real de sesión (nunca username) para una firma de Gasto — mismo tipo que IdentidadFirmante en fondos.ts. */
export type IdentidadFirmanteGasto = { usuarioId: number; nombre: string; rol?: string | null };

/** GASTOS-ADMINISTRATIVO-1 (Fase 5) — mensaje FIJO cuando el autorizante no tiene firma registrada en "Mi firma". Exportado para que el endpoint devuelva EXACTAMENTE este texto. */
export const MENSAJE_FIRMA_REQUERIDA_AUTORIZAR = "Debes registrar tu firma en Mi firma antes de autorizar el gasto.";

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo patrón EXACTO que
 * guardarImagenFirmaFondo() en fondos.ts: cada USO de la plantilla
 * personal ("Mi firma") genera una COPIA física INDEPENDIENTE (nunca se
 * referencia el archivo de usuario_firmas directamente) — así, cambiar o
 * borrar la plantilla después nunca altera una firma histórica ya
 * guardada en firmas_electronicas.
 */
async function guardarImagenFirmaGasto(
  empresaId: number,
  gastoId: number,
  accionPrefix: "solicitar" | "requerir" | "autorizar",
  imagen: { bytes: ArrayBuffer; original: string },
): Promise<{ relative: string; original: string; mime: string; size: number; sha256: string }> {
  const guardada = await guardarUpload(empresaId, "firmas", `firma_gasto_${accionPrefix}_${gastoId}`, {
    name: imagen.original || "firma.png",
    size: imagen.bytes.byteLength,
    arrayBuffer: async () => imagen.bytes,
  });
  return {
    relative: guardada.relative,
    original: guardada.original,
    mime: "image/png",
    size: guardada.size,
    sha256: sha256Hex(imagen.bytes),
  };
}

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
  // GASTOS-COMPROBANTE-404-1 — catálogo COMPARTIDO con Fondos (ver
  // fondos/route.ts, fondos/[id]/route.ts y catalogos/route.ts, que lo
  // reexpone para el formulario de Fondos): agregar aquí basta para que
  // ambos módulos acepten/muestren "Reintegro de gastos", sin duplicar
  // el catálogo en ningún otro lugar.
  "Reintegro de gastos",
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

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — mismo helper mínimo que ya usa
 * fondos.ts para leer dentro de una transacción (los 4 helpers de
 * identidad-administrativa.ts exigen una PoolConnection). No se importa
 * de fondos.ts para no crear una dependencia cruzada entre módulos
 * hermanos — es la misma utilidad de 3 líneas, sin lógica de negocio.
 */
async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}
async function executeConn(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — flujo de autorización propio de
 * Gastos, separado del de Fondos (ESTADOS_FONDO en fondos.ts) porque sus
 * estados NO son idénticos: un gasto operativo es dinero YA incurrido,
 * nunca un anticipo por liquidar, así que no existe "Liquidada" aquí.
 * `estado === null` (histórico/legado, ver GastoOperativo.estado) NO es
 * un estado de esta máquina — no tiene transiciones válidas, nunca se
 * autoriza/rechaza silenciosamente (ver autorizarGasto/rechazarGasto).
 */
export const ESTADOS_GASTO = ["Pendiente", "Autorizada", "Rechazada"] as const;
export type EstadoGasto = (typeof ESTADOS_GASTO)[number];

const TRANSICIONES_GASTO: Record<EstadoGasto, EstadoGasto[]> = {
  Pendiente: ["Autorizada", "Rechazada"],
  Autorizada: [],
  Rechazada: [],
};

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
  /**
   * GASTOS-ADMINISTRATIVO-1 (Fase 2) — TODOS opcionales por ahora: la UI
   * actual (Fase 4, todavía no implementada) no los envía, así que
   * "Crear gasto" debe seguir funcionando exactamente igual sin ellos. Se
   * vuelven obligatorios recién cuando la API/formulario los conecten. Si
   * vienen informados, se resuelven/validan server-side contra los
   * mismos helpers que ya usa Fondos (identidad-administrativa.ts) —
   * nunca se confía en un nombre libre enviado por el cliente.
   *
   * `entidadRequirenteId` NO es nullable (igual que en
   * SolicitudFondoInput): se omite (no se toca) o se manda un id válido,
   * sin una vía explícita para "limpiarla" en esta fase.
   */
  entidadRequirenteId?: number;
  requirenteEmpleadoId?: number | null;
  requirenteNombre?: string | null;
  requirenteUsuarioId?: number | null;
  solicitanteUsuarioId?: number | null;
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
 *
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — pasa a ejecutarse DENTRO de la
 * transacción de crearGasto/actualizarGasto (antes usaba el pool
 * directamente), mismo criterio que Fondos: todas las validaciones y la
 * escritura final quedan atómicas. Mismas 4 consultas, mismos mensajes —
 * comportamiento idéntico, solo cambia que ahora usa `conn`.
 */
async function validarReferenciasGastoTx(
  conn: PoolConnection,
  empresaId: number,
  input: Pick<GastoOperativoInput, "empleadoId" | "vehiculoId" | "clienteId" | "planId">,
): Promise<void> {
  if (input.empleadoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [input.empleadoId, empresaId]);
    if (!rows[0]) throw new Error("El empleado indicado no pertenece a esta empresa.");
  }
  if (input.vehiculoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1", [input.vehiculoId, empresaId]);
    if (!rows[0]) throw new Error("El vehículo indicado no pertenece a esta empresa.");
  }
  if (input.clienteId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [input.clienteId, empresaId]);
    if (!rows[0]) throw new Error("El cliente indicado no pertenece a esta empresa.");
  }
  if (input.planId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1", [input.planId, empresaId]);
    if (!rows[0]) throw new Error("El viaje/plan indicado no pertenece a esta empresa.");
  }
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — resuelve entidad requirente,
 * requirente y solicitante DENTRO de la transacción, reutilizando
 * EXACTAMENTE los mismos helpers que ya usa Fondos
 * (identidad-administrativa.ts) — nunca se confía en un nombre/rol que
 * mande el cliente HTTP; el nombre resuelto por el servidor manda sobre
 * cualquier texto libre enviado. Todos los campos son opcionales aquí
 * (ver GastoOperativoInput): si no vienen, simplemente no se resuelve
 * nada y los valores quedan `null`.
 */
async function resolverIdentidadAdministrativaGastoTx(
  conn: PoolConnection,
  empresaId: number,
  input: Pick<GastoOperativoInput, "entidadRequirenteId" | "requirenteEmpleadoId" | "requirenteUsuarioId" | "solicitanteUsuarioId">,
): Promise<{
  entidadRequirente: { id: number; nombre: string } | null;
  requirenteUsuario: { nombre: string; rol: string | null } | null;
  solicitanteUsuario: { nombre: string; rol: string | null } | null;
}> {
  const entidadRequirente = input.entidadRequirenteId == null
    ? null
    : await resolverEntidadRequirenteTx(conn, empresaId, input.entidadRequirenteId);
  await validarEmpleadoDeEmpresaTx(conn, empresaId, input.requirenteEmpleadoId, "requirente");
  let requirenteUsuario: { nombre: string; rol: string | null } | null = null;
  if (input.requirenteUsuarioId != null) {
    requirenteUsuario = await resolverUsuarioDeEmpresaTx(conn, empresaId, input.requirenteUsuarioId);
    if (!requirenteUsuario) throw new Error("El usuario requirente indicado no pertenece a esta empresa.");
  }
  let solicitanteUsuario: { nombre: string; rol: string | null } | null = null;
  if (input.solicitanteUsuarioId != null) {
    solicitanteUsuario = await resolverSolicitanteOperacionesTx(conn, empresaId, input.solicitanteUsuarioId);
    if (!solicitanteUsuario) throw new Error("El usuario solicitante indicado no pertenece a esta empresa.");
  }
  return { entidadRequirente, requirenteUsuario, solicitanteUsuario };
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — pasa a una transacción explícita
 * (antes usaba `execute()` del pool directamente) porque
 * resolverIdentidadAdministrativaGastoTx/validarReferenciasGastoTx
 * exigen una PoolConnection — mismo requisito que ya tiene Fondos para
 * reutilizar esos helpers sin duplicarlos. `estado` queda hardcodeado
 * `'Pendiente'` en el INSERT, nunca aceptado desde `input`.
 */
export async function crearGasto(
  empresaId: number,
  input: GastoOperativoInput,
  creadoPor?: string | null,
): Promise<GastoOperativo> {
  if (!input.fechaSolicitud) throw new Error("Fecha de solicitud requerida.");
  if (!input.categoria) throw new Error("Categoría de gasto requerida.");
  if (!(input.monto > 0)) throw new Error("El monto debe ser mayor a cero.");
  const numeroCuentaPago = normalizarDestinoPago(input.metodoPago ?? null, input.numeroCuentaPago);

  const conn = await getPool().getConnection();
  const archivosFirmaEscritos: string[] = [];
  let insertId = 0;
  try {
    await conn.beginTransaction();
    await validarReferenciasGastoTx(conn, empresaId, input);
    const { entidadRequirente, requirenteUsuario, solicitanteUsuario } = await resolverIdentidadAdministrativaGastoTx(conn, empresaId, input);

    const r = await executeConn(conn,
      `INSERT INTO tms_gastos_operativos
         (empresa_id, fecha_solicitud, fecha_viaje, empleado_id, vehiculo_id, cliente_id, plan_id,
          categoria, descripcion, cantidad, monto, metodo_pago, numero_cuenta_pago, tiene_factura,
          observaciones, creado_por,
          entidad_requirente_id, entidad_requirente_nombre,
          requirente_empleado_id, requirente_nombre, requirente_usuario_id,
          solicitante_usuario_id, solicitante_nombre, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente')`,
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
        entidadRequirente?.id ?? null,
        entidadRequirente?.nombre ?? null,
        input.requirenteEmpleadoId ?? null,
        requirenteUsuario ? requirenteUsuario.nombre : (input.requirenteNombre?.trim() || null),
        input.requirenteUsuarioId ?? null,
        input.solicitanteUsuarioId ?? null,
        solicitanteUsuario?.nombre ?? null,
      ],
    );
    insertId = Number(r.insertId);

    // GASTOS-ADMINISTRATIVO-1 (Fase 5) — firma del SOLICITANTE y del
    // REQUIRIENTE (solo si se asoció un usuario real), BEST-EFFORT: mismo
    // criterio que Fondos — nunca bloquea la creación por falta de "Mi
    // firma"; sin ella, el PDF individual muestra el nombre + espacio en
    // blanco (nunca se inventa una firma).
    if (input.solicitanteUsuarioId != null && solicitanteUsuario) {
      const bytes = await leerBytesFirmaGuardada(input.solicitanteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaGasto(empresaId, insertId, "solicitar", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: input.solicitanteUsuarioId, empleadoId: null,
          nombreFirmante: solicitanteUsuario.nombre, rolFirmante: solicitanteUsuario.rol ?? "",
          accion: "SOLICITAR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: insertId,
          valoresRelevantes: { gastoId: insertId, monto: input.monto },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }
    if (input.requirenteUsuarioId != null && requirenteUsuario) {
      const bytes = await leerBytesFirmaGuardada(input.requirenteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaGasto(empresaId, insertId, "requerir", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: input.requirenteUsuarioId, empleadoId: null,
          nombreFirmante: requirenteUsuario.nombre, rolFirmante: requirenteUsuario.rol ?? "",
          accion: "REQUERIR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: insertId,
          valoresRelevantes: { gastoId: insertId, monto: input.monto },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }

    await registrarAuditoriaTx(conn, {
      empresaId, usuario: creadoPor ?? null, accion: "crear", modulo: "tms_gastos",
      detalle: `Gasto operativo #${insertId} creado por Q${input.monto.toFixed(2)}.`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    for (const relative of archivosFirmaEscritos) borrarUpload(relative);
    throw error;
  } finally {
    conn.release();
  }
  const creado = await obtenerGasto(empresaId, insertId);
  if (!creado) throw new Error("No se pudo crear el gasto.");
  return creado;
}

export type GastoOperativoUpdate = Partial<GastoOperativoInput> & { activo?: boolean };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — mismo cambio estructural que
 * crearGasto: transacción explícita con `SELECT ... FOR UPDATE` (bloquea
 * la fila mientras se decide si el contenido puede editarse, evitando
 * una carrera con autorizarGasto/rechazarGasto sobre el mismo id).
 *
 * Bloqueo de contenido (aprobado): si el gasto está `Autorizada` o
 * `Rechazada`, se rechaza cualquier cambio que NO sea exclusivamente
 * `activo` — un histórico (`estado IS NULL`) o uno `Pendiente` siguen
 * editables sin restricción nueva, exactamente como hoy. `activo` (baja
 * lógica) queda SIEMPRE permitido, sea cual sea el estado — es una
 * operación administrativa distinta, no revierte una autorización.
 */
export async function actualizarGasto(
  empresaId: number,
  id: number,
  cambios: GastoOperativoUpdate,
): Promise<GastoOperativo | null> {
  const conn = await getPool().getConnection();
  const archivosFirmaEscritos: string[] = [];
  try {
    await conn.beginTransaction();
    const rows = await queryConn<RowDataPacket[]>(conn,
      `SELECT id, DATE_FORMAT(fecha_solicitud, '%Y-%m-%d') AS fecha_solicitud,
              DATE_FORMAT(fecha_viaje, '%Y-%m-%d') AS fecha_viaje,
              empleado_id, vehiculo_id, cliente_id, plan_id,
              categoria, descripcion, cantidad, monto, metodo_pago, numero_cuenta_pago,
              tiene_factura, factura_nombre_original, observaciones, activo,
              entidad_requirente_id, entidad_requirente_nombre,
              requirente_empleado_id, requirente_nombre, requirente_usuario_id,
              solicitante_usuario_id, solicitante_nombre, estado
       FROM tms_gastos_operativos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [id, empresaId],
    );
    const actual = rows[0];
    if (!actual) { await conn.rollback(); return null; }

    const estadoActual: EstadoGasto | null = actual.estado != null ? (String(actual.estado) as EstadoGasto) : null;
    const camposEnviados = Object.keys(cambios) as (keyof GastoOperativoUpdate)[];
    const soloActivo = camposEnviados.length > 0 && camposEnviados.every((k) => k === "activo");
    if (!soloActivo && (estadoActual === "Autorizada" || estadoActual === "Rechazada")) {
      throw new Error(`No se puede editar el contenido de un gasto en estado "${estadoActual}" — solo mientras está Pendiente o es histórico.`);
    }

    const monto = cambios.monto !== undefined ? cambios.monto : Number(actual.monto ?? 0);
    if (!(monto > 0)) throw new Error("El monto debe ser mayor a cero.");
    const metodoPagoActual = actual.metodo_pago != null ? String(actual.metodo_pago) : null;
    const numeroCuentaPagoActual = actual.numero_cuenta_pago != null ? String(actual.numero_cuenta_pago) : null;
    const metodoPago = cambios.metodoPago !== undefined ? cambios.metodoPago : metodoPagoActual;
    const numeroCuentaPago = normalizarDestinoPago(
      metodoPago,
      cambios.numeroCuentaPago !== undefined ? cambios.numeroCuentaPago : numeroCuentaPagoActual,
    );
    const empleadoId = cambios.empleadoId !== undefined ? cambios.empleadoId : (actual.empleado_id != null ? Number(actual.empleado_id) : null);
    const vehiculoId = cambios.vehiculoId !== undefined ? cambios.vehiculoId : (actual.vehiculo_id != null ? Number(actual.vehiculo_id) : null);
    const clienteId = cambios.clienteId !== undefined ? cambios.clienteId : (actual.cliente_id != null ? Number(actual.cliente_id) : null);
    const planId = cambios.planId !== undefined ? cambios.planId : (actual.plan_id != null ? Number(actual.plan_id) : null);
    // Solo valida lo que REALMENTE cambia — las referencias ya guardadas
    // fueron validadas al crear el gasto (no se re-valida en cada edición
    // no relacionada; cambios.x en undefined significa "no tocar este campo").
    await validarReferenciasGastoTx(conn, empresaId, cambios);
    const { entidadRequirente, requirenteUsuario, solicitanteUsuario } = await resolverIdentidadAdministrativaGastoTx(conn, empresaId, cambios);

    // GASTOS-ADMINISTRATIVO-1 (Fase 5) — mismo criterio que
    // actualizarSolicitudFondo: una nueva firma snapshot se captura solo
    // si el usuario requirente/solicitante REALMENTE cambió (nunca se
    // re-firma sin razón en cada edición no relacionada).
    const requirenteUsuarioCambio = cambios.requirenteUsuarioId !== undefined
      && cambios.requirenteUsuarioId !== (actual.requirente_usuario_id != null ? Number(actual.requirente_usuario_id) : null);
    const solicitanteUsuarioCambio = cambios.solicitanteUsuarioId !== undefined
      && cambios.solicitanteUsuarioId !== (actual.solicitante_usuario_id != null ? Number(actual.solicitante_usuario_id) : null);

    const entidadRequirenteId = entidadRequirente?.id ?? (actual.entidad_requirente_id != null ? Number(actual.entidad_requirente_id) : null);
    const entidadRequirenteNombre = entidadRequirente?.nombre ?? (actual.entidad_requirente_nombre != null ? String(actual.entidad_requirente_nombre) : null);
    const requirenteEmpleadoId = cambios.requirenteEmpleadoId !== undefined ? cambios.requirenteEmpleadoId ?? null : (actual.requirente_empleado_id != null ? Number(actual.requirente_empleado_id) : null);
    const requirenteNombre = requirenteUsuario
      ? requirenteUsuario.nombre
      : (cambios.requirenteNombre !== undefined ? cambios.requirenteNombre?.trim() || null : (actual.requirente_nombre != null ? String(actual.requirente_nombre) : null));
    const requirenteUsuarioId = cambios.requirenteUsuarioId !== undefined ? cambios.requirenteUsuarioId ?? null : (actual.requirente_usuario_id != null ? Number(actual.requirente_usuario_id) : null);
    const solicitanteUsuarioId = cambios.solicitanteUsuarioId !== undefined ? cambios.solicitanteUsuarioId ?? null : (actual.solicitante_usuario_id != null ? Number(actual.solicitante_usuario_id) : null);
    const solicitanteNombre = cambios.solicitanteUsuarioId !== undefined
      ? (solicitanteUsuario ? solicitanteUsuario.nombre : null)
      : (actual.solicitante_nombre != null ? String(actual.solicitante_nombre) : null);

    await executeConn(conn,
      `UPDATE tms_gastos_operativos SET
         fecha_solicitud = ?, fecha_viaje = ?, empleado_id = ?, vehiculo_id = ?, cliente_id = ?, plan_id = ?,
         categoria = ?, descripcion = ?, cantidad = ?, monto = ?, metodo_pago = ?, numero_cuenta_pago = ?,
         tiene_factura = ?, observaciones = ?, activo = ?,
         entidad_requirente_id = ?, entidad_requirente_nombre = ?,
         requirente_empleado_id = ?, requirente_nombre = ?, requirente_usuario_id = ?,
         solicitante_usuario_id = ?, solicitante_nombre = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        cambios.fechaSolicitud !== undefined ? cambios.fechaSolicitud : String(actual.fecha_solicitud),
        cambios.fechaViaje !== undefined ? cambios.fechaViaje : (actual.fecha_viaje != null ? String(actual.fecha_viaje) : null),
        empleadoId,
        vehiculoId,
        clienteId,
        planId,
        cambios.categoria !== undefined ? cambios.categoria : String(actual.categoria),
        cambios.descripcion !== undefined ? cambios.descripcion?.trim() || null : (actual.descripcion != null ? String(actual.descripcion) : null),
        cambios.cantidad !== undefined ? cambios.cantidad : Number(actual.cantidad ?? 1),
        monto,
        metodoPago,
        numeroCuentaPago,
        // Un comprobante almacenado es evidencia suficiente y prevalece
        // sobre un false enviado por cualquier cliente. Para pasar a 0 se
        // debe eliminar primero el archivo mediante su endpoint dedicado.
        actual.factura_nombre_original
          ? 1
          : cambios.tieneFactura !== undefined
            ? (cambios.tieneFactura ? 1 : 0)
            : Number(actual.tiene_factura ?? 0),
        cambios.observaciones !== undefined ? cambios.observaciones?.trim() || null : (actual.observaciones != null ? String(actual.observaciones) : null),
        cambios.activo !== undefined ? (cambios.activo ? 1 : 0) : Number(actual.activo ?? 1),
        entidadRequirenteId,
        entidadRequirenteNombre,
        requirenteEmpleadoId,
        requirenteNombre,
        requirenteUsuarioId,
        solicitanteUsuarioId,
        solicitanteNombre,
        id,
        empresaId,
      ],
    );

    // GASTOS-ADMINISTRATIVO-1 (Fase 5) — firma BEST-EFFORT del
    // SOLICITANTE/REQUIRIENTE cuando el usuario asociado cambió en esta
    // edición (ver requirenteUsuarioCambio/solicitanteUsuarioCambio).
    if (solicitanteUsuarioCambio && cambios.solicitanteUsuarioId != null && solicitanteUsuario) {
      const bytes = await leerBytesFirmaGuardada(cambios.solicitanteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaGasto(empresaId, id, "solicitar", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: cambios.solicitanteUsuarioId, empleadoId: null,
          nombreFirmante: solicitanteUsuario.nombre, rolFirmante: solicitanteUsuario.rol ?? "",
          accion: "SOLICITAR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: id,
          valoresRelevantes: { gastoId: id, monto },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }
    if (requirenteUsuarioCambio && cambios.requirenteUsuarioId != null && requirenteUsuario) {
      const bytes = await leerBytesFirmaGuardada(cambios.requirenteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaGasto(empresaId, id, "requerir", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: cambios.requirenteUsuarioId, empleadoId: null,
          nombreFirmante: requirenteUsuario.nombre, rolFirmante: requirenteUsuario.rol ?? "",
          accion: "REQUERIR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: id,
          valoresRelevantes: { gastoId: id, monto },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }

    await registrarAuditoriaTx(conn, {
      empresaId, usuario: null, accion: "editar", modulo: "tms_gastos",
      detalle: `Gasto operativo #${id} editado.`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    for (const relative of archivosFirmaEscritos) borrarUpload(relative);
    throw error;
  } finally {
    conn.release();
  }
  return obtenerGasto(empresaId, id);
}

/** Nunca DELETE físico — "eliminar" es desactivar (activo = 0), igual que contactos/rutas. Exento del bloqueo de contenido (ver actualizarGasto). */
export async function desactivarGasto(empresaId: number, id: number): Promise<GastoOperativo | null> {
  return actualizarGasto(empresaId, id, { activo: false });
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — bloquea la fila (`FOR UPDATE`) y
 * valida la transición contra TRANSICIONES_GASTO, máquina de estados
 * PROPIA de Gastos (separada de TRANSICIONES_FONDO en fondos.ts, porque
 * sus estados no son idénticos — sin "Liquidada" aquí). Un histórico
 * (`estado IS NULL`) se rechaza explícitamente: nunca se convierte
 * silenciosamente a "Pendiente" (eso sería un backfill implícito, fuera
 * de alcance). Compartido por autorizarGasto/rechazarGasto para no
 * duplicar el bloqueo/validación de transición.
 */
async function bloquearGastoParaTransicionTx(
  conn: PoolConnection,
  empresaId: number,
  id: number,
  destino: EstadoGasto,
): Promise<{ estadoActual: EstadoGasto; requirenteUsuarioId: number | null; solicitanteUsuarioId: number | null; creadoPor: string | null } | null> {
  const rows = await queryConn<RowDataPacket[]>(conn,
    `SELECT id, estado, requirente_usuario_id, solicitante_usuario_id, creado_por
     FROM tms_gastos_operativos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
    [id, empresaId],
  );
  if (!rows[0]) return null;
  if (rows[0].estado == null) {
    throw new ErrorGasto("Este gasto es histórico y no tiene flujo de autorización.", 409);
  }
  const estadoActual = String(rows[0].estado) as EstadoGasto;
  if (!TRANSICIONES_GASTO[estadoActual].includes(destino)) {
    throw new ErrorGasto(`No se puede pasar de "${estadoActual}" a "${destino}".`, 409);
  }
  return {
    estadoActual,
    requirenteUsuarioId: rows[0].requirente_usuario_id != null ? Number(rows[0].requirente_usuario_id) : null,
    solicitanteUsuarioId: rows[0].solicitante_usuario_id != null ? Number(rows[0].solicitante_usuario_id) : null,
    creadoPor: rows[0].creado_por != null ? String(rows[0].creado_por) : null,
  };
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — autoriza un gasto Pendiente. Mismo
 * criterio EXACTO que cambiarEstadoSolicitudFondo en fondos.ts: exige la
 * firma manuscrita real de "Mi firma" del autorizante (`opts.firmaImagen`,
 * ya leída por el endpoint vía leerBytesFirmaGuardada — nunca deriva la
 * imagen del body) — sin ella se rechaza con
 * MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, ANTES de tocar la base de datos. La
 * copia física de esa firma se escribe ANTES de abrir la transacción
 * (guardarUpload no es transaccional, mismo criterio que
 * guardarImagenFirmaFondo) y se compensa (se borra) si el commit no llega
 * a completarse, por cualquier motivo — mismo mecanismo `committed` que
 * cambiarEstadoSolicitudFondo.
 *
 * `autorizanteUsuarioId`/`autorizanteNombre`/`autorizanteRol` deben venir
 * de la identidad de sesión real (`guard.session`) del endpoint — esta
 * función nunca los deriva del body, los recibe ya resueltos por el
 * caller.
 *
 * Prevención de autoautorización: mismo criterio que Fondos — se
 * rechaza si el autorizante es el requirente, el solicitante, o quien
 * creó el registro (comparando `opts.usuario` contra `creado_por`).
 */
export async function autorizarGasto(
  empresaId: number,
  id: number,
  opts: {
    usuario?: string | null;
    autorizanteUsuarioId: number;
    autorizanteNombre: string;
    autorizanteRol?: string | null;
    autorizanteEmpleadoId?: number | null;
    firmaImagen: { bytes: ArrayBuffer; original: string } | null;
  },
): Promise<GastoOperativo | null> {
  if (!opts.firmaImagen) {
    throw new ErrorGasto(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, 400);
  }
  const imagenGuardada = await guardarImagenFirmaGasto(empresaId, id, "autorizar", opts.firmaImagen);

  let committed = false;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const bloqueo = await bloquearGastoParaTransicionTx(conn, empresaId, id, "Autorizada");
    if (!bloqueo) { await conn.rollback(); return null; }
    await validarEmpleadoDeEmpresaTx(conn, empresaId, opts.autorizanteEmpleadoId, "autorizante");
    const esPropia =
      (bloqueo.requirenteUsuarioId != null && bloqueo.requirenteUsuarioId === opts.autorizanteUsuarioId) ||
      (bloqueo.solicitanteUsuarioId != null && bloqueo.solicitanteUsuarioId === opts.autorizanteUsuarioId) ||
      (bloqueo.creadoPor != null && opts.usuario != null && bloqueo.creadoPor === opts.usuario);
    if (esPropia) {
      throw new ErrorGasto("No puede autorizar su propio gasto.", 403);
    }
    await executeConn(conn,
      `UPDATE tms_gastos_operativos
       SET estado = 'Autorizada', autorizante_empleado_id = ?, autorizante_nombre = ?, autorizante_usuario_id = ?, autorizado_en = NOW()
       WHERE id = ? AND empresa_id = ?`,
      [opts.autorizanteEmpleadoId ?? null, opts.autorizanteNombre, opts.autorizanteUsuarioId, id, empresaId],
    );
    // GASTOS-ADMINISTRATIVO-1 (Fase 5) — snapshot INMUTABLE de la firma
    // real usada AL AUTORIZAR (mismo patrón que AUTORIZAR_FONDO): el PDF
    // individual (leído después, cualquier cantidad de veces) usa esta
    // fila, nunca vuelve a resolver "la firma actual" del usuario.
    await crearFirmaInterna(conn, {
      empresaId, usuarioId: opts.autorizanteUsuarioId, empleadoId: opts.autorizanteEmpleadoId ?? null,
      nombreFirmante: opts.autorizanteNombre, rolFirmante: opts.autorizanteRol ?? "",
      accion: "AUTORIZAR_GASTO", modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO", entidadId: id,
      valoresRelevantes: { gastoId: id },
      imagen: imagenGuardada, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
    });
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: opts.usuario ?? null, accion: "autorizar", modulo: "tms_gastos",
      detalle: `Gasto operativo #${id}: ${bloqueo.estadoActual} -> Autorizada.`,
    });
    await conn.commit();
    committed = true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    if (!committed) borrarUpload(imagenGuardada.relative);
  }
  return obtenerGasto(empresaId, id);
}

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 2) — rechaza un gasto Pendiente. Mismo
 * criterio que Fondos: exige un motivo, nunca se autoautoriza el
 * chequeo (rechazar la propia solicitud no es un conflicto de interés
 * en el mismo sentido que autorizarla — mismo criterio que
 * cambiarEstadoSolicitudFondo, que tampoco lo exige para "Rechazada").
 */
export async function rechazarGasto(
  empresaId: number,
  id: number,
  opts: { usuario?: string | null; motivoRechazo: string },
): Promise<GastoOperativo | null> {
  if (!opts.motivoRechazo?.trim()) throw new Error("El rechazo requiere un motivo.");
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const bloqueo = await bloquearGastoParaTransicionTx(conn, empresaId, id, "Rechazada");
    if (!bloqueo) { await conn.rollback(); return null; }
    await executeConn(conn,
      `UPDATE tms_gastos_operativos SET estado = 'Rechazada', rechazado_en = NOW(), motivo_rechazo = ? WHERE id = ? AND empresa_id = ?`,
      [opts.motivoRechazo.trim(), id, empresaId],
    );
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: opts.usuario ?? null, accion: "rechazar", modulo: "tms_gastos",
      detalle: `Gasto operativo #${id}: ${bloqueo.estadoActual} -> Rechazada. Motivo: ${opts.motivoRechazo.trim()}`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerGasto(empresaId, id);
}
