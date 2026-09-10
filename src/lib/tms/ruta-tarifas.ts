import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1)
 *
 * Catálogo de opciones de tarifa por ruta (`tms_ruta_tarifas`): una ruta
 * puede tener VARIAS tarifas activas al mismo tiempo. Cada viaje elige una
 * y guarda su snapshot en `tms_planes_viaje` — si mañana cambia una tarifa
 * maestra, los viajes anteriores NO cambian de monto (ver planes/route.ts,
 * columnas tarifa_*_historico).
 *
 * NO reemplaza a `tms_cliente_ruta_tarifas` (historial append-only de
 * cambios de `tarifa_referencia`, sin tocar) — son cosas distintas.
 *
 * `tms_cliente_rutas.tarifa_referencia` se mantiene SINCRONIZADO con el
 * `monto` de la tarifa PREDETERMINADA activa (o NULL si no hay ninguna):
 * así todo lo que ya lo lee (ruta-defaults.ts, cotizaciones.ts,
 * rutas-export-excel.ts, rutas-import.ts) sigue funcionando sin cambios.
 *
 * "Solo una predeterminada activa por ruta" se garantiza aquí, dentro de
 * la transacción (mismo criterio que guardarPersonalRuta en
 * cliente-rutas.ts). La auditoría de cada cambio va a la tabla `auditoria`
 * genérica; la fila guarda además actualizado_por/_en.
 */

async function q<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}

export type ActorTarifa = { usuarioId: number; nombre: string } | null;

export type RutaTarifa = {
  id: number;
  rutaId: number;
  nombre: string;
  descripcion: string | null;
  monto: number;
  moneda: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
  predeterminada: boolean;
  observacion: string | null;
  creadoPorNombre: string | null;
  creadoEn: string;
  actualizadoPorNombre: string | null;
  actualizadoEn: string;
};

export type RutaTarifaInput = {
  nombre: string;
  descripcion?: string | null;
  monto: number;
  moneda?: string | null;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
  observacion?: string | null;
  /** Solo aplica al crear: si true (y no hay otra), nace como predeterminada. */
  predeterminada?: boolean;
};

export type RutaTarifaUpdate = {
  nombre?: string;
  descripcion?: string | null;
  monto?: number;
  moneda?: string | null;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
  observacion?: string | null;
};

const SELECT_TARIFA = `
  SELECT id, ruta_id, nombre, descripcion, monto, moneda,
         DATE_FORMAT(vigente_desde, '%Y-%m-%d') AS vigente_desde,
         DATE_FORMAT(vigente_hasta, '%Y-%m-%d') AS vigente_hasta,
         activa, predeterminada, observacion,
         creado_por_nombre, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i') AS creado_en,
         actualizado_por_nombre, DATE_FORMAT(actualizado_en, '%Y-%m-%d %H:%i') AS actualizado_en
  FROM tms_ruta_tarifas
`;

function mapTarifa(r: RowDataPacket): RutaTarifa {
  return {
    id: Number(r.id),
    rutaId: Number(r.ruta_id),
    nombre: String(r.nombre),
    descripcion: r.descripcion != null ? String(r.descripcion) : null,
    monto: Number(r.monto),
    moneda: String(r.moneda ?? "GTQ"),
    vigenteDesde: String(r.vigente_desde),
    vigenteHasta: r.vigente_hasta != null ? String(r.vigente_hasta) : null,
    activa: Number(r.activa ?? 0) === 1,
    predeterminada: Number(r.predeterminada ?? 0) === 1,
    observacion: r.observacion != null ? String(r.observacion) : null,
    creadoPorNombre: r.creado_por_nombre != null ? String(r.creado_por_nombre) : null,
    creadoEn: String(r.creado_en ?? ""),
    actualizadoPorNombre: r.actualizado_por_nombre != null ? String(r.actualizado_por_nombre) : null,
    actualizadoEn: String(r.actualizado_en ?? ""),
  };
}

