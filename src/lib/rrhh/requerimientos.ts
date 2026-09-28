import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { resolverUsuarioDeEmpresaTx } from "@/lib/tms/identidad-administrativa";
import {
  centavosRrhhReq, importeRrhhReq,
  type DetalleRequerimientoRrhh, type FiltrosRequerimientoRrhh, type LineaRequerimientoRrhh, type RequerimientoRrhh, type RequerimientoRrhhDatos,
} from "./requerimiento-schema";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — requerimientos propios de RRHH (tabla `rrhh_requerimientos` +
 * `rrhh_requerimiento_lineas`), independientes de `compras_requerimientos*`. Mismo patrón de transacción/versión
 * optimista/código administrativo que src/lib/compras/requerimientos.ts, sin vehículo/factura (específicos de
 * Compras/TMS) y sin captura de firma manuscrita (RRHH-REQUERIMIENTOS-PROVEEDORES-1: PDF/Excel muestran nombre y
 * línea de firma en blanco cuando no hay imagen — ver requerimiento-exportaciones.ts — no se implementó captura de
 * "Mi firma" para este módulo en esta primera fase; ver reporte del ticket).
 *
 * "Persona que requiere" en RRHH es CUALQUIER usuario con acceso al tenant (no limitado a Operaciones, a propósito —
 * pedido explícito del ticket): se resuelve con resolverUsuarioDeEmpresaTx (genérico, sin permisos de Compras).
 */
export class ErrorRequerimientoRrhh extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const CONFLICTO_RRHH_REQ = "El requerimiento fue modificado por otro usuario. Actualiza la información.";
export const MSG_TRANSFERENCIA_SIN_CUENTA = "El proveedor no tiene banco y número de cuenta registrados; no se puede usar Transferencia en esta línea.";

const columnasCabecera = `id, codigo, DATE_FORMAT(fecha_requerimiento, '%Y-%m-%d') AS fecha_requerimiento,
  entidad_requirente_id, entidad_requirente_nombre, requirente_usuario_id, requirente_nombre,
  solicitante_usuario_id, solicitante_nombre, observaciones, total, estado, version,
  autorizante_usuario_id, autorizante_nombre, DATE_FORMAT(autorizado_en, '%Y-%m-%d %H:%i:%s') AS autorizado_en,
  DATE_FORMAT(rechazado_en, '%Y-%m-%d %H:%i:%s') AS rechazado_en, motivo_rechazo`;
const columnasLinea = `id, orden, proveedor_id, proveedor_nombre_snapshot, proveedor_razon_social_snapshot, proveedor_nit_snapshot,
  descripcion, cantidad, precio_unitario, metodo_pago, condicion_pago, banco_snapshot, numero_cuenta_snapshot,
  tipo_cuenta_snapshot, dias_credito_snapshot, total, observaciones`;

export async function listarRequerimientosRrhh(empresaId: number, filtros: FiltrosRequerimientoRrhh): Promise<RequerimientoRrhh[]> {
  return await query<RowDataPacket[]>(`SELECT ${columnasCabecera},
    (SELECT COUNT(*) FROM rrhh_requerimiento_lineas l WHERE l.empresa_id = r.empresa_id AND l.requerimiento_id = r.id) AS cantidad_lineas
    FROM rrhh_requerimientos r WHERE empresa_id = ? AND LOCATE(?, codigo) > 0
    AND (? IS NULL OR fecha_requerimiento >= ?) AND (? IS NULL OR fecha_requerimiento <= ?)
    AND (? IS NULL OR estado = ?) AND (? IS NULL OR entidad_requirente_id = ?)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM rrhh_requerimiento_lineas p WHERE p.empresa_id = r.empresa_id AND p.requerimiento_id = r.id AND p.proveedor_id = ?))
    ORDER BY fecha_requerimiento DESC, id DESC`,
  [empresaId, filtros.codigo, filtros.desde ?? null, filtros.desde ?? null, filtros.hasta ?? null, filtros.hasta ?? null,
    filtros.estado ?? null, filtros.estado ?? null, filtros.entidad_requirente_id ?? null, filtros.entidad_requirente_id ?? null,
    filtros.proveedor_id ?? null, filtros.proveedor_id ?? null]) as unknown as RequerimientoRrhh[];
}

