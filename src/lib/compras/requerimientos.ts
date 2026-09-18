import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { esUsuarioOperaciones, ERROR_REQUIRIENTE_OPERACIONES, resolverUsuarioDeEmpresaTx, resolverSolicitanteOperacionesTx } from "@/lib/tms/identidad-administrativa";
import { normalizarMetodoPagoCompra } from "./metodos-pago";
import { centavosCompra, importeCompra, type DetalleCompra, type FiltrosCompra, type LineaCompra, type RequerimientoCompra, type RequerimientoDatos } from "./requerimiento-schema";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";

export class ErrorCompra extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const CONFLICTO_COMPRA = "El requerimiento fue modificado por otro usuario. Actualiza la información.";
const columnasCabecera = `id, codigo, DATE_FORMAT(fecha_requerimiento, '%Y-%m-%d') AS fecha_requerimiento,
  entidad_requirente_id, entidad_requirente_nombre, requirente_usuario_id, requirente_nombre,
  solicitante_usuario_id, solicitante_nombre, encargado_compras_usuario_id, encargado_compras_nombre, observaciones, total, estado, version,
  autorizante_usuario_id, autorizante_nombre, DATE_FORMAT(autorizado_en, '%Y-%m-%d %H:%i:%s') AS autorizado_en,
  DATE_FORMAT(rechazado_en, '%Y-%m-%d %H:%i:%s') AS rechazado_en, motivo_rechazo`;
const columnasLinea = `id, vehiculo_id, unidad_descripcion, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
  serie_factura, numero_factura, proveedor_id, proveedor_nombre_snapshot, proveedor_razon_social_snapshot,
  proveedor_nit_snapshot, repuesto_descripcion, metodo_pago, condicion_pago, banco_snapshot,
  numero_cuenta_snapshot, dias_credito_snapshot, total, observaciones`;
