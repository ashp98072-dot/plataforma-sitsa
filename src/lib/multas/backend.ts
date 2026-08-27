import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool, query, type SqlParams, type SqlValue } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { anioSchema, ErrorMultas, idSchema, mesSchema, nuevaMulta, revisionSchema, transicion, type Multa } from "./reglas";

export type ActorMultas = { empresaId: number; usuarioId: number; usuario: string };
async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  let descartada = false;
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch (rollbackError) {
      descartada = true; conn.destroy(); console.error("Rollback Multas", rollbackError);
    }
    throw error;
  } finally { if (!descartada) conn.release(); }
}
async function auditar(conn: PoolConnection, actor: ActorMultas, accion: string, detalle: object) {
  await registrarAuditoriaTx(conn, { empresaId: actor.empresaId, usuario: actor.usuario,
    modulo: "multas", accion, detalle: JSON.stringify({ usuario_id: actor.usuarioId, ...detalle }) });
}
async function vehiculoPropio(conn: PoolConnection, empresa: number, id: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id, placa FROM flota_vehiculos WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresa, id]);
  if (!rows[0]) throw new ErrorMultas("Vehículo no encontrado en la empresa propietaria.", 404);
  return rows[0];
}
async function responsablePropio(conn: PoolConnection, empresa: number, id: number | null) {
  if (id == null) return;
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM empleados WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresa, id]);
  if (!rows[0]) throw new ErrorMultas("Empleado responsable no encontrado en esta empresa.", 400);
}

