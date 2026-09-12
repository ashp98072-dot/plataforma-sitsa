import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { normalizarDestinoPago } from "@/lib/tms/gastos";
import {
  resolverEntidadRequirenteTx,
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
  if (limpio.length > maximo) throw new Error(`El valor editado no puede exceder ${maximo} caracteres.`);
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
  input: Pick<LineaFondoInput, "empleadoId" | "vehiculoId" | "clienteId" | "planId" | "fechaViaje" | "empleadoNombreOverride" | "cuentaOverride" | "cargoOverride">,
): Promise<{ empleadoNombre: string | null; cargo: string | null; cuenta: string | null; placa: string | null; clienteId: number | null; clienteNombre: string | null; fechaViaje: string | null }> {
  let empleadoNombre: string | null = null;
  let cargo: string | null = null;
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — `cuenta` es empleados.cuenta_bancaria
  // (fuente oficial YA existente, ver src/lib/rrhh/empleados.ts y
  // viaticos-exportar-banco.ts), congelada aquí como snapshot igual que
  // nombre/puesto — nunca un valor enviado por el cliente HTTP.
  let cuenta: string | null = null;
  if (input.empleadoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre, puesto, cuenta_bancaria FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [input.empleadoId, empresaId]);
    if (!rows[0]) throw new Error("El empleado indicado no pertenece a esta empresa.");
    empleadoNombre = String(rows[0].nombre);
    cargo = rows[0].puesto != null ? String(rows[0].puesto) : null;
    cuenta = rows[0].cuenta_bancaria != null ? String(rows[0].cuenta_bancaria) : null;
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
  if (input.vehiculoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT placa FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1", [input.vehiculoId, empresaId]);
    if (!rows[0]) throw new Error("El vehículo indicado no pertenece a esta empresa.");
    placa = String(rows[0].placa);
  }
  let clienteId = input.clienteId ?? null;
  let clienteNombre: string | null = null;
  if (input.clienteId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [input.clienteId, empresaId]);
    if (!rows[0]) throw new Error("El cliente indicado no pertenece a esta empresa.");
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
    if (!rows[0]) throw new Error("El viaje indicado no pertenece a esta empresa.");
    if (input.clienteId == null) {
      clienteId = rows[0].cliente_id != null ? Number(rows[0].cliente_id) : null;
      clienteNombre = rows[0].cliente_nombre != null ? String(rows[0].cliente_nombre) : null;
    }
    if (fechaViaje == null) fechaViaje = String(rows[0].fecha_plan);
  }
  return { empleadoNombre, cargo, cuenta, placa, clienteId, clienteNombre, fechaViaje };
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
};

export type SolicitudFondo = {
  id: number;
  empresaId: number;
  codigo: string;
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
    fechaViaje: r.fecha_viaje != null ? String(r.fecha_viaje) : null,
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
  };
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
  return rows.map((r) => ({ ...mapSolicitud(r), lineas: [] }));
}

