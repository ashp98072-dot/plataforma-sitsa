import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { resolverUsuarioDeEmpresaTx } from "@/lib/tms/identidad-administrativa";
import { normalizarMetodoPagoCompra } from "./metodos-pago";
import { centavosCompra, importeCompra, type DetalleCompra, type FiltrosCompra, type LineaCompra, type RequerimientoCompra, type RequerimientoDatos } from "./requerimiento-schema";

export class ErrorCompra extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const CONFLICTO_COMPRA = "El requerimiento fue modificado por otro usuario. Actualiza la información.";
const columnasCabecera = `id, codigo, DATE_FORMAT(fecha_requerimiento, '%Y-%m-%d') AS fecha_requerimiento,
  entidad_requirente_id, entidad_requirente_nombre, requirente_usuario_id, requirente_nombre,
  solicitante_usuario_id, solicitante_nombre, encargado_compras_usuario_id, encargado_compras_nombre, observaciones, total, estado, version`;
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
    query<RowDataPacket[]>(`SELECT DISTINCT u.id, u.nombre FROM usuarios u LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = ?
      WHERE u.activo = 1 AND u.nombre IS NOT NULL AND TRIM(u.nombre) <> '' AND (ue.usuario_id IS NOT NULL OR u.acceso_todas_empresas = 1) ORDER BY u.nombre, u.id`, [empresaId]),
  ]);
  return { proveedores, vehiculos, entidades, usuarios };
}
export async function guardarRequerimiento(empresaId: number, usuarioId: number, usuario: string,
  datos: RequerimientoDatos, puedeEliminar: boolean, id?: number) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let antes: RowDataPacket | undefined;
    let existentes: RowDataPacket[] = [];
    if (id !== undefined) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, codigo, estado, total, version, encargado_compras_usuario_id, encargado_compras_nombre FROM compras_requerimientos WHERE empresa_id = ? AND id = ? FOR UPDATE`, [empresaId, id]);
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
    const requirente = await resolverUsuarioDeEmpresaTx(conn, empresaId, datos.requirente_usuario_id);
    if (!requirente) throw new ErrorCompra("La persona que requiere no tiene acceso a esta empresa.");
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
