import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { obtenerVehiculoAccesibleTx } from "@/lib/flota/acceso";
import { canonizarVehiculoTx } from "@/lib/flota/vehiculos-alias";
import { normalizarDestinoPago } from "@/lib/tms/gastos";
import { CAMPOS_DOMINIO_FONDOS } from "@/lib/tms/validacion-fondos-gastos";
import { ErrorDominioFormulario, conLinea } from "@/lib/validacion-formulario";
import {
  INDICE_CLAVE_FONDOS,
  TABLA_FONDOS,
  buscarCreacionPorClave,
  esDuplicadoDeClave,
  huellaSolicitudFondo,
  lectorDeConexion,
  normalizarClaveIdempotencia,
} from "@/lib/tms/idempotencia-envio";
import { destinoPagoEmpleado } from "./destino-pago-empleado";
import { fondosDiariosInstalado } from "./fondos-diarios";
import { nivelDeProteccion, origenDeFila, rechazarOrigenDeCliente, validarEdicionLinea, validarEliminacionLinea, type NivelProteccion } from "./fondo-lineas-protegidas";
import {
  resolverEntidadRequirenteTx,
  resolverRequirenteOperacionesTx,
  resolverSolicitanteOperacionesTx,
  resolverUsuarioDeEmpresaTx,
  validarEmpleadoDeEmpresaTx,
} from "@/lib/tms/identidad-administrativa";

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — solicitudes de fondo (anticipo/caja
 * chica para un viaje u operación), con sus líneas de gasto ESTIMADO.
 * Es un objeto DISTINTO de tms_gastos_operativos (el gasto ya incurrido):
 * una solicitud de fondo es la petición previa de dinero, sus líneas no
 * se copian automáticamente a gastos operativos en esta fase 1.
 *
 * Reutiliza empleados (requirente/autorizante) — no duplica el maestro de
 * personal. Auditoría vía src/lib/auditoria.ts (registrarAuditoriaTx),
 * NO se crea una bitácora paralela.
 *
 * Esquema: NO se crea/altera desde este módulo — asume que
 * sql/migrate-2026-09-tms-gastos-reportes.sql ya se aplicó manualmente.
 */

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}
async function executeConn(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result;
}

function limpiarOverride(valor: string | null | undefined, maximo: number): string | null {
  if (valor == null) return null;
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (!limpio) return null;
  if (limpio.length > maximo) throw new ErrorDominioFormulario(`El valor editado no puede exceder ${maximo} caracteres.`);
  return limpio;
}

/** Identidad real de sesión (nunca username) para una firma de Fondos — ver crearSolicitudFondo/cambiarEstadoSolicitudFondo. */
export type IdentidadFirmante = { usuarioId: number; nombre: string; rol?: string | null };

/**
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — mismo patrón EXACTO que
 * guardarImagenFirma() en src/lib/tms/viaticos.ts: cada USO de la
 * plantilla personal ("Mi firma") genera una COPIA física INDEPENDIENTE
 * (nunca se referencia el archivo de usuario_firmas directamente) — así,
 * cambiar o borrar la plantilla después nunca altera una firma histórica
 * ya guardada en firmas_electronicas.
 */