export async function listarRequerimientos(empresaId: number, filtros: FiltrosCompra) {
  return await query<RowDataPacket[]>(`SELECT ${columnasCabecera},
    (SELECT COUNT(*) FROM compras_requerimiento_lineas l WHERE l.empresa_id = r.empresa_id AND l.requerimiento_id = r.id) AS cantidad_lineas
    FROM compras_requerimientos r WHERE empresa_id = ? AND LOCATE(?, codigo) > 0
    AND (? IS NULL OR fecha_requerimiento >= ?) AND (? IS NULL OR fecha_requerimiento <= ?)
    AND (? IS NULL OR estado = ?) AND (? IS NULL OR EXISTS (
      SELECT 1 FROM compras_requerimiento_lineas p WHERE p.empresa_id = r.empresa_id AND p.requerimiento_id = r.id AND p.proveedor_id = ?))
    ORDER BY fecha_requerimiento DESC, id DESC`,
  [empresaId, filtros.codigo, filtros.desde ?? null, filtros.desde ?? null, filtros.hasta ?? null, filtros.hasta ?? null,
    filtros.estado ?? null, filtros.estado ?? null, filtros.proveedor_id ?? null, filtros.proveedor_id ?? null]) as unknown as RequerimientoCompra[];
}
export async function obtenerRequerimiento(empresaId: number, id: number): Promise<DetalleCompra | null> {
  const rows = await query<RowDataPacket[]>(`SELECT ${columnasCabecera} FROM compras_requerimientos WHERE empresa_id = ? AND id = ?`, [empresaId, id]);
  if (!rows[0]) return null;
  const lineas = await query<RowDataPacket[]>(`SELECT ${columnasLinea} FROM compras_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? ORDER BY orden, id`, [empresaId, id]);
  return { ...rows[0], lineas, cantidad_lineas: lineas.length } as unknown as DetalleCompra;
}
export async function catalogosCompra(empresaId: number) {
  // No usar listarVehiculosAccesibles: incluye unidades compartidas de otros tenants.
  const [proveedores, vehiculos, entidades, usuarios] = await Promise.all([
    query<RowDataPacket[]>(`SELECT id, nombre_comercial, nit, contacto_nombre, contacto_telefono, telefono,
      metodo_pago_habitual, banco, numero_cuenta, dias_credito FROM compras_proveedores WHERE empresa_id = ? AND activo = 1 ORDER BY nombre_comercial, id`, [empresaId]),
    query<RowDataPacket[]>(`SELECT id, placa, descripcion, marca, modelo FROM flota_vehiculos WHERE empresa_id = ? AND activo = 1 ORDER BY placa, id`, [empresaId]),
    // El helper de Fondos/Gastos limita códigos KT/MONACO; Compras usa entidades reales del tenant, sin nombres/códigos hardcodeados.
    query<RowDataPacket[]>(`SELECT id, nombre FROM cont_entidades WHERE empresa_id = ? AND activa = 1 ORDER BY nombre, id`, [empresaId]),
    query<RowDataPacket[]>(`SELECT DISTINCT u.id, u.nombre, u.rol_global FROM usuarios u LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = ?
      WHERE u.activo = 1 AND u.nombre IS NOT NULL AND TRIM(u.nombre) <> '' AND (ue.usuario_id IS NOT NULL OR u.acceso_todas_empresas = 1) ORDER BY u.nombre, u.id`, [empresaId]),
  ]);
  const opciones = (rows: RowDataPacket[]) => rows.map(r => ({ id: Number(r.id), nombre: String(r.nombre) }));
  return { proveedores, vehiculos, entidades, usuarios: opciones(usuarios), requirentesOperaciones: opciones(usuarios.filter(r => esUsuarioOperaciones(r.rol_global))) };
}
export async function guardarRequerimiento(empresaId: number, usuarioId: number, usuario: string,
  datos: RequerimientoDatos, puedeEliminar: boolean, id?: number) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let antes: RowDataPacket | undefined;
    let existentes: RowDataPacket[] = [];
    if (id !== undefined) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, codigo, estado, total, version, requirente_usuario_id, requirente_nombre, encargado_compras_usuario_id, encargado_compras_nombre FROM compras_requerimientos WHERE empresa_id = ? AND id = ? FOR UPDATE`, [empresaId, id]);
      antes = rows[0];
      if (!antes) throw new ErrorCompra("Requerimiento no encontrado.", 404);
      if (Number(antes.version) !== datos.version) throw new ErrorCompra(CONFLICTO_COMPRA, 409);
      if (antes.estado !== "Pendiente") throw new ErrorCompra("Solo se puede editar un requerimiento Pendiente.", 409);
      const [rowsLineas] = await conn.query<RowDataPacket[]>(`SELECT ${columnasLinea} FROM compras_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? FOR UPDATE`, [empresaId, id]);
      existentes = rowsLineas;
    }
    const porId = new Map(existentes.map(l => [Number(l.id), l]));
    if (datos.lineas.some(l => l.id !== undefined && !porId.has(l.id))) throw new ErrorCompra("Una línea no pertenece a este requerimiento.");
    const recibidos = new Set(datos.lineas.flatMap(l => l.id === undefined ? [] : [l.id]));
    const eliminadas = existentes.filter(l => !recibidos.has(Number(l.id))).map(l => Number(l.id));
    if (eliminadas.length && !puedeEliminar) throw new ErrorCompra("Sin permiso para eliminar líneas de compras.", 403);
    for (const lineaId of eliminadas) {
      const [docs] = await conn.query<RowDataPacket[]>(`SELECT id FROM compras_linea_documentos WHERE empresa_id = ? AND requerimiento_id = ? AND linea_id = ? LIMIT 1 FOR UPDATE`, [empresaId, id, lineaId]);
      if (docs.length) throw new ErrorCompra("No se puede eliminar una línea que tiene documentos registrados.", 409);
    }
    const [entidades] = await conn.query<RowDataPacket[]>(`SELECT id, nombre FROM cont_entidades WHERE empresa_id = ? AND id = ? AND activa = 1 LOCK IN SHARE MODE`, [empresaId, datos.entidad_requirente_id]);
    if (!entidades[0]) throw new ErrorCompra("La empresa requirente no es válida o no pertenece a esta empresa.");
    const conservaRequirente = antes && datos.requirente_usuario_id === (antes.requirente_usuario_id == null ? null : Number(antes.requirente_usuario_id));
    const requirente = conservaRequirente && antes ? { nombre: antes.requirente_nombre ?? null }
      : await resolverSolicitanteOperacionesTx(conn, empresaId, datos.requirente_usuario_id);
    if (!requirente) throw new ErrorCompra(ERROR_REQUIRIENTE_OPERACIONES);
    const solicitante = !antes ? await resolverUsuarioDeEmpresaTx(conn, empresaId, usuarioId) : null;
    if (!antes && !solicitante) throw new ErrorCompra("El solicitante no tiene acceso a esta empresa.");
    const encargadoId = datos.encargado_compras_usuario_id === undefined ? antes?.encargado_compras_usuario_id ?? null : datos.encargado_compras_usuario_id;
    let encargadoNombre: string | null = antes?.encargado_compras_nombre ?? null;
    if (datos.encargado_compras_usuario_id !== undefined || !antes) {
      const encargado = encargadoId === null ? null : await resolverUsuarioDeEmpresaTx(conn, empresaId, encargadoId);
      if (encargadoId !== null && !encargado) throw new ErrorCompra("El encargado de compras no tiene acceso a esta empresa.");
      encargadoNombre = encargado?.nombre ?? null;
    }
    // Resolver y validar TODAS las líneas antes de escribir. Un proveedor inactivo existente conserva su snapshot si no cambia.
    const resueltas: LineaCompra[] = [];
    const proveedores = new Map<number, RowDataPacket>();
    const vehiculos = new Map<number, RowDataPacket>();
    for (const linea of datos.lineas) {
      const vieja = linea.id === undefined ? undefined : porId.get(linea.id);
      let proveedor = proveedores.get(linea.proveedor_id);
      if (!proveedor) {
        const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, activo, nombre_comercial, razon_social, nit, banco, numero_cuenta, dias_credito FROM compras_proveedores WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE`, [empresaId, linea.proveedor_id]);
        proveedor = rows[0];
        if (!proveedor) throw new ErrorCompra("El proveedor no pertenece a esta empresa.");
        proveedores.set(linea.proveedor_id, proveedor);
      }
      if (!proveedor.activo && (!vieja || Number(vieja.proveedor_id) !== linea.proveedor_id)) throw new ErrorCompra("El proveedor debe estar activo para una línea nueva o al cambiar proveedor.");
      const snapshot = !proveedor.activo && vieja ? {
        proveedor_nombre_snapshot: vieja.proveedor_nombre_snapshot, proveedor_razon_social_snapshot: vieja.proveedor_razon_social_snapshot,
        proveedor_nit_snapshot: vieja.proveedor_nit_snapshot, banco_snapshot: vieja.banco_snapshot,
        numero_cuenta_snapshot: vieja.numero_cuenta_snapshot, dias_credito_snapshot: vieja.dias_credito_snapshot,
      } : {
        proveedor_nombre_snapshot: proveedor.nombre_comercial, proveedor_razon_social_snapshot: proveedor.razon_social,
        proveedor_nit_snapshot: proveedor.nit, banco_snapshot: proveedor.banco,
        numero_cuenta_snapshot: proveedor.numero_cuenta, dias_credito_snapshot: proveedor.dias_credito,
      };
      let unidad = linea.unidad_descripcion;
      if (linea.vehiculo_id !== null) {
        let vehiculo = vehiculos.get(linea.vehiculo_id);
        if (!vehiculo) {
          const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, activo, placa, descripcion, marca, modelo FROM flota_vehiculos WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE`, [empresaId, linea.vehiculo_id]);
          vehiculo = rows[0];
          if (!vehiculo) throw new ErrorCompra("El vehículo no pertenece a esta empresa.");
          vehiculos.set(linea.vehiculo_id, vehiculo);
        }
        if (!vehiculo.activo && (!vieja || Number(vieja.vehiculo_id) !== linea.vehiculo_id)) throw new ErrorCompra("La unidad seleccionada no está activa.");
        unidad = !vehiculo.activo && vieja ? vieja.unidad_descripcion : [vehiculo.placa, vehiculo.descripcion || [vehiculo.marca, vehiculo.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ").slice(0, 200);
      }
      const metodoPago = vieja && Number(vieja.proveedor_id) === linea.proveedor_id && vieja.metodo_pago === linea.metodo_pago
        ? linea.metodo_pago : normalizarMetodoPagoCompra(linea.metodo_pago);
      resueltas.push({ ...linea, metodo_pago: metodoPago!, id: linea.id ?? 0, unidad_descripcion: unidad, ...snapshot } as LineaCompra);
    }
    const total = importeCompra(datos.lineas.reduce((sum, l) => sum + centavosCompra(l.total), 0));
    let codigo = antes ? String(antes.codigo) : "";
    if (!antes) {
      // Igual convención legible basada en AUTO_INCREMENT que Fondos, con placeholder único para evitar colisiones concurrentes.
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO compras_requerimientos
        (empresa_id, codigo, fecha_requerimiento, entidad_requirente_id, entidad_requirente_nombre,
         requirente_usuario_id, requirente_nombre, solicitante_usuario_id, solicitante_nombre, estado, total, observaciones, creado_por,
         encargado_compras_usuario_id, encargado_compras_nombre)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?)`,
      [empresaId, `TMP-${randomUUID()}`, datos.fecha_requerimiento, datos.entidad_requirente_id, entidades[0].nombre,
        datos.requirente_usuario_id, requirente.nombre, usuarioId, solicitante!.nombre, total, datos.observaciones, usuarioId, encargadoId, encargadoNombre]);
      id = result.insertId;
      codigo = `RC-${datos.fecha_requerimiento.slice(0, 4)}-${String(id).padStart(6, "0")}`;
      await conn.execute(`UPDATE compras_requerimientos SET codigo = ? WHERE empresa_id = ? AND id = ?`, [codigo, empresaId, id]);
    } else {
      const [result] = await conn.execute<ResultSetHeader>(`UPDATE compras_requerimientos SET fecha_requerimiento = ?, entidad_requirente_id = ?, entidad_requirente_nombre = ?,
        requirente_usuario_id = ?, requirente_nombre = ?, observaciones = ?, total = ?, encargado_compras_usuario_id = ?, encargado_compras_nombre = ?, version = version + 1
        WHERE empresa_id = ? AND id = ? AND version = ? AND estado = 'Pendiente'`,
      [datos.fecha_requerimiento, datos.entidad_requirente_id, entidades[0].nombre, datos.requirente_usuario_id, requirente.nombre,
        datos.observaciones, total, encargadoId, encargadoNombre, empresaId, id, datos.version]);
      if (result.affectedRows !== 1) throw new ErrorCompra(CONFLICTO_COMPRA, 409);
    }
    const requerimientoId = id!;
    const agregadas: number[] = [], editadas: number[] = [];
    const campos = ["orden", "vehiculo_id", "unidad_descripcion", "fecha", "serie_factura", "numero_factura", "proveedor_id",
      "proveedor_nombre_snapshot", "proveedor_razon_social_snapshot", "proveedor_nit_snapshot", "repuesto_descripcion", "metodo_pago", "condicion_pago",
      "banco_snapshot", "numero_cuenta_snapshot", "dias_credito_snapshot", "total", "observaciones"] as const;
    for (const [indice, linea] of resueltas.entries()) {
      const valores = campos.map(c => c === "orden" ? indice + 1 : linea[c] ?? null);
      if (linea.id) {
        await conn.execute(`UPDATE compras_requerimiento_lineas SET ${campos.map(c => `${c} = ?`).join(", ")} WHERE empresa_id = ? AND requerimiento_id = ? AND id = ?`, [...valores, empresaId, requerimientoId, linea.id]);
        editadas.push(linea.id);
      } else {
        const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO compras_requerimiento_lineas (empresa_id, requerimiento_id, ${campos.join(", ")}) VALUES (${Array(campos.length + 2).fill("?").join(", ")})`, [empresaId, requerimientoId, ...valores]);
        agregadas.push(result.insertId);
      }
    }
    for (const lineaId of eliminadas) await conn.execute(`DELETE FROM compras_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? AND id = ?`, [empresaId, requerimientoId, lineaId]);
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "compras_requerimientos", accion: antes ? "editar_requerimiento_compras" : "crear_requerimiento_compras",
      detalle: JSON.stringify({ requerimientoId: id, codigo, cantidadLineas: resueltas.length, totalAnterior: antes ? String(antes.total) : null,
        totalNuevo: total, agregadas, editadas, eliminadas, usuarioId, encargadoComprasUsuarioId: encargadoId }) });
    await conn.commit();
    return { id: id!, codigo, version: antes ? Number(antes.version) + 1 : 1 };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

/**
 * COMPRAS-FASE-4-AUTORIZACION — Pendiente -> Autorizada / Rechazada.
 * Fuente única de la transición: no hay reapertura (Autorizada/Rechazada
 * son estados finales en esta fase), doble autorización/rechazo, ni
 * Autorizada -> Rechazada o viceversa.
 */
export const MENSAJE_FIRMA_REQUERIDA_AUTORIZAR =
  "Debes registrar tu firma en Mi firma antes de autorizar el requerimiento.";
export const MENSAJE_AUTOAUTORIZACION_COMPRA = "No puede autorizar su propio requerimiento de compra.";

/**
 * Cada uso de "Mi firma" genera una COPIA física independiente (mismo
 * patrón exacto que guardarImagenFirmaFondo/guardarImagenFirmaGasto) —
 * nunca se referencia el archivo de usuario_firmas directamente, así
 * cambiar/reemplazar la plantilla personal después nunca altera una firma
 * histórica ya guardada en firmas_electronicas.
 */
async function guardarImagenFirmaCompra(
  empresaId: number,
  requerimientoId: number,
  imagen: { bytes: ArrayBuffer; original: string },
): Promise<{ relative: string; original: string; mime: string; size: number; sha256: string }> {
  const guardada = await guardarUpload(empresaId, "firmas", `firma_compra_autorizar_${requerimientoId}`, {
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
 * Bloquea la fila FOR UPDATE y valida, en una sola pasada: que exista en
 * esta empresa, que su estado siga siendo 'Pendiente' (única transición
 * permitida en esta fase — Autorizada/Rechazada son finales, sin
 * reapertura, sin doble decisión) y que la versión que el cliente está
 * viendo coincida (CONFLICTO_COMPRA si no). Concurrencia: dos decisiones
 * simultáneas sobre el mismo requerimiento solo pueden completar una —
 * FOR UPDATE serializa la segunda transacción hasta que la primera
 * confirma o revierte; al reanudar, ve el estado/versión ya cambiados y
 * falla con 409.
 */
async function bloquearRequerimientoParaDecisionTx(
  conn: PoolConnection,
  empresaId: number,
  id: number,
  version: number,
): Promise<{
  codigo: string;
  total: string;
  requirenteUsuarioId: number | null;
  solicitanteUsuarioId: number | null;
  creadoPor: number | null;
} | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT codigo, total, estado, version, requirente_usuario_id, solicitante_usuario_id, creado_por
     FROM compras_requerimientos WHERE empresa_id = ? AND id = ? LIMIT 1 FOR UPDATE`,
    [empresaId, id],
  );
  const fila = rows[0];
  if (!fila) return null;
  const estadoActual = String(fila.estado);
  if (estadoActual !== "Pendiente") {
    throw new ErrorCompra(
      `Solo se puede autorizar o rechazar un requerimiento Pendiente (estado actual: ${estadoActual}).`,
      409,
    );
  }
  if (Number(fila.version) !== version) {
    throw new ErrorCompra(CONFLICTO_COMPRA, 409);
  }
  return {
    codigo: String(fila.codigo),
    total: String(fila.total),
    requirenteUsuarioId: fila.requirente_usuario_id != null ? Number(fila.requirente_usuario_id) : null,
    solicitanteUsuarioId: fila.solicitante_usuario_id != null ? Number(fila.solicitante_usuario_id) : null,
    creadoPor: fila.creado_por != null ? Number(fila.creado_por) : null,
  };
}

