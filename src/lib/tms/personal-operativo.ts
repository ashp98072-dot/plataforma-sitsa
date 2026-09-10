import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1
 *
 * `tms_personal` es la ÚNICA entidad de persona operativa de TMS. No se
 * crea una segunda entidad. Una persona utilizable en Operaciones de la
 * empresa X = una fila tms_personal con empresa_id = X. Tres tipos:
 *
 *   - propio     -> id_empleado -> empleados de la MISMA empresa.
 *   - compartido -> id_empleado -> empleados de OTRA empresa del grupo.
 *                   NO entra a la planilla de X (planilla lee `empleados`
 *                   filtrado por su empresa_id, nunca tms_personal).
 *   - externo    -> id_empleado NULL; solo registro operativo.
 *
 * Todo TMS (tms_planes_viaje.piloto_id, tms_plan_auxiliares.personal_id,
 * tms_viaticos.personal_id, disponibilidad, reportes) ya referencia
 * tms_personal.id — cero cambios en el filtrado por empresa.
 */

export const TIPOS_VINCULO = ["propio", "compartido", "externo"] as const;
export type TipoVinculo = (typeof TIPOS_VINCULO)[number];

export const TIPOS_PERSONAL = ["Piloto", "Auxiliar"] as const;
export type TipoPersonal = (typeof TIPOS_PERSONAL)[number];

export type ActorPersonal = { usuarioId: number; nombre: string } | null;

async function q<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}

export type PersonalOperativo = {
  id: number;
  nombre: string;
  tipo: string; // Piloto | Auxiliar
  tipoVinculo: TipoVinculo;
  activo: boolean;
  telefono: string | null;
  licencia: string | null;
  codigo: string | null;
  idEmpleado: number | null;
  empresaOrigenId: number | null;
  empresaOrigenNombre: string | null;
  empresaOrigenTexto: string | null;
  /** Etiqueta de origen para la UI: "Empresa X" (compartido), texto libre (externo) o "" (propio). */
  origen: string;
};

/** Texto de origen para snapshots y para la UI. */
export function etiquetaOrigen(row: {
  tipo_vinculo?: string | null;
  empresa_origen_nombre?: string | null;
  empresa_origen_texto?: string | null;
}): string {
  const tv = String(row.tipo_vinculo ?? "propio");
  if (tv === "compartido") return row.empresa_origen_nombre ? String(row.empresa_origen_nombre) : "Otra empresa";
  if (tv === "externo") return row.empresa_origen_texto ? String(row.empresa_origen_texto) : "Externo";
  return "";
}

function mapPersonal(r: RowDataPacket): PersonalOperativo {
  const row = r as Record<string, unknown>;
  const tipoVinculo = (TIPOS_VINCULO as readonly string[]).includes(String(r.tipo_vinculo))
    ? (String(r.tipo_vinculo) as TipoVinculo)
    : "propio";
  return {
    id: Number(r.id),
    nombre: String(r.nombre),
    tipo: String(r.tipo ?? "Piloto"),
    tipoVinculo,
    activo: String(r.estado ?? "Activo") === "Activo",
    telefono: r.telefono != null ? String(r.telefono) : null,
    licencia: r.licencia != null ? String(r.licencia) : null,
    codigo: r.codigo != null ? String(r.codigo) : null,
    idEmpleado: r.id_empleado != null ? Number(r.id_empleado) : null,
    empresaOrigenId: r.empresa_origen_id != null ? Number(r.empresa_origen_id) : null,
    empresaOrigenNombre: r.empresa_origen_nombre != null ? String(r.empresa_origen_nombre) : null,
    empresaOrigenTexto: r.empresa_origen_texto != null ? String(r.empresa_origen_texto) : null,
    origen: etiquetaOrigen({
      tipo_vinculo: row.tipo_vinculo as string | null,
      empresa_origen_nombre: row.empresa_origen_nombre as string | null,
      empresa_origen_texto: row.empresa_origen_texto as string | null,
    }),
  };
}