/** Todas las tarifas de una ruta (activas e inactivas), predeterminada primero. */
export async function listarTarifasDeRuta(empresaId: number, rutaId: number): Promise<RutaTarifa[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_TARIFA} WHERE empresa_id = ? AND ruta_id = ?
     ORDER BY predeterminada DESC, activa DESC, nombre ASC, id ASC`,
    [empresaId, rutaId],
  );
  return rows.map(mapTarifa);
}

export type TarifaProgramacion = { id: number; nombre: string; monto: number; moneda: string; predeterminada: boolean };

/**
 * §2 — tarifas ACTIVAS de una ruta para el selector de Programación, con
 * la predeterminada marcada. Solo lo mínimo para elegir y snapshotear.
 */
export async function tarifasActivasDeRuta(
  empresaId: number,
  rutaId: number,
): Promise<{ tarifas: TarifaProgramacion[]; predeterminadaId: number | null }> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, monto, moneda, predeterminada
     FROM tms_ruta_tarifas
     WHERE empresa_id = ? AND ruta_id = ? AND activa = 1
       AND (vigente_hasta IS NULL OR vigente_hasta >= CURDATE())
     ORDER BY predeterminada DESC, nombre ASC, id ASC`,
    [empresaId, rutaId],
  );
  const tarifas: TarifaProgramacion[] = rows.map((r) => ({
    id: Number(r.id),
    nombre: String(r.nombre),
    monto: Number(r.monto),
    moneda: String(r.moneda ?? "GTQ"),
    predeterminada: Number(r.predeterminada ?? 0) === 1,
  }));
  const predeterminadaId = tarifas.find((t) => t.predeterminada)?.id ?? null;
  return { tarifas, predeterminadaId };
}

/** Igual que tarifasActivasDeRuta pero en lote (para listarRutas). */
export async function tarifasActivasDeVariasRutas(
  empresaId: number,
  rutaIds: number[],
): Promise<Map<number, { tarifas: TarifaProgramacion[]; predeterminadaId: number | null }>> {
  const map = new Map<number, { tarifas: TarifaProgramacion[]; predeterminadaId: number | null }>();
  const ids = [...new Set(rutaIds.map(Number).filter((n) => n > 0))];
  if (!ids.length) return map;
  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_id, id, nombre, monto, moneda, predeterminada
     FROM tms_ruta_tarifas
     WHERE empresa_id = ? AND activa = 1
       AND (vigente_hasta IS NULL OR vigente_hasta >= CURDATE())
       AND ruta_id IN (${ids.map(() => "?").join(",")})
     ORDER BY ruta_id, predeterminada DESC, nombre ASC, id ASC`,
    [empresaId, ...ids],
  );
  for (const r of rows) {
    const rutaId = Number(r.ruta_id);
    const entry = map.get(rutaId) ?? { tarifas: [], predeterminadaId: null };
    const t: TarifaProgramacion = {
      id: Number(r.id),
      nombre: String(r.nombre),
      monto: Number(r.monto),
      moneda: String(r.moneda ?? "GTQ"),
      predeterminada: Number(r.predeterminada ?? 0) === 1,
    };
    entry.tarifas.push(t);
    if (t.predeterminada && entry.predeterminadaId == null) entry.predeterminadaId = t.id;
    map.set(rutaId, entry);
  }
  return map;
}

/**
 * Valida que la tarifa exista, sea de ESTA empresa y de la ruta indicada,
 * y esté activa — para el snapshot de Programación (§2/§5). Devuelve la
 * fila mínima para snapshotear, o null si no cumple.
 */
export async function tarifaParaSnapshot(
  empresaId: number,
  rutaId: number,
  tarifaId: number,
): Promise<{ id: number; nombre: string; monto: number; moneda: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, monto, moneda FROM tms_ruta_tarifas
     WHERE id = ? AND empresa_id = ? AND ruta_id = ? AND activa = 1 LIMIT 1`,
    [tarifaId, empresaId, rutaId],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: Number(r.id), nombre: String(r.nombre), monto: Number(r.monto), moneda: String(r.moneda ?? "GTQ") };
}

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§2/§3) — PATCH de planes:
 * decide si hay que LIMPIAR el snapshot de tarifa del viaje (tarifa_id +
 * tarifa_*_historico) porque el PATCH cambió la ruta y NO envió tarifaId,
 * y la tarifa que traía el viaje ya no pertenece a la nueva ruta. Función
 * PURA para poder probar la regla sin la ruta ni la base de datos.
 *
 * Nunca debe quedar "ruta X + tarifa_id de ruta Y": si el PATCH trae
 * tarifaId, esa rama valida y snapshotea por separado (no pasa por aquí).
 */
