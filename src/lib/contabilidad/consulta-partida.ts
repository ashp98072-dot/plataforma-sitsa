import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { AccesoContable, bloquearAmbito, type AmbitoContable } from "./ambito";
import { importeCentavos, mostrarCentavos } from "./captura";

export function totalizarPartida(lineas: { debe: unknown; haber: unknown }[]) {
  let debe = BigInt(0), haber = BigInt(0);
  for (const linea of lineas) {
    const d = importeCentavos(String(linea.debe)), h = importeCentavos(String(linea.haber));
    if (d === null || h === null) throw new Error("Importe contable inválido.");
    debe += d; haber += h;
  }
  return { debe: mostrarCentavos(debe), haber: mostrarCentavos(haber), diferencia: mostrarCentavos(debe - haber) };
}

export async function consultarPartida(empresaId: number, ambito: AmbitoContable, id: string) {
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) throw new AccesoContable("Partida inválida.", 400);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await bloquearAmbito(conn, empresaId, ambito, false);
    const parametros = [empresaId, ambito.entidadId, Number(id)];
    const [cabeceras] = await conn.query<RowDataPacket[]>(
      "SELECT id, numero, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, glosa, estado, creado_por FROM cont_asientos WHERE empresa_id = ? AND entidad_id = ? AND id = ?", parametros);
    if (!cabeceras.length) throw new AccesoContable("Partida no encontrada.", 404);
    const [lineas] = await conn.query<RowDataPacket[]>(
      `SELECT d.id, d.cuenta_id, c.codigo, c.nombre, d.debe, d.haber
       FROM cont_asiento_detalle d
       LEFT JOIN cont_cuentas c ON c.id = d.cuenta_id AND c.empresa_id = d.empresa_id AND c.entidad_id = d.entidad_id
       WHERE d.empresa_id = ? AND d.entidad_id = ? AND d.asiento_id = ? ORDER BY d.id`, parametros);
    const totales = totalizarPartida(lineas as { debe: unknown; haber: unknown }[]);
    await conn.commit();
    return { asiento: cabeceras[0], lineas, totales };
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
