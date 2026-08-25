import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

/**
 * VIAT-4 (punto 2 — "Operaciones > Rutas") — catálogo maestro de rutas/
 * servicios preconfigurados por cliente, a partir de la hoja "CODIGOS
 * DATA" del Excel operativo real. Es una PLANTILLA: Programación COPIA
 * sus datos al viaje (ver src/app/api/empresas/[slug]/tms/planes/route.ts,
 * campos ruta_id/ruta_codigo_historico) — cambiar o desactivar una ruta
 * después NUNCA altera viajes ya creados.
 *
 * No duplica maestros: cliente_id referencia tms_clientes;
 * ubicacion_carga_id y las paradas de la ruta referencian
 * tms_cliente_ubicaciones (VIAT-1); contacto_cliente_id referencia
 * tms_cliente_contactos (VIAT-4). Esquema: NO se crea/altera desde este
 * módulo — asume que sql/migrate-2026-08-viat-4-contactos-rutas.sql ya se
 * aplicó manualmente.
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

export type ClienteRuta = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  codigo: string;
  nombre: string | null;
  ubicacionCargaId: number | null;
  lugarCargaTexto: string | null;
  horaHabitual: string | null;
  contactoClienteId: number | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
  observaciones: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
  paradas: RutaParada[];
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
    horaHabitual: r.hora_habitual != null ? String(r.hora_habitual) : null,
    contactoClienteId: r.contacto_cliente_id != null ? Number(r.contacto_cliente_id) : null,
    contactoNombre: r.contacto_nombre != null ? String(r.contacto_nombre) : null,
    contactoCargo: r.contacto_cargo != null ? String(r.contacto_cargo) : null,
    contactoTelefono: r.contacto_telefono != null ? String(r.contacto_telefono) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    activo: Number(r.activo ?? 1) === 1,
    creadoEn: String(r.creado_en ?? ""),
    actualizadoEn: String(r.actualizado_en ?? ""),
  };
}

const SELECT_RUTA = `
  SELECT r.id, r.cliente_id, c.nombre AS cliente_nombre, r.codigo, r.nombre,
         r.ubicacion_carga_id, r.lugar_carga_texto, r.hora_habitual,
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

export type FiltrosRutas = {
  clienteId?: number;
  codigo?: string;
  q?: string; // busca en código, nombre de ruta y nombre de cliente
  incluirInactivas?: boolean;
};

/**
 * Buscar/listar rutas (Operaciones > Rutas y el selector de Programación).
 * Búsqueda de dos formas (punto "CÓDIGO" de VIAT-4): por código exacto/
 * parcial, o filtrando primero por cliente — ambas funcionan a la vez si
 * se combinan.
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
  if (filtros.q?.trim()) {
    condiciones.push("(r.codigo LIKE ? OR r.nombre LIKE ? OR c.nombre LIKE ?)");
    const like = `%${filtros.q.trim()}%`;
    params.push(like, like, like);
  }
  const rows = await query<RowDataPacket[]>(
    `${SELECT_RUTA} WHERE ${condiciones.join(" AND ")} ORDER BY c.nombre, r.codigo LIMIT 200`,
    params,
  );
  const base = rows.map(mapRuta);
  const paradasMap = await paradasDeRutas(base.map((r) => r.id));
  return base.map((r) => ({ ...r, paradas: paradasMap.get(r.id) ?? [] }));
}

export async function obtenerRuta(empresaId: number, id: number): Promise<ClienteRuta | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_RUTA} WHERE r.id = ? AND r.empresa_id = ? LIMIT 1`, [
    id,
    empresaId,
  ]);
  if (!rows[0]) return null;
  const base = mapRuta(rows[0]);
  const paradasMap = await paradasDeRutas([base.id]);
  return { ...base, paradas: paradasMap.get(base.id) ?? [] };
}

export type ClienteRutaInput = {
  clienteId: number;
  codigo: string;
  nombre?: string | null;
  ubicacionCargaId?: number | null;
  lugarCargaTexto?: string | null;
  horaHabitual?: string | null;
  contactoClienteId?: number | null;
  observaciones?: string | null;
  paradas?: RutaParadaInput[];
};

async function guardarParadasRuta(
  empresaId: number,
  rutaId: number,
  paradas: RutaParadaInput[],
): Promise<void> {
  // Reemplazo total, mismo patrón que guardarParadasPlan (src/lib/tms/paradas.ts):
  // borra y vuelve a insertar en el orden recibido. No es un DELETE de la
  // ruta ni de viajes ya copiados — solo de las paradas de LA PLANTILLA.
  await execute("DELETE FROM tms_cliente_ruta_paradas WHERE ruta_id = ?", [rutaId]);
  let orden = 1;
  for (const p of paradas) {
    const nombre = (p.lugarNombre || "").trim();
    if (!nombre) continue;
    await execute(
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
  empresaId: number,
  ubicacionCargaId: number | null | undefined,
  lugarCargaTexto: string | null | undefined,
): Promise<string | null> {
  const texto = lugarCargaTexto?.trim();
  if (texto) return texto;
  if (!ubicacionCargaId) return null;
  const rows = await query<RowDataPacket[]>(
    "SELECT nombre FROM tms_cliente_ubicaciones WHERE id = ? AND empresa_id = ? LIMIT 1",
    [ubicacionCargaId, empresaId],
  );
  return rows[0]?.nombre ? String(rows[0].nombre) : null;
}

/** Código único por CLIENTE (no global) — ver nota de diseño en la migración. */
export async function crearRuta(
  empresaId: number,
  input: ClienteRutaInput,
): Promise<ClienteRuta> {
  const codigo = input.codigo.trim();
  if (!codigo) throw new Error("Código de ruta requerido.");
  if (!input.clienteId) throw new Error("Cliente requerido.");

  const existente = await query<RowDataPacket[]>(
    "SELECT id FROM tms_cliente_rutas WHERE empresa_id = ? AND cliente_id = ? AND codigo = ? LIMIT 1",
    [empresaId, input.clienteId, codigo],
  );
  if (existente[0]) {
    throw new Error(`El código "${codigo}" ya existe para este cliente.`);
  }

  const lugarCargaTexto = await resolverLugarCargaTexto(
    empresaId,
    input.ubicacionCargaId,
    input.lugarCargaTexto,
  );
  const r = await execute(
    `INSERT INTO tms_cliente_rutas
      (empresa_id, cliente_id, codigo, nombre, ubicacion_carga_id, lugar_carga_texto, hora_habitual, contacto_cliente_id, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      input.clienteId,
      codigo,
      input.nombre?.trim() || null,
      input.ubicacionCargaId ?? null,
      lugarCargaTexto,
      input.horaHabitual?.trim() || null,
      input.contactoClienteId ?? null,
      input.observaciones?.trim() || null,
    ],
  );
  const rutaId = Number(r.insertId);
  if (input.paradas?.length) {
    await guardarParadasRuta(empresaId, rutaId, input.paradas);
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
  const actual = await obtenerRuta(empresaId, id);
  if (!actual) return null;

  const codigo = cambios.codigo !== undefined ? cambios.codigo.trim() : actual.codigo;
  if (!codigo) throw new Error("Código de ruta requerido.");
  if (codigo !== actual.codigo) {
    const existente = await query<RowDataPacket[]>(
      "SELECT id FROM tms_cliente_rutas WHERE empresa_id = ? AND cliente_id = ? AND codigo = ? AND id <> ? LIMIT 1",
      [empresaId, actual.clienteId, codigo, id],
    );
    if (existente[0]) {
      throw new Error(`El código "${codigo}" ya existe para este cliente.`);
    }
  }

  const ubicacionCargaIdEfectiva =
    cambios.ubicacionCargaId !== undefined ? cambios.ubicacionCargaId ?? null : actual.ubicacionCargaId;
  const lugarCargaTextoEfectivo =
    cambios.lugarCargaTexto !== undefined || cambios.ubicacionCargaId !== undefined
      ? await resolverLugarCargaTexto(empresaId, ubicacionCargaIdEfectiva, cambios.lugarCargaTexto)
      : actual.lugarCargaTexto;

  await execute(
    `UPDATE tms_cliente_rutas
     SET codigo = ?, nombre = ?, ubicacion_carga_id = ?, lugar_carga_texto = ?, hora_habitual = ?,
         contacto_cliente_id = ?, observaciones = ?, activo = ?
     WHERE id = ? AND empresa_id = ?`,
    [
      codigo,
      cambios.nombre !== undefined ? cambios.nombre?.trim() || null : actual.nombre,
      ubicacionCargaIdEfectiva,
      lugarCargaTextoEfectivo,
      cambios.horaHabitual !== undefined ? cambios.horaHabitual?.trim() || null : actual.horaHabitual,
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
    await guardarParadasRuta(empresaId, id, cambios.paradas);
  }
  return obtenerRuta(empresaId, id);
}
