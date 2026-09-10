import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { tarifasActivasDeRuta, tarifasActivasDeVariasRutas } from "@/lib/tms/ruta-tarifas";
import { hoyLocal } from "@/lib/rrhh/dates";

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}

async function executeConn(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * VIAT-4 (punto 2 — "Operaciones > Rutas") — catálogo maestro de rutas/
 * servicios preconfigurados por cliente, a partir de la hoja "CODIGOS
 * DATA" del Excel operativo real. Es una PLANTILLA: Programación COPIA
 * sus datos al viaje (ver src/app/api/empresas/[slug]/tms/planes/route.ts,
 * campos ruta_id/ruta_codigo_historico/lugar_descarga_historico/
 * contacto_*_historico) — cambiar o desactivar una ruta después NUNCA
 * altera viajes ya creados.
 *
 * No duplica maestros: cliente_id referencia tms_clientes;
 * ubicacion_carga_id y las paradas de la ruta referencian
 * tms_cliente_ubicaciones (VIAT-1); contacto_cliente_id referencia
 * tms_cliente_contactos (VIAT-4). Esquema: NO se crea/altera desde este
 * módulo — asume que sql/migrate-2026-08-viat-4-contactos-rutas.sql y
 * sql/migrate-2026-08-viat-4b-rutas-correcciones.sql ya se aplicaron
 * manualmente.
 *
 * VIAT-4b (corrección tras revisar el Excel real): el código es
 * GLOBAL por empresa, no por cliente — 147 registros/147 códigos únicos
 * en la muestra real. `destino_descripcion` es la descripción operativa
 * completa del destino (texto libre, formato tipo "RUTA-X -
 * punto1-punto2-punto3"), SEPARADA de las paradas estructuradas
 * (tms_cliente_ruta_paradas), que se mantienen intactas en paralelo.
 *
 * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo" ya
 * no se utiliza: se retiró de este tipo/CRUD (formulario, listado,
 * import/export de Excel, y de todo lo que copiaba su valor — ver
 * ruta-defaults.ts, cotizacion-defaults.ts, cotizaciones.ts). La columna
 * `tms_cliente_rutas.costo_operativo` NO se eliminó (sin DROP, sin
 * migración destructiva) — queda en BD sin uso, con datos históricos
 * intactos; simplemente esta capa ya no la selecciona ni la escribe.
 */

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§12 del ticket) — validaciones explícitas
 * de pertenencia que crearRuta/actualizarRuta NO hacían: `clienteId`,
 * `contactoClienteId` y `ubicacionCargaId` se aceptaban del cliente HTTP
 * y se escribían directo (la única FK real en el esquema es
 * `cliente_id -> tms_clientes(id)`, SIN empresa_id — un id de OTRA
 * empresa pasaría esa FK sin problema). Mismo criterio de aislamiento ya
 * usado en fondos.ts (validarEmpleadoDeEmpresaTx) y cotizaciones.ts.
 */
async function validarClienteDeEmpresaTx(conn: PoolConnection, empresaId: number, clienteId: number): Promise<void> {
  const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [clienteId, empresaId]);
  if (!rows[0]) throw new Error("El cliente indicado no pertenece a esta empresa.");
}

/** El contacto debe pertenecer a ESTE cliente (no solo a esta empresa) — un contacto de otro cliente de la misma empresa tampoco es válido aquí. */
async function validarContactoDeClienteTx(conn: PoolConnection, empresaId: number, clienteId: number, contactoId: number | null | undefined): Promise<void> {
  if (contactoId == null) return;
  const rows = await queryConn<RowDataPacket[]>(conn,
    "SELECT id FROM tms_cliente_contactos WHERE id = ? AND empresa_id = ? AND cliente_id = ? LIMIT 1",
    [contactoId, empresaId, clienteId],
  );
  if (!rows[0]) throw new Error("El contacto indicado no pertenece a este cliente.");
}

/** Ubicación de carga: pertenencia a la empresa (criterio explícito del ticket §12 — no exige además que sea del mismo cliente). */
async function validarUbicacionDeEmpresaTx(conn: PoolConnection, empresaId: number, ubicacionId: number | null | undefined): Promise<void> {
  if (ubicacionId == null) return;
  const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM tms_cliente_ubicaciones WHERE id = ? AND empresa_id = ? LIMIT 1", [ubicacionId, empresaId]);
  if (!rows[0]) throw new Error("La ubicación de carga indicada no pertenece a esta empresa.");
}

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§5) — la unidad recurrente
 * DEBE ser un vehículo de flota_vehiculos de ESTA empresa. `null`/`undefined`
 * la quita sin validar (se permite dejar la ruta sin unidad recurrente).
 */