export async function crearRevision(actor: ActorMultas, input: unknown) {
  const data = revisionSchema.parse(input);
  return tx(async (conn) => {
    // Mismo primer lock que el DELETE de vehículos y el alta de multas.
    await vehiculoPropio(conn, actor.empresaId, data.vehiculo_id);
    const [previas] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM ops_multas_revisiones WHERE empresa_id = ? AND vehiculo_id = ?
       AND periodo_anio = ? AND periodo_mes = ? FOR UPDATE`,
      [actor.empresaId, data.vehiculo_id, data.anio, data.mes]);
    if (previas.length) throw new ErrorMultas("La unidad ya tiene revisión en ese período.", 409);
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ops_multas_revisiones (empresa_id, vehiculo_id, periodo_anio, periodo_mes,
       verificada_en, verificada_por_usuario_id, observaciones) VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
      [actor.empresaId, data.vehiculo_id, data.anio, data.mes, actor.usuarioId, data.observaciones]);
    if (result.affectedRows !== 1) throw new ErrorMultas("No se pudo crear la revisión.", 409);
    await auditar(conn, actor, "revision_multa_creada", { revision_id: result.insertId, ...data });
    return { id: result.insertId };
  });
}

const columnasCreacion = ["revision_id", "vehiculo_id", "fecha_infraccion", "referencia_boleta", "tipo_multa",
  "descripcion", "lugar", "monto_total", "moneda", "tipo_responsabilidad", "empleado_responsable_id",
  "responsable_texto", "resolucion_economica", "monto_empresa", "monto_colaborador", "estado",
  "estado_pago", "estado_descuento", "observaciones"] as const;
export async function crearMulta(actor: ActorMultas, input: unknown) {
  const data = nuevaMulta(input);
  return tx(async (conn) => {
    const vehiculo = await vehiculoPropio(conn, actor.empresaId, data.vehiculo_id);
    const [revisiones] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM ops_multas_revisiones WHERE empresa_id = ? AND id = ? AND vehiculo_id = ? FOR UPDATE`,
      [actor.empresaId, data.revision_id, data.vehiculo_id]);
    if (!revisiones[0]) throw new ErrorMultas("Revisión no encontrada para esta empresa y vehículo.", 404);
    await responsablePropio(conn, actor.empresaId, data.empleado_responsable_id);
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ops_multas (empresa_id, placa_historica, creado_por_usuario_id, actualizado_por_usuario_id,
       ${columnasCreacion.join(", ")}) VALUES (${Array(4 + columnasCreacion.length).fill("?").join(", ")})`,
      [actor.empresaId, vehiculo.placa, actor.usuarioId, actor.usuarioId, ...columnasCreacion.map((c) => data[c])]);
    if (result.affectedRows !== 1) throw new ErrorMultas("No se pudo crear la multa.", 409);
    await auditar(conn, actor, "multa_creada", { multa_id: result.insertId, datos: data });
    return { id: result.insertId };
  });
}

// Whitelist fija: identidad, importe total, moneda y fecha no son editables.
const columnasEdicion = ["tipo_multa", "descripcion", "lugar", "tipo_responsabilidad", "empleado_responsable_id",
  "responsable_texto", "resolucion_economica", "monto_empresa", "monto_colaborador", "estado", "estado_pago",
  "estado_descuento", "observaciones", "pagada_en", "pagada_por_usuario_id", "descontada_en",
  "descontada_por_usuario_id", "motivo_anulacion", "anulada_en", "anulada_por_usuario_id"] as const;
export async function actualizarMulta(actor: ActorMultas, id: number, input: unknown) {
  idSchema.parse(id);
  return tx(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM ops_multas WHERE empresa_id = ? AND id = ? FOR UPDATE", [actor.empresaId, id]);
    if (!rows[0]) throw new ErrorMultas("Multa no encontrada.", 404);
    // mysql2 conserva DECIMAL como string; no activar decimalNumbers.
    const antes = rows[0] as RowDataPacket & Multa;
    const { multa: despues, evento } = transicion(antes, input, actor.usuarioId);
    await responsablePropio(conn, actor.empresaId, despues.empleado_responsable_id);
    const cambios = columnasEdicion.filter((c) => antes[c] !== despues[c]);
    if (!cambios.length) throw new ErrorMultas("No hay cambios; recargue el expediente.", 409);
    const params: SqlParams = cambios.map((c) => despues[c] as SqlValue);
    const [result] = await conn.execute<ResultSetHeader>(
      `UPDATE ops_multas SET ${cambios.map((c) => `${c} = ?`).join(", ")}, actualizado_por_usuario_id = ?, actualizado_en = NOW()
       WHERE empresa_id = ? AND id = ? AND estado = ? AND estado_pago = ? AND estado_descuento = ?`,
      [...params, actor.usuarioId, actor.empresaId, id, antes.estado, antes.estado_pago, antes.estado_descuento]);
    if (result.affectedRows !== 1) throw new ErrorMultas("El expediente cambió; recargue antes de continuar.", 409);
    await auditar(conn, actor, evento, { multa_id: id,
      antes: Object.fromEntries(cambios.map((c) => [c, antes[c]])),
      despues: Object.fromEntries(cambios.map((c) => [c, despues[c]])) });
    return { id };
  });
}

const filtrosSchema = z.object({
  anio: anioSchema.optional(), mes: mesSchema.optional(), vehiculo_id: idSchema.optional(),
  vista: z.enum(["periodo", "pendientes"]).default("periodo"),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export function filtros(input: Record<string, string>, revisiones = false) {
  const data = filtrosSchema.parse(input);
  if ((revisiones || data.vista === "periodo") && (data.anio == null || data.mes == null))
    throw new ErrorMultas("Indique año y mes.");
  if (revisiones && data.vista !== "periodo") throw new ErrorMultas("Las revisiones se consultan por período.");
  return data;
}
export async function listarRevisiones(empresaId: number, input: Record<string, string>) {
  const f = filtros(input, true);
  const params: SqlParams = [empresaId, f.anio!, f.mes!];
  if (f.vehiculo_id) params.push(f.vehiculo_id);
  const rows = await query<RowDataPacket[]>(
    `SELECT r.*, v.placa AS placa_actual, u.nombre AS verificador_nombre, u.username AS verificador_usuario,
       (SELECT COUNT(*) FROM ops_multas m WHERE m.empresa_id = r.empresa_id AND m.revision_id = r.id
         AND m.vehiculo_id = r.vehiculo_id AND m.estado <> 'ANULADA') AS cantidad_multas,
       (SELECT COALESCE(SUM(m.monto_total), 0) FROM ops_multas m WHERE m.empresa_id = r.empresa_id AND m.revision_id = r.id
         AND m.vehiculo_id = r.vehiculo_id AND m.estado <> 'ANULADA') AS monto_total
     FROM ops_multas_revisiones r
     INNER JOIN flota_vehiculos v ON v.empresa_id = r.empresa_id AND v.id = r.vehiculo_id
     INNER JOIN usuarios u ON u.id = r.verificada_por_usuario_id
     WHERE r.empresa_id = ? AND r.periodo_anio = ? AND r.periodo_mes = ?
       ${f.vehiculo_id ? "AND r.vehiculo_id = ?" : ""}
     ORDER BY r.id DESC LIMIT 101 OFFSET ${(f.pagina - 1) * 100}`, params);
  return { revisiones: rows.slice(0, 100), pagina: f.pagina, hay_mas: rows.length > 100 };
}
export async function listarMultas(empresaId: number, input: Record<string, string>) {
  const f = filtros(input);
  const params: SqlParams = [empresaId];
  let periodo = "";
  if (f.vista === "periodo") {
    periodo = "AND r.periodo_anio = ? AND r.periodo_mes = ?";
    params.push(f.anio!, f.mes!);
  } else {
    // Pendientes de TODOS los períodos, sin copiar multas a otro mes.
    periodo = `AND m.estado <> 'ANULADA' AND (m.estado IN ('PENDIENTE','EN_REVISION')
      OR m.estado_pago = 'PENDIENTE' OR m.estado_descuento = 'PENDIENTE')`;
  }
  if (f.vehiculo_id) params.push(f.vehiculo_id);
  const rows = await query<RowDataPacket[]>(
    `SELECT m.*, r.periodo_anio, r.periodo_mes, v.placa AS placa_actual, e.nombre AS empleado_responsable_nombre
     FROM ops_multas m
     INNER JOIN ops_multas_revisiones r ON r.empresa_id = m.empresa_id AND r.id = m.revision_id AND r.vehiculo_id = m.vehiculo_id
     INNER JOIN flota_vehiculos v ON v.empresa_id = m.empresa_id AND v.id = m.vehiculo_id
     LEFT JOIN empleados e ON e.empresa_id = m.empresa_id AND e.id = m.empleado_responsable_id
     WHERE m.empresa_id = ? ${periodo} ${f.vehiculo_id ? "AND m.vehiculo_id = ?" : ""}
     ORDER BY m.id DESC LIMIT 101 OFFSET ${(f.pagina - 1) * 100}`, params);
  return { multas: rows.slice(0, 100), vista: f.vista, pagina: f.pagina, hay_mas: rows.length > 100 };
}
