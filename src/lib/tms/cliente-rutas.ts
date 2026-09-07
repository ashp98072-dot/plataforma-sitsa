import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";

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
 */

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
  costoOperativo: number | null;
  contactoClienteId: number | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
  observaciones: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
  paradas: RutaParada[];
  personalPredeterminado: RutaPersonal[];
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
    costoOperativo: r.costo_operativo != null ? Number(r.costo_operativo) : null,
    contactoClienteId: r.contacto_cliente_id != null ? Number(r.contacto_cliente_id) : null,
    contactoNombre: r.contacto_nombre != null ? String(r.contacto_nombre) : null,
    contactoCargo: r.contacto_cargo != null ? String(r.contacto_cargo) : null,
    contactoTelefono: r.contacto_telefono != null ? String(r.contacto_telefono) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    activo: Number(r.activo ?? 1) === 1,
    creadoEn: String(r.creado_en ?? ""),
    actualizadoEn: String(r.actualizado_en ?? ""),
    personalPredeterminado: [],
  };
}

const SELECT_RUTA = `
  SELECT r.id, r.cliente_id, c.nombre AS cliente_nombre, r.codigo, r.nombre,
         r.ubicacion_carga_id, r.lugar_carga_texto, r.destino_descripcion, r.hora_habitual,
         r.tarifa_referencia, r.costo_operativo,
         r.contacto_cliente_id, ct.nombre AS contacto_nombre, ct.cargo AS contacto_cargo,
         ct.telefono AS contacto_telefono,
         r.observaciones, r.activo, r.creado_en, r.actualizado_en
  FROM tms_cliente_rutas r
  INNER JOIN tms_clientes c ON c.id = r.cliente_id
  LEFT JOIN tms_cliente_contactos ct ON ct.id = r.contacto_cliente_id
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
  if (!filtros.incluirInactivas) condiciones.push("r.activo = 1");
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
  const [paradasMap, personalMap] = await Promise.all([paradasDeRutas(ids), personalDeRutas(empresaId, ids)]);
  return base.map((r) => ({
    ...r,
    paradas: paradasMap.get(r.id) ?? [],
    personalPredeterminado: personalMap.get(r.id) ?? [],
  }));
}

export async function obtenerRuta(empresaId: number, id: number): Promise<ClienteRuta | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_RUTA} WHERE r.id = ? AND r.empresa_id = ? LIMIT 1`, [
    id,
    empresaId,
  ]);
  if (!rows[0]) return null;
  const base = mapRuta(rows[0]);
  const [paradasMap, personalMap] = await Promise.all([paradasDeRutas([base.id]), personalDeRutas(empresaId, [base.id])]);
  return {
    ...base,
    paradas: paradasMap.get(base.id) ?? [],
    personalPredeterminado: personalMap.get(base.id) ?? [],
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
  costoOperativo?: number | null;
  contactoClienteId?: number | null;
  observaciones?: string | null;
  paradas?: RutaParadaInput[];
  personalPredeterminado?: RutaPersonalInput[];
};

async function validarPersonalRuta(conn: PoolConnection, empresaId: number, personal: RutaPersonalInput[]): Promise<void> {
  if (personal.length > 9) throw new Error("Una ruta admite como máximo un piloto y ocho auxiliares.");
  if (personal.filter((p) => p.rol === "Piloto").length > 1) throw new Error("Solo puedes definir un piloto habitual por ruta.");
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

/** VIAT-4b — código único por EMPRESA (no por cliente); ver nota de diseño en la migración. */
export async function crearRuta(
  empresaId: number,
  input: ClienteRutaInput,
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
    const existente = await queryConn<RowDataPacket[]>(conn,
      "SELECT id FROM tms_cliente_rutas WHERE empresa_id = ? AND codigo = ? LIMIT 1 FOR UPDATE",
      [empresaId, codigo],
    );
    if (existente[0]) throw new Error(`El código "${codigo}" ya existe en esta empresa (el código es único, no por cliente).`);
    const lugarCargaTexto = await resolverLugarCargaTexto(conn, empresaId, input.ubicacionCargaId, input.lugarCargaTexto);
    const r = await executeConn(conn,
      `INSERT INTO tms_cliente_rutas
        (empresa_id, cliente_id, codigo, nombre, ubicacion_carga_id, lugar_carga_texto, destino_descripcion, hora_habitual, tarifa_referencia, costo_operativo, contacto_cliente_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, input.clienteId, codigo, input.nombre?.trim() || null, input.ubicacionCargaId ?? null,
        lugarCargaTexto, input.destinoDescripcion?.trim() || null, input.horaHabitual?.trim() || null,
        input.tarifaReferencia ?? null, input.costoOperativo ?? null, input.contactoClienteId ?? null, input.observaciones?.trim() || null],
    );
    rutaId = Number(r.insertId);
    if (input.paradas !== undefined) await guardarParadasRuta(conn, empresaId, rutaId, input.paradas);
    if (input.personalPredeterminado !== undefined) await guardarPersonalRuta(conn, empresaId, rutaId, input.personalPredeterminado);
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

export async function actualizarRuta(
  empresaId: number,
  id: number,
  cambios: ClienteRutaUpdate,
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

  const ubicacionCargaIdEfectiva =
    cambios.ubicacionCargaId !== undefined ? cambios.ubicacionCargaId ?? null : actual.ubicacionCargaId;
  const lugarCargaTextoEfectivo =
    cambios.lugarCargaTexto !== undefined || cambios.ubicacionCargaId !== undefined
      ? await resolverLugarCargaTexto(conn, empresaId, ubicacionCargaIdEfectiva, cambios.lugarCargaTexto)
      : actual.lugarCargaTexto;

  await executeConn(conn,
    `UPDATE tms_cliente_rutas
     SET codigo = ?, nombre = ?, ubicacion_carga_id = ?, lugar_carga_texto = ?, destino_descripcion = ?,
         hora_habitual = ?, tarifa_referencia = ?, costo_operativo = ?, contacto_cliente_id = ?, observaciones = ?, activo = ?
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
      cambios.tarifaReferencia !== undefined ? cambios.tarifaReferencia ?? null : actual.tarifaReferencia,
      cambios.costoOperativo !== undefined ? cambios.costoOperativo ?? null : actual.costoOperativo,
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
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerRuta(empresaId, id);
}