const SELECT_PERSONAL = `
  SELECT tp.id, tp.nombre, tp.tipo, tp.tipo_vinculo, tp.estado, tp.telefono, tp.licencia,
         tp.codigo, tp.id_empleado, tp.empresa_origen_id, tp.empresa_origen_texto,
         eo.nombre AS empresa_origen_nombre
  FROM tms_personal tp
  LEFT JOIN empresas eo ON eo.id = tp.empresa_origen_id
`;

export type FiltrosPersonalOperativo = {
  tipoVinculo?: TipoVinculo;
  tipo?: TipoPersonal;
  activo?: boolean;
  q?: string;
};

/** Listado para la pantalla "Personal operativo". */
export async function listarPersonalOperativo(
  empresaId: number,
  filtros: FiltrosPersonalOperativo = {},
): Promise<PersonalOperativo[]> {
  const cond = ["tp.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtros.tipoVinculo) { cond.push("tp.tipo_vinculo = ?"); params.push(filtros.tipoVinculo); }
  if (filtros.tipo) { cond.push("tp.tipo = ?"); params.push(filtros.tipo); }
  if (filtros.activo !== undefined) { cond.push("tp.estado = ?"); params.push(filtros.activo ? "Activo" : "Inactivo"); }
  if (filtros.q?.trim()) {
    cond.push("(tp.nombre LIKE ? OR tp.codigo LIKE ? OR tp.telefono LIKE ?)");
    const like = `%${filtros.q.trim()}%`;
    params.push(like, like, like);
  }
  const rows = await query<RowDataPacket[]>(
    `${SELECT_PERSONAL} WHERE ${cond.join(" AND ")} ORDER BY tp.estado = 'Activo' DESC, tp.tipo, tp.nombre`,
    params,
  );
  return rows.map(mapPersonal);
}

export async function obtenerPersonalOperativo(empresaId: number, id: number): Promise<PersonalOperativo | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_PERSONAL} WHERE tp.id = ? AND tp.empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapPersonal(rows[0]) : null;
}

/**
 * Candidatos para los selectores de Piloto/Auxiliar de Programación:
 * empleados PROPIOS activos + personal COMPARTIDO/EXTERNO activo de esta
 * empresa. Los propios se identifican por empleadoId (ruta de resolución
 * legacy en planes/route.ts, lazy-crea el tms_personal); compartido/
 * externo por personalId (ruta P5.1a, valida sin auto-crear).
 */
export type SeleccionablePlan = {
  /** Distingue la fuente en la UI. */
  fuente: "propio" | "compartido" | "externo";
  /** empleados.id — solo para propios. */
  empleadoId: number | null;
  /** tms_personal.id — para compartido/externo (y para propios que ya lo tienen). */
  personalId: number | null;
  nombre: string;
  origen: string;
  tipo: string; // Piloto | Auxiliar
};

export async function seleccionablesParaPlan(
  empresaId: number,
  tipo: TipoPersonal,
): Promise<SeleccionablePlan[]> {
  const likeTipo = tipo === "Auxiliar" ? "%auxiliar%" : "%piloto%";
  // Propios: empleados activos de esta empresa con categoría/puesto del tipo.
  const empleados = await query<RowDataPacket[]>(
    `SELECT e.id, e.nombre,
            (SELECT tp.id FROM tms_personal tp
              WHERE tp.empresa_id = ? AND tp.id_empleado = e.id AND tp.tipo = ?
              ORDER BY tp.id LIMIT 1) AS personal_id
     FROM empleados e
     WHERE e.empresa_id = ? AND e.estado = 'Activo'
       AND (e.categoria_ops = ? OR LOWER(COALESCE(e.puesto,'')) LIKE ? OR LOWER(COALESCE(e.categoria_ops,'')) LIKE ?)
     ORDER BY e.nombre`,
    [empresaId, tipo, empresaId, tipo, likeTipo, likeTipo],
  ).catch(() => [] as RowDataPacket[]);

  // Compartido/externo: filas tms_personal activas de esta empresa.
  const externos = await query<RowDataPacket[]>(
    `${SELECT_PERSONAL}
     WHERE tp.empresa_id = ? AND tp.tipo = ? AND tp.estado = 'Activo'
       AND tp.tipo_vinculo IN ('compartido','externo')
     ORDER BY tp.nombre`,
    [empresaId, tipo],
  );

  const out: SeleccionablePlan[] = [];
  for (const e of empleados) {
    out.push({
      fuente: "propio",
      empleadoId: Number(e.id),
      personalId: e.personal_id != null ? Number(e.personal_id) : null,
      nombre: String(e.nombre),
      origen: "",
      tipo,
    });
  }
  for (const r of externos) {
    const p = mapPersonal(r);
    out.push({
      fuente: p.tipoVinculo === "compartido" ? "compartido" : "externo",
      empleadoId: null,
      personalId: p.id,
      nombre: p.nombre,
      origen: p.origen,
      tipo,
    });
  }
  return out;
}

