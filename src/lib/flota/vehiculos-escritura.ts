import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { placaComparable } from "./combustible-coincidencias";
import { estadoEsquemaFisico, consultaFisicaTx } from "./identidad-fisica-schema";

export class ErrorIdentidadVehiculo extends Error {
  constructor(message: string, public status = 409, public codigo?: string) { super(message); }
}

/** Código con el que la API avisa que la placa ya pertenece a una unidad física con identidad vinculada. */
export const PLACA_CON_IDENTIDAD_VINCULADA = "PLACA_CON_IDENTIDAD_VINCULADA";

/** All application plate writers lock the owning company on the same transaction connection.
 * No UNIQUE/DDL or changes to existing plates. External SQL writers remain outside this guarantee. */
export async function escribirVehiculos<T>(empresa: number, accion: (c: PoolConnection) => Promise<T>) {
  const c = await getPool().getConnection();
  let limpia = false, commit = false;
  try {
    await c.beginTransaction();
    const [e] = await c.query<RowDataPacket[]>("SELECT id FROM empresas WHERE id=? AND activa=1 FOR UPDATE", [empresa]);
    if (!e.length) throw new ErrorIdentidadVehiculo("Empresa no disponible.", 403);
    const result = await accion(c);
    commit = true; await c.commit(); limpia = true;
    return result;
  } catch (e) {
    try { await c.rollback(); limpia = !commit; } catch { limpia = false; }
    if (commit) throw new ErrorIdentidadVehiculo("Resultado incierto. Consulta el catálogo antes de reintentar.", 503);
    throw e;
  } finally { if (limpia) c.release(); else c.destroy(); }
}

export async function coincidenciasPlacaTx(c: PoolConnection, empresa: number, placa: string) {
  const key = placaComparable(placa);
  if (!key) throw new ErrorIdentidadVehiculo("Placa inválida.", 400);
  // Current read after company lock: a waiting writer sees the preceding commit even under RR.
  const [rows] = await c.query<RowDataPacket[]>("SELECT id,empresa_id,placa,chasis,tipo_unidad,activo FROM flota_vehiculos WHERE empresa_id=? ORDER BY id FOR UPDATE", [empresa]);
  return rows.filter(v => placaComparable(String(v.placa)) === key);
}

export async function exigirPlacaLibreTx(c: PoolConnection, empresa: number, placa: string, id?: number) {
  const rows = await coincidenciasPlacaTx(c, empresa, placa);
  if (rows.some(v => Number(v.id) !== id)) throw new ErrorIdentidadVehiculo("La placa comparable ya está registrada en esta empresa. Revisa el registro existente.");
  await exigirSinDuplicadoCompartidoTx(c,empresa,placa,id);
}

/** Sharing authorizes use, not creation of a second local physical record. */
export async function exigirSinDuplicadoCompartidoTx(c:PoolConnection,empresa:number,placa:string,id?:number){
 await exigirSinIdentidadVinculadaTx(c,placa);
 const [compartidos]=await c.query<RowDataPacket[]>("SELECT v.id,v.placa FROM flota_vehiculos v JOIN flota_vehiculo_acceso a ON a.vehiculo_id=v.id AND a.empresa_id=? WHERE v.empresa_id<>? AND v.activo=1 ORDER BY v.id FOR UPDATE",[empresa,empresa]);
 if(compartidos.some(v=>Number(v.id)!==id&&placaComparable(String(v.placa))===placaComparable(placa)))throw new ErrorIdentidadVehiculo("La placa ya corresponde a una unidad compartida vigente. Usa ese registro o revisa su identidad fisica.");
}

/**
 * No se crea otra ficha con la placa de una unidad física que YA tiene una identidad APROBADA: se usa la unidad existente y se solicita la autorización de uso
 * (evita nuevos duplicados sin bloquear unidades legítimas). Solo informa que la placa ya está vinculada; nunca datos de las fichas ni de otras empresas.
 * Se ejecuta bajo el bloqueo de la empresa que escribe. Interruptor de emergencia: `FLOTA_GUARDA_ALTA_IDENTIDAD=0`.
 */
export async function exigirSinIdentidadVinculadaTx(c: PoolConnection, placa: string) {
  if (process.env.FLOTA_GUARDA_ALTA_IDENTIDAD === "0") return;
  const clave = placaComparable(placa);
  if (!clave) return;
  if (await estadoEsquemaFisico(consultaFisicaTx(c)) !== "COMPLETO") return;
  const [aprobadas] = await c.query<RowDataPacket[]>("SELECT v.placa FROM flota_identidad_miembros m JOIN flota_identidades_fisicas f ON f.id = m.identidad_id AND f.estado = 'APROBADA' JOIN flota_vehiculos v ON v.id = m.vehiculo_id");
  if (aprobadas.some(r => placaComparable(String(r.placa)) === clave)) {
    throw new ErrorIdentidadVehiculo("Esta placa ya corresponde a una unidad física con identidad vinculada. No se crea otra ficha: solicita al administrador la autorización de uso de la unidad existente.", 409, PLACA_CON_IDENTIDAD_VINCULADA);
  }
}

/** ¿La ficha pertenece a alguna identidad física (en cualquier estado)? Sus datos de identidad quedan inmutables. */
export async function fichaEnIdentidadTx(c: PoolConnection, vehiculoId: number) {
  if (await estadoEsquemaFisico(consultaFisicaTx(c)) === "AUSENTE") return false;
  const [m] = await c.query<RowDataPacket[]>("SELECT 1 FROM flota_identidad_miembros WHERE vehiculo_id = ? LIMIT 1", [vehiculoId]);
  return m.length > 0;
}