export async function obtenerRequerimientoRrhh(empresaId: number, id: number): Promise<DetalleRequerimientoRrhh | null> {
  const rows = await query<RowDataPacket[]>(`SELECT ${columnasCabecera} FROM rrhh_requerimientos WHERE empresa_id = ? AND id = ?`, [empresaId, id]);
  if (!rows[0]) return null;
  const lineas = await query<RowDataPacket[]>(`SELECT ${columnasLinea} FROM rrhh_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? ORDER BY orden, id`, [empresaId, id]);
  return { ...rows[0], lineas, cantidad_lineas: lineas.length } as unknown as DetalleRequerimientoRrhh;
}

export async function catalogosRequerimientoRrhh(empresaId: number) {
  const [proveedores, entidades, usuarios] = await Promise.all([
    query<RowDataPacket[]>(`SELECT id, nombre_comercial, razon_social, nit, contacto_nombre, telefono, email,
      metodo_pago_habitual, banco, numero_cuenta, tipo_cuenta, dias_credito FROM rrhh_proveedores WHERE empresa_id = ? AND activo = 1 ORDER BY nombre_comercial, id`, [empresaId]),
    // Empresa requirente = entidades reales del tenant (cont_entidades), sin nombres/códigos hardcodeados — mismo criterio que Compras.
    query<RowDataPacket[]>(`SELECT id, nombre FROM cont_entidades WHERE empresa_id = ? AND activa = 1 ORDER BY nombre, id`, [empresaId]),
    // "Persona que requiere" en RRHH: cualquier usuario con acceso a ESTE tenant (no limitado a Operaciones).
    query<RowDataPacket[]>(`SELECT DISTINCT u.id, u.nombre FROM usuarios u LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = ?
      WHERE u.activo = 1 AND u.nombre IS NOT NULL AND TRIM(u.nombre) <> '' AND (ue.usuario_id IS NOT NULL OR u.acceso_todas_empresas = 1) ORDER BY u.nombre, u.id`, [empresaId]),
  ]);
  const opciones = (rows: RowDataPacket[]) => rows.map(r => ({ id: Number(r.id), nombre: String(r.nombre) }));
  return { proveedores, entidades: opciones(entidades), usuarios: opciones(usuarios) };
}