async function guardarImagenFirmaFondo(
  empresaId: number,
  solicitudId: number,
  accionPrefix: "solicitar" | "requerir" | "autorizar",
  imagen: { bytes: ArrayBuffer; original: string },
): Promise<{ relative: string; original: string; mime: string; size: number; sha256: string }> {
  const guardada = await guardarUpload(empresaId, "firmas", `firma_fondo_${accionPrefix}_${solicitudId}`, {
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

/**
 * SOLICITUD-FONDOS-REPORTE-1 — resuelve el SNAPSHOT de una línea
 * (nombre/cargo del empleado, placa del vehículo, nombre del cliente, y
 * la fecha del viaje) SIEMPRE del lado del servidor, releyendo cada
 * catálogo por (id, empresa_id) dentro de la MISMA transacción — mismo
 * criterio de seguridad que resolverSnapshotRuta en cotizaciones.ts:
 * nombre/cuenta/cargo parten del maestro; solo se aceptan los overrides
 * explícitos, acotados y saneados de esta solicitud. Si algún id no pertenece a esta empresa, se rechaza —
 * nunca se acepta silenciosamente una referencia de otra empresa.
 *
 * `fechaViaje` explícita del caller SIEMPRE gana; si no vino pero sí hay
 * `planId`, se completa con la fecha real de ese plan (nunca al revés:
 * un planId no puede pisar una fecha que el usuario ya escribió a mano).
 */
async function resolverSnapshotLineaTx(
  conn: PoolConnection,
  empresaId: number,
  input: Pick<LineaFondoInput, "empleadoId" | "vehiculoId" | "clienteId" | "planId" | "fechaViaje" | "empleadoNombreOverride" | "cuentaOverride" | "cargoOverride" | "metodoPago">,
): Promise<{ empleadoNombre: string | null; cargo: string | null; cuenta: string | null; placa: string | null; vehiculoId: number | null; clienteId: number | null; clienteNombre: string | null; fechaViaje: string | null }> {
  let empleadoNombre: string | null = null;
  let cargo: string | null = null;
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — `cuenta` es empleados.cuenta_bancaria
  // (fuente oficial YA existente, ver src/lib/rrhh/empleados.ts y
  // viaticos-exportar-banco.ts), congelada aquí como snapshot igual que
  // nombre/puesto — nunca un valor enviado por el cliente HTTP.
  let cuenta: string | null = null;
  if (input.empleadoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre, puesto, cuenta_bancaria, telefono FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [input.empleadoId, empresaId]);
    if (!rows[0]) throw new ErrorDominioFormulario("El empleado indicado no pertenece a esta empresa.");
    empleadoNombre = String(rows[0].nombre);
    cargo = rows[0].puesto != null ? String(rows[0].puesto) : null;
    cuenta = input.metodoPago == null ? (rows[0].cuenta_bancaria != null ? String(rows[0].cuenta_bancaria) : null) : destinoPagoEmpleado(input.metodoPago, {
      cuentaBancaria: rows[0].cuenta_bancaria != null ? String(rows[0].cuenta_bancaria) : null,
      telefono: rows[0].telefono != null ? String(rows[0].telefono) : null,
    }) || null;
    empleadoNombre = limpiarOverride(input.empleadoNombreOverride, 200) ?? empleadoNombre;
    // Cuenta es el destino bancario de esta solicitud y se congela como
    // snapshot. A diferencia de Nombre/Cargo, un override explícitamente
    // vacío también es significativo (p. ej. conservar vacío al editar una
    // solicitud aunque RRHH haya recibido una cuenta posteriormente).
    if (input.cuentaOverride !== undefined && input.cuentaOverride !== null) {
      cuenta = limpiarOverride(input.cuentaOverride, 100);
    }
    cargo = limpiarOverride(input.cargoOverride, 150) ?? cargo;
  }
  let placa: string | null = null;
  // Una operación NUEVA se asocia a la identidad canónica: si el ID enviado fue absorbido por una fusión se guarda su canónico (la historia no se toca).
  const vehiculoId = await canonizarVehiculoTx(conn, empresaId, input.vehiculoId);
  if (vehiculoId != null) {
    // Vehículo PROPIO o COMPARTIDO con la empresa activa (regla real de Flota); nunca «cualquier id». La placa se congela como snapshot; la propiedad no cambia.
    const veh = await obtenerVehiculoAccesibleTx(conn, empresaId, vehiculoId);
    if (!veh) throw new ErrorDominioFormulario("El vehículo indicado no pertenece a esta empresa.");
    placa = String(veh.placa);
  }
  let clienteId = input.clienteId ?? null;
  let clienteNombre: string | null = null;
  if (input.clienteId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [input.clienteId, empresaId]);
    if (!rows[0]) throw new ErrorDominioFormulario("El cliente indicado no pertenece a esta empresa.");
    clienteNombre = String(rows[0].nombre);
  }
  let fechaViaje = input.fechaViaje ?? null;
  if (input.planId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn,
      `SELECT p.cliente_id, c.nombre AS cliente_nombre, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
       WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
      [input.planId, empresaId],
    );
    if (!rows[0]) throw new ErrorDominioFormulario("El viaje indicado no pertenece a esta empresa.");
    if (input.clienteId == null) {
      clienteId = rows[0].cliente_id != null ? Number(rows[0].cliente_id) : null;
      clienteNombre = rows[0].cliente_nombre != null ? String(rows[0].cliente_nombre) : null;
    }
    if (fechaViaje == null) fechaViaje = String(rows[0].fecha_plan);
  }
  return { empleadoNombre, cargo, cuenta, placa, vehiculoId, clienteId, clienteNombre, fechaViaje };
}

export const ESTADOS_FONDO = ["Pendiente", "Autorizada", "Rechazada", "Liquidada"] as const;
export type EstadoFondo = (typeof ESTADOS_FONDO)[number];

/** Pendiente -> Autorizada -> Liquidada, o Rechazada en cualquier punto antes de Liquidada. Nunca hacia atrás. */
const TRANSICIONES_FONDO: Record<EstadoFondo, EstadoFondo[]> = {
  Pendiente: ["Autorizada", "Rechazada"],
  Autorizada: ["Liquidada", "Rechazada"],
  Rechazada: [],
  Liquidada: [],
};

export type LineaFondo = {
  id: number;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  orden: number;
  /**
   * SOLICITUD-FONDOS-REPORTE-1 — relación real (RRHH/Flota/Clientes/
   * viaje) cuando la línea corresponde a una persona/unidad/cliente/viaje
   * concreto, MÁS su valor SNAPSHOT (nombre/cargo/placa/nombre de
   * cliente) resuelto y congelado por el servidor al crear la línea
   * (resolverSnapshotLineaTx más abajo) — nunca un valor enviado por el
   * cliente HTTP. El reporte (reportes-gastos.ts) lee el snapshot, nunca
   * hace JOIN en vivo a los catálogos, para que un cambio posterior de
   * nombre/placa no altere una solicitud ya emitida.
   */
  fechaViaje: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  cargo: string | null;
  /** SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — snapshot de empleados.cuenta_bancaria, ver resolverSnapshotLineaTx. */
  cuenta: string | null;
  /**
   * FONDOS-GASTOS-METODO-PAGO-1 — método de pago de ESTA línea (mismo
   * catálogo que Gastos, METODOS_PAGO_GASTO en gastos.ts). No es un
   * snapshot derivado de otro catálogo: se elige directamente por línea,
   * igual que categoria/descripcion. Determina si `cuenta` se interpreta
   * como cuenta bancaria o como número de transferencia móvil — la
   * ETIQUETA (Cuenta/Número) es solo de presentación (ver export-files/
   * fondos-solicitud-pdf/page.tsx), el dato vive únicamente aquí.
   */
  metodoPago: string | null;
  vehiculoId: number | null;
  placa: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  planId: number | null;
  /** FONDOS DIARIOS — 'AUTO_VIATICO' = línea generada desde Programación (solo método de pago y cuenta editables); null = manual. */
  origen?: string | null;
  /** FONDOS DIARIOS — viático (tms_viaticos.id) de origen de una línea automática. */
  viaticoId?: number | null;
};

export type SolicitudFondo = {
  id: number;
  empresaId: number;
  codigo: string;
  /** FONDOS DIARIOS — 'DIARIA' = consolidada por (fecha, empresa requirente) desde Programación; 'MANUAL' = creada a mano. Ausente si la migración no está aplicada. */
  origen?: "MANUAL" | "DIARIA";
  /** FONDOS DIARIOS — 'COMPLEMENTARIA' = excepcional, ligada a una principal ya autorizada. */
  tipo?: "PRINCIPAL" | "COMPLEMENTARIA";
  solicitudPrincipalId?: number | null;
  entidadRequirenteId?: number | null;
  entidadRequirenteNombre?: string | null;
  requirenteEmpleadoId: number | null;
  requirenteNombre: string | null;
  /** SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — usuarios.id del requirente SOLO cuando se seleccionó del catálogo (ver §3 del ticket); su firma histórica vive en firmas_electronicas (accion='REQUERIR_FONDO'). */
  requirenteUsuarioId: number | null;
  fechaRequerimiento: string;
  total: number;
  autorizanteEmpleadoId: number | null;
  autorizanteNombre: string | null;
  /** usuarios.id de quien autorizó (sesión, nunca del cliente) — su firma histórica vive en firmas_electronicas (accion='AUTORIZAR_FONDO'). */
  autorizanteUsuarioId: number | null;
  estado: EstadoFondo;
  autorizadoEn: string | null;
  rechazadoEn: string | null;
  motivoRechazo: string | null;
  liquidadoEn: string | null;
  observaciones: string | null;
  creadoPor: string | null;
  /** usuarios.id de quien creó la solicitud — su firma histórica vive en firmas_electronicas (accion='SOLICITAR_FONDO'). */
  solicitanteUsuarioId: number | null;
  /** Nombre real (usuarios.nombre) snapshot al crear — nunca el username de creadoPor. */
  solicitanteNombre: string | null;
  creadoEn: string | null;
  lineas: LineaFondo[];
};

function mapLinea(r: RowDataPacket): LineaFondo {
  return {
    id: Number(r.id),
    categoria: String(r.categoria),
    descripcion: r.descripcion != null ? String(r.descripcion) : null,
    cantidad: Number(r.cantidad ?? 1),
    monto: Number(r.monto ?? 0),
    orden: Number(r.orden ?? 0),
    fechaViaje: (r.fecha_viaje_txt ?? r.fecha_viaje) != null ? String(r.fecha_viaje_txt ?? r.fecha_viaje) : null,
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
    cargo: r.cargo != null ? String(r.cargo) : null,
    cuenta: r.cuenta != null ? String(r.cuenta) : null,
    metodoPago: r.metodo_pago != null ? String(r.metodo_pago) : null,
    vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
    placa: r.placa != null ? String(r.placa) : null,
    clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
    clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
    origen: r.origen != null ? String(r.origen) : null,
    viaticoId: r.viatico_id != null ? Number(r.viatico_id) : null,
  };
}

/**
 * FONDOS DIARIOS — datos de la solicitud que solo existen con la migración (origen, tipo, principal). Una consulta aparte (y solo si la migración está aplicada) evita
 * cambiar el SELECT base: sin la migración todo funciona exactamente como antes.
 */
async function anexarDatosDiarios<T extends Omit<SolicitudFondo, "lineas">>(empresaId: number, solicitudes: T[]): Promise<T[]> {
  if (!solicitudes.length || !(await fondosDiariosInstalado())) return solicitudes;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, origen, tipo, solicitud_principal_id FROM tms_solicitudes_fondo WHERE empresa_id = ? AND id IN (${solicitudes.map(() => "?").join(",")})`,
    [empresaId, ...solicitudes.map((s) => s.id)],
  );
  const porId = new Map((Array.isArray(rows) ? rows : []).map((r) => [Number(r.id), r]));
  return solicitudes.map((s) => {
    const r = porId.get(s.id);
    if (!r || r.origen == null) return s;
    return { ...s, origen: String(r.origen) as "MANUAL" | "DIARIA", tipo: String(r.tipo) as "PRINCIPAL" | "COMPLEMENTARIA", solicitudPrincipalId: r.solicitud_principal_id != null ? Number(r.solicitud_principal_id) : null };
  });
}

function mapSolicitud(r: RowDataPacket): Omit<SolicitudFondo, "lineas"> {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    codigo: String(r.codigo),
    entidadRequirenteId: r.entidad_requirente_id != null ? Number(r.entidad_requirente_id) : null,
    entidadRequirenteNombre: r.entidad_requirente_nombre != null ? String(r.entidad_requirente_nombre) : null,
    requirenteEmpleadoId: r.requirente_empleado_id != null ? Number(r.requirente_empleado_id) : null,
    requirenteNombre: r.requirente_nombre != null ? String(r.requirente_nombre) : null,
    requirenteUsuarioId: r.requirente_usuario_id != null ? Number(r.requirente_usuario_id) : null,
    fechaRequerimiento: String(r.fecha_requerimiento),
    total: Number(r.total ?? 0),
    autorizanteEmpleadoId: r.autorizante_empleado_id != null ? Number(r.autorizante_empleado_id) : null,
    autorizanteNombre: r.autorizante_nombre != null ? String(r.autorizante_nombre) : null,
    autorizanteUsuarioId: r.autorizante_usuario_id != null ? Number(r.autorizante_usuario_id) : null,
    estado: String(r.estado) as EstadoFondo,
    autorizadoEn: r.autorizado_en != null ? String(r.autorizado_en) : null,
    rechazadoEn: r.rechazado_en != null ? String(r.rechazado_en) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
    liquidadoEn: r.liquidado_en != null ? String(r.liquidado_en) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    solicitanteUsuarioId: r.solicitante_usuario_id != null ? Number(r.solicitante_usuario_id) : null,
    solicitanteNombre: r.solicitante_nombre != null ? String(r.solicitante_nombre) : null,
    creadoEn: r.creado_en != null ? String(r.creado_en) : null,
  };
}

const SELECT_SOLICITUD = `
  SELECT s.id, s.empresa_id, s.codigo, s.entidad_requirente_id, s.entidad_requirente_nombre, s.requirente_empleado_id,
         COALESCE(s.requirente_nombre, req.nombre) AS requirente_nombre,
         s.requirente_usuario_id,
         DATE_FORMAT(s.fecha_requerimiento, '%Y-%m-%d') AS fecha_requerimiento,
         s.total, s.autorizante_empleado_id,
         COALESCE(s.autorizante_nombre, aut.nombre) AS autorizante_nombre,
         s.autorizante_usuario_id,
         s.estado, s.autorizado_en, s.rechazado_en, s.motivo_rechazo, s.liquidado_en,
         s.observaciones, s.creado_por, s.solicitante_usuario_id, s.solicitante_nombre, s.creado_en
  FROM tms_solicitudes_fondo s
  LEFT JOIN empleados req ON req.id = s.requirente_empleado_id AND req.empresa_id = s.empresa_id
  LEFT JOIN empleados aut ON aut.id = s.autorizante_empleado_id AND aut.empresa_id = s.empresa_id
`;