async function validarUnidadRecurrenteTx(conn: PoolConnection, empresaId: number, vehiculoId: number | null | undefined): Promise<void> {
  if (vehiculoId == null) return;
  const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1", [vehiculoId, empresaId]);
  if (!rows[0]) throw new Error("La unidad recurrente indicada no pertenece a la flota de esta empresa.");
}

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 — historial APPEND-ONLY de cambios de
 * `tms_cliente_rutas.tarifa_referencia` (§1/§2 del ticket). El valor
 * "vigente" sigue siendo esa misma columna (nadie más la lee hoy:
 * ruta-defaults.ts, cotizaciones.ts, rutas-export-excel.ts,
 * rutas-import.ts — ninguno cambia) — esta tabla es SOLO la bitácora de
 * cómo llegó a ese valor. Nunca se actualiza ni se borra una fila desde
 * aquí (append-only real); nunca se llama para tarifas de VIAJES ya
 * creados (`tms_planes_viaje.tarifa_comercial` es un campo totalmente
 * distinto, copiado aparte al crear el plan — modificar el tarifario de
 * la ruta después nunca toca esos snapshots, §13 del ticket).
 */
export type TarifaHistorialEntry = {
  id: number;
  tarifa: number;
  moneda: string;
  vigenteDesde: string;
  motivo: string | null;
  usuarioId: number | null;
  usuarioNombre: string | null;
  creadoEn: string;
};

function mapTarifaHistorial(r: RowDataPacket): TarifaHistorialEntry {
  return {
    id: Number(r.id),
    tarifa: Number(r.tarifa),
    moneda: String(r.moneda ?? "GTQ"),
    vigenteDesde: String(r.vigente_desde),
    motivo: r.motivo != null ? String(r.motivo) : null,
    usuarioId: r.usuario_id != null ? Number(r.usuario_id) : null,
    usuarioNombre: r.usuario_nombre != null ? String(r.usuario_nombre) : null,
    creadoEn: String(r.creado_en ?? ""),
  };
}