export function debeLimpiarTarifaPorCambioDeRuta(input: {
  /** d.tarifaId !== undefined (el PATCH trae un id o un null explícito). */
  patchTraeTarifaId: boolean;
  /** El PATCH cambió la ruta del viaje respecto a la guardada. */
  rutaCambio: boolean;
  /** tarifa_id que YA tenía el viaje (null si no tenía). */
  antesTarifaId: number | null;
  /** La tarifa actual sigue existiendo/activa en la NUEVA ruta (misma empresa). */
  tarifaActualSigueEnRutaNueva: boolean;
}): boolean {
  return (
    !input.patchTraeTarifaId &&
    input.rutaCambio &&
    input.antesTarifaId != null &&
    !input.tarifaActualSigueEnRutaNueva
  );
}

/** Verifica pertenencia de la ruta a la empresa dentro de la transacción. */
async function rutaDeEmpresaTx(conn: PoolConnection, empresaId: number, rutaId: number): Promise<void> {
  const rows = await q(conn, "SELECT id FROM tms_cliente_rutas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE", [rutaId, empresaId]);
  if (!rows[0]) throw new Error("La ruta no existe o pertenece a otra empresa.");
}

/** Sincroniza tms_cliente_rutas.tarifa_referencia con la predeterminada activa (o NULL). */
async function sincronizarTarifaReferenciaTx(conn: PoolConnection, empresaId: number, rutaId: number): Promise<void> {
  const rows = await q(conn,
    `SELECT monto FROM tms_ruta_tarifas
     WHERE empresa_id = ? AND ruta_id = ? AND activa = 1 AND predeterminada = 1 LIMIT 1`,
    [empresaId, rutaId],
  );
  const monto = rows[0]?.monto != null ? Number(rows[0].monto) : null;
  await conn.execute(
    "UPDATE tms_cliente_rutas SET tarifa_referencia = ? WHERE id = ? AND empresa_id = ?",
    [monto, rutaId, empresaId],
  );
}