/**
 * Autorizar: exige firma registrada en "Mi firma" (guardada como snapshot
 * INMUTABLE en firmas_electronicas, mismo patrón exacto que
 * AUTORIZAR_FONDO/AUTORIZAR_GASTO) y bloquea la autoautorización SIEMPRE
 * — a diferencia de autorizarGasto() (que la permite si el permiso
 * específico ya fue verificado), este ticket pide explícitamente "no
 * confiar en nombres, comparar IDs" y prohibirla sin excepción, así que
 * NO se ofrece un parámetro permitirAutoautorizacion.
 *
 * `null` = el requerimiento no existe en esta empresa (el caller responde
 * 404). Lanza ErrorCompra para: sin firma (400), estado ya decidido o
 * versión desactualizada (409), autoautorización (403).
 */
export async function autorizarRequerimientoCompra(
  empresaId: number,
  id: number,
  version: number,
  opts: {
    usuario: string;
    autorizanteUsuarioId: number;
    autorizanteNombre: string;
    autorizanteRol?: string | null;
    firmaImagen: { bytes: ArrayBuffer; original: string } | null;
  },
): Promise<DetalleCompra | null> {
  if (!opts.firmaImagen) throw new ErrorCompra(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, 400);
  // Copia física ANTES de abrir la transacción — guardarUpload() no es
  // transaccional. Se compensa (borrarUpload) en el finally si el commit
  // no llega a completarse, por cualquier motivo (rollback o excepción).
  const imagenGuardada = await guardarImagenFirmaCompra(empresaId, id, opts.firmaImagen);
  let committed = false;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const bloqueo = await bloquearRequerimientoParaDecisionTx(conn, empresaId, id, version);
    if (!bloqueo) {
      await conn.rollback();
      return null;
    }
    const esPropio =
      (bloqueo.requirenteUsuarioId != null && bloqueo.requirenteUsuarioId === opts.autorizanteUsuarioId) ||
      (bloqueo.solicitanteUsuarioId != null && bloqueo.solicitanteUsuarioId === opts.autorizanteUsuarioId) ||
      (bloqueo.creadoPor != null && bloqueo.creadoPor === opts.autorizanteUsuarioId);
    if (esPropio) throw new ErrorCompra(MENSAJE_AUTOAUTORIZACION_COMPRA, 403);
    await conn.execute(
      `UPDATE compras_requerimientos
       SET estado = 'Autorizada', autorizante_usuario_id = ?, autorizante_nombre = ?, autorizado_en = NOW(),
           rechazado_en = NULL, motivo_rechazo = NULL, version = version + 1
       WHERE empresa_id = ? AND id = ?`,
      [opts.autorizanteUsuarioId, opts.autorizanteNombre, empresaId, id],
    );
    // Firma + transición + auditoría: MISMA transacción (regla dura de
    // firmas-internas.ts) — un solo commit para las tres.
    await crearFirmaInterna(conn, {
      empresaId,
      usuarioId: opts.autorizanteUsuarioId,
      empleadoId: null,
      nombreFirmante: opts.autorizanteNombre,
      rolFirmante: opts.autorizanteRol ?? "",
      accion: "AUTORIZAR_COMPRA",
      modulo: "COMPRAS",
      entidadTipo: "REQUERIMIENTO_COMPRA",
      entidadId: id,
      valoresRelevantes: { requerimientoId: id, codigo: bloqueo.codigo, total: bloqueo.total, version: version + 1 },
      imagen: imagenGuardada,
      metodo: "FIRMA_MANUSCRITA",
      origenFirma: "GUARDADA",
    });
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: opts.usuario,
      modulo: "compras_requerimientos",
      accion: "autorizar_requerimiento_compras",
      detalle: JSON.stringify({
        requerimientoId: id,
        codigo: bloqueo.codigo,
        estadoAnterior: "Pendiente",
        estadoNuevo: "Autorizada",
        total: bloqueo.total,
        usuarioId: opts.autorizanteUsuarioId,
      }),
    });
    await conn.commit();
    committed = true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    if (!committed) borrarUpload(imagenGuardada.relative);
  }
  return obtenerRequerimiento(empresaId, id);
}

