import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { AccesoContable, type AmbitoContable } from "./ambito";
import { textoBanco, type BancoContable } from "./bancos-shared";

export const SQL_BANCOS = `SELECT b.id, b.banco, b.alias, b.moneda, b.activa,
  c.id AS cuenta_id, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, c.activa AS cuenta_activa
  FROM cont_cuentas_bancarias b LEFT JOIN cont_cuentas c
    ON c.empresa_id=b.empresa_id AND c.entidad_id=b.entidad_id AND c.id=b.cuenta_id
  WHERE b.empresa_id=? AND b.entidad_id=? ORDER BY b.alias,b.id`;
const estado = (v: unknown) => v === 1 || v === "1" ? true : v === 0 || v === "0" ? false : null;
export function bancoVisible(r: RowDataPacket): BancoContable {
  const banco = textoBanco(r.banco), alias = textoBanco(r.alias), moneda = textoBanco(r.moneda);
  const cuenta = r.cuenta_id == null ? null : {
    codigo: typeof r.cuenta_codigo === "string" && r.cuenta_codigo.trim() ? r.cuenta_codigo.trim() : null,
    nombre: textoBanco(r.cuenta_nombre), activa: estado(r.cuenta_activa),
  };
  const advertencias: string[] = [];
  if (!banco) advertencias.push("Banco sin configurar.");
  if (!alias) advertencias.push("Alias sin configurar.");
  if (!moneda || !/^[A-Z]{3}$/.test(moneda)) advertencias.push("Moneda sin configuración válida.");
  if (!cuenta) advertencias.push("Cuenta contable no disponible en esta entidad.");
  else {
    if (!cuenta.codigo || !cuenta.nombre) advertencias.push("Cuenta contable incompleta.");
    if (cuenta.activa !== true) advertencias.push(cuenta.activa === false ? "Cuenta contable inactiva." : "Estado contable sin configurar.");
  }
  const activa = estado(r.activa);
  if (activa === null) advertencias.push("Estado bancario sin configurar.");
  return { id: Number(r.id), banco, alias, moneda, activa, cuenta, advertencias };
}

/** Caller: requireTenantModulo(contabilidad). La política vigente autoriza los libros de la empresa, no asignaciones duplicadas (#555). */
export async function consultarBancos(empresaId: number, ambito: AmbitoContable): Promise<BancoContable[]> {
  if (!Number.isInteger(ambito.entidadId) || ambito.entidadId <= 0) throw new AccesoContable("Entidad inválida.", 400);
  const c = await getPool().getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [entidades] = await c.query<RowDataPacket[]>("SELECT id,activa FROM cont_entidades WHERE empresa_id=? AND id=?", [empresaId, ambito.entidadId]);
    if (!entidades.length || (!ambito.admin && Number(entidades[0].activa) !== 1)) throw new AccesoContable("Entidad no disponible.", 404);
    const [rows] = await c.query<RowDataPacket[]>(SQL_BANCOS, [empresaId, ambito.entidadId]);
    await c.commit();
    return rows.map(bancoVisible);
  } catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
}