/** §4 del ticket — orden descendente (el cambio más reciente primero). */
export async function listarHistorialTarifas(empresaId: number, rutaId: number): Promise<TarifaHistorialEntry[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, tarifa, moneda, DATE_FORMAT(vigente_desde, '%Y-%m-%d') AS vigente_desde, motivo, usuario_id, usuario_nombre, creado_en
     FROM tms_cliente_ruta_tarifas
     WHERE empresa_id = ? AND ruta_id = ?
     ORDER BY vigente_desde DESC, id DESC`,
    [empresaId, rutaId],
  );
  return rows.map(mapTarifaHistorial);
}

/** El registro MÁS RECIENTE de cada ruta (para las columnas de conveniencia en listarRutas/obtenerRuta y el Excel ampliado, §6 del ticket) — evita releer todo el historial solo para mostrar "último cambio". */
async function ultimaTarifaDeRutas(empresaId: number, rutaIds: number[]): Promise<Map<number, TarifaHistorialEntry>> {
  const map = new Map<number, TarifaHistorialEntry>();
  if (!rutaIds.length) return map;
  const rows = await query<RowDataPacket[]>(
    `SELECT t.ruta_id, t.id, t.tarifa, t.moneda, DATE_FORMAT(t.vigente_desde, '%Y-%m-%d') AS vigente_desde,
            t.motivo, t.usuario_id, t.usuario_nombre, t.creado_en
     FROM tms_cliente_ruta_tarifas t
     INNER JOIN (
       SELECT ruta_id, MAX(vigente_desde) AS max_desde
       FROM tms_cliente_ruta_tarifas
       WHERE empresa_id = ? AND ruta_id IN (${rutaIds.map(() => "?").join(",")})
       GROUP BY ruta_id
     ) ultimo ON ultimo.ruta_id = t.ruta_id AND ultimo.max_desde = t.vigente_desde
     WHERE t.empresa_id = ?
     ORDER BY t.ruta_id, t.id DESC`,
    [empresaId, ...rutaIds, empresaId],
  );
  for (const r of rows) {
    const rutaId = Number(r.ruta_id);
    if (!map.has(rutaId)) map.set(rutaId, mapTarifaHistorial(r)); // primera fila por ruta = la de mayor id entre las de fecha más reciente (ORDER BY arriba)
  }
  return map;
}

/**
 * Inserta UNA fila de historial cuando la tarifa realmente cambió — "si
 * la tarifa no cambió, no crear una entrada duplicada" (§3 del ticket).
 * `tarifaNueva == null` nunca genera fila (no hay "tarifa cero
 * histórica" que registrar; la tabla exige `tarifa NOT NULL`). Compara
 * por valor numérico (no por referencia) para no crear una fila cuando
 * el caller reenvía el mismo monto sin cambios reales.
 */
export async function registrarCambioTarifaTx(
  conn: PoolConnection,
  params: {
    empresaId: number;
    rutaId: number;
    tarifaAnterior: number | null;
    tarifaNueva: number | null;
    vigenteDesde?: string | null;
    motivo?: string | null;
    usuarioId?: number | null;
    usuarioNombre?: string | null;
  },
): Promise<void> {
  if (params.tarifaNueva == null) return;
  if (params.tarifaAnterior != null && Number(params.tarifaAnterior) === Number(params.tarifaNueva)) return;
  await executeConn(conn,
    `INSERT INTO tms_cliente_ruta_tarifas
      (empresa_id, ruta_id, tarifa, moneda, vigente_desde, motivo, usuario_id, usuario_nombre)
     VALUES (?, ?, ?, 'GTQ', ?, ?, ?, ?)`,
    [
      params.empresaId, params.rutaId, params.tarifaNueva,
      params.vigenteDesde?.trim() || hoyLocal(),
      params.motivo?.trim() || null,
      params.usuarioId ?? null,
      params.usuarioNombre?.trim() || null,
    ],
  );
}

export type RutaParada = {
  id: number;
  orden: number;
  tipo: string;
  lugarNombre: string;
  clienteUbicacionId: number | null;
};

export type RutaParadaInput = {
  tipo?: string;
  lugarNombre: string;
  clienteUbicacionId?: number | null;
};

export type RutaPersonal = {
  empleadoId: number;
  empleadoCodigo: string;
  empleadoNombre: string;
  rol: "Piloto" | "Auxiliar";
  orden: number;
  viaticoMonto: number | null;
};

export type RutaPersonalInput = {
  empleadoId: number;
  rol: "Piloto" | "Auxiliar";
  viaticoMonto?: number | null;
};

export type ClienteRuta = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  codigo: string;
  nombre: string | null;
  ubicacionCargaId: number | null;
  lugarCargaTexto: string | null;
  destinoDescripcion: string | null;
  horaHabitual: string | null;
  tarifaReferencia: number | null;
  /** RUTAS-TARIFARIO-HISTORIAL-1 (§1/§4/§6) — datos del ÚLTIMO cambio registrado en tms_cliente_ruta_tarifas, para no tener que releer todo listarHistorialTarifas() solo para mostrar esto. `null` si la ruta nunca tuvo un cambio de tarifa registrado en el historial (p. ej. creada antes de este ticket). */
  tarifaVigenteDesde: string | null;
  tarifaUltimoCambioEn: string | null;
  tarifaModificadoPor: string | null;
  contactoClienteId: number | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
  observaciones: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
  /** RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4) — unidad habitual de la ruta (flota_vehiculos, misma empresa). Opcional; Programación la precarga como sugerencia. */
  unidadRecurrenteId: number | null;
  unidadRecurrentePlaca: string | null;
  paradas: RutaParada[];
  personalPredeterminado: RutaPersonal[];
  /** RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1/§2) — opciones de tarifa ACTIVAS del catálogo, solo en obtenerRuta (detalle). La predeterminada va primero. `undefined` en listarRutas (no se cargan ahí por costo). */
  tarifasActivas?: { id: number; nombre: string; monto: number; moneda: string; predeterminada: boolean }[];
  tarifaPredeterminadaId?: number | null;
};

function mapRuta(r: RowDataPacket): Omit<ClienteRuta, "paradas"> {
  return {
    id: Number(r.id),
    clienteId: Number(r.cliente_id),
    clienteNombre: String(r.cliente_nombre ?? ""),
    codigo: String(r.codigo),
    nombre: r.nombre != null ? String(r.nombre) : null,
    ubicacionCargaId: r.ubicacion_carga_id != null ? Number(r.ubicacion_carga_id) : null,
    lugarCargaTexto: r.lugar_carga_texto != null ? String(r.lugar_carga_texto) : null,
    destinoDescripcion: r.destino_descripcion != null ? String(r.destino_descripcion) : null,
    horaHabitual: r.hora_habitual != null ? String(r.hora_habitual) : null,
    tarifaReferencia: r.tarifa_referencia != null ? Number(r.tarifa_referencia) : null,
    contactoClienteId: r.contacto_cliente_id != null ? Number(r.contacto_cliente_id) : null,
    contactoNombre: r.contacto_nombre != null ? String(r.contacto_nombre) : null,
    contactoCargo: r.contacto_cargo != null ? String(r.contacto_cargo) : null,
    contactoTelefono: r.contacto_telefono != null ? String(r.contacto_telefono) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    activo: Number(r.activo ?? 1) === 1,
    creadoEn: String(r.creado_en ?? ""),
    actualizadoEn: String(r.actualizado_en ?? ""),
    unidadRecurrenteId: r.unidad_recurrente_id != null ? Number(r.unidad_recurrente_id) : null,
    unidadRecurrentePlaca: r.unidad_recurrente_placa != null ? String(r.unidad_recurrente_placa) : null,
    tarifaVigenteDesde: null,
    tarifaUltimoCambioEn: null,
    tarifaModificadoPor: null,
    personalPredeterminado: [],
  };
}

const SELECT_RUTA = `
  SELECT r.id, r.cliente_id, c.nombre AS cliente_nombre, r.codigo, r.nombre,
         r.ubicacion_carga_id, r.lugar_carga_texto, r.destino_descripcion, r.hora_habitual,
         r.tarifa_referencia,
         r.unidad_recurrente_id, fvr.placa AS unidad_recurrente_placa,
         r.contacto_cliente_id, ct.nombre AS contacto_nombre, ct.cargo AS contacto_cargo,
         ct.telefono AS contacto_telefono,
         r.observaciones, r.activo, r.creado_en, r.actualizado_en
  FROM tms_cliente_rutas r
  INNER JOIN tms_clientes c ON c.id = r.cliente_id
  LEFT JOIN tms_cliente_contactos ct ON ct.id = r.contacto_cliente_id
  LEFT JOIN flota_vehiculos fvr ON fvr.id = r.unidad_recurrente_id AND fvr.empresa_id = r.empresa_id
`;

async function paradasDeRutas(rutaIds: number[]): Promise<Map<number, RutaParada[]>> {
  const map = new Map<number, RutaParada[]>();
  if (!rutaIds.length) return map;
  const placeholders = rutaIds.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT id, ruta_id, orden, tipo, lugar_nombre, cliente_ubicacion_id
     FROM tms_cliente_ruta_paradas
     WHERE ruta_id IN (${placeholders}) AND activo = 1
     ORDER BY ruta_id, orden, id`,
    rutaIds,
  );
  for (const r of rows) {
    const rid = Number(r.ruta_id);
    const list = map.get(rid) ?? [];
    list.push({
      id: Number(r.id),
      orden: Number(r.orden),
      tipo: String(r.tipo ?? "Entrega"),
      lugarNombre: String(r.lugar_nombre),
      clienteUbicacionId: r.cliente_ubicacion_id != null ? Number(r.cliente_ubicacion_id) : null,
    });
    map.set(rid, list);
  }
  return map;
}

