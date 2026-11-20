import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { placaComparable } from "./combustible-coincidencias";
import { estadoEsquemaFisico, consultaFisicaTx } from "./identidad-fisica-schema";

export class ErrorIdentidadVehiculo extends Error {
  constructor(message: string, public status = 409, public codigo?: string) { super(message); }
}

/** Código con el que la API avisa que compartir dejaría a una empresa con dos fichas de la misma placa (la pantalla pide confirmar). */
export const PLACA_REPETIDA_AL_COMPARTIR = "PLACA_REPETIDA_AL_COMPARTIR";

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
 const [compartidos]=await c.query<RowDataPacket[]>("SELECT v.id,v.placa FROM flota_vehiculos v JOIN flota_vehiculo_acceso a ON a.vehiculo_id=v.id AND a.empresa_id=? WHERE v.empresa_id<>? AND v.activo=1 ORDER BY v.id FOR UPDATE",[empresa,empresa]);
 if(compartidos.some(v=>Number(v.id)!==id&&placaComparable(String(v.placa))===placaComparable(placa)))throw new ErrorIdentidadVehiculo("La placa ya corresponde a una unidad compartida vigente. Usa ese registro o revisa su identidad fisica.");
}

export type ConflictoCompartir = { empresaId: number; nombre: string };

/**
 * Compartir una ficha AUTORIZA el uso de la unidad; no debe dejar a la empresa destino con dos fichas de la misma placa sin que nadie lo decida.
 * Devuelve las empresas NUEVAS (las que aún no tenían acceso) que ya tienen una ficha ACTIVA propia con la misma placa comparable y cuya unidad no
 * está unida por una identidad física APROBADA con esta ficha. Las comparticiones ya existentes no se revisan (no se bloquean ediciones ajenas) y
 * una ficha inactiva no cuenta. Solo lee; el candado de las filas evita carreras con altas simultáneas. Solo se devuelve el nombre de la empresa
 * que la propia persona eligió: nunca IDs ni datos de las fichas de la otra empresa.
 */
export async function conflictosAlCompartirTx(c: PoolConnection, vehiculoId: number, empresaIds: number[]): Promise<ConflictoCompartir[]> {
  const pedidas = [...new Set(empresaIds.map(Number))].filter(n => Number.isSafeInteger(n) && n > 0);
  if (!pedidas.length) return [];
  const [[v]] = await c.query<RowDataPacket[]>("SELECT id,empresa_id,placa FROM flota_vehiculos WHERE id=? FOR UPDATE", [vehiculoId]);
  if (!v) throw new ErrorIdentidadVehiculo("Vehículo no disponible.", 404);
  const clave = placaComparable(String(v.placa));
  if (!clave) return [];
  const [actuales] = await c.query<RowDataPacket[]>("SELECT empresa_id FROM flota_vehiculo_acceso WHERE vehiculo_id=?", [vehiculoId]);
  const yaTienen = new Set(actuales.map(a => Number(a.empresa_id)));
  const nuevas = pedidas.filter(e => e !== Number(v.empresa_id) && !yaTienen.has(e));
  if (!nuevas.length) return [];
  const identidades = await estadoEsquemaFisico(consultaFisicaTx(c)) === "COMPLETO";
  const conflictos: ConflictoCompartir[] = [];
  for (const empresaId of nuevas) {
    const [locales] = await c.query<RowDataPacket[]>("SELECT id,placa FROM flota_vehiculos WHERE empresa_id=? AND activo=1 AND id<>? ORDER BY id FOR UPDATE", [empresaId, vehiculoId]);
    const iguales = locales.filter(l => placaComparable(String(l.placa)) === clave);
    let sinResolver = false;
    for (const l of iguales) {
      const [unidos] = identidades
        ? await c.query<RowDataPacket[]>("SELECT 1 FROM flota_identidad_miembros a JOIN flota_identidad_miembros b ON b.identidad_id=a.identidad_id AND b.vehiculo_id=? JOIN flota_identidades_fisicas f ON f.id=a.identidad_id AND f.estado='APROBADA' WHERE a.vehiculo_id=? LIMIT 1", [vehiculoId, Number(l.id)])
        : [[]];
      if (!unidos.length) sinResolver = true;
    }
    if (!sinResolver) continue;
    const [[e]] = await c.query<RowDataPacket[]>("SELECT nombre FROM empresas WHERE id=?", [empresaId]);
    conflictos.push({ empresaId, nombre: String(e?.nombre ?? `empresa ${empresaId}`) });
  }
  return conflictos;
}

export const mensajeConflictoCompartir = (conflictos: ConflictoCompartir[], placa?: string) =>
  `${conflictos.map(x => x.nombre).join(", ")} ya ${conflictos.length > 1 ? "tienen" : "tiene"} una ficha propia activa${placa ? ` con la placa ${placa}` : " con la misma placa"}. Compartir esta unidad dejaría dos fichas visibles que pueden ser la misma unidad física o unidades distintas. Para unirlas, propón y aprueba su identidad física en Combustibles CB2 → Identidades físicas; no se eliminan ni se fusionan registros.`;

/** Variante estricta (sin confirmación posible): para importaciones, donde no hay diálogo. */
export async function exigirComparticionSinDuplicadoTx(c: PoolConnection, vehiculoId: number, empresaIds: number[]) {
  const conflictos = await conflictosAlCompartirTx(c, vehiculoId, empresaIds);
  if (conflictos.length) throw new ErrorIdentidadVehiculo(mensajeConflictoCompartir(conflictos), 409, PLACA_REPETIDA_AL_COMPARTIR);
}