export async function guardarRequerimientoRrhh(
  empresaId: number, usuarioId: number, usuario: string, datos: RequerimientoRrhhDatos, id?: number,
): Promise<{ id: number; codigo: string; version: number }> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let antes: RowDataPacket | undefined;
    let existentes: RowDataPacket[] = [];
    if (id !== undefined) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, codigo, estado, total, version FROM rrhh_requerimientos WHERE empresa_id = ? AND id = ? FOR UPDATE`, [empresaId, id]);
      antes = rows[0];
      if (!antes) throw new ErrorRequerimientoRrhh("Requerimiento no encontrado.", 404);
      if (Number(antes.version) !== datos.version) throw new ErrorRequerimientoRrhh(CONFLICTO_RRHH_REQ, 409);
      if (antes.estado !== "Pendiente") throw new ErrorRequerimientoRrhh("Solo se puede editar un requerimiento Pendiente.", 409);
      const [rowsLineas] = await conn.query<RowDataPacket[]>(`SELECT ${columnasLinea} FROM rrhh_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? FOR UPDATE`, [empresaId, id]);
      existentes = rowsLineas;
    }
    const porId = new Map(existentes.map(l => [Number(l.id), l]));
    if (datos.lineas.some(l => l.id !== undefined && !porId.has(l.id))) throw new ErrorRequerimientoRrhh("Una línea no pertenece a este requerimiento.");
    const recibidos = new Set(datos.lineas.flatMap(l => l.id === undefined ? [] : [l.id]));
    const eliminadas = existentes.filter(l => !recibidos.has(Number(l.id))).map(l => Number(l.id));

    // Empresa requirente: entidad activa de ESTE tenant (nunca hardcodeada, nunca de otra empresa).
    const [entidades] = await conn.query<RowDataPacket[]>(`SELECT id, nombre FROM cont_entidades WHERE empresa_id = ? AND id = ? AND activa = 1 LOCK IN SHARE MODE`, [empresaId, datos.entidad_requirente_id]);
    if (!entidades[0]) throw new ErrorRequerimientoRrhh("La empresa requirente no es válida o no pertenece a esta empresa.");

    // Persona que requiere: usuario del tenant (RRHH, sin restricción a Operaciones); solicitante es SIEMPRE quien está autenticado.
    const conservaRequirente = antes && datos.requirente_usuario_id === (antes.requirente_usuario_id == null ? null : Number(antes.requirente_usuario_id));
    const requirente = conservaRequirente && antes ? { nombre: antes.requirente_nombre ?? null } : await resolverUsuarioDeEmpresaTx(conn, empresaId, datos.requirente_usuario_id);
    if (!requirente) throw new ErrorRequerimientoRrhh("La persona que requiere no tiene acceso a esta empresa.");
    const solicitante = !antes ? await resolverUsuarioDeEmpresaTx(conn, empresaId, usuarioId) : null;
    if (!antes && !solicitante) throw new ErrorRequerimientoRrhh("El solicitante no tiene acceso a esta empresa.");

    // AJUSTE PR #372 (punto 1) — Resolver y validar TODAS las líneas antes de escribir. El snapshot histórico de una línea
    // EXISTENTE se preserva SIEMPRE que conserve el mismo proveedor_id, sin importar si ese proveedor sigue activo o si
    // cambió su banco/cuenta/nombre/NIT/días de crédito DESPUÉS de crearse — editar cualquier otro campo de la línea
    // (descripción, cantidad, método de pago…) nunca debe refrescar el snapshot. Solo una línea NUEVA o un cambio real de
    // proveedor_id toma los datos ACTUALES de rrhh_proveedores.
    const resueltas: (LineaRequerimientoRrhh & { total: string })[] = [];
    const proveedores = new Map<number, RowDataPacket>();
    for (const linea of datos.lineas) {
      const vieja = linea.id === undefined ? undefined : porId.get(linea.id);
      const mismoProveedor = Boolean(vieja) && Number(vieja!.proveedor_id) === linea.proveedor_id;
      let proveedor = proveedores.get(linea.proveedor_id);
      if (!proveedor) {
        const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, activo, nombre_comercial, razon_social, nit, banco, numero_cuenta, tipo_cuenta, dias_credito FROM rrhh_proveedores WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE`, [empresaId, linea.proveedor_id]);
        proveedor = rows[0];
        if (!proveedor) throw new ErrorRequerimientoRrhh("El proveedor no pertenece a esta empresa.");
        proveedores.set(linea.proveedor_id, proveedor);
      }
      if (!proveedor.activo && !mismoProveedor) throw new ErrorRequerimientoRrhh("El proveedor debe estar activo para una línea nueva o al cambiar de proveedor.");
      const snapshot = mismoProveedor ? {
        proveedor_nombre_snapshot: String(vieja!.proveedor_nombre_snapshot), proveedor_razon_social_snapshot: vieja!.proveedor_razon_social_snapshot,
        proveedor_nit_snapshot: vieja!.proveedor_nit_snapshot, banco_snapshot: vieja!.banco_snapshot,
        numero_cuenta_snapshot: vieja!.numero_cuenta_snapshot, tipo_cuenta_snapshot: vieja!.tipo_cuenta_snapshot, dias_credito_snapshot: vieja!.dias_credito_snapshot,
      } : {
        proveedor_nombre_snapshot: String(proveedor.nombre_comercial), proveedor_razon_social_snapshot: proveedor.razon_social,
        proveedor_nit_snapshot: proveedor.nit, banco_snapshot: proveedor.banco,
        numero_cuenta_snapshot: proveedor.numero_cuenta, tipo_cuenta_snapshot: proveedor.tipo_cuenta, dias_credito_snapshot: proveedor.dias_credito,
      };
      // TRANSFERENCIA: exige banco y número de cuenta (del snapshot que se va a guardar) — backend valida, nunca confía solo en el frontend.
      if (linea.metodo_pago === "Transferencia" && (!snapshot.banco_snapshot || !snapshot.numero_cuenta_snapshot)) {
        throw new ErrorRequerimientoRrhh(MSG_TRANSFERENCIA_SIN_CUENTA);
      }
      const totalLinea = importeRrhhReq(Math.round(centavosRrhhReq(linea.cantidad) * centavosRrhhReq(linea.precio_unitario) / 100));
      resueltas.push({ ...linea, id: linea.id ?? 0, total: totalLinea, ...snapshot } as LineaRequerimientoRrhh & { total: string });
    }
    const total = importeRrhhReq(resueltas.reduce((sum, l) => sum + centavosRrhhReq(l.total), 0));

    let codigo = antes ? String(antes.codigo) : "";
    if (!antes) {
      // Convención segura de Compras/Fondos/Gastos: INSERT con placeholder único, AUTO_INCREMENT, UPDATE con el código final
      // (dentro de la MISMA transacción) — nunca MAX(id)+1 ni COUNT(*)+1.
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO rrhh_requerimientos
        (empresa_id, codigo, fecha_requerimiento, entidad_requirente_id, entidad_requirente_nombre,
         requirente_usuario_id, requirente_nombre, solicitante_usuario_id, solicitante_nombre, estado, total, observaciones, creado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?)`,
      [empresaId, `TMP-${randomUUID()}`, datos.fecha_requerimiento, datos.entidad_requirente_id, entidades[0].nombre,
        datos.requirente_usuario_id, requirente.nombre, usuarioId, solicitante!.nombre, total, datos.observaciones, usuarioId]);
      id = result.insertId;
      codigo = `RH-${datos.fecha_requerimiento.slice(0, 4)}-${String(id).padStart(6, "0")}`;
      await conn.execute(`UPDATE rrhh_requerimientos SET codigo = ? WHERE empresa_id = ? AND id = ?`, [codigo, empresaId, id]);
    } else {
      const [result] = await conn.execute<ResultSetHeader>(`UPDATE rrhh_requerimientos SET fecha_requerimiento = ?, entidad_requirente_id = ?, entidad_requirente_nombre = ?,
        requirente_usuario_id = ?, requirente_nombre = ?, observaciones = ?, total = ?, version = version + 1
        WHERE empresa_id = ? AND id = ? AND version = ? AND estado = 'Pendiente'`,
      [datos.fecha_requerimiento, datos.entidad_requirente_id, entidades[0].nombre, datos.requirente_usuario_id, requirente.nombre,
        datos.observaciones, total, empresaId, id, datos.version]);
      if (result.affectedRows !== 1) throw new ErrorRequerimientoRrhh(CONFLICTO_RRHH_REQ, 409);
    }
    const requerimientoId = id!;
    const agregadas: number[] = [], editadas: number[] = [];
    const campos = ["orden", "proveedor_id", "proveedor_nombre_snapshot", "proveedor_razon_social_snapshot", "proveedor_nit_snapshot",
      "descripcion", "cantidad", "precio_unitario", "metodo_pago", "condicion_pago", "banco_snapshot", "numero_cuenta_snapshot",
      "tipo_cuenta_snapshot", "dias_credito_snapshot", "total", "observaciones"] as const;
    for (const [indice, linea] of resueltas.entries()) {
      const valores = campos.map(c => (c === "orden" ? indice + 1 : (linea as Record<string, unknown>)[c] ?? null)) as (string | number | null)[];
      if (linea.id) {
        await conn.execute(`UPDATE rrhh_requerimiento_lineas SET ${campos.map(c => `${c} = ?`).join(", ")} WHERE empresa_id = ? AND requerimiento_id = ? AND id = ?`, [...valores, empresaId, requerimientoId, linea.id]);
        editadas.push(linea.id);
      } else {
        const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO rrhh_requerimiento_lineas (empresa_id, requerimiento_id, ${campos.join(", ")}) VALUES (${Array(campos.length + 2).fill("?").join(", ")})`, [empresaId, requerimientoId, ...valores]);
        agregadas.push(result.insertId);
      }
    }
    for (const lineaId of eliminadas) await conn.execute(`DELETE FROM rrhh_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? AND id = ?`, [empresaId, requerimientoId, lineaId]);

    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "rrhh_requerimientos", accion: antes ? "editar_requerimiento_rrhh" : "crear_requerimiento_rrhh",
      detalle: JSON.stringify({ requerimientoId: id, codigo, cantidadLineas: resueltas.length, totalAnterior: antes ? String(antes.total) : null, totalNuevo: total, agregadas, editadas, eliminadas, usuarioId }) });
    await conn.commit();
    return { id: id!, codigo, version: antes ? Number(antes.version) + 1 : 1 };
  } catch (error) {
    try { await conn.rollback(); } catch { /* conservar el error original */ }
    throw error;
  } finally {
    conn.release();
  }
}