export type FiltrosFondos = {
  estado?: EstadoFondo;
  fechaDesde?: string;
  fechaHasta?: string;
  /**
   * REPORTES-FONDOS-PDF-TABULAR-1 — filtro "Requirente" del listado en
   * pantalla. Antes solo lo aplicaban las exportaciones (condicionesFondos
   * en reportes-gastos.ts, sobre s.requirente_usuario_id); el listado lo
   * ignoraba en silencio y la pantalla lo simulaba filtrando en el
   * cliente. Misma columna, mismo criterio — sin duplicar esa lógica, solo
   * se replica la MISMA condición aquí para que ambos caminos coincidan.
   */
  requirenteUsuarioId?: number;
};

export async function listarSolicitudesFondo(
  empresaId: number,
  filtros: FiltrosFondos = {},
): Promise<SolicitudFondo[]> {
  const condiciones = ["s.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtros.estado) { condiciones.push("s.estado = ?"); params.push(filtros.estado); }
  if (filtros.fechaDesde) { condiciones.push("s.fecha_requerimiento >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("s.fecha_requerimiento <= ?"); params.push(filtros.fechaHasta); }
  if (filtros.requirenteUsuarioId) { condiciones.push("s.requirente_usuario_id = ?"); params.push(filtros.requirenteUsuarioId); }
  const rows = await query<RowDataPacket[]>(
    `${SELECT_SOLICITUD} WHERE ${condiciones.join(" AND ")} ORDER BY s.fecha_requerimiento DESC, s.id DESC`,
    params,
  );
  return (await anexarDatosDiarios(empresaId, rows.map((r) => mapSolicitud(r)))).map((s) => ({ ...s, lineas: [] }));
}

export async function obtenerSolicitudFondo(empresaId: number, id: number): Promise<SolicitudFondo | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_SOLICITUD} WHERE s.id = ? AND s.empresa_id = ? LIMIT 1`, [id, empresaId]);
  if (!rows[0]) return null;
  // `*` (con la fecha formateada aparte): trae también `origen` y `viatico_id` cuando la migración de fondos diarios está aplicada, sin romper si no lo está.
  const lineas = await query<RowDataPacket[]>(
    `SELECT l.*, DATE_FORMAT(l.fecha_viaje, '%Y-%m-%d') AS fecha_viaje_txt
     FROM tms_solicitud_fondo_lineas l
     WHERE l.empresa_id = ? AND l.solicitud_id = ? ORDER BY l.orden, l.id`,
    [empresaId, id],
  );
  const [solicitud] = await anexarDatosDiarios(empresaId, [mapSolicitud(rows[0])]);
  return { ...solicitud, lineas: lineas.map(mapLinea) };
}

export type LineaFondoInput = {
  /**
   * FONDOS FASE 1 — SOLO en edición: identificador de una línea YA guardada de ESTA solicitud. Con id la línea se actualiza en su sitio
   * (conserva su identidad, necesaria para los vínculos de Combustible/CB2); sin id se inserta como línea nueva. El id se valida contra la
   * solicitud y la empresa dentro de la transacción: nunca se confía en él. Las líneas guardadas que no vengan en la lista se retiran.
   */
  id?: number | null;
  categoria: string;
  descripcion?: string | null;
  cantidad?: number;
  monto: number;
  /**
   * SOLICITUD-FONDOS-REPORTE-1 — relaciones OPCIONALES cuando la línea
   * corresponde a una persona/unidad/cliente/viaje concreto (mantener
   * relaciones internas cuando existan, pedido explícito del ticket). El
   * servidor resuelve y congela el snapshot legible (nombre/cargo/placa/
   * cliente) a partir de estos ids. Nombre/cuenta/cargo pueden llevar un
   * override controlado que afecta únicamente el snapshot de esta línea.
   */
  fechaViaje?: string | null;
  empleadoId?: number | null;
  vehiculoId?: number | null;
  clienteId?: number | null;
  planId?: number | null;
  /** Overrides del snapshot de esta solicitud; nunca actualizan el maestro de empleados. */
  empleadoNombreOverride?: string | null;
  cuentaOverride?: string | null;
  cargoOverride?: string | null;
  /** FONDOS-GASTOS-METODO-PAGO-1 — ver LineaFondo.metodoPago. */
  metodoPago?: string | null;
};

export type SolicitudFondoInput = {
  entidadRequirenteId?: number;
  requirenteEmpleadoId?: number | null;
  requirenteNombre?: string | null;
  /**
   * Nuevas solicitudes requieren usuario de Operaciones del tenant.
   * El tipo opcional conserva compatibilidad de lectura/edición de históricos;
   * no habilita nuevas identidades de texto libre o empleados sin usuario.
   */
  requirenteUsuarioId?: number | null;
  /** Usuario de Operaciones que solicita el fondo; se elige explícitamente y nunca se infiere de la sesión. */
  solicitanteUsuarioId?: number | null;
  fechaRequerimiento: string;
  observaciones?: string | null;
  /**
   * Clave de envío (idempotencia), OPCIONAL durante la primera ventana de despliegue: sin ella se crea como siempre; con
   * ella, un reintento con el mismo contenido devuelve la creación original y con otro contenido responde 409.
   * Ver src/lib/tms/idempotencia-envio.ts.
   */
  claveIdempotencia?: string | null;
  lineas: LineaFondoInput[];
};

function calcularTotal(lineas: LineaFondoInput[]): number {
  return lineas.reduce((s, l) => s + (l.cantidad ?? 1) * l.monto, 0);
}

/**
 * `solicitante` (§1 del ticket) — identidad REAL de sesión (nunca
 * derivada del cliente): resuelta por el endpoint desde `guard.session`,
 * nunca opcional en producción (el POST siempre está autenticado), pero
 * se deja opcional en la firma de la función para no romper llamadores
 * existentes que todavía no la pasan (tests) — sin ella, la solicitud se
 * crea igual, simplemente sin snapshot de firma del solicitante (§1: "si
 * todavía no existe flujo de firma para alguno, no inventar una firma").
 */
export async function crearSolicitudFondo(
  empresaId: number,
  input: SolicitudFondoInput,
  creadoPor?: string | null,
  solicitanteLegado?: IdentidadFirmante | null,
): Promise<SolicitudFondo> {
  if (!input.fechaRequerimiento) throw new ErrorDominioFormulario("Fecha de requerimiento requerida.");
  if (!input.requirenteEmpleadoId && !input.requirenteUsuarioId && !input.requirenteNombre?.trim()) {
    throw new ErrorDominioFormulario("Requirente requerido: selecciona un usuario de Operaciones.");
  }
  if (!input.lineas.length) throw new ErrorDominioFormulario("La solicitud necesita al menos una línea de gasto.");
  for (const [i, l] of input.lineas.entries()) {
    rechazarOrigenDeCliente(l, i + 1);   // el origen de una línea jamás lo decide el cliente
    if (!l.categoria) throw new ErrorDominioFormulario("Cada línea necesita una categoría.");
    if (!(l.monto > 0)) throw new ErrorDominioFormulario("Cada línea necesita un monto mayor a cero.");
  }
  const total = calcularTotal(input.lineas);

  // IDEMPOTENCIA — la consulta previa va ANTES de abrir la transacción y de las validaciones de referencias: reintentar una
  // creación ya confirmada debe devolverla aunque, entretanto, el requirente/solicitante haya dejado de estar activo.
  const clave = normalizarClaveIdempotencia(input.claveIdempotencia);
  const huella = clave ? huellaSolicitudFondo(input) : null;
  let claveEfectiva = clave;
  if (clave) {
    const previa = await buscarCreacionPorClave((sql, params) => query<RowDataPacket[]>(sql, params), TABLA_FONDOS, empresaId, clave, huella!);
    if (previa.tipo === "existente") return recuperarSolicitudCreada(empresaId, previa.id);
    // Migración sin aplicar: se crea en modo legado (sin protección) en vez de fallar la operación.
    if (previa.tipo === "sin_soporte") claveEfectiva = null;
  }

  const conn = await getPool().getConnection();
  let solicitudId = 0;
  let reutilizadaId: number | null = null;
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — copias físicas de firma escritas
  // dentro de este intento; si algo falla y se hace rollback, se borran
  // (best-effort) para no dejar archivos huérfanos sin fila que los
  // referencie — mismo principio que compensarImagenFirma() en viaticos.ts.
  const archivosFirmaEscritos: string[] = [];
  try {
    await conn.beginTransaction();
    const entidadRequirente = input.entidadRequirenteId == null
      ? null
      : await resolverEntidadRequirenteTx(conn, empresaId, input.entidadRequirenteId);
    await validarEmpleadoDeEmpresaTx(conn, empresaId, input.requirenteEmpleadoId, "requirente");

    // Requirente nuevo: usuario activo de Operaciones con acceso al tenant.
    // El servidor obtiene el nombre; nunca utiliza el texto enviado.
    const requirenteUsuario = await resolverRequirenteOperacionesTx(conn, empresaId, input);
    const solicitanteId = input.solicitanteUsuarioId ?? solicitanteLegado?.usuarioId ?? null;
    const solicitanteUsuario = solicitanteId == null ? null
      : input.solicitanteUsuarioId != null
        ? await resolverSolicitanteOperacionesTx(conn, empresaId, solicitanteId)
        : await resolverUsuarioDeEmpresaTx(conn, empresaId, solicitanteId);
    if (solicitanteId != null && !solicitanteUsuario) throw new ErrorDominioFormulario("El usuario solicitante indicado no pertenece a esta empresa.");

    const r = await executeConn(conn,
      `INSERT INTO tms_solicitudes_fondo
        (empresa_id, codigo, entidad_requirente_id, entidad_requirente_nombre, requirente_empleado_id, requirente_nombre, requirente_usuario_id,
         fecha_requerimiento, total, observaciones, creado_por, solicitante_usuario_id, solicitante_nombre${claveEfectiva ? ", clave_idempotencia, huella_idempotencia" : ""})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${claveEfectiva ? ", ?, ?" : ""})`,
      [
        empresaId,
        // Marcador ÚNICO por transacción (mismo criterio que crearGasto): se reemplaza abajo por FONDO-<id>. Un marcador
        // común ("") hacía que dos creaciones simultáneas de la misma empresa compitieran por el UNIQUE (empresa_id, codigo)
        // y terminaran en deadlock — verificado contra MariaDB con peticiones concurrentes.
        `TMP-${randomBytes(12).toString("hex")}`,
        entidadRequirente?.id ?? null,
        entidadRequirente?.nombre ?? null,
        input.requirenteEmpleadoId ?? null,
        requirenteUsuario ? requirenteUsuario.nombre : (input.requirenteNombre?.trim() || null),
        input.requirenteUsuarioId ?? null,
        input.fechaRequerimiento,
        total,
        input.observaciones?.trim() || null,
        creadoPor ?? null,
        solicitanteId,
        solicitanteUsuario?.nombre ?? solicitanteLegado?.nombre ?? null,
        ...(claveEfectiva ? [claveEfectiva, huella] : []),
      ],
    );
    solicitudId = Number(r.insertId);
    const codigo = `FONDO-${String(solicitudId).padStart(6, "0")}`;
    await executeConn(conn, `UPDATE tms_solicitudes_fondo SET codigo = ? WHERE id = ? AND empresa_id = ?`, [codigo, solicitudId, empresaId]);
    let orden = 0;
    for (const [indice, l] of input.lineas.entries()) {
      // Un error de negocio de ESTA fila (empleado/unidad/cliente/viaje inexistente, cuenta móvil inválida) indica la línea.
      let snapshot: Awaited<ReturnType<typeof resolverSnapshotLineaTx>>;
      let cuenta: string | null;
      try {
        snapshot = await resolverSnapshotLineaTx(conn, empresaId, l);
        cuenta = normalizarDestinoPago(l.metodoPago ?? null, snapshot.cuenta);
      } catch (e) {
        throw conLinea(e, indice + 1, "lineas", "Línea", CAMPOS_DOMINIO_FONDOS);
      }
      await executeConn(conn,
        `INSERT INTO tms_solicitud_fondo_lineas
          (empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
           fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, metodo_pago, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId, solicitudId, l.categoria, l.descripcion?.trim() || null, l.cantidad ?? 1, l.monto, orden,
          snapshot.fechaViaje, l.empleadoId ?? null, snapshot.empleadoNombre, snapshot.cargo, cuenta, l.metodoPago ?? null,
          snapshot.vehiculoId, snapshot.placa, snapshot.clienteId, snapshot.clienteNombre, l.planId ?? null,
        ],
      );
      orden += 1;
    }

    // §1/§3 del ticket — firma del SOLICITANTE (siempre que tenga "Mi
    // firma" guardada) y del REQUIRIENTE (solo si se asoció un usuario
    // real) — BEST-EFFORT: a diferencia de autorizar, NUNCA bloquea la
    // creación por falta de firma; sin ella, el PDF muestra el nombre +
    // espacio en blanco (§3/§5: "no inventar una firma").
    if (solicitanteId) {
      const bytes = await leerBytesFirmaGuardada(solicitanteId);
      if (bytes) {
        const imagen = await guardarImagenFirmaFondo(empresaId, solicitudId, "solicitar", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: solicitanteId, empleadoId: null,
          nombreFirmante: solicitanteUsuario?.nombre ?? solicitanteLegado?.nombre ?? "", rolFirmante: solicitanteUsuario?.rol ?? solicitanteLegado?.rol ?? "",
          accion: "SOLICITAR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO", entidadId: solicitudId,
          valoresRelevantes: { solicitudId, codigo, total },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }
    if (input.requirenteUsuarioId != null && requirenteUsuario) {
      const bytes = await leerBytesFirmaGuardada(input.requirenteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaFondo(empresaId, solicitudId, "requerir", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: input.requirenteUsuarioId, empleadoId: null,
          nombreFirmante: requirenteUsuario.nombre, rolFirmante: requirenteUsuario.rol ?? "",
          accion: "REQUERIR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO", entidadId: solicitudId,
          valoresRelevantes: { solicitudId, codigo, total },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: creadoPor ?? null,
      accion: "crear",
      modulo: "tms_fondos",
      detalle: `Solicitud de fondo #${solicitudId} ${codigo} creada por Q${total.toFixed(2)}.`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    for (const relative of archivosFirmaEscritos) borrarUpload(relative);
    // CONCURRENCIA — otra petición con la MISMA clave confirmó primero y el UNIQUE (empresa_id, clave) rechazó este INSERT:
    // tras el rollback se relee (instantánea nueva) y se devuelve esa creación; si el contenido difiere, 409.
    if (claveEfectiva && esDuplicadoDeClave(error, INDICE_CLAVE_FONDOS)) {
      const previa = await buscarCreacionPorClave(lectorDeConexion(conn), TABLA_FONDOS, empresaId, claveEfectiva, huella!);
      if (previa.tipo !== "existente") throw error;
      reutilizadaId = previa.id;
    } else {
      throw error;
    }
  } finally {
    conn.release();
  }
  return recuperarSolicitudCreada(empresaId, reutilizadaId ?? solicitudId);
}

async function recuperarSolicitudCreada(empresaId: number, id: number): Promise<SolicitudFondo> {
  const creada = await obtenerSolicitudFondo(empresaId, id);
  if (!creada) throw new Error("No se pudo crear la solicitud de fondo.");
  return creada;
}

export type SolicitudFondoUpdate = {
  entidadRequirenteId?: number;
  fechaRequerimiento?: string;
  requirenteEmpleadoId?: number | null;
  requirenteNombre?: string | null;
  /** SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3) — mismo criterio que en crearSolicitudFondo: opcional, resuelto/validado contra esta empresa, y captura una nueva firma snapshot (REQUERIR_FONDO) si el usuario seleccionado tiene "Mi firma" guardada. */
  requirenteUsuarioId?: number | null;
  solicitanteUsuarioId?: number | null;
  observaciones?: string | null;
  /**
   * SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — si viene,
   * REEMPLAZA por completo las líneas actuales (se borran y se insertan
   * de nuevo, cada una con su propio snapshot resuelto por
   * resolverSnapshotLineaTx — mismo criterio de seguridad que al crear:
   * nunca se acepta un snapshot enviado por el cliente HTTP) y el total
   * se recalcula. Si NO viene, ni las líneas ni el total se tocan.
   */
  lineas?: LineaFondoInput[];
};

/**
 * FONDOS FASE 1 — actualización DIFERENCIAL de las líneas de una solicitud Pendiente, en DOS fases dentro de la transacción del llamador:
 *   1) `planificarLineasTx` (SOLO LECTURA): relee las líneas FOR UPDATE por (empresa, solicitud), valida todo y calcula los valores finales y el total.
 *      Se ejecuta ANTES de escribir nada (ni siquiera el encabezado): un rechazo no ha tocado ningún registro.
 *   2) `aplicarLineasTx` (escritura): borra las retiradas y actualiza/inserta lo que cambió.
 *
 * Reglas:
 *  · Con `id`: la línea se actualiza en su sitio SOLO si algo cambió; su identificador no cambia (Combustible y CB2 apuntan a él). El id debe pertenecer a
 *    ESTA solicitud y ESTA empresa. Sin `id`: línea nueva (siempre manual: el origen jamás lo decide el cliente).
 *  · Un cliente que no envía NINGÚN id sobre una solicitud que ya tiene líneas no identifica cuáles conservar: se RECHAZA antes de escribir
 *    (nunca se sustituyen en silencio las líneas originales).
 *  · Las líneas guardadas que no aparecen en la lista se retiran, salvo las automáticas y las vinculadas a Combustible/CB2 (rechazo controlado).
 *  · Líneas automáticas y vinculadas: ver fondo-lineas-protegidas.ts. Sus campos protegidos salen SIEMPRE de la fila guardada, nunca de lo enviado, y
 *    el `orden` de una automática nunca lo decide el cliente. Cuenta y método de pago solo se recalculan si el cliente los cambia explícitamente.
 *  · El total se calcula de los valores FINALES (no de lo enviado).
 */
export const MENSAJE_LINEAS_SIN_ID =
  "Esta solicitud ya tiene líneas guardadas y el envío no identifica ninguna de ellas, así que no se sabe cuáles conservar. Recarga la pantalla y vuelve a editarla. No se guardó ningún cambio.";

/** Vínculos que apuntan a una línea. Ambos módulos son OPCIONALES (pueden no estar instalados), pero si existen su estructura debe ser la esperada. */
const VINCULOS_A_LINEAS = [
  { tabla: "flota_combustible_cargas", columna: "solicitud_fondo_linea_id", modulo: "Combustible" },
  { tabla: "flota_cb2_fondos_vinculos", columna: "linea_id", modulo: "CB2" },
] as const;

const esViolacionFkReferenciada = (e: unknown) => {
  const x = e as { errno?: number; code?: string } | null;
  return x?.errno === 1451 || x?.code === "ER_ROW_IS_REFERENCED_2" || x?.code === "ER_ROW_IS_REFERENCED";
};

/** Errores de privilegios de MariaDB/MySQL: la tabla puede EXISTIR pero este usuario no la ve ni la puede leer (1044 db, 1142 tabla, 1143 columna, 1045 acceso). */
const CODIGOS_SIN_PRIVILEGIO = new Set([1044, 1045, 1142, 1143]);
const errnoDe = (e: unknown): number | null => {
  const x = e as { errno?: number; code?: string } | null;
  if (typeof x?.errno === "number") return x.errno;
  const porCodigo: Record<string, number> = { ER_NO_SUCH_TABLE: 1146, ER_BAD_FIELD_ERROR: 1054, ER_TABLEACCESS_DENIED_ERROR: 1142, ER_COLUMNACCESS_DENIED_ERROR: 1143, ER_DBACCESS_DENIED_ERROR: 1044, ER_ACCESS_DENIED_ERROR: 1045 };
  return x?.code ? porCodigo[x.code] ?? null : null;
};
const detener = (mensaje: string) => new ErrorDominioFormulario(`${mensaje} No se guardó ningún cambio; avisa a soporte.`, 409);

/**
 * Ids (entre `ids`) con vales de Combustible o vínculos CB2. La verificación NO se apoya en que `information_schema` «parezca completo»: ese catálogo solo
 * muestra lo que el usuario de la base puede ver, así que una respuesta vacía no prueba que un módulo no exista. La fuente de verdad es una SONDA REAL
 * (la propia consulta de vínculos) y se distinguen cuatro situaciones:
 *  · la sonda responde → hay datos reales (aunque information_schema no la liste);
 *  · error «tabla inexistente» (1146) → el módulo NO está instalado, pero solo se acepta si information_schema tampoco la lista y VE las tablas propias
 *    del módulo de Fondos (si no las ve, su silencio no demuestra nada);
 *  · «columna inexistente» (1054) → la tabla existe con otra estructura: no se puede comprobar la integridad;
 *  · errores de privilegios (1044/1045/1142/1143) → la tabla puede existir y este usuario no la ve: visibilidad insuficiente;
 *  · cualquier otro error se propaga tal cual.
 * Ante incertidumbre se DETIENE la operación antes de modificar o eliminar nada (no se asume que las FK impidan cambios de monto, beneficiario o categoría).
 */
async function lineasConVinculosTx(conn: PoolConnection, empresaId: number, ids: number[]): Promise<Set<number>> {
  const vinculadas = new Set<number>();
  if (!ids.length) return vinculadas;
  const marcas = ids.map(() => "?").join(",");
  for (const v of VINCULOS_A_LINEAS) {
    let filas: RowDataPacket[];
    try {
      filas = await queryConn<RowDataPacket[]>(conn, `SELECT DISTINCT ${v.columna} AS linea_id FROM ${v.tabla} WHERE empresa_id = ? AND ${v.columna} IN (${marcas})`, [empresaId, ...ids]);
    } catch (e) {
      const errno = errnoDe(e);
      if (errno === 1146) {
        const propias = await queryConn<RowDataPacket[]>(conn,
          "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_solicitud_fondo_lineas')");
        if (Number(propias[0]?.n ?? 0) !== 2) {
          throw detener(`No se puede verificar los vínculos con ${v.modulo}: el usuario de la base no tiene visibilidad suficiente para confirmar que ${v.tabla} no existe.`);
        }
        const listada = await queryConn<RowDataPacket[]>(conn, "SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1", [v.tabla]);
        if (listada[0]) throw detener(`No se puede verificar los vínculos con ${v.modulo}: ${v.tabla} aparece en el catálogo pero no responde.`);
        continue;   // módulo opcional realmente no instalado
      }
      if (errno === 1054) throw detener(`No se puede verificar la integridad de los vínculos con ${v.modulo}: la estructura de ${v.tabla} no es la esperada.`);
      if (errno != null && CODIGOS_SIN_PRIVILEGIO.has(errno)) {
        throw detener(`No se puede verificar los vínculos con ${v.modulo}: el usuario de la base no tiene visibilidad suficiente sobre ${v.tabla}.`);
      }
      throw e;
    }
    for (const r of filas) vinculadas.add(Number(r.linea_id));
  }
  return vinculadas;
}

const fechaDeFila = (r: RowDataPacket): string | null => {
  const v = r.fecha_viaje_txt ?? r.fecha_viaje;
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
};
const cadena = (v: unknown): string | null => (v == null ? null : String(v));
const num2 = (v: unknown): string => Number(v ?? 0).toFixed(2);
const idONull = (v: unknown): number | null => (v == null ? null : Number(v));

type ValoresFinales = {
  categoria: string; descripcion: string | null; cantidad: number; monto: number; orden: number; fechaViaje: string | null;
  empleadoId: number | null; empleadoNombre: string | null; cargo: string | null; cuenta: string | null; metodoPago: string | null;
  vehiculoId: number | null; placa: string | null; clienteId: number | null; clienteNombre: string | null; planId: number | null;
};
type OperacionLinea = { fila: RowDataPacket | null; v: ValoresFinales };
type PlanLineas = { total: number; retiradas: number[]; operaciones: OperacionLinea[] };

const valoresDeFila = (r: RowDataPacket): ValoresFinales => ({
  categoria: String(r.categoria), descripcion: cadena(r.descripcion), cantidad: Number(r.cantidad ?? 1), monto: Number(r.monto ?? 0), orden: Number(r.orden ?? 0), fechaViaje: fechaDeFila(r),
  empleadoId: idONull(r.empleado_id), empleadoNombre: cadena(r.empleado_nombre), cargo: cadena(r.cargo), cuenta: cadena(r.cuenta), metodoPago: cadena(r.metodo_pago),
  vehiculoId: idONull(r.vehiculo_id), placa: cadena(r.placa), clienteId: idONull(r.cliente_id), clienteNombre: cadena(r.cliente_nombre), planId: idONull(r.plan_id),
});
const iguales = (a: ValoresFinales, b: ValoresFinales) =>
  a.categoria === b.categoria && a.descripcion === b.descripcion && num2(a.cantidad) === num2(b.cantidad) && num2(a.monto) === num2(b.monto) && a.orden === b.orden
  && a.fechaViaje === b.fechaViaje && a.empleadoId === b.empleadoId && a.empleadoNombre === b.empleadoNombre && a.cargo === b.cargo && a.cuenta === b.cuenta
  && a.metodoPago === b.metodoPago && a.vehiculoId === b.vehiculoId && a.placa === b.placa && a.clienteId === b.clienteId && a.clienteNombre === b.clienteNombre && a.planId === b.planId;

async function planificarLineasTx(conn: PoolConnection, empresaId: number, solicitudId: number, entradas: LineaFondoInput[]): Promise<PlanLineas> {
  const existentes = await queryConn<RowDataPacket[]>(conn,
    `SELECT l.*, DATE_FORMAT(l.fecha_viaje, '%Y-%m-%d') AS fecha_viaje_txt
     FROM tms_solicitud_fondo_lineas l WHERE l.empresa_id = ? AND l.solicitud_id = ? ORDER BY l.orden, l.id FOR UPDATE`,
    [empresaId, solicitudId],
  );
  const porId = new Map(existentes.map((r) => [Number(r.id), r]));

  // 1) Identificadores recibidos: de ESTA solicitud y empresa, sin repetirse; y nunca origen enviado por el cliente.
  const usados = new Set<number>();
  entradas.forEach((l, i) => {
    rechazarOrigenDeCliente(l, i + 1);
    if (l.id == null) return;
    if (!Number.isInteger(l.id) || l.id <= 0 || !porId.has(l.id)) throw new ErrorDominioFormulario(`Línea ${i + 1}: el identificador de la línea no pertenece a esta solicitud.`);
    if (usados.has(l.id)) throw new ErrorDominioFormulario(`Línea ${i + 1}: la misma línea aparece más de una vez.`);
    usados.add(l.id);
  });
  // Cliente que no identifica ninguna línea guardada: ambiguo → rechazo ANTES de escribir (nada se sustituye en silencio).
  if (existentes.length && entradas.every((l) => l.id == null)) throw new ErrorDominioFormulario(MENSAJE_LINEAS_SIN_ID);

  // 2) Nivel de protección de cada línea guardada (origen guardado + vínculos reales).
  const vinculadas = await lineasConVinculosTx(conn, empresaId, existentes.map((r) => Number(r.id)));
  const nivelDe = (r: RowDataPacket) => nivelDeProteccion(origenDeFila(r), vinculadas.has(Number(r.id)));

  // 3) Retiradas: ni automáticas ni vinculadas.
  const retiradas = existentes.filter((r) => !usados.has(Number(r.id)));
  for (const r of retiradas) validarEliminacionLinea(nivelDe(r), Number(r.orden ?? 0) + 1);

  // 4) Orden: las automáticas conservan SIEMPRE el suyo; las demás se numeran a continuación, en el orden recibido.
  const ordenesAuto = existentes.filter((r) => nivelDe(r) === "AUTOMATICA").map((r) => Number(r.orden ?? 0));
  let siguiente = ordenesAuto.length ? Math.max(...ordenesAuto) + 1 : 0;

  const operaciones: OperacionLinea[] = [];
  for (const [indice, l] of entradas.entries()) {
    const numero = indice + 1;
    const fila = l.id != null ? porId.get(l.id)! : null;
    const nivel: NivelProteccion = fila ? nivelDe(fila) : "NINGUNA";
    let v: ValoresFinales;
    if (fila && nivel !== "NINGUNA") {
      const guardado = valoresDeFila(fila);
      // Fuera de conLinea: estos mensajes ya indican la línea y no deben reetiquetarse como errores de un campo.
      validarEdicionLinea(nivel, {
        categoria: guardado.categoria, descripcion: guardado.descripcion, cantidad: guardado.cantidad, monto: guardado.monto, fechaViaje: guardado.fechaViaje,
        empleadoId: guardado.empleadoId, empleadoNombre: guardado.empleadoNombre, cargo: guardado.cargo, vehiculoId: guardado.vehiculoId, clienteId: guardado.clienteId, planId: guardado.planId,
      }, {
        categoria: l.categoria, descripcion: l.descripcion === undefined ? undefined : l.descripcion?.trim() || null, cantidad: l.cantidad ?? 1, monto: l.monto, fechaViaje: l.fechaViaje,
        empleadoId: l.empleadoId, empleadoNombre: l.empleadoNombreOverride ?? undefined, cargo: l.cargoOverride ?? undefined, vehiculoId: l.vehiculoId,
        clienteId: l.clienteId, planId: l.planId,
      }, numero);
      try {
        // Cuenta y método de pago: se recalculan SOLO si el cliente los cambia; si no, se conserva el snapshot guardado (nunca se refresca desde RRHH).
        const metodo = l.metodoPago ?? null;
        let cuenta = guardado.cuenta;
        if (metodo !== guardado.metodoPago || (l.cuentaOverride !== undefined && l.cuentaOverride !== null)) {
          const derivado = await resolverSnapshotLineaTx(conn, empresaId, { empleadoId: guardado.empleadoId, metodoPago: l.metodoPago, cuentaOverride: l.cuentaOverride });
          cuenta = normalizarDestinoPago(metodo, derivado.cuenta);
        }
        if (nivel === "AUTOMATICA") {
          v = { ...guardado, cuenta, metodoPago: metodo };   // todo lo demás, incluido `orden`, es lo guardado
        } else {
          // VINCULADA: se pueden editar descripción, fecha del viaje, cliente, cargo, método de pago, cuenta y la posición.
          let clienteId = guardado.clienteId, clienteNombre = guardado.clienteNombre;
          if (l.clienteId != null && l.clienteId !== guardado.clienteId) {
            const c = await resolverSnapshotLineaTx(conn, empresaId, { clienteId: l.clienteId });
            clienteId = c.clienteId; clienteNombre = c.clienteNombre;
          }
          v = {
            ...guardado, descripcion: l.descripcion === undefined ? guardado.descripcion : l.descripcion?.trim() || null, fechaViaje: l.fechaViaje ?? guardado.fechaViaje, clienteId, clienteNombre,
            cargo: limpiarOverride(l.cargoOverride, 150) ?? guardado.cargo, cuenta, metodoPago: metodo, orden: siguiente++,
          };
        }
      } catch (e) {
        throw conLinea(e, numero, "lineas", "Línea", CAMPOS_DOMINIO_FONDOS);
      }
    } else {
      try {
        const snapshot = await resolverSnapshotLineaTx(conn, empresaId, l);
        v = {
          categoria: l.categoria, descripcion: l.descripcion?.trim() || null, cantidad: l.cantidad ?? 1, monto: l.monto, orden: siguiente++, fechaViaje: snapshot.fechaViaje,
          empleadoId: l.empleadoId ?? null, empleadoNombre: snapshot.empleadoNombre, cargo: snapshot.cargo, cuenta: normalizarDestinoPago(l.metodoPago ?? null, snapshot.cuenta),
          metodoPago: l.metodoPago ?? null, vehiculoId: snapshot.vehiculoId, placa: snapshot.placa, clienteId: snapshot.clienteId, clienteNombre: snapshot.clienteNombre, planId: l.planId ?? null,
        };
      } catch (e) {
        throw conLinea(e, numero, "lineas", "Línea", CAMPOS_DOMINIO_FONDOS);
      }
    }
    operaciones.push({ fila, v });
  }
  const total = operaciones.reduce((s, o) => s + o.v.cantidad * o.v.monto, 0);
  return { total, retiradas: retiradas.map((r) => Number(r.id)), operaciones };
}

async function aplicarLineasTx(conn: PoolConnection, empresaId: number, solicitudId: number, plan: PlanLineas): Promise<void> {
  if (plan.retiradas.length) {
    try {
      await executeConn(conn,
        `DELETE FROM tms_solicitud_fondo_lineas WHERE empresa_id = ? AND solicitud_id = ? AND id IN (${plan.retiradas.map(() => "?").join(",")})`,
        [empresaId, solicitudId, ...plan.retiradas],
      );
    } catch (e) {
      if (esViolacionFkReferenciada(e)) throw new ErrorDominioFormulario("No se puede eliminar una línea que tiene registros asociados (Combustible, CB2 u otros). No se guardó ningún cambio.");
      throw e;
    }
  }
  for (const { fila, v } of plan.operaciones) {
    if (!fila) {
      await executeConn(conn,
        `INSERT INTO tms_solicitud_fondo_lineas
          (empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
           fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, metodo_pago, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, solicitudId, v.categoria, v.descripcion, v.cantidad, v.monto, v.orden, v.fechaViaje, v.empleadoId, v.empleadoNombre, v.cargo, v.cuenta, v.metodoPago,
          v.vehiculoId, v.placa, v.clienteId, v.clienteNombre, v.planId],
      );
      continue;
    }
    if (iguales(valoresDeFila(fila), v)) continue;
    await executeConn(conn,
      `UPDATE tms_solicitud_fondo_lineas
       SET categoria = ?, descripcion = ?, cantidad = ?, monto = ?, orden = ?, fecha_viaje = ?, empleado_id = ?, empleado_nombre = ?, cargo = ?, cuenta = ?, metodo_pago = ?,
           vehiculo_id = ?, placa = ?, cliente_id = ?, cliente_nombre = ?, plan_id = ?
       WHERE id = ? AND empresa_id = ? AND solicitud_id = ?`,
      [v.categoria, v.descripcion, v.cantidad, v.monto, v.orden, v.fechaViaje, v.empleadoId, v.empleadoNombre, v.cargo, v.cuenta, v.metodoPago,
        v.vehiculoId, v.placa, v.clienteId, v.clienteNombre, v.planId, Number(fila.id), empresaId, solicitudId],
    );
  }
}

/**
 * Edita una solicitud de fondo MIENTRAS esté en "Pendiente" — mismo
 * criterio ya usado en cotizaciones.ts ("solo editable mientras está en
 * Borrador"): una vez Autorizada/Rechazada/Liquidada el contenido queda
 * fijo, solo cambia de estado (cambiarEstadoSolicitudFondo). Encabezado
 * + reemplazo de líneas en UNA sola transacción — si falla la inserción
 * de cualquier línea, se revierte TODO (encabezado incluido), nunca deja
 * la solicitud a medio actualizar.
 *
 * Los campos NO enviados (`undefined`) conservan su valor RAW actual
 * (releído aquí dentro de la transacción, no el valor ya COALESCEado con
 * el nombre del empleado que expone SELECT_SOLICITUD) — evita que editar
 * un campo cualquiera "hornee" por accidente un nombre derivado del JOIN
 * dentro de la columna de texto libre.
 */
export async function actualizarSolicitudFondo(
  empresaId: number,
  id: number,
  input: SolicitudFondoUpdate,
  usuario?: string | null,
): Promise<SolicitudFondo | null> {
  if (input.lineas !== undefined) {
    if (!input.lineas.length) throw new ErrorDominioFormulario("La solicitud necesita al menos una línea de gasto.");
    for (const l of input.lineas) {
      if (!l.categoria) throw new ErrorDominioFormulario("Cada línea necesita una categoría.");
      if (!(l.monto > 0)) throw new ErrorDominioFormulario("Cada línea necesita un monto mayor a cero.");
    }
  }
  const conn = await getPool().getConnection();
  const archivosFirmaEscritos: string[] = [];
  try {
    await conn.beginTransaction();
    const rows = await queryConn<RowDataPacket[]>(conn,
      `SELECT id, estado, entidad_requirente_id, entidad_requirente_nombre, requirente_empleado_id, requirente_nombre, requirente_usuario_id, solicitante_usuario_id, solicitante_nombre,
              DATE_FORMAT(fecha_requerimiento, '%Y-%m-%d') AS fecha_requerimiento, observaciones, total
       FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [id, empresaId],
    );
    if (!rows[0]) { await conn.rollback(); return null; }
    const actual = rows[0];
    const estadoActual = String(actual.estado) as EstadoFondo;
    if (estadoActual !== "Pendiente") {
      throw new ErrorDominioFormulario(`No se puede editar una solicitud en estado "${estadoActual}" — solo mientras está Pendiente.`);
    }
    // FONDOS DIARIOS — la fecha y la empresa requirente de una solicitud diaria definen su grupo (clave única): no se cambian a mano. Requirente, solicitante,
    // observaciones, líneas manuales y método de pago/cuenta de las automáticas sí son editables.
    if (await fondosDiariosInstalado()) {
      const meta = await queryConn<RowDataPacket[]>(conn, "SELECT origen FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? LIMIT 1", [id, empresaId]);
      if (String(meta[0]?.origen ?? "MANUAL") === "DIARIA") {
        const cambiaFecha = input.fechaRequerimiento !== undefined && input.fechaRequerimiento !== String(actual.fecha_requerimiento);
        const cambiaEntidad = input.entidadRequirenteId != null && Number(input.entidadRequirenteId) !== Number(actual.entidad_requirente_id);
        if (cambiaFecha || cambiaEntidad) throw new ErrorDominioFormulario("La fecha y la empresa requirente de una solicitud diaria las define Programación y no se pueden cambiar aquí.");
      }
    }
    const entidadRequirente = input.entidadRequirenteId == null
      ? null
      : await resolverEntidadRequirenteTx(conn, empresaId, input.entidadRequirenteId);
    if (input.requirenteEmpleadoId !== undefined) {
      await validarEmpleadoDeEmpresaTx(conn, empresaId, input.requirenteEmpleadoId, "requirente");
    }
    // §3 del ticket — mismo criterio que crearSolicitudFondo: si cambia
    // el requirente-usuario, se revalida contra esta empresa y se
    // resuelve su nombre real; una nueva firma snapshot (REQUERIR_FONDO)
    // se captura solo si de verdad cambió (nunca se re-firma sin razón
    // en cada edición).
    const requirenteUsuarioCambio = input.requirenteUsuarioId !== undefined
      && input.requirenteUsuarioId !== (actual.requirente_usuario_id != null ? Number(actual.requirente_usuario_id) : null);
    const requirenteUsuario = await resolverRequirenteOperacionesTx(conn, empresaId, input, actual);
    let solicitanteUsuario: { nombre: string; rol: string | null } | null = null;
    const solicitanteUsuarioCambio = input.solicitanteUsuarioId !== undefined
      && input.solicitanteUsuarioId !== (actual.solicitante_usuario_id != null ? Number(actual.solicitante_usuario_id) : null);
    if (input.solicitanteUsuarioId != null) {
      solicitanteUsuario = await resolverSolicitanteOperacionesTx(conn, empresaId, input.solicitanteUsuarioId);
      if (!solicitanteUsuario) throw new ErrorDominioFormulario("El usuario solicitante indicado no pertenece a esta empresa.");
    }
    // FONDOS FASE 1: las líneas se validan y se calculan ANTES de escribir nada (ni el encabezado); el total sale de los valores finales.
    const planLineas = input.lineas !== undefined ? await planificarLineasTx(conn, empresaId, id, input.lineas) : null;
    const total = planLineas ? planLineas.total : Number(actual.total ?? 0);

    const actualizarSolicitanteSql = input.solicitanteUsuarioId !== undefined ? ", solicitante_usuario_id = ?, solicitante_nombre = ?" : "";
    const actualizarSolicitanteParams = input.solicitanteUsuarioId !== undefined
      ? [input.solicitanteUsuarioId ?? null, solicitanteUsuario?.nombre ?? null]
      : [];
    await executeConn(conn,
      `UPDATE tms_solicitudes_fondo
       SET entidad_requirente_id = ?, entidad_requirente_nombre = ?, requirente_empleado_id = ?, requirente_nombre = ?, requirente_usuario_id = ?${actualizarSolicitanteSql}, fecha_requerimiento = ?, total = ?, observaciones = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        entidadRequirente?.id ?? actual.entidad_requirente_id,
        entidadRequirente?.nombre ?? actual.entidad_requirente_nombre,
        requirenteUsuarioCambio ? null : actual.requirente_empleado_id,
        requirenteUsuario
          ? requirenteUsuario.nombre
          : actual.requirente_nombre,
        input.requirenteUsuarioId !== undefined ? input.requirenteUsuarioId ?? null : actual.requirente_usuario_id,
        ...actualizarSolicitanteParams,
        input.fechaRequerimiento ?? actual.fecha_requerimiento,
        total,
        input.observaciones !== undefined ? input.observaciones?.trim() || null : actual.observaciones,
        id,
        empresaId,
      ],
    );

    if (solicitanteUsuarioCambio && input.solicitanteUsuarioId != null && solicitanteUsuario) {
      const bytes = await leerBytesFirmaGuardada(input.solicitanteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaFondo(empresaId, id, "solicitar", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: input.solicitanteUsuarioId, empleadoId: null,
          nombreFirmante: solicitanteUsuario.nombre, rolFirmante: solicitanteUsuario.rol ?? "",
          accion: "SOLICITAR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO", entidadId: id,
          valoresRelevantes: { solicitudId: id, total }, imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }

    if (requirenteUsuarioCambio && input.requirenteUsuarioId != null && requirenteUsuario) {
      const bytes = await leerBytesFirmaGuardada(input.requirenteUsuarioId);
      if (bytes) {
        const imagen = await guardarImagenFirmaFondo(empresaId, id, "requerir", bytes);
        archivosFirmaEscritos.push(imagen.relative);
        await crearFirmaInterna(conn, {
          empresaId, usuarioId: input.requirenteUsuarioId, empleadoId: null,
          nombreFirmante: requirenteUsuario.nombre, rolFirmante: requirenteUsuario.rol ?? "",
          accion: "REQUERIR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO", entidadId: id,
          valoresRelevantes: { solicitudId: id, total },
          imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
        });
      }
    }

    // FONDOS FASE 1: aplicación diferencial por id (conserva la identidad de las líneas; ver planificarLineasTx/aplicarLineasTx).
    if (planLineas) await aplicarLineasTx(conn, empresaId, id, planLineas);

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: usuario ?? null,
      accion: "editar",
      modulo: "tms_fondos",
      detalle: `Solicitud de fondo #${id} editada.${input.lineas !== undefined ? ` Líneas actualizadas, nuevo total Q${total.toFixed(2)}.` : ""}`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    for (const relative of archivosFirmaEscritos) borrarUpload(relative);
    throw error;
  } finally {
    conn.release();
  }
  return obtenerSolicitudFondo(empresaId, id);
}

export const MENSAJE_SIN_EMPRESA_REQUIRENTE = "No se puede autorizar: la solicitud no tiene empresa requirente. Edítala y selecciona una antes de autorizar.";
export const MENSAJE_SIN_REQUIRENTE = "No se puede autorizar: la solicitud no tiene un requirente identificable (usuario de Operaciones). Edítala, selecciona el requirente y vuelve a autorizar.";
export const MENSAJE_REQUIRENTE_NO_VALIDO = "No se puede autorizar: el requirente de la solicitud ya no es válido (debe ser un usuario activo de Operaciones con acceso a esta empresa). Edítala y selecciona otro requirente.";

/**
 * Requisitos previos a AUTORIZAR (FONDOS FASE 1):
 *  · Empresa requirente: debe existir y seguir siendo válida (activa, KT/MONACO, de ESTA empresa) — misma regla que al crear.
 *  · Requirente: debe ser un USUARIO identificable y vigente (activo, con acceso a la empresa y de rol Operaciones), como exige la creación. Las solicitudes
 *    históricas con solo texto/empleado siguen consultables y editables, pero para autorizarlas se corrige antes la identidad desde el formulario.
 */
async function exigirRequirentesParaAutorizarTx(conn: PoolConnection, empresaId: number, fila: RowDataPacket): Promise<void> {
  if (fila.entidad_requirente_id == null) throw new ErrorDominioFormulario(MENSAJE_SIN_EMPRESA_REQUIRENTE);
  await resolverEntidadRequirenteTx(conn, empresaId, Number(fila.entidad_requirente_id));

  // El texto libre (requirente_nombre) o un empleado de RRHH sin usuario NO prueban identidad: solo cuenta un usuario identificable.
  if (fila.requirente_usuario_id == null) throw new ErrorDominioFormulario(MENSAJE_SIN_REQUIRENTE);
  const usuario = await resolverSolicitanteOperacionesTx(conn, empresaId, Number(fila.requirente_usuario_id));   // activo, con acceso a la empresa y de rol Operaciones
  if (!usuario) throw new ErrorDominioFormulario(MENSAJE_REQUIRENTE_NO_VALIDO);
}

export type AccionFondo = "autorizar" | "rechazar" | "liquidar";

const ACCION_A_ESTADO: Record<AccionFondo, EstadoFondo> = {
  autorizar: "Autorizada",
  rechazar: "Rechazada",
  liquidar: "Liquidada",
};

/** §2 del ticket — mensaje FIJO cuando el autorizante no tiene firma registrada en "Mi firma". Exportado para que el endpoint devuelva EXACTAMENTE este texto. */
export const MENSAJE_FIRMA_REQUERIDA_AUTORIZAR = "Debes registrar tu firma en Mi firma antes de autorizar la solicitud.";

/**
 * Transición de estado — SIEMPRE valida contra TRANSICIONES_FONDO (nunca
 * salta de Pendiente a Liquidada, nunca reabre una Rechazada/Liquidada).
 * Deja rastro en `auditoria` (mismo mecanismo que el resto de la app).
 *
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§2 del ticket) — autorizar EXIGE
 * `opts.autorizante` (identidad real de sesión + bytes de su "Mi firma",
 * ya leídos por el endpoint vía leerBytesFirmaGuardada): sin ella se
 * rechaza con MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, ANTES de tocar la base
 * de datos — "no permitir una Solicitud Autorizada sin firma del
 * autorizante". La copia física de esa firma se escribe ANTES de abrir
 * la transacción (guardarUpload no es transaccional, mismo criterio que
 * guardarImagenFirma() en viaticos.ts) y se compensa (se borra) si el
 * commit no llega a completarse, por cualquier motivo.
 */
export async function cambiarEstadoSolicitudFondo(
  empresaId: number,
  id: number,
  accion: AccionFondo,
  opts: {
    usuario?: string | null;
    autorizanteEmpleadoId?: number | null;
    motivoRechazo?: string | null;
    autorizante?: (IdentidadFirmante & { imagen: { bytes: ArrayBuffer; original: string } }) | null;
    permitirAutoautorizacion?: boolean;
  } = {},
): Promise<SolicitudFondo | null> {
  if (accion === "rechazar" && !opts.motivoRechazo?.trim()) {
    throw new ErrorDominioFormulario("El rechazo requiere un motivo.");
  }
  if (accion === "autorizar" && !opts.autorizante) {
    throw new ErrorDominioFormulario(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR);
  }

  const imagenGuardada = accion === "autorizar" && opts.autorizante
    ? await guardarImagenFirmaFondo(empresaId, id, "autorizar", opts.autorizante.imagen)
    : null;

  let committed = false;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rows = await queryConn<RowDataPacket[]>(conn,
      `SELECT id, estado, entidad_requirente_id, requirente_usuario_id, solicitante_usuario_id, creado_por
       FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [id, empresaId],
    );
    if (!rows[0]) { await conn.rollback(); return null; }
    const estadoActual = String(rows[0].estado) as EstadoFondo;
    const destino = ACCION_A_ESTADO[accion];
    if (!TRANSICIONES_FONDO[estadoActual].includes(destino)) {
      throw new ErrorDominioFormulario(`No se puede pasar de "${estadoActual}" a "${destino}".`);
    }
    if (destino === "Autorizada") {
      // FONDOS FASE 1 — una solicitud sin empresa requirente o sin requirente válido NO se puede autorizar (las históricas siguen siendo
      // consultables y editables mientras estén Pendientes). Se valida DENTRO de la transacción, con la fila ya bloqueada.
      await exigirRequirentesParaAutorizarTx(conn, empresaId, rows[0]);
      await validarEmpleadoDeEmpresaTx(conn, empresaId, opts.autorizanteEmpleadoId, "autorizante");
      const autorizante = opts.autorizante!; // ya se rechazó arriba si faltaba
      // FONDOS-AUTORIZAR-PERMISO-1 — nadie autoriza su propia solicitud,
      // aunque tenga el permiso: se bloquea si el autorizante es el
      // requirente (beneficiario), el solicitante (quien la registró en
      // Operaciones) o quien creó el registro.
      const reqUsuarioId = rows[0].requirente_usuario_id != null ? Number(rows[0].requirente_usuario_id) : null;
      const solUsuarioId = rows[0].solicitante_usuario_id != null ? Number(rows[0].solicitante_usuario_id) : null;
      const creadoPor = rows[0].creado_por != null ? String(rows[0].creado_por) : null;
      const esPropia =
        (reqUsuarioId != null && reqUsuarioId === autorizante.usuarioId) ||
        (solUsuarioId != null && solUsuarioId === autorizante.usuarioId) ||
        (creadoPor != null && opts.usuario != null && creadoPor === opts.usuario);
      if (esPropia && !opts.permitirAutoautorizacion) {
        throw new ErrorDominioFormulario("No puede autorizar su propia solicitud.");
      }
      await executeConn(conn,
        `UPDATE tms_solicitudes_fondo
         SET estado = ?, autorizante_empleado_id = ?, autorizante_nombre = ?, autorizante_usuario_id = ?, autorizado_en = NOW()
         WHERE id = ? AND empresa_id = ?`,
        [destino, opts.autorizanteEmpleadoId ?? null, autorizante.nombre, autorizante.usuarioId, id, empresaId],
      );
      // §2/§4 del ticket — snapshot INMUTABLE de la firma real usada AL
      // AUTORIZAR (mismo patrón que autorizarViatico): el PDF (leído
      // después, cualquier cantidad de veces) usa esta fila, nunca
      // vuelve a resolver "la firma actual" del usuario.
      await crearFirmaInterna(conn, {
        empresaId, usuarioId: autorizante.usuarioId, empleadoId: opts.autorizanteEmpleadoId ?? null,
        nombreFirmante: autorizante.nombre, rolFirmante: autorizante.rol ?? "",
        accion: "AUTORIZAR_FONDO", modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO", entidadId: id,
        valoresRelevantes: { solicitudId: id },
        imagen: imagenGuardada!, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
      });
    } else if (destino === "Rechazada") {
      await executeConn(conn,
        `UPDATE tms_solicitudes_fondo SET estado = ?, rechazado_en = NOW(), motivo_rechazo = ? WHERE id = ? AND empresa_id = ?`,
        [destino, opts.motivoRechazo!.trim(), id, empresaId],
      );
    } else {
      await executeConn(conn,
        `UPDATE tms_solicitudes_fondo SET estado = ?, liquidado_en = NOW() WHERE id = ? AND empresa_id = ?`,
        [destino, id, empresaId],
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: opts.usuario ?? null,
      accion,
      modulo: "tms_fondos",
      detalle: `Solicitud de fondo #${id}: ${estadoActual} -> ${destino}.${opts.motivoRechazo ? ` Motivo: ${opts.motivoRechazo}` : ""}`,
    });
    await conn.commit();
    committed = true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    if (imagenGuardada && !committed) {
      borrarUpload(imagenGuardada.relative);
    }
  }
  return obtenerSolicitudFondo(empresaId, id);
}
