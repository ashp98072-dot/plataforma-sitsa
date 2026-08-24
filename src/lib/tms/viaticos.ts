import type { RowDataPacket } from "mysql2";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { execute, query, type SqlParams } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * VIAT-0 — viáticos operativos asociados a una programación/viaje (piloto y
 * auxiliares). Información INTERNA: nunca se expone en endpoints de
 * cliente/facturación (ver src/app/api/empresas/[slug]/facturacion/**), ni se
 * mezcla con `tarifa_comercial`/`referencia_cliente` de tms_planes_viaje.
 *
 * Diseño (punto 10 de VIAT-0, ajustado por aclaración de negocio): `estado`
 * y `metodo_pago` quedan preparados para una fase operativa posterior
 * VIAT-1, conceptualmente PENDIENTE/PROGRAMADO → AUTORIZADO → ENTREGADO →
 * LIQUIDADO — ENTREGADO es el dinero entregado al piloto/auxiliar,
 * LIQUIDADO el cierre administrativo del viático. En esta fase NINGÚN
 * código escribe otro valor de `estado` que 'PROGRAMADO'.
 *
 * IMPORTANTE: los viáticos son un flujo puramente OPERATIVO de TMS/viaje —
 * NUNCA se pagan por planilla/nómina. No hay ni habrá relación con
 * rrhh_planilla_lineas, ni descuentos/ingresos de nómina generados desde
 * viáticos, ni lógica que dependa de una planilla para determinar si un
 * viático está pagado. `metodo_pago` (sin usar todavía) describirá en
 * VIAT-1 el medio de entrega del efectivo (p. ej. Efectivo/Transferencia/
 * Cheque) — Planilla no es, y no será, una opción válida.
 *
 * Puesto/tipo: se reutiliza el vocabulario ya existente (empleados.puesto /
 * empleados.categoria_ops: Piloto | Auxiliar | ...; tms_personal.tipo, que ya
 * usa los mismos valores) — no se crea un catálogo nuevo de puestos. La
 * resolución preferida es empleados.categoria_ops (cuando tms_personal está
 * vinculado a un empleado real vía id_empleado, ver
 * migrate-2026-08-fase0-tms-personal-empleado.sql); si no hay vínculo, cae a
 * tms_personal.tipo.
 *
 * Esquema: NO se crea/altera desde este módulo. tms_viaticos_config y
 * tms_viaticos deben existir por haberse aplicado manualmente
 * sql/migrate-2026-08-viat-0-viaticos.sql (mismo criterio que el resto de
 * SITSA: migraciones SQL explícitas antes de desplegar, sin DDL automático
 * en runtime). Si la migración no se aplicó, cualquier función de este
 * archivo falla con el error real de MySQL (tabla inexistente) — no se
 * silencia ni se crea estructura por su cuenta.
 */

export type ViaticoConfig = {
  id: number;
  puesto: string;
  montoDefecto: number;
  activo: boolean;
};

function mapConfig(r: RowDataPacket): ViaticoConfig {
  return {
    id: Number(r.id),
    puesto: String(r.puesto),
    montoDefecto: Number(r.monto_defecto ?? 0),
    activo: Number(r.activo ?? 1) === 1,
  };
}

export async function listarViaticosConfig(
  empresaId: number,
): Promise<ViaticoConfig[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, puesto, monto_defecto, activo FROM tms_viaticos_config
     WHERE empresa_id = ? ORDER BY puesto`,
    [empresaId],
  );
  return rows.map(mapConfig);
}

export async function guardarViaticoConfig(
  empresaId: number,
  puesto: string,
  montoDefecto: number,
  usuario: string,
): Promise<void> {
  const p = puesto.trim();
  if (!p) throw new Error("Puesto requerido.");
  await execute(
    `INSERT INTO tms_viaticos_config (empresa_id, puesto, monto_defecto, actualizado_por)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE monto_defecto = VALUES(monto_defecto), actualizado_por = VALUES(actualizado_por)`,
    [empresaId, p, montoDefecto, usuario],
  );
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "config_viatico",
    modulo: "tms",
    detalle: `Viático predeterminado · ${p} → Q${montoDefecto.toFixed(2)}`,
  });
}

async function runQuery<T extends RowDataPacket[]>(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  if (conn) {
    const [rows] = await conn.query<RowDataPacket[]>(sql, params);
    return rows as T;
  }
  return query<RowDataPacket[]>(sql, params) as Promise<T>;
}

async function runExecute(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<ResultSetHeader> {
  if (conn) {
    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  }
  return execute(sql, params);
}

/** Puesto efectivo de un personal_id: empleados.categoria_ops si está vinculado, si no tms_personal.tipo. */
async function puestoDePersonal(
  empresaId: number,
  personalId: number,
  conn?: PoolConnection,
): Promise<string> {
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT COALESCE(e.categoria_ops, tp.tipo) AS puesto
     FROM tms_personal tp
     LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
     WHERE tp.id = ? AND tp.empresa_id = ? LIMIT 1`,
    [personalId, empresaId],
  );
  return rows[0]?.puesto ? String(rows[0].puesto) : "Otro";
}