/** Bloquea la fila y valida que siga Pendiente y que la versión coincida; null si no existe en esta empresa. */
async function bloquearRequerimientoRrhhParaDecision(conn: PoolConnection, empresaId: number, id: number, version: number) {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT codigo, total, estado, version, requirente_usuario_id, solicitante_usuario_id, creado_por
    FROM rrhh_requerimientos WHERE empresa_id = ? AND id = ? LIMIT 1 FOR UPDATE`, [empresaId, id]);
  const fila = rows[0];
  if (!fila) return null;
  if (String(fila.estado) !== "Pendiente") throw new ErrorRequerimientoRrhh(`Solo se puede autorizar o rechazar un requerimiento Pendiente (estado actual: ${fila.estado}).`, 409);
  if (Number(fila.version) !== version) throw new ErrorRequerimientoRrhh(CONFLICTO_RRHH_REQ, 409);
  return {
    codigo: String(fila.codigo), total: String(fila.total),
    requirenteUsuarioId: fila.requirente_usuario_id != null ? Number(fila.requirente_usuario_id) : null,
    solicitanteUsuarioId: fila.solicitante_usuario_id != null ? Number(fila.solicitante_usuario_id) : null,
    creadoPor: fila.creado_por != null ? Number(fila.creado_por) : null,
  };
}

export const MENSAJE_AUTOAUTORIZACION_RRHH = "No puede autorizar su propio requerimiento de RRHH.";

export async function autorizarRequerimientoRrhh(
  empresaId: number, id: number, version: number,
  opts: { usuario: string; autorizanteUsuarioId: number; autorizanteNombre: string; permitirAutoautorizacion?: boolean },
): Promise<DetalleRequerimientoRrhh | null> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const bloqueo = await bloquearRequerimientoRrhhParaDecision(conn, empresaId, id, version);
    if (!bloqueo) { await conn.rollback(); return null; }
    const esPropio = (bloqueo.requirenteUsuarioId != null && bloqueo.requirenteUsuarioId === opts.autorizanteUsuarioId) ||
      (bloqueo.solicitanteUsuarioId != null && bloqueo.solicitanteUsuarioId === opts.autorizanteUsuarioId) ||
      (bloqueo.creadoPor != null && bloqueo.creadoPor === opts.autorizanteUsuarioId);
    if (esPropio && !opts.permitirAutoautorizacion) throw new ErrorRequerimientoRrhh(MENSAJE_AUTOAUTORIZACION_RRHH, 403);
    await conn.execute(`UPDATE rrhh_requerimientos SET estado = 'Autorizada', autorizante_usuario_id = ?, autorizante_nombre = ?, autorizado_en = NOW(),
      rechazado_en = NULL, motivo_rechazo = NULL, version = version + 1 WHERE empresa_id = ? AND id = ?`,
    [opts.autorizanteUsuarioId, opts.autorizanteNombre, empresaId, id]);
    await registrarAuditoriaTx(conn, { empresaId, usuario: opts.usuario, modulo: "rrhh_requerimientos", accion: "autorizar_requerimiento_rrhh",
      detalle: JSON.stringify({ requerimientoId: id, codigo: bloqueo.codigo, estadoAnterior: "Pendiente", estadoNuevo: "Autorizada", total: bloqueo.total, usuarioId: opts.autorizanteUsuarioId }) });
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* conservar el error original */ }
    throw error;
  } finally { conn.release(); }
  return obtenerRequerimientoRrhh(empresaId, id);
}

export async function rechazarRequerimientoRrhh(
  empresaId: number, id: number, version: number, opts: { usuario: string; usuarioId: number; motivo: string },
): Promise<DetalleRequerimientoRrhh | null> {
  const motivo = opts.motivo.trim();
  if (!motivo) throw new ErrorRequerimientoRrhh("El rechazo requiere un motivo.");
  if (motivo.length > 1000) throw new ErrorRequerimientoRrhh("El motivo no puede superar 1000 caracteres.");
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const bloqueo = await bloquearRequerimientoRrhhParaDecision(conn, empresaId, id, version);
    if (!bloqueo) { await conn.rollback(); return null; }
    await conn.execute(`UPDATE rrhh_requerimientos SET estado = 'Rechazada', rechazado_en = NOW(), motivo_rechazo = ?, version = version + 1 WHERE empresa_id = ? AND id = ?`, [motivo, empresaId, id]);
    await registrarAuditoriaTx(conn, { empresaId, usuario: opts.usuario, modulo: "rrhh_requerimientos", accion: "rechazar_requerimiento_rrhh",
      detalle: JSON.stringify({ requerimientoId: id, codigo: bloqueo.codigo, estadoAnterior: "Pendiente", estadoNuevo: "Rechazada", total: bloqueo.total, usuarioId: opts.usuarioId, motivoRechazo: motivo }) });
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  return obtenerRequerimientoRrhh(empresaId, id);
}