/**
 * Rechazar: nunca exige firma. Motivo obligatorio (trim, no vacío, máximo
 * 1000 caracteres — mismo límite que motivo_rechazo VARCHAR(1000)). NO
 * llena autorizante_usuario_id/autorizante_nombre/autorizado_en — esos
 * campos quedan reservados exclusivamente para una autorización real.
 * `usuarioId` es solo para la auditoría (quién rechazó) — el frontend
 * nunca lo envía, viene de la sesión real del caller.
 */
export async function rechazarRequerimientoCompra(
  empresaId: number,
  id: number,
  version: number,
  opts: { usuario: string; usuarioId: number; motivo: string },
): Promise<DetalleCompra | null> {
  const motivo = opts.motivo.trim();
  if (!motivo) throw new ErrorCompra("El rechazo requiere un motivo.");
  if (motivo.length > 1000) throw new ErrorCompra("El motivo no puede superar 1000 caracteres.");
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const bloqueo = await bloquearRequerimientoParaDecisionTx(conn, empresaId, id, version);
    if (!bloqueo) {
      await conn.rollback();
      return null;
    }
    await conn.execute(
      `UPDATE compras_requerimientos
       SET estado = 'Rechazada', rechazado_en = NOW(), motivo_rechazo = ?, version = version + 1
       WHERE empresa_id = ? AND id = ?`,
      [motivo, empresaId, id],
    );
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: opts.usuario,
      modulo: "compras_requerimientos",
      accion: "rechazar_requerimiento_compras",
      detalle: JSON.stringify({
        requerimientoId: id,
        codigo: bloqueo.codigo,
        estadoAnterior: "Pendiente",
        estadoNuevo: "Rechazada",
        total: bloqueo.total,
        usuarioId: opts.usuarioId,
        motivoRechazo: motivo,
      }),
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerRequerimiento(empresaId, id);
}