/**
 * Snapshot mínimo para congelar en el viaje/viático quién participó.
 * Devuelve null si el personal no existe o no es de esta empresa.
 */
export type SnapshotPersonal = { nombre: string; tipo: TipoVinculo; origen: string };

export async function snapshotPersonal(
  empresaId: number,
  personalId: number,
): Promise<SnapshotPersonal | null> {
  const map = await snapshotsPersonal(empresaId, [personalId]);
  return map.get(personalId) ?? null;
}

/** Batch: id de tms_personal -> snapshot (nombre/tipo/origen). Evita N+1. */
export async function snapshotsPersonal(
  empresaId: number,
  personalIds: number[],
  conn?: PoolConnection,
): Promise<Map<number, SnapshotPersonal>> {
  const map = new Map<number, SnapshotPersonal>();
  const ids = [...new Set(personalIds.map(Number).filter((n) => n > 0))];
  if (!ids.length) return map;
  const sql = `${SELECT_PERSONAL} WHERE tp.empresa_id = ? AND tp.id IN (${ids.map(() => "?").join(",")})`;
  const params = [empresaId, ...ids];
  let rows: RowDataPacket[] = [];
  try {
    if (conn) {
      rows = await q(conn, sql, params);
    } else {
      const r = await query<RowDataPacket[]>(sql, params);
      rows = Array.isArray(r) ? r : [];
    }
  } catch {
    rows = [];
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = mapPersonal(r);
    map.set(p.id, { nombre: p.nombre, tipo: p.tipoVinculo, origen: p.origen });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

async function auditarTx(conn: PoolConnection, empresaId: number, actor: ActorPersonal, accion: string, detalle: string): Promise<void> {
  await registrarAuditoriaTx(conn, { empresaId, usuario: actor?.nombre ?? null, accion, modulo: "tms", detalle });
}

export type PersonalExternoInput = {
  nombre: string;
  tipo: TipoPersonal;
  telefono?: string | null;
  licencia?: string | null;
  empresaOrigenTexto?: string | null;
  empresaOrigenId?: number | null;
};

/** Crea un tms_personal EXTERNO (sin empleado RRHH) para esta empresa. */
export async function crearPersonalExterno(
  empresaId: number,
  input: PersonalExternoInput,
  actor: ActorPersonal,
): Promise<PersonalOperativo> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("El nombre es obligatorio.");
  if (!(TIPOS_PERSONAL as readonly string[]).includes(input.tipo)) throw new Error("Tipo inválido (Piloto o Auxiliar).");
  const conn = await getPool().getConnection();
  let nuevoId = 0;
  try {
    await conn.beginTransaction();
    if (input.empresaOrigenId != null) {
      const emp = await q(conn, "SELECT id FROM empresas WHERE id = ? LIMIT 1", [input.empresaOrigenId]);
      if (!emp[0]) throw new Error("La empresa de origen indicada no existe.");
    }
    const [r] = await conn.execute(
      `INSERT INTO tms_personal
        (empresa_id, id_empleado, nombre, tipo, tipo_vinculo, empresa_origen_id, empresa_origen_texto, licencia, telefono, estado)
       VALUES (?, NULL, ?, ?, 'externo', ?, ?, ?, ?, 'Activo')`,
      [
        empresaId, nombre, input.tipo,
        input.empresaOrigenId ?? null,
        input.empresaOrigenTexto?.trim() || null,
        input.licencia?.trim() || null,
        input.telefono?.trim() || null,
      ],
    );
    nuevoId = Number((r as { insertId: number }).insertId);
    await auditarTx(conn, empresaId, actor, "personal_operativo_crear_externo",
      `Personal externo creado: "${nombre}" (${input.tipo}). tms_personal.id=${nuevoId}`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return (await obtenerPersonalOperativo(empresaId, nuevoId))!;
}

/**
 * Habilita a un empleado de OTRA empresa para operar en esta empresa:
 * crea (o reactiva) una fila tms_personal COMPARTIDA. NO toca el empleado
 * ni su empresa_id — solo agrega la proyección operativa.
 */
export async function habilitarCompartido(
  empresaId: number,
  empleadoId: number,
  tipo: TipoPersonal,
  actor: ActorPersonal,
  /** ids de empresa a las que el usuario tiene acceso — la empresa de origen del empleado DEBE estar aquí (§multiempresa). */
  empresasPermitidas: number[],
): Promise<PersonalOperativo> {
  if (!(TIPOS_PERSONAL as readonly string[]).includes(tipo)) throw new Error("Tipo inválido (Piloto o Auxiliar).");
  const permitidas = new Set(empresasPermitidas);
  const conn = await getPool().getConnection();
  let personalId = 0;
  try {
    await conn.beginTransaction();
    const emp = await q(conn,
      "SELECT id, nombre, codigo, empresa_id FROM empleados WHERE id = ? LIMIT 1 FOR UPDATE",
      [empleadoId],
    );
    if (!emp[0]) throw new Error("El empleado indicado no existe.");
    const empresaOrigen = Number(emp[0].empresa_id);
    if (empresaOrigen === empresaId) {
      throw new Error("Ese empleado ya es de esta empresa: es personal propio, no compartido.");
    }
    if (!permitidas.has(empresaOrigen)) {
      throw new Error("No tienes acceso a la empresa de origen de ese empleado.");
    }
    // ¿Ya hay una fila tms_personal para ese empleado en esta empresa?
    const existente = await q(conn,
      "SELECT id, estado FROM tms_personal WHERE empresa_id = ? AND id_empleado = ? AND tipo = ? LIMIT 1 FOR UPDATE",
      [empresaId, empleadoId, tipo],
    );
    if (existente[0]) {
      personalId = Number(existente[0].id);
      await conn.execute(
        `UPDATE tms_personal
         SET estado = 'Activo', tipo_vinculo = 'compartido', empresa_origen_id = ?,
             nombre = ?, codigo = COALESCE(codigo, ?)
         WHERE id = ? AND empresa_id = ?`,
        [empresaOrigen, String(emp[0].nombre), emp[0].codigo ?? null, personalId, empresaId],
      );
      await auditarTx(conn, empresaId, actor, "personal_operativo_compartido_reactivar",
        `Compartido reactivado: empleado #${empleadoId} "${String(emp[0].nombre)}" (empresa origen #${empresaOrigen}). tms_personal.id=${personalId}`);
    } else {
      const [r] = await conn.execute(
        `INSERT INTO tms_personal
          (empresa_id, id_empleado, codigo, nombre, tipo, tipo_vinculo, empresa_origen_id, estado)
         VALUES (?, ?, ?, ?, ?, 'compartido', ?, 'Activo')`,
        [empresaId, empleadoId, emp[0].codigo ?? null, String(emp[0].nombre), tipo, empresaOrigen],
      );
      personalId = Number((r as { insertId: number }).insertId);
      await auditarTx(conn, empresaId, actor, "personal_operativo_compartido_habilitar",
        `Compartido habilitado: empleado #${empleadoId} "${String(emp[0].nombre)}" de empresa #${empresaOrigen}. tms_personal.id=${personalId}`);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return (await obtenerPersonalOperativo(empresaId, personalId))!;
}

export type PersonalOperativoUpdate = {
  nombre?: string;
  telefono?: string | null;
  licencia?: string | null;
  empresaOrigenTexto?: string | null;
  activo?: boolean;
};

/**
 * Edita/activa/desactiva un tms_personal de esta empresa. Nunca cambia
 * empresa_id ni id_empleado (no reasigna una persona a otra planilla).
 * Desactivar NO borra ni altera viajes/viáticos históricos.
 */
export async function actualizarPersonalOperativo(
  empresaId: number,
  id: number,
  cambios: PersonalOperativoUpdate,
  actor: ActorPersonal,
): Promise<PersonalOperativo | null> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const actual = await q(conn,
      "SELECT id, nombre, tipo_vinculo, estado FROM tms_personal WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE",
      [id, empresaId],
    );
    if (!actual[0]) {
      await conn.rollback();
      return null;
    }
    const esExterno = String(actual[0].tipo_vinculo) === "externo";
    const nombre = cambios.nombre !== undefined ? cambios.nombre.trim() : String(actual[0].nombre);
    if (!nombre) throw new Error("El nombre es obligatorio.");
    await conn.execute(
      `UPDATE tms_personal SET
        nombre = ?,
        telefono = CASE WHEN ? THEN ? ELSE telefono END,
        licencia = CASE WHEN ? THEN ? ELSE licencia END,
        empresa_origen_texto = CASE WHEN ? THEN ? ELSE empresa_origen_texto END,
        estado = COALESCE(?, estado)
       WHERE id = ? AND empresa_id = ?`,
      [
        // nombre: compartido conserva el del empleado RRHH; solo externo lo edita libremente.
        esExterno ? nombre : String(actual[0].nombre),
        cambios.telefono !== undefined, cambios.telefono?.trim() || null,
        cambios.licencia !== undefined, cambios.licencia?.trim() || null,
        cambios.empresaOrigenTexto !== undefined && esExterno, cambios.empresaOrigenTexto?.trim() || null,
        cambios.activo === undefined ? null : cambios.activo ? "Activo" : "Inactivo",
        id, empresaId,
      ],
    );
    if (cambios.activo !== undefined) {
      await auditarTx(conn, empresaId, actor, cambios.activo ? "personal_operativo_activar" : "personal_operativo_desactivar",
        `${cambios.activo ? "Activado" : "Desactivado"}: "${nombre}". tms_personal.id=${id} (viajes/viáticos históricos intactos)`);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return obtenerPersonalOperativo(empresaId, id);
}

/** Empleados de OTRAS empresas (a las que el usuario tiene acceso) para el buscador de "habilitar compartido". */
export async function buscarEmpleadosOtrasEmpresas(
  empresaActualId: number,
  empresasPermitidas: number[],
  q: string,
  tipo: TipoPersonal,
): Promise<{ empleadoId: number; nombre: string; empresaId: number; empresaNombre: string; codigo: string | null }[]> {
  const otras = empresasPermitidas.filter((e) => e !== empresaActualId);
  if (!otras.length) return [];
  const likeTipo = tipo === "Auxiliar" ? "%auxiliar%" : "%piloto%";
  const like = `%${q.trim()}%`;
  const rows = await query<RowDataPacket[]>(
    `SELECT e.id, e.nombre, e.codigo, e.empresa_id, em.nombre AS empresa_nombre
     FROM empleados e
     INNER JOIN empresas em ON em.id = e.empresa_id
     WHERE e.empresa_id IN (${otras.map(() => "?").join(",")})
       AND e.estado = 'Activo'
       AND (e.categoria_ops = ? OR LOWER(COALESCE(e.puesto,'')) LIKE ? OR LOWER(COALESCE(e.categoria_ops,'')) LIKE ?)
       AND (? = '' OR e.nombre LIKE ? OR e.codigo LIKE ?)
     ORDER BY em.nombre, e.nombre
     LIMIT 30`,
    [...otras, tipo, likeTipo, likeTipo, q.trim(), like, like],
  );
  return rows.map((r) => ({
    empleadoId: Number(r.id),
    nombre: String(r.nombre),
    empresaId: Number(r.empresa_id),
    empresaNombre: String(r.empresa_nombre),
    codigo: r.codigo != null ? String(r.codigo) : null,
  }));
}
