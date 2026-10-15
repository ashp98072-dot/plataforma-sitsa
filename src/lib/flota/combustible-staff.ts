import type { RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { obtenerVehiculoAccesibleTx, predicadoVehiculoAccesible } from "./acceso";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { borrarUpload, contentTypeFor, guardarUpload, validarRutaArchivoEmpresa } from "@/lib/uploads";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { combustibleStaffSchema, precioCalculado, type CombustibleStaffInput } from "./combustible-staff-schema";

type Archivo = { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

/** No DDL en requests. La migración C-1 debe aplicarse y verificarse antes de desplegar. */
export async function catalogosCombustible(empresaId: number) {
  const [proveedores, vehiculos, estaciones] = await Promise.all([
    query<RowDataPacket[]>("SELECT id, nombre_comercial AS nombre FROM compras_proveedores WHERE empresa_id = ? AND activo = 1 ORDER BY nombre_comercial", [empresaId]),
    query<RowDataPacket[]>(`SELECT v.id, v.placa, v.descripcion FROM flota_vehiculos v WHERE v.activo = 1 AND ${predicadoVehiculoAccesible("v", "?")} ORDER BY v.placa`, [empresaId, empresaId]),
    query<RowDataPacket[]>(`SELECT e.id, e.proveedor_id AS proveedorId, e.nombre FROM flota_combustible_estaciones e JOIN compras_proveedores p ON p.id=e.proveedor_id AND p.empresa_id=e.empresa_id WHERE e.empresa_id=? AND e.activo=1 AND p.activo=1 ORDER BY e.nombre, e.id`, [empresaId]),
  ]);
  return { proveedores, vehiculos, estaciones };
}

/** Bloqueo del proveedor serializa la detección preventiva de duplicados del mismo proveedor.
 * No sustituye un UNIQUE físico: escritores externos/SQL quedan fuera de esta garantía. */
export async function guardarCombustibleStaff(empresaId: number, actor: { usuarioId: number; username: string }, input: CombustibleStaffInput, file: Archivo | null, id?: number) {
  if (!Number.isSafeInteger(actor.usuarioId) || actor.usuarioId <= 0) throw new ErrorDominioFormulario("Usuario registrador inválido.");
  const datos = combustibleStaffSchema.parse(input);
  if (id == null && !file) throw new ErrorDominioFormulario("Adjunta la evidencia del vale.");
  const conn = await getPool().getConnection();
  let subida: Awaited<ReturnType<typeof guardarUpload>> | null = null;
  let anterior: string | null = null;
  let committed = false;
  try {
    await conn.beginTransaction();
    const [proveedores] = await conn.query<RowDataPacket[]>("SELECT id, activo FROM compras_proveedores WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, datos.proveedorId]);
    if (!proveedores[0]) throw new ErrorDominioFormulario("Proveedor no disponible para esta empresa.");
    let actual: RowDataPacket | undefined;
    if (id != null) {
      const [rows] = await conn.query<RowDataPacket[]>("SELECT id, estado, vehiculo_id, viaje_id, proveedor_id, estacion_id, gasolinera, ruta_relativa FROM flota_combustible_cargas WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, id]);
      actual = rows[0];
      if (!actual) throw new ErrorDominioFormulario("Vale no encontrado.", 404);
      if (actual.estado !== "PENDIENTE") throw new ErrorDominioFormulario("Solo se pueden editar vales pendientes.", 409);
      anterior = actual.ruta_relativa ? String(actual.ruta_relativa) : null;
    }
    if (!proveedores[0].activo && (!actual || Number(actual.proveedor_id) !== datos.proveedorId)) throw new ErrorDominioFormulario("Proveedor inactivo.");
    const estacionId = datos.estacionId === undefined ? (actual?.estacion_id == null ? null : Number(actual.estacion_id)) : datos.estacionId;
    // Texto histórico preservado; el navegador no decide el snapshot de una estación catalogada.
    let gasolinera = actual?.gasolinera ?? null;
    if (estacionId != null) {
      const [estaciones] = await conn.query<RowDataPacket[]>("SELECT id, nombre, activo FROM flota_combustible_estaciones WHERE empresa_id=? AND proveedor_id=? AND id=? LOCK IN SHARE MODE", [empresaId, datos.proveedorId, estacionId]);
      const estacion = estaciones[0];
      const conserva = actual && Number(actual.estacion_id) === estacionId && Number(actual.proveedor_id) === datos.proveedorId;
      if (!estacion || (!estacion.activo && !conserva)) throw new ErrorDominioFormulario("La estación no está activa o no pertenece a este proveedor y empresa.");
      gasolinera = conserva && actual?.gasolinera != null ? actual.gasolinera : String(estacion.nombre);
    }
    const vehiculo = await obtenerVehiculoAccesibleTx(conn, empresaId, datos.vehiculoId);
    if ((!actual || Number(actual.vehiculo_id) !== datos.vehiculoId) && (!vehiculo || !vehiculo.activo)) throw new ErrorDominioFormulario("Vehículo no disponible para esta empresa.");
    if (datos.viajeId != null) {
      const [viajes] = await conn.query<RowDataPacket[]>("SELECT id, vehiculo_id FROM flota_viajes WHERE empresa_id = ? AND id = ?", [empresaId, datos.viajeId]);
      if (!viajes[0] || Number(viajes[0].vehiculo_id) !== datos.vehiculoId) throw new ErrorDominioFormulario("Viaje no válido para esta empresa y unidad.");
    }
    const [duplicados] = await conn.query<RowDataPacket[]>(`SELECT id FROM flota_combustible_cargas WHERE empresa_id = ? AND proveedor_id = ? AND UPPER(TRIM(numero_vale)) = UPPER(TRIM(?)) AND id <> ? LIMIT 1`, [empresaId, datos.proveedorId, datos.numeroVale, id ?? 0]);
    if (duplicados.length) throw new ErrorDominioFormulario("Ya existe un vale con ese proveedor y número en esta empresa.", 409);
    if (!file && !anterior) throw new ErrorDominioFormulario("Adjunta la evidencia del vale.");
    if (file) subida = await guardarUpload(empresaId, "flota", "combustible", file);
    const valores = [datos.vehiculoId, datos.viajeId, datos.proveedorId, datos.numeroVale, datos.fechaConsumo, datos.tipoCombustible, datos.galones, datos.monto, precioCalculado(datos.monto, datos.galones), datos.km, gasolinera, datos.observaciones || null, estacionId];
    let cargaId = id;
    if (id == null) {
      const [result] = await conn.execute<import("mysql2").ResultSetHeader>(`INSERT INTO flota_combustible_cargas
        (vehiculo_id, viaje_id, proveedor_id, numero_vale, fecha_consumo, tipo_combustible, galones, monto, precio_por_galon, km, gasolinera, observaciones, estacion_id,
         empresa_id, empleado_id, piloto_nombre, ruta_relativa, nombre_original, mime, tamano, estado, creado_por, creado_por_usuario_id, creado_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?)`,
      [...valores, empresaId, subida!.relative, subida!.original, contentTypeFor(subida!.original), subida!.size, actor.username, actor.usuarioId, ahoraLocal()]);
      cargaId = Number(result.insertId);
    } else {
      await conn.execute(`UPDATE flota_combustible_cargas SET vehiculo_id=?, viaje_id=?, proveedor_id=?, numero_vale=?, fecha_consumo=?, tipo_combustible=?, galones=?, monto=?, precio_por_galon=?, km=?, gasolinera=?, observaciones=?, estacion_id=?${subida ? ", ruta_relativa=?, nombre_original=?, mime=?, tamano=?" : ""} WHERE empresa_id=? AND id=? AND estado='PENDIENTE'`,
        [...valores, ...(subida ? [subida.relative, subida.original, contentTypeFor(subida.original), subida.size] : []), empresaId, id]);
    }
    await registrarAuditoriaTx(conn, { empresaId, usuario: actor.username, accion: id == null ? "registrar_combustible" : "editar_combustible", modulo: "flota_combustible", detalle: `Vale #${cargaId} · proveedor #${datos.proveedorId} · ${datos.numeroVale} · usuario #${actor.usuarioId}` });
    await conn.commit();
    committed = true;
    // El archivo histórico se conserva: puede estar referenciado por snapshots/consultas anteriores.
    return cargaId!;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    if (!committed && subida && validarRutaArchivoEmpresa(empresaId, subida.relative)) borrarUpload(subida.relative);
  }
}