async function personalDeRutas(empresaId: number, rutaIds: number[]): Promise<Map<number, RutaPersonal[]>> {
  const map = new Map<number, RutaPersonal[]>();
  if (!rutaIds.length) return map;
  const rows = await query<RowDataPacket[]>(
    `SELECT rp.ruta_id, rp.empleado_id, e.codigo AS empleado_codigo, e.nombre AS empleado_nombre,
            rp.rol, rp.orden, rp.viatico_monto
     FROM tms_cliente_ruta_personal rp
     INNER JOIN empleados e ON e.id = rp.empleado_id AND e.empresa_id = rp.empresa_id
     WHERE rp.empresa_id = ? AND rp.ruta_id IN (${rutaIds.map(() => "?").join(",")})
     ORDER BY rp.ruta_id, (rp.rol = 'Piloto') DESC, rp.orden, rp.id`,
    [empresaId, ...rutaIds],
  );
  for (const r of rows) {
    const rutaId = Number(r.ruta_id);
    const list = map.get(rutaId) ?? [];
    list.push({
      empleadoId: Number(r.empleado_id),
      empleadoCodigo: String(r.empleado_codigo),
      empleadoNombre: String(r.empleado_nombre),
      rol: String(r.rol) === "Piloto" ? "Piloto" : "Auxiliar",
      orden: Number(r.orden),
      viaticoMonto: r.viatico_monto != null ? Number(r.viatico_monto) : null,
    });
    map.set(rutaId, list);
  }
  return map;
}

export type FiltrosRutas = {
  clienteId?: number;
  codigo?: string;
  q?: string; // busca en código, nombre de ruta, descripción de destino y nombre de cliente
  incluirInactivas?: boolean;
  /** RUTAS-TARIFARIO-HISTORIAL-1 (§6) — filtro EXPLÍCITO de estado (true=solo activas, false=solo inactivas), para el export filtrable. `undefined` preserva el comportamiento previo de `incluirInactivas` sin cambios. */
  activo?: boolean;
};

/**
 * Buscar/listar rutas (Operaciones > Rutas y el selector de Programación).
 * Dos formas de buscar, como pide el proceso real: A) escribir un código
 * (el código es único por EMPRESA — VIAT-4b — así que "17" resuelve
 * directamente sin ambigüedad, sin necesitar elegir cliente antes); B) si
 * ya hay cliente elegido, filtrar solo entre sus rutas. Cuando `q`
 * coincide EXACTAMENTE con un código, esa fila se ordena primero (para
 * que escribir "17" traiga la ruta 17 al tope aunque también existan
 * códigos como "170").
 */
