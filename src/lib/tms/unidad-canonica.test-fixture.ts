import type { PoolConnection,ResultSetHeader,RowDataPacket } from "mysql2/promise";
import { idUnidadTrasUpsert } from "./unidad-upsert";
/** Adaptador de la unidad para los simuladores de orquestación existentes.
 * El resolvedor REAL se prueba aparte, con MariaDB y guardas reales. */
export async function unidadEnSimulador(c:PoolConnection,empresa:number,placa:string,flota:number|null) {
 const [r]=await c.execute<ResultSetHeader>("INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id) VALUES (?, ?, 'Camion', ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",[empresa,placa,flota]);
 return idUnidadTrasUpsert(r.insertId,async()=>{const [u]=await c.query<RowDataPacket[]>("SELECT id FROM tms_unidades WHERE empresa_id = ? AND placa = ? LIMIT 1",[empresa,placa]);return u[0]?Number(u[0].id):null;});
}