async function montoSugeridoParaPuesto(
  empresaId: number,
  puesto: string,
  conn?: PoolConnection,
): Promise<number> {
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT monto_defecto FROM tms_viaticos_config
     WHERE empresa_id = ? AND puesto = ? AND activo = 1 LIMIT 1`,
    [empresaId, puesto],
  );
  return rows[0] ? Number(rows[0].monto_defecto ?? 0) : 0;
}

export type AsignacionPersonalPlan = {
  piloto: number | null;
  auxiliares: number[];
};

/**
 * Sincroniza tms_viaticos con el personal REALMENTE asignado a un plan
 * (punto 6, 8, 12). Reutiliza el mismo patrón "reemplazar según lo
 * actualmente asignado" que guardarAuxiliaresPlan() en
 * src/app/api/empresas/[slug]/tms/planes/route.ts:
 * - elimina filas de personal que ya no está asignado al plan;
 * - crea una fila (monto_asignado = monto_sugerido, sin motivo/usuario) para
 *   cada personal recién asignado que todavía no tenía viático;
 * - NO toca monto_asignado/motivo_cambio/modificado_por de un personal que
 *   ya tenía fila (una edición de otros campos del plan, o un resave con el
 *   mismo personal, nunca resetea un monto ya ajustado manualmente).
 * `conn` opcional: si viene (dentro de la transacción de PATCH en
 * planes/route.ts), todas las escrituras usan esa misma conexión — la
 * asignación de personal y sus viáticos quedan consistentes en un solo
 * commit/rollback.
 */
export async function sincronizarViaticosPlan(
  empresaId: number,
  planId: number,
  asignacion: AsignacionPersonalPlan,
  conn?: PoolConnection,
): Promise<void> {
  const objetivo: { personalId: number; rol: "Piloto" | "Auxiliar" }[] = [];
  if (asignacion.piloto != null) {
    objetivo.push({ personalId: asignacion.piloto, rol: "Piloto" });
  }
  for (const pid of asignacion.auxiliares) {
    if (!objetivo.some((o) => o.personalId === pid)) {
      objetivo.push({ personalId: pid, rol: "Auxiliar" });
    }
  }

  if (objetivo.length) {
    const placeholders = objetivo.map(() => "?").join(",");
    await runExecute(
      conn,
      `DELETE FROM tms_viaticos WHERE plan_id = ? AND personal_id NOT IN (${placeholders})`,
      [planId, ...objetivo.map((o) => o.personalId)],
    );
  } else {
    await runExecute(conn, `DELETE FROM tms_viaticos WHERE plan_id = ?`, [planId]);
  }

  for (const o of objetivo) {
    const puesto = await puestoDePersonal(empresaId, o.personalId, conn);
    const sugerido = await montoSugeridoParaPuesto(empresaId, puesto, conn);
    await runExecute(
      conn,
      `INSERT INTO tms_viaticos (empresa_id, plan_id, personal_id, rol, monto_sugerido, monto_asignado)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         rol = VALUES(rol),
         monto_sugerido = VALUES(monto_sugerido)`,
      [empresaId, planId, o.personalId, o.rol, sugerido, sugerido],
    );
  }
}

export type ResultadoActualizarMonto =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Modifica el monto asignado de UN viático ya existente (punto 7). Si el
 * monto difiere del sugerido, exige motivo (defensa server-side; la UI ya lo
 * exige antes de enviar). Guarda quién lo modificó y cuándo
 * (actualizado_en). No permite cambiar plan_id/personal_id/estado — este
 * endpoint es exclusivamente para el monto y su motivo.
 */
export async function actualizarMontoViatico(
  empresaId: number,
  viaticoId: number,
  montoAsignado: number,
  motivoCambio: string | null,
  usuario: string,
): Promise<ResultadoActualizarMonto> {
  if (montoAsignado < 0) {
    return { ok: false, error: "El monto no puede ser negativo." };
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT monto_sugerido FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [viaticoId, empresaId],
  );
  if (!rows[0]) {
    return { ok: false, error: "Viático no encontrado." };
  }
  const sugerido = Number(rows[0].monto_sugerido ?? 0);
  const difiere = Math.abs(montoAsignado - sugerido) > 0.005;
  if (difiere && !motivoCambio?.trim()) {
    return {
      ok: false,
      error: "Indica el motivo del cambio: el monto difiere del predeterminado.",
    };
  }
  await execute(
    `UPDATE tms_viaticos
     SET monto_asignado = ?, motivo_cambio = ?, modificado_por = ?
     WHERE id = ? AND empresa_id = ?`,
    [montoAsignado, difiere ? motivoCambio!.trim() : null, usuario, viaticoId, empresaId],
  );
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "editar_viatico",
    modulo: "tms",
    detalle: `Viático #${viaticoId} · Q${sugerido.toFixed(2)} → Q${montoAsignado.toFixed(2)}${
      difiere ? ` · motivo: ${motivoCambio!.trim()}` : ""
    }`,
  });
  return { ok: true };
}

export type ViaticoDetalle = {
  id: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  cliente: string | null;
  unidadPlaca: string | null;
  personalId: number;
  personalNombre: string;
  rol: string;
  puesto: string;
  montoSugerido: number;
  montoAsignado: number;
  motivoCambio: string | null;
  modificadoPor: string | null;
  estado: string;
  metodoPago: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

function mapDetalle(r: RowDataPacket): ViaticoDetalle {
  return {
    id: Number(r.id),
    planId: Number(r.plan_id),
    planCodigo: String(r.plan_codigo ?? ""),
    fechaPlan: r.fecha_plan != null ? String(r.fecha_plan).slice(0, 10) : "",
    cliente: r.cliente != null ? String(r.cliente) : null,
    unidadPlaca: r.unidad_placa != null ? String(r.unidad_placa) : null,
    personalId: Number(r.personal_id),
    personalNombre: String(r.personal_nombre ?? ""),
    rol: String(r.rol),
    puesto: String(r.puesto ?? r.rol),
    montoSugerido: Number(r.monto_sugerido ?? 0),
    montoAsignado: Number(r.monto_asignado ?? 0),
    motivoCambio: r.motivo_cambio != null ? String(r.motivo_cambio) : null,
    modificadoPor: r.modificado_por != null ? String(r.modificado_por) : null,
    estado: String(r.estado ?? "PROGRAMADO"),
    metodoPago: r.metodo_pago != null ? String(r.metodo_pago) : null,
    creadoEn: String(r.creado_en ?? ""),
    actualizadoEn: String(r.actualizado_en ?? ""),
  };
}

const DETALLE_SELECT = `
  SELECT v.id, v.plan_id, v.personal_id, v.rol, v.monto_sugerido, v.monto_asignado,
         v.motivo_cambio, v.modificado_por, v.estado, v.metodo_pago, v.creado_en, v.actualizado_en,
         pl.codigo AS plan_codigo, pl.fecha_plan,
         c.nombre AS cliente, u.placa AS unidad_placa,
         tp.nombre AS personal_nombre,
         COALESCE(e.categoria_ops, tp.tipo) AS puesto
  FROM tms_viaticos v
  INNER JOIN tms_planes_viaje pl ON pl.id = v.plan_id
  LEFT JOIN tms_clientes c ON c.id = pl.cliente_id
  LEFT JOIN tms_unidades u ON u.id = pl.unidad_id
  INNER JOIN tms_personal tp ON tp.id = v.personal_id
  LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
`;

/** Detalle completo de los viáticos de UN plan/viaje (punto 8). Uso interno TMS/RRHH — nunca en endpoints de cliente/facturación. */
export async function listarViaticosDePlan(
  empresaId: number,
  planId: number,
): Promise<ViaticoDetalle[]> {
  const rows = await query<RowDataPacket[]>(
    `${DETALLE_SELECT} WHERE v.empresa_id = ? AND v.plan_id = ? ORDER BY v.rol DESC, tp.nombre`,
    [empresaId, planId],
  );
  return rows.map(mapDetalle);
}