export async function listarRutas(
  empresaId: number,
  filtros: FiltrosRutas = {},
): Promise<ClienteRuta[]> {
  const condiciones = ["r.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtros.activo !== undefined) {
    condiciones.push("r.activo = ?");
    params.push(filtros.activo ? 1 : 0);
  } else if (!filtros.incluirInactivas) {
    condiciones.push("r.activo = 1");
  }
  if (filtros.clienteId) {
    condiciones.push("r.cliente_id = ?");
    params.push(filtros.clienteId);
  }
  if (filtros.codigo?.trim()) {
    condiciones.push("r.codigo LIKE ?");
    params.push(`%${filtros.codigo.trim()}%`);
  }

  let ordenExacto = "";
  const ordenParams: (string | number)[] = [];
  if (filtros.q?.trim()) {
    const termino = filtros.q.trim();
    condiciones.push(
      "(r.codigo LIKE ? OR r.nombre LIKE ? OR r.destino_descripcion LIKE ? OR c.nombre LIKE ?)",
    );
    const like = `%${termino}%`;
    params.push(like, like, like, like);
    // Coincidencia EXACTA de código primero (punto "escribir 17 resuelve
    // directamente" — el orden importa cuando además hay matches parciales).
    ordenExacto = "(r.codigo = ?) DESC, ";
    ordenParams.push(termino);
  }

  const rows = await query<RowDataPacket[]>(
    `${SELECT_RUTA} WHERE ${condiciones.join(" AND ")} ORDER BY ${ordenExacto}c.nombre, r.codigo LIMIT 200`,
    [...params, ...ordenParams],
  );
  const base = rows.map(mapRuta);
  const ids = base.map((r) => r.id);
  const [paradasMap, personalMap, tarifaMap, opcionesMap] = await Promise.all([
    paradasDeRutas(ids), personalDeRutas(empresaId, ids), ultimaTarifaDeRutas(empresaId, ids),
    tarifasActivasDeVariasRutas(empresaId, ids),
  ]);
  return base.map((r) => {
    const ultima = tarifaMap.get(r.id);
    const opciones = opcionesMap.get(r.id);
    return {
      ...r,
      paradas: paradasMap.get(r.id) ?? [],
      personalPredeterminado: personalMap.get(r.id) ?? [],
      tarifaVigenteDesde: ultima?.vigenteDesde ?? null,
      tarifaUltimoCambioEn: ultima?.creadoEn ?? null,
      tarifaModificadoPor: ultima?.usuarioNombre ?? null,
      tarifasActivas: opciones?.tarifas ?? [],
      tarifaPredeterminadaId: opciones?.predeterminadaId ?? null,
    };
  });
}

