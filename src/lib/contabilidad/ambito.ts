import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";

export type AmbitoContable = { entidadId: number; usuarioId: number; admin: boolean };
export class AccesoContable extends Error {
  constructor(message: string, public status = 403) { super(message); }
}
export function ambitoDesdeRequest(req: Request, session: SessionPayload): AmbitoContable {
  const valores = new URL(req.url).searchParams.getAll("entidad");
  if (valores.length !== 1 || !/^[1-9]\d*$/.test(valores[0]) || Number(valores[0]) > 2147483647) {
    throw new AccesoContable("Selecciona una entidad contable válida.", 400);
  }
  return { entidadId: Number(valores[0]), usuarioId: session.id, admin: session.rol === "Admin" };
}

/** Después del guard de módulo. Mismo lock de empresa que la limpieza; entidad que la revocación. */
export async function bloquearAmbito(conn: PoolConnection, empresaId: number, a: AmbitoContable, editar: boolean) {
  if (!a || !Number.isInteger(a.entidadId) || a.entidadId <= 0) throw new AccesoContable("Entidad requerida.", 400);
  const [empresas] = await conn.query<RowDataPacket[]>("SELECT id FROM empresas WHERE id = ? FOR UPDATE", [empresaId]);
  if (!empresas.length) throw new AccesoContable("Empresa no disponible.");
  const [entidades] = await conn.query<RowDataPacket[]>(
    "SELECT id, activa FROM cont_entidades WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresaId, a.entidadId],
  );
  if (!entidades.length || Number(entidades[0].activa) !== 1) throw new AccesoContable("Entidad no disponible.");
  if (a.admin) return;
  const [accesos] = await conn.query<RowDataPacket[]>(
    "SELECT activo, puede_editar FROM cont_entidad_usuarios WHERE empresa_id = ? AND entidad_id = ? AND usuario_id = ? FOR UPDATE",
    [empresaId, a.entidadId, a.usuarioId],
  );
  if (!accesos.length || Number(accesos[0].activo) !== 1 || (editar && Number(accesos[0].puede_editar) !== 1)) {
    throw new AccesoContable("Sin acceso suficiente a esta entidad.");
  }
}

const consultas = {
  cuentas: "SELECT id, codigo, nombre, tipo, nivel, activa FROM cont_cuentas WHERE empresa_id = ? AND entidad_id = ? ORDER BY codigo",
  asientos: `SELECT id, fecha, numero, glosa, estado, creado_por,
    (SELECT COALESCE(SUM(d.debe), 0) FROM cont_asiento_detalle d WHERE d.empresa_id = cont_asientos.empresa_id AND d.entidad_id = cont_asientos.entidad_id AND d.asiento_id = cont_asientos.id) AS total_debe,
    (SELECT COALESCE(SUM(d.haber), 0) FROM cont_asiento_detalle d WHERE d.empresa_id = cont_asientos.empresa_id AND d.entidad_id = cont_asientos.entidad_id AND d.asiento_id = cont_asientos.id) AS total_haber
    FROM cont_asientos WHERE empresa_id = ? AND entidad_id = ? ORDER BY fecha DESC, id DESC LIMIT 100`,
  cxc: "SELECT id, cliente, documento, fecha, vencimiento, monto, saldo, estado FROM cont_cxc WHERE empresa_id = ? AND entidad_id = ? ORDER BY fecha DESC, id DESC LIMIT 200",
  cxp: "SELECT id, proveedor, documento, fecha, vencimiento, monto, saldo, estado FROM cont_cxp WHERE empresa_id = ? AND entidad_id = ? ORDER BY fecha DESC, id DESC LIMIT 200",
};
export async function consultarLibro(tipo: keyof typeof consultas, empresaId: number, a: AmbitoContable) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await bloquearAmbito(conn, empresaId, a, false);
    const [rows] = await conn.query<RowDataPacket[]>(consultas[tipo], [empresaId, a.entidadId]);
    await conn.commit();
    return rows;
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}
export function errorAmbito(error: unknown) {
  if (error instanceof AccesoContable) return NextResponse.json({ error: error.message }, { status: error.status });
  const code = (error as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return NextResponse.json(
    { error: "Esquema contable pendiente. Verifica las migraciones de entidades y C2A.", codigo: "MIGRACION_PENDIENTE" }, { status: 503 },
  );
  return null;
}

/** Fail-closed hasta el corte manual C2B. Sin DDL ni alteración automática. */
export async function exigirEsquemaC2b(conn: PoolConnection) {
  const [indices] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tabla, INDEX_NAME AS nombre,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0
       AND TABLE_NAME IN ('cont_cuentas','cont_asientos')
     GROUP BY TABLE_NAME, INDEX_NAME`,
  );
  const esperados = [
    ["cont_cuentas", "uq_cuenta_entidad", "empresa_id,entidad_id,codigo"],
    ["cont_asientos", "uq_asiento_entidad", "empresa_id,entidad_id,numero"],
  ];
  const [fks] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS tabla, CONSTRAINT_NAME AS nombre, REFERENCED_TABLE_NAME AS referencia,
       GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas,
       GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS destino
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('cont_cuentas','cont_asientos','cont_cxc','cont_cxp','cont_asiento_detalle')
     GROUP BY TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME`,
  );
  const relaciones = [
    ["cont_cuentas", "fk_cont_cuenta_entidad", "cont_entidades", "empresa_id,entidad_id", "empresa_id,id"],
    ["cont_asientos", "fk_cont_asiento_entidad", "cont_entidades", "empresa_id,entidad_id", "empresa_id,id"],
    ["cont_cxc", "fk_cont_cxc_entidad", "cont_entidades", "empresa_id,entidad_id", "empresa_id,id"],
    ["cont_cxp", "fk_cont_cxp_entidad", "cont_entidades", "empresa_id,entidad_id", "empresa_id,id"],
    ["cont_asiento_detalle", "fk_cont_detalle_asiento_ambito", "cont_asientos", "empresa_id,entidad_id,asiento_id", "empresa_id,entidad_id,id"],
    ["cont_asiento_detalle", "fk_cont_detalle_cuenta_ambito", "cont_cuentas", "empresa_id,entidad_id,cuenta_id", "empresa_id,entidad_id,id"],
  ];
  if (!esperados.every(([tabla, nombre, columnas]) => indices.some((i) => i.tabla === tabla && i.nombre === nombre && i.columnas === columnas))
    || indices.some((i) => i.nombre === "uq_cuenta" || i.nombre === "uq_asiento")
    || !relaciones.every(([tabla, nombre, referencia, columnas, destino]) => fks.some((f) =>
      f.tabla === tabla && f.nombre === nombre && f.referencia === referencia && f.columnas === columnas && f.destino === destino))) {
    throw new AccesoContable("Esquema C2B pendiente. Aplica manualmente la migración contabilidad-entidad-integridad antes de registrar.", 503);
  }
}