export async function obtenerSolicitudFondo(empresaId: number, id: number): Promise<SolicitudFondo | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_SOLICITUD} WHERE s.id = ? AND s.empresa_id = ? LIMIT 1`, [id, empresaId]);
  if (!rows[0]) return null;
  const lineas = await query<RowDataPacket[]>(
    `SELECT id, categoria, descripcion, cantidad, monto, orden,
            DATE_FORMAT(fecha_viaje, '%Y-%m-%d') AS fecha_viaje,
            empleado_id, empleado_nombre, cargo, cuenta, metodo_pago,
            vehiculo_id, placa,
            cliente_id, cliente_nombre,
            plan_id
     FROM tms_solicitud_fondo_lineas
     WHERE empresa_id = ? AND solicitud_id = ? ORDER BY orden, id`,
    [empresaId, id],
  );
  return { ...mapSolicitud(rows[0]), lineas: lineas.map(mapLinea) };
}

export type LineaFondoInput = {
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
   * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3 del ticket) — OPCIONAL: cuando
   * el requirente corresponde a un usuario real del sistema (no solo un
   * empleado RRHH sin login), seleccionable desde el catálogo. Permite
   * que el PDF autorizado muestre su nombre real + firma manuscrita
   * (snapshot capturado aquí, ver crearSolicitudFondo). Sin este campo,
   * el requirente sigue siendo únicamente texto libre/empleado — nunca
   * se inventa una firma para ese caso.
   */
  requirenteUsuarioId?: number | null;
  /** Usuario de Operaciones que solicita el fondo; se elige explícitamente y nunca se infiere de la sesión. */
  solicitanteUsuarioId?: number | null;
  fechaRequerimiento: string;
  observaciones?: string | null;
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
  if (!input.fechaRequerimiento) throw new Error("Fecha de requerimiento requerida.");
  if (!input.requirenteEmpleadoId && !input.requirenteUsuarioId && !input.requirenteNombre?.trim()) {
    throw new Error("Requirente requerido (empleado, usuario o nombre).");
  }
  if (!input.lineas.length) throw new Error("La solicitud necesita al menos una línea de gasto.");
  for (const l of input.lineas) {
    if (!l.categoria) throw new Error("Cada línea necesita una categoría.");
    if (!(l.monto > 0)) throw new Error("Cada línea necesita un monto mayor a cero.");
  }
  const total = calcularTotal(input.lineas);

  const conn = await getPool().getConnection();
  let solicitudId = 0;
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

    // §3 del ticket — requirente-usuario OPCIONAL: si viene, DEBE
    // pertenecer a esta empresa (nunca se acepta un usuario de otro
    // tenant aunque el id exista) y su nombre real resuelto por el
    // servidor manda sobre cualquier texto libre enviado.
    let requirenteUsuario: { nombre: string; rol: string | null } | null = null;
    if (input.requirenteUsuarioId != null) {
      requirenteUsuario = await resolverUsuarioDeEmpresaTx(conn, empresaId, input.requirenteUsuarioId);
      if (!requirenteUsuario) throw new Error("El usuario requirente indicado no pertenece a esta empresa.");
    }
    const solicitanteId = input.solicitanteUsuarioId ?? solicitanteLegado?.usuarioId ?? null;
    const solicitanteUsuario = solicitanteId == null ? null
      : input.solicitanteUsuarioId != null
        ? await resolverSolicitanteOperacionesTx(conn, empresaId, solicitanteId)
        : await resolverUsuarioDeEmpresaTx(conn, empresaId, solicitanteId);
    if (solicitanteId != null && !solicitanteUsuario) throw new Error("El usuario solicitante indicado no pertenece a esta empresa.");

    const r = await executeConn(conn,
      `INSERT INTO tms_solicitudes_fondo
        (empresa_id, codigo, entidad_requirente_id, entidad_requirente_nombre, requirente_empleado_id, requirente_nombre, requirente_usuario_id,
         fecha_requerimiento, total, observaciones, creado_por, solicitante_usuario_id, solicitante_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        "", // se completa abajo con un código estable derivado del id, mismo criterio que clientes.codigo
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
      ],
    );
    solicitudId = Number(r.insertId);
    const codigo = `FONDO-${String(solicitudId).padStart(6, "0")}`;
    await executeConn(conn, `UPDATE tms_solicitudes_fondo SET codigo = ? WHERE id = ? AND empresa_id = ?`, [codigo, solicitudId, empresaId]);
    let orden = 0;
    for (const l of input.lineas) {
      const snapshot = await resolverSnapshotLineaTx(conn, empresaId, l);
      const cuenta = normalizarDestinoPago(l.metodoPago ?? null, snapshot.cuenta);
      await executeConn(conn,
        `INSERT INTO tms_solicitud_fondo_lineas
          (empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
           fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, metodo_pago, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId, solicitudId, l.categoria, l.descripcion?.trim() || null, l.cantidad ?? 1, l.monto, orden,
          snapshot.fechaViaje, l.empleadoId ?? null, snapshot.empleadoNombre, snapshot.cargo, cuenta, l.metodoPago ?? null,
          l.vehiculoId ?? null, snapshot.placa, snapshot.clienteId, snapshot.clienteNombre, l.planId ?? null,
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
    throw error;
  } finally {
    conn.release();
  }
  const creada = await obtenerSolicitudFondo(empresaId, solicitudId);
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
    if (!input.lineas.length) throw new Error("La solicitud necesita al menos una línea de gasto.");
    for (const l of input.lineas) {
      if (!l.categoria) throw new Error("Cada línea necesita una categoría.");
      if (!(l.monto > 0)) throw new Error("Cada línea necesita un monto mayor a cero.");
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
      throw new Error(`No se puede editar una solicitud en estado "${estadoActual}" — solo mientras está Pendiente.`);
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
    let requirenteUsuario: { nombre: string; rol: string | null } | null = null;
    const requirenteUsuarioCambio = input.requirenteUsuarioId !== undefined
      && input.requirenteUsuarioId !== (actual.requirente_usuario_id != null ? Number(actual.requirente_usuario_id) : null);
    if (input.requirenteUsuarioId != null) {
      requirenteUsuario = await resolverUsuarioDeEmpresaTx(conn, empresaId, input.requirenteUsuarioId);
      if (!requirenteUsuario) throw new Error("El usuario requirente indicado no pertenece a esta empresa.");
    }
    let solicitanteUsuario: { nombre: string; rol: string | null } | null = null;
    const solicitanteUsuarioCambio = input.solicitanteUsuarioId !== undefined
      && input.solicitanteUsuarioId !== (actual.solicitante_usuario_id != null ? Number(actual.solicitante_usuario_id) : null);
    if (input.solicitanteUsuarioId != null) {
      solicitanteUsuario = await resolverSolicitanteOperacionesTx(conn, empresaId, input.solicitanteUsuarioId);
      if (!solicitanteUsuario) throw new Error("El usuario solicitante indicado no pertenece a esta empresa.");
    }
    const total = input.lineas !== undefined ? calcularTotal(input.lineas) : Number(actual.total ?? 0);

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
        input.requirenteEmpleadoId !== undefined ? input.requirenteEmpleadoId ?? null : actual.requirente_empleado_id,
        requirenteUsuario
          ? requirenteUsuario.nombre
          : (input.requirenteNombre !== undefined ? input.requirenteNombre?.trim() || null : actual.requirente_nombre),
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

    if (input.lineas !== undefined) {
      await executeConn(conn, "DELETE FROM tms_solicitud_fondo_lineas WHERE empresa_id = ? AND solicitud_id = ?", [empresaId, id]);
      let orden = 0;
      for (const l of input.lineas) {
        const snapshot = await resolverSnapshotLineaTx(conn, empresaId, l);
        const cuenta = normalizarDestinoPago(l.metodoPago ?? null, snapshot.cuenta);
        await executeConn(conn,
          `INSERT INTO tms_solicitud_fondo_lineas
            (empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
             fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, metodo_pago, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            empresaId, id, l.categoria, l.descripcion?.trim() || null, l.cantidad ?? 1, l.monto, orden,
            snapshot.fechaViaje, l.empleadoId ?? null, snapshot.empleadoNombre, snapshot.cargo, cuenta, l.metodoPago ?? null,
            l.vehiculoId ?? null, snapshot.placa, snapshot.clienteId, snapshot.clienteNombre, l.planId ?? null,
          ],
        );
        orden += 1;
      }
    }

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: usuario ?? null,
      accion: "editar",
      modulo: "tms_fondos",
      detalle: `Solicitud de fondo #${id} editada.${input.lineas !== undefined ? ` Líneas reemplazadas, nuevo total Q${total.toFixed(2)}.` : ""}`,
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
    throw new Error("El rechazo requiere un motivo.");
  }
  if (accion === "autorizar" && !opts.autorizante) {
    throw new Error(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR);
  }

  const imagenGuardada = accion === "autorizar" && opts.autorizante
    ? await guardarImagenFirmaFondo(empresaId, id, "autorizar", opts.autorizante.imagen)
    : null;

  let committed = false;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rows = await queryConn<RowDataPacket[]>(conn,
      `SELECT id, estado, requirente_usuario_id, solicitante_usuario_id, creado_por
       FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [id, empresaId],
    );
    if (!rows[0]) { await conn.rollback(); return null; }
    const estadoActual = String(rows[0].estado) as EstadoFondo;
    const destino = ACCION_A_ESTADO[accion];
    if (!TRANSICIONES_FONDO[estadoActual].includes(destino)) {
      throw new Error(`No se puede pasar de "${estadoActual}" a "${destino}".`);
    }
    if (destino === "Autorizada") {
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
        throw new Error("No puede autorizar su propia solicitud.");
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
