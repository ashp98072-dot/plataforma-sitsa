import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { placaComparable } from "./combustible-coincidencias";
import { identificarPlaca } from "./combustible-coincidencias";

export class ErrorIdentidadVehiculo extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

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
 await exigirSinEquivalenciaPlacaTx(c,empresa,placa);
 const [compartidos]=await c.query<RowDataPacket[]>("SELECT v.id,v.placa FROM flota_vehiculos v JOIN flota_vehiculo_acceso a ON a.vehiculo_id=v.id AND a.empresa_id=? WHERE v.empresa_id<>? AND v.activo=1 ORDER BY v.id FOR UPDATE",[empresa,empresa]);
 if(compartidos.some(v=>Number(v.id)!==id&&placaComparable(String(v.placa))===placaComparable(placa)))throw new ErrorIdentidadVehiculo("La placa ya corresponde a una unidad compartida vigente. Usa ese registro o revisa su identidad fisica.");
}

/** El llamador debe bloquear la fila de empresa antes de comprobar y escribir. */
export async function exigirSinEquivalenciaPlacaTx(c: PoolConnection, empresa: number, placa: string) {
 const [tablas] = await c.query<RowDataPacket[]>("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_placas_equivalencias'");
 if (!tablas.length) return;
 if (tablas[0].ENGINE !== "InnoDB") throw new ErrorIdentidadVehiculo("Registro de equivalencias de placas incompatible.", 503);
 const [equivalencias] = await c.query<RowDataPacket[]>("SELECT placa_normalizada FROM flota_cb2_placas_equivalencias WHERE empresa_id=? AND revocado_en IS NULL FOR UPDATE", [empresa]);
 if (equivalencias.some(e => identificarPlaca(String(e.placa_normalizada), [{ placa }], v => v.placa).estado !== "INEXISTENTE")) throw new ErrorIdentidadVehiculo("La placa coincide con una equivalencia CB2 vigente. Revísala y revócala antes de registrar la unidad.");
}