export async function obtenerRuta(empresaId: number, id: number): Promise<ClienteRuta | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_RUTA} WHERE r.id = ? AND r.empresa_id = ? LIMIT 1`, [
    id,
    empresaId,
  ]);
  if (!rows[0]) return null;
  const base = mapRuta(rows[0]);
  const [paradasMap, personalMap, tarifaMap, opcionesTarifa] = await Promise.all([
    paradasDeRutas([base.id]), personalDeRutas(empresaId, [base.id]), ultimaTarifaDeRutas(empresaId, [base.id]),
    tarifasActivasDeRuta(empresaId, base.id),
  ]);
  const ultima = tarifaMap.get(base.id);
  return {
    ...base,
    paradas: paradasMap.get(base.id) ?? [],
    personalPredeterminado: personalMap.get(base.id) ?? [],
    tarifaVigenteDesde: ultima?.vigenteDesde ?? null,
    tarifaUltimoCambioEn: ultima?.creadoEn ?? null,
    tarifaModificadoPor: ultima?.usuarioNombre ?? null,
    tarifasActivas: opcionesTarifa.tarifas,
    tarifaPredeterminadaId: opcionesTarifa.predeterminadaId,
  };
}

export type ClienteRutaInput = {
  clienteId: number;
  codigo: string;
  nombre?: string | null;
  ubicacionCargaId?: number | null;
  lugarCargaTexto?: string | null;
  destinoDescripcion?: string | null;
  horaHabitual?: string | null;
  tarifaReferencia?: number | null;
  /** RUTAS-TARIFARIO-HISTORIAL-1 (§5 del ticket) — SOLO metadatos del cambio de tarifa; nunca se guardan como columna de tms_cliente_rutas, alimentan tms_cliente_ruta_tarifas (registrarCambioTarifaTx). Ignorados si tarifaReferencia no viene o no cambió. */
  tarifaVigenteDesde?: string | null;
  tarifaMotivo?: string | null;
  /** RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4/§5) — flota_vehiculos.id de la MISMA empresa; null la quita. Validado antes de escribir. */
  unidadRecurrenteId?: number | null;
  contactoClienteId?: number | null;
  observaciones?: string | null;
  paradas?: RutaParadaInput[];
  personalPredeterminado?: RutaPersonalInput[];
};

/** Identidad real de sesión (nunca username) para el snapshot del historial de tarifas — ver registrarCambioTarifaTx. Opcional para no romper llamadores existentes (tests, rutas-import.ts) que todavía no la pasan. */
export type ActorRuta = { usuarioId: number; nombre: string } | null;

async function validarPersonalRuta(conn: PoolConnection, empresaId: number, personal: RutaPersonalInput[]): Promise<void> {
  if (personal.length > 9) throw new Error("Una ruta admite como máximo un piloto y ocho auxiliares.");
  if (personal.filter((p) => p.rol === "Piloto").length > 1) throw new Error("Solo puedes definir un piloto habitual por ruta.");
  // §9/§12 del ticket — "hasta 8 auxiliares" es un tope PROPIO, no solo
  // una consecuencia del tope total de 9 (una ruta sin piloto no puede
  // colar un noveno auxiliar aprovechando el hueco del piloto ausente).
  if (personal.filter((p) => p.rol === "Auxiliar").length > 8) throw new Error("Una ruta admite como máximo 8 auxiliares.");
  const ids = personal.map((p) => p.empleadoId);
  if (new Set(ids).size !== ids.length) throw new Error("No repitas al mismo empleado en la ruta.");
  if (personal.some((p) => !Number.isInteger(p.empleadoId) || p.empleadoId < 1 || (p.viaticoMonto != null && (!Number.isFinite(p.viaticoMonto) || p.viaticoMonto < 0)))) {
    throw new Error("Personal o monto de viático inválido.");
  }
  if (!ids.length) return;
  const rows = await queryConn<RowDataPacket[]>(conn,
    `SELECT id FROM empleados WHERE empresa_id = ? AND estado = 'Activo'
     AND id IN (${ids.map(() => "?").join(",")})`,
    [empresaId, ...ids],
  );
  if (rows.length !== ids.length) throw new Error("Uno o más empleados no existen, están inactivos o pertenecen a otra empresa.");
}

async function guardarPersonalRuta(conn: PoolConnection, empresaId: number, rutaId: number, personal: RutaPersonalInput[]): Promise<void> {
  await validarPersonalRuta(conn, empresaId, personal);
  await executeConn(conn, "DELETE FROM tms_cliente_ruta_personal WHERE empresa_id = ? AND ruta_id = ?", [empresaId, rutaId]);
  let pilotoOrden = 1;
  let auxiliarOrden = 1;
  for (const persona of personal) {
    const orden = persona.rol === "Piloto" ? pilotoOrden++ : auxiliarOrden++;
    await executeConn(conn,
      `INSERT INTO tms_cliente_ruta_personal
        (empresa_id, ruta_id, empleado_id, rol, orden, viatico_monto)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, rutaId, persona.empleadoId, persona.rol, orden, persona.viaticoMonto ?? null],
    );
  }
}