async function auditarTx(
  conn: PoolConnection,
  empresaId: number,
  actor: ActorTarifa,
  accion: string,
  detalle: string,
): Promise<void> {
  await registrarAuditoriaTx(conn, {
    empresaId,
    usuario: actor?.nombre ?? null,
    accion,
    modulo: "tms",
    detalle,
  });
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function fechaOHoy(v: string | null | undefined): string {
  return v && FECHA_RE.test(v) ? v : new Date().toISOString().slice(0, 10);
}
function fechaONull(v: string | null | undefined): string | null {
  return v && FECHA_RE.test(v) ? v : null;
}
function normalizarMoneda(v: string | null | undefined): string {
  const m = (v ?? "GTQ").trim().toUpperCase();
  return m || "GTQ";
}

export async function crearTarifaRuta(
  empresaId: number,
  rutaId: number,
  input: RutaTarifaInput,
  actor: ActorTarifa,
): Promise<RutaTarifa[]> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("El nombre de la tarifa es obligatorio.");
  if (!Number.isFinite(input.monto) || input.monto < 0) throw new Error("El monto de la tarifa debe ser un número mayor o igual a 0.");
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await rutaDeEmpresaTx(conn, empresaId, rutaId);
    const existentesActivas = await q(conn,
      "SELECT COUNT(*) AS n FROM tms_ruta_tarifas WHERE empresa_id = ? AND ruta_id = ? AND activa = 1",
      [empresaId, rutaId],
    );
    // Primera tarifa activa de la ruta -> nace predeterminada aunque no lo pidan.
    const esPrimera = Number(existentesActivas[0]?.n ?? 0) === 0;
    const predeterminada = input.predeterminada === true || esPrimera;
    if (predeterminada) {
      await conn.execute(
        "UPDATE tms_ruta_tarifas SET predeterminada = 0 WHERE empresa_id = ? AND ruta_id = ?",
        [empresaId, rutaId],
      );
    }
    const [r] = await conn.execute(
      `INSERT INTO tms_ruta_tarifas
        (empresa_id, ruta_id, nombre, descripcion, monto, moneda, vigente_desde, vigente_hasta,
         activa, predeterminada, observacion, creado_por, creado_por_nombre, actualizado_por, actualizado_por_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId, rutaId, nombre, input.descripcion?.trim() || null, input.monto, normalizarMoneda(input.moneda),
        fechaOHoy(input.vigenteDesde), fechaONull(input.vigenteHasta), predeterminada ? 1 : 0,
        input.observacion?.trim() || null,
        actor?.usuarioId ?? null, actor?.nombre ?? null, actor?.usuarioId ?? null, actor?.nombre ?? null,
      ],
    );
    const nuevaId = Number((r as { insertId: number }).insertId);
    await sincronizarTarifaReferenciaTx(conn, empresaId, rutaId);
    await auditarTx(conn, empresaId, actor, "ruta_tarifa_crear",
      `Ruta #${rutaId} · tarifa "${nombre}" creada: ${normalizarMoneda(input.moneda)} ${input.monto.toFixed(2)}${predeterminada ? " (predeterminada)" : ""}. tarifa_id=${nuevaId}`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return listarTarifasDeRuta(empresaId, rutaId);
}

/** Carga la tarifa + su ruta validando empresa; lanza si no pertenece. */
async function tarifaDeEmpresaTx(conn: PoolConnection, empresaId: number, tarifaId: number): Promise<RowDataPacket> {
  const rows = await q(conn,
    "SELECT * FROM tms_ruta_tarifas WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
    [tarifaId, empresaId],
  );
  if (!rows[0]) throw new Error("La tarifa no existe o pertenece a otra empresa.");
  return rows[0];
}

export async function actualizarTarifaRuta(
  empresaId: number,
  tarifaId: number,
  cambios: RutaTarifaUpdate,
  actor: ActorTarifa,
): Promise<RutaTarifa[]> {
  const conn = await getPool().getConnection();
  let rutaId = 0;
  try {
    await conn.beginTransaction();
    const actual = await tarifaDeEmpresaTx(conn, empresaId, tarifaId);
    rutaId = Number(actual.ruta_id);
    const nombre = cambios.nombre !== undefined ? cambios.nombre.trim() : String(actual.nombre);
    if (!nombre) throw new Error("El nombre de la tarifa es obligatorio.");
    const monto = cambios.monto !== undefined ? cambios.monto : Number(actual.monto);
    if (!Number.isFinite(monto) || monto < 0) throw new Error("El monto de la tarifa debe ser un número mayor o igual a 0.");
    await conn.execute(
      `UPDATE tms_ruta_tarifas
       SET nombre = ?, descripcion = ?, monto = ?, moneda = ?, vigente_desde = ?, vigente_hasta = ?,
           observacion = ?, actualizado_por = ?, actualizado_por_nombre = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        nombre,
        cambios.descripcion !== undefined ? cambios.descripcion?.trim() || null : (actual.descripcion ?? null),
        monto,
        cambios.moneda !== undefined ? normalizarMoneda(cambios.moneda) : String(actual.moneda ?? "GTQ"),
        cambios.vigenteDesde !== undefined ? fechaOHoy(cambios.vigenteDesde) : String(actual.vigente_desde).slice(0, 10),
        cambios.vigenteHasta !== undefined ? fechaONull(cambios.vigenteHasta) : (actual.vigente_hasta ? String(actual.vigente_hasta).slice(0, 10) : null),
        cambios.observacion !== undefined ? cambios.observacion?.trim() || null : (actual.observacion ?? null),
        actor?.usuarioId ?? null, actor?.nombre ?? null,
        tarifaId, empresaId,
      ],
    );
    await sincronizarTarifaReferenciaTx(conn, empresaId, rutaId);
    await auditarTx(conn, empresaId, actor, "ruta_tarifa_editar",
      `Ruta #${rutaId} · tarifa "${nombre}" editada (monto ${Number(actual.monto).toFixed(2)} -> ${monto.toFixed(2)}). tarifa_id=${tarifaId}`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return listarTarifasDeRuta(empresaId, rutaId);
}

export async function cambiarEstadoTarifa(
  empresaId: number,
  tarifaId: number,
  activa: boolean,
  actor: ActorTarifa,
): Promise<RutaTarifa[]> {
  const conn = await getPool().getConnection();
  let rutaId = 0;
  try {
    await conn.beginTransaction();
    const actual = await tarifaDeEmpresaTx(conn, empresaId, tarifaId);
    rutaId = Number(actual.ruta_id);
    const eraPredeterminada = Number(actual.predeterminada ?? 0) === 1;
    await conn.execute(
      `UPDATE tms_ruta_tarifas
       SET activa = ?, predeterminada = ?, actualizado_por = ?, actualizado_por_nombre = ?
       WHERE id = ? AND empresa_id = ?`,
      // Al desactivar una tarifa pierde la marca de predeterminada.
      [activa ? 1 : 0, activa ? (eraPredeterminada ? 1 : 0) : 0, actor?.usuarioId ?? null, actor?.nombre ?? null, tarifaId, empresaId],
    );
    // Si se desactivó la predeterminada, promover otra activa (la más
    // reciente por vigencia) para no dejar la ruta sin predeterminada.
    if (!activa && eraPredeterminada) {
      const candidata = await q(conn,
        `SELECT id FROM tms_ruta_tarifas
         WHERE empresa_id = ? AND ruta_id = ? AND activa = 1
         ORDER BY vigente_desde DESC, id DESC LIMIT 1`,
        [empresaId, rutaId],
      );
      if (candidata[0]) {
        await conn.execute(
          "UPDATE tms_ruta_tarifas SET predeterminada = 1 WHERE id = ? AND empresa_id = ?",
          [Number(candidata[0].id), empresaId],
        );
      }
    }
    await sincronizarTarifaReferenciaTx(conn, empresaId, rutaId);
    await auditarTx(conn, empresaId, actor, activa ? "ruta_tarifa_activar" : "ruta_tarifa_desactivar",
      `Ruta #${rutaId} · tarifa "${String(actual.nombre)}" ${activa ? "activada" : "desactivada"}. tarifa_id=${tarifaId}`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return listarTarifasDeRuta(empresaId, rutaId);
}

export async function marcarPredeterminada(
  empresaId: number,
  tarifaId: number,
  actor: ActorTarifa,
): Promise<RutaTarifa[]> {
  const conn = await getPool().getConnection();
  let rutaId = 0;
  try {
    await conn.beginTransaction();
    const actual = await tarifaDeEmpresaTx(conn, empresaId, tarifaId);
    rutaId = Number(actual.ruta_id);
    if (Number(actual.activa ?? 0) !== 1) {
      throw new Error("Solo una tarifa activa puede ser la predeterminada. Actívala primero.");
    }
    await conn.execute(
      "UPDATE tms_ruta_tarifas SET predeterminada = 0 WHERE empresa_id = ? AND ruta_id = ?",
      [empresaId, rutaId],
    );
    await conn.execute(
      `UPDATE tms_ruta_tarifas
       SET predeterminada = 1, actualizado_por = ?, actualizado_por_nombre = ?
       WHERE id = ? AND empresa_id = ?`,
      [actor?.usuarioId ?? null, actor?.nombre ?? null, tarifaId, empresaId],
    );
    await sincronizarTarifaReferenciaTx(conn, empresaId, rutaId);
    await auditarTx(conn, empresaId, actor, "ruta_tarifa_predeterminada",
      `Ruta #${rutaId} · tarifa "${String(actual.nombre)}" marcada como predeterminada. tarifa_id=${tarifaId}`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return listarTarifasDeRuta(empresaId, rutaId);
}