async function guardarParadasRuta(
  conn: PoolConnection,
  empresaId: number,
  rutaId: number,
  paradas: RutaParadaInput[],
): Promise<void> {
  // Reemplazo total, mismo patrón que guardarParadasPlan (src/lib/tms/paradas.ts):
  // borra y vuelve a insertar en el orden recibido. No es un DELETE de la
  // ruta ni de viajes ya copiados — solo de las paradas de LA PLANTILLA.
  // Independiente de destino_descripcion: las paradas estructuradas
  // siguen existiendo aparte, esta función nunca las reemplaza por texto.
  await executeConn(conn, "DELETE FROM tms_cliente_ruta_paradas WHERE empresa_id = ? AND ruta_id = ?", [empresaId, rutaId]);
  let orden = 1;
  for (const p of paradas) {
    const nombre = (p.lugarNombre || "").trim();
    if (!nombre) continue;
    // §12 del ticket — "paradas válidas": la ubicación referenciada (si
    // viene) debe pertenecer a esta empresa, mismo criterio que la
    // ubicación de carga de la ruta.
    await validarUbicacionDeEmpresaTx(conn, empresaId, p.clienteUbicacionId);
    await executeConn(conn,
      `INSERT INTO tms_cliente_ruta_paradas
        (empresa_id, ruta_id, cliente_ubicacion_id, orden, tipo, lugar_nombre)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [empresaId, rutaId, p.clienteUbicacionId ?? null, orden++, p.tipo || "Entrega", nombre],
    );
  }
}

/**
 * Resuelve el texto de "lugar de carga" a guardar: si se escribió texto
 * libre, ese manda; si no, pero se eligió una ubicación del catálogo, se
 * copia SU nombre ahora mismo (fotografía) — así lugar_carga_texto queda
 * siempre poblado cuando hay carga configurada, sin que Programación
 * tenga que resolver ubicacion_carga_id por separado al copiar la ruta.
 */
async function resolverLugarCargaTexto(
  conn: PoolConnection,
  empresaId: number,
  ubicacionCargaId: number | null | undefined,
  lugarCargaTexto: string | null | undefined,
): Promise<string | null> {
  const texto = lugarCargaTexto?.trim();
  if (texto) return texto;
  if (!ubicacionCargaId) return null;
  const rows = await queryConn<RowDataPacket[]>(conn,
    "SELECT nombre FROM tms_cliente_ubicaciones WHERE id = ? AND empresa_id = ? LIMIT 1",
    [ubicacionCargaId, empresaId],
  );
  return rows[0]?.nombre ? String(rows[0].nombre) : null;
}

/**
 * VIAT-4b — código único por EMPRESA (no por cliente); ver nota de
 * diseño en la migración.
 *
 * RUTAS-TARIFARIO-HISTORIAL-1 — `actor` (§1 del ticket, identidad real
 * de sesión) alimenta el snapshot de `usuario_id`/`usuario_nombre` del
 * historial de tarifa cuando `input.tarifaReferencia` viene con valor
 * ("tarifa inicial"). §12: valida cliente/contacto/ubicación contra esta
 * empresa ANTES de escribir nada.
 */
export async function crearRuta(
  empresaId: number,
  input: ClienteRutaInput,
  actor?: ActorRuta,
): Promise<ClienteRuta> {
  const codigo = input.codigo.trim();
  if (!codigo) throw new Error("Código de ruta requerido.");
  if (!input.clienteId) throw new Error("Cliente requerido.");
  const conn = await getPool().getConnection();
  let rutaId = 0;
  try {
    await conn.beginTransaction();
    if (input.personalPredeterminado !== undefined) {
      await validarPersonalRuta(conn, empresaId, input.personalPredeterminado);
    }
    await validarClienteDeEmpresaTx(conn, empresaId, input.clienteId);
    await validarContactoDeClienteTx(conn, empresaId, input.clienteId, input.contactoClienteId);
    await validarUbicacionDeEmpresaTx(conn, empresaId, input.ubicacionCargaId);
    await validarUnidadRecurrenteTx(conn, empresaId, input.unidadRecurrenteId);
    const existente = await queryConn<RowDataPacket[]>(conn,
      "SELECT id FROM tms_cliente_rutas WHERE empresa_id = ? AND codigo = ? LIMIT 1 FOR UPDATE",
      [empresaId, codigo],
    );
    if (existente[0]) throw new Error(`El código "${codigo}" ya existe en esta empresa (el código es único, no por cliente).`);
    const lugarCargaTexto = await resolverLugarCargaTexto(conn, empresaId, input.ubicacionCargaId, input.lugarCargaTexto);
    const r = await executeConn(conn,
      `INSERT INTO tms_cliente_rutas
        (empresa_id, cliente_id, codigo, nombre, ubicacion_carga_id, lugar_carga_texto, destino_descripcion, hora_habitual, tarifa_referencia, unidad_recurrente_id, contacto_cliente_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, input.clienteId, codigo, input.nombre?.trim() || null, input.ubicacionCargaId ?? null,
        lugarCargaTexto, input.destinoDescripcion?.trim() || null, input.horaHabitual?.trim() || null,
        input.tarifaReferencia ?? null, input.unidadRecurrenteId ?? null, input.contactoClienteId ?? null, input.observaciones?.trim() || null],
    );
    rutaId = Number(r.insertId);
    if (input.paradas !== undefined) await guardarParadasRuta(conn, empresaId, rutaId, input.paradas);
    if (input.personalPredeterminado !== undefined) await guardarPersonalRuta(conn, empresaId, rutaId, input.personalPredeterminado);
    await registrarCambioTarifaTx(conn, {
      empresaId, rutaId, tarifaAnterior: null, tarifaNueva: input.tarifaReferencia ?? null,
      vigenteDesde: input.tarifaVigenteDesde, motivo: input.tarifaMotivo ?? "Tarifa inicial",
      usuarioId: actor?.usuarioId, usuarioNombre: actor?.nombre,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return (await obtenerRuta(empresaId, rutaId))!;
}

export type ClienteRutaUpdate = Partial<Omit<ClienteRutaInput, "clienteId">> & {
  activo?: boolean;
};

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 — §3: encabezado + historial de tarifa en
 * la MISMA transacción (si cambió); §5: exige `tarifaMotivo` cuando YA
 * existía una tarifa anterior (no aplica a la primera vez que se define
 * una tarifa); §12: valida contacto/ubicación contra esta empresa/
 * cliente antes de escribir.
 */
export async function actualizarRuta(
  empresaId: number,
  id: number,
  cambios: ClienteRutaUpdate,
  actor?: ActorRuta,
): Promise<ClienteRuta | null> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    if (cambios.personalPredeterminado !== undefined) await validarPersonalRuta(conn, empresaId, cambios.personalPredeterminado);
    const actuales = await queryConn<RowDataPacket[]>(conn, `${SELECT_RUTA} WHERE r.id = ? AND r.empresa_id = ? LIMIT 1 FOR UPDATE`, [id, empresaId]);
    if (!actuales[0]) {
      await conn.rollback();
      return null;
    }
    const actual = { ...mapRuta(actuales[0]), paradas: [], personalPredeterminado: [] };

  const codigo = cambios.codigo !== undefined ? cambios.codigo.trim() : actual.codigo;
  if (!codigo) throw new Error("Código de ruta requerido.");
  if (codigo !== actual.codigo) {
    const existente = await queryConn<RowDataPacket[]>(conn,
      "SELECT id FROM tms_cliente_rutas WHERE empresa_id = ? AND codigo = ? AND id <> ? LIMIT 1",
      [empresaId, codigo, id],
    );
    if (existente[0]) {
      throw new Error(`El código "${codigo}" ya existe en esta empresa (el código es único, no por cliente).`);
    }
  }

  await validarContactoDeClienteTx(conn, empresaId, actual.clienteId, cambios.contactoClienteId !== undefined ? cambios.contactoClienteId : actual.contactoClienteId);
  await validarUbicacionDeEmpresaTx(conn, empresaId, cambios.ubicacionCargaId !== undefined ? cambios.ubicacionCargaId : actual.ubicacionCargaId);
  if (cambios.unidadRecurrenteId !== undefined) {
    await validarUnidadRecurrenteTx(conn, empresaId, cambios.unidadRecurrenteId);
  }

  // §5 del ticket: "Motivo obligatorio cuando exista una tarifa anterior."
  const tarifaNueva = cambios.tarifaReferencia !== undefined ? cambios.tarifaReferencia ?? null : actual.tarifaReferencia;
  const tarifaCambio = cambios.tarifaReferencia !== undefined
    && tarifaNueva != null
    && (actual.tarifaReferencia == null || Number(actual.tarifaReferencia) !== Number(tarifaNueva));
  if (tarifaCambio && actual.tarifaReferencia != null && !cambios.tarifaMotivo?.trim()) {
    throw new Error("El motivo del cambio de tarifa es obligatorio cuando ya existe una tarifa anterior.");
  }

  const ubicacionCargaIdEfectiva =
    cambios.ubicacionCargaId !== undefined ? cambios.ubicacionCargaId ?? null : actual.ubicacionCargaId;
  const lugarCargaTextoEfectivo =
    cambios.lugarCargaTexto !== undefined || cambios.ubicacionCargaId !== undefined
      ? await resolverLugarCargaTexto(conn, empresaId, ubicacionCargaIdEfectiva, cambios.lugarCargaTexto)
      : actual.lugarCargaTexto;

  await executeConn(conn,
    `UPDATE tms_cliente_rutas
     SET codigo = ?, nombre = ?, ubicacion_carga_id = ?, lugar_carga_texto = ?, destino_descripcion = ?,
         hora_habitual = ?, tarifa_referencia = ?, unidad_recurrente_id = ?, contacto_cliente_id = ?, observaciones = ?, activo = ?
     WHERE id = ? AND empresa_id = ?`,
    [
      codigo,
      cambios.nombre !== undefined ? cambios.nombre?.trim() || null : actual.nombre,
      ubicacionCargaIdEfectiva,
      lugarCargaTextoEfectivo,
      cambios.destinoDescripcion !== undefined
        ? cambios.destinoDescripcion?.trim() || null
        : actual.destinoDescripcion,
      cambios.horaHabitual !== undefined ? cambios.horaHabitual?.trim() || null : actual.horaHabitual,
      tarifaNueva,
      cambios.unidadRecurrenteId !== undefined ? cambios.unidadRecurrenteId ?? null : actual.unidadRecurrenteId,
      cambios.contactoClienteId !== undefined
        ? cambios.contactoClienteId ?? null
        : actual.contactoClienteId,
      cambios.observaciones !== undefined ? cambios.observaciones?.trim() || null : actual.observaciones,
      cambios.activo !== undefined ? (cambios.activo ? 1 : 0) : actual.activo ? 1 : 0,
      id,
      empresaId,
    ],
  );
  if (cambios.paradas !== undefined) {
    await guardarParadasRuta(conn, empresaId, id, cambios.paradas);
  }
  if (cambios.personalPredeterminado !== undefined) {
    await guardarPersonalRuta(conn, empresaId, id, cambios.personalPredeterminado);
  }
  if (tarifaCambio) {
    await registrarCambioTarifaTx(conn, {
      empresaId, rutaId: id, tarifaAnterior: actual.tarifaReferencia, tarifaNueva,
      vigenteDesde: cambios.tarifaVigenteDesde, motivo: cambios.tarifaMotivo,
      usuarioId: actor?.usuarioId, usuarioNombre: actor?.nombre,
    });
  }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerRuta(empresaId, id);
}
