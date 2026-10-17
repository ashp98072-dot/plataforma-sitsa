import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorCxp, esConflictoTransitorio } from "./errores";
import type { RegimenFiscal } from "./isr-proveedor";
import { idOpcional, idPositivo, regimenValido } from "./validacion";

/**
 * M-3A — configuración fiscal/contable del proveedor POR EMPRESA + ENTIDAD. El proveedor sigue siendo `compras_proveedores` (maestro comercial,
 * sin duplicarlo); esta tabla solo añade régimen, sujeción a ISR y cuentas contables. Cambiarla NO altera facturas ya registradas
 * (cada factura guarda una fotografía del régimen y de la regla aplicada).
 */
export type Actor = { id: number; username: string };
export type ConfigFiscal = {
  proveedorId: number; entidadId: number; regimenFiscal: RegimenFiscal; sujetoIsr: boolean;
  cuentaProveedorId: number | null; cuentaAnticipoId: number | null; cuentaGastoId: number | null; activo: boolean;
};
export type EntradaConfigFiscal = {
  regimenFiscal?: unknown; sujetoIsr?: unknown; cuentaProveedorId?: unknown; cuentaAnticipoId?: unknown; cuentaGastoId?: unknown; activo?: unknown;
};

const TIPO_CUENTA = { cuentaProveedorId: "Pasivo", cuentaAnticipoId: "Activo", cuentaGastoId: "Gasto" } as const;
const ETIQUETA_CUENTA = { cuentaProveedorId: "Cuenta de proveedores", cuentaAnticipoId: "Cuenta de anticipo a proveedores", cuentaGastoId: "Cuenta de gasto" } as const;

const mapear = (r: RowDataPacket): ConfigFiscal => ({
  proveedorId: Number(r.proveedor_id), entidadId: Number(r.entidad_id), regimenFiscal: String(r.regimen_fiscal) as RegimenFiscal,
  sujetoIsr: Number(r.sujeto_isr) === 1,
  cuentaProveedorId: r.cuenta_proveedor_id == null ? null : Number(r.cuenta_proveedor_id),
  cuentaAnticipoId: r.cuenta_anticipo_id == null ? null : Number(r.cuenta_anticipo_id),
  cuentaGastoId: r.cuenta_gasto_id == null ? null : Number(r.cuenta_gasto_id),
  activo: Number(r.activo) === 1,
});
const COLUMNAS = "proveedor_id, entidad_id, regimen_fiscal, sujeto_isr, cuenta_proveedor_id, cuenta_anticipo_id, cuenta_gasto_id, activo";

export async function obtenerConfigFiscal(empresaId: number, entidadId: number, proveedorId: number): Promise<ConfigFiscal | null> {
  const rows = await query<RowDataPacket[]>(`SELECT ${COLUMNAS} FROM cxp_proveedor_fiscal WHERE empresa_id = ? AND entidad_id = ? AND proveedor_id = ?`, [empresaId, entidadId, proveedorId]);
  return rows[0] ? mapear(rows[0]) : null;
}

/** Proveedores comerciales de la empresa con su configuración fiscal para la entidad (null = pendiente de configurar). */
export async function listarProveedoresCxp(empresaId: number, entidadId: number, { buscar = "", soloActivos = false }: { buscar?: string; soloActivos?: boolean } = {}) {
  const termino = buscar.trim().slice(0, 100);
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.nombre_comercial, p.nit, p.dias_credito, p.activo AS proveedor_activo,
            f.proveedor_id, f.entidad_id, f.regimen_fiscal, f.sujeto_isr, f.cuenta_proveedor_id, f.cuenta_anticipo_id, f.cuenta_gasto_id, f.activo
       FROM compras_proveedores p
       LEFT JOIN cxp_proveedor_fiscal f ON f.empresa_id = p.empresa_id AND f.proveedor_id = p.id AND f.entidad_id = ?
      WHERE p.empresa_id = ? AND (? = '' OR LOCATE(?, p.nombre_comercial) > 0 OR LOCATE(?, COALESCE(p.nit, '')) > 0) AND (? = 0 OR p.activo = 1)
      ORDER BY p.nombre_comercial LIMIT 300`,
    [entidadId, empresaId, termino, termino, termino, soloActivos ? 1 : 0],
  );
  return rows.map(r => ({
    id: Number(r.id), nombre: String(r.nombre_comercial), nit: r.nit == null ? null : String(r.nit),
    diasCredito: r.dias_credito == null ? null : Number(r.dias_credito), activo: Number(r.proveedor_activo) === 1,
    fiscal: r.proveedor_id == null ? null : mapear(r),
  }));
}

/** Cuentas activas de la entidad (id, código, nombre, tipo) para los selectores de la configuración fiscal. */
export async function listarCuentasCxp(empresaId: number, entidadId: number) {
  const rows = await query<RowDataPacket[]>(
    "SELECT id, codigo, nombre, tipo FROM cont_cuentas WHERE empresa_id = ? AND entidad_id = ? AND activa = 1 AND tipo IN ('Pasivo','Activo','Gasto') ORDER BY codigo LIMIT 2000",
    [empresaId, entidadId]);
  return rows.map(r => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre), tipo: String(r.tipo) }));
}

async function validarCuenta(conn: PoolConnection, empresaId: number, entidadId: number, campo: keyof typeof TIPO_CUENTA, cuentaId: number | null) {
  if (cuentaId == null) return;
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT tipo, activa FROM cont_cuentas WHERE empresa_id = ? AND entidad_id = ? AND id = ? LOCK IN SHARE MODE", [empresaId, entidadId, cuentaId]);
  if (!rows[0]) throw new ErrorCxp(`${ETIQUETA_CUENTA[campo]}: la cuenta no existe en esta entidad.`, 400, "CUENTA_INVALIDA");
  if (Number(rows[0].activa) !== 1) throw new ErrorCxp(`${ETIQUETA_CUENTA[campo]}: la cuenta está inactiva.`, 400, "CUENTA_INVALIDA");
  if (String(rows[0].tipo) !== TIPO_CUENTA[campo]) {
    throw new ErrorCxp(`${ETIQUETA_CUENTA[campo]}: debe ser una cuenta de tipo ${TIPO_CUENTA[campo]}.`, 400, "CUENTA_TIPO_INVALIDO");
  }
}

/** Crea o actualiza la configuración fiscal (transaccional y auditada). Empresa/entidad/usuario vienen del servidor, nunca del cuerpo. */
export async function guardarConfigFiscal(empresaId: number, entidadId: number, proveedorIdEntrada: unknown, actor: Actor, entrada: EntradaConfigFiscal): Promise<ConfigFiscal> {
  const proveedorId = idPositivo(proveedorIdEntrada, "Proveedor");
  const regimenFiscal = regimenValido(entrada.regimenFiscal);
  if (typeof entrada.sujetoIsr !== "boolean") throw new ErrorCxp("Indica si el proveedor está sujeto a retención de ISR.", 400, "SUJETO_ISR_REQUERIDO");
  if (regimenFiscal === "PEQUENO_CONTRIBUYENTE" && entrada.sujetoIsr) {
    throw new ErrorCxp("Un pequeño contribuyente no tiene retención de ISR: desmarca «sujeto a ISR».", 400, "PEQUENO_SIN_RETENCION");
  }
  if (entrada.activo !== undefined && typeof entrada.activo !== "boolean") throw new ErrorCxp("Estado inválido.", 400, "ESTADO_INVALIDO");
  const cuentas = {
    cuentaProveedorId: idOpcional(entrada.cuentaProveedorId, "Cuenta de proveedores"),
    cuentaAnticipoId: idOpcional(entrada.cuentaAnticipoId, "Cuenta de anticipo"),
    cuentaGastoId: idOpcional(entrada.cuentaGastoId, "Cuenta de gasto"),
  };
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const [entidad] = await conn.query<RowDataPacket[]>("SELECT activa FROM cont_entidades WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE", [empresaId, entidadId]);
    if (!entidad[0] || Number(entidad[0].activa) !== 1) throw new ErrorCxp("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE");
    const [prov] = await conn.query<RowDataPacket[]>("SELECT id FROM compras_proveedores WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE", [empresaId, proveedorId]);
    if (!prov[0]) throw new ErrorCxp("Proveedor no disponible para esta empresa.", 404, "PROVEEDOR_NO_DISPONIBLE");
    for (const campo of Object.keys(TIPO_CUENTA) as (keyof typeof TIPO_CUENTA)[]) await validarCuenta(conn, empresaId, entidadId, campo, cuentas[campo]);

    const [actual] = await conn.query<RowDataPacket[]>(`SELECT ${COLUMNAS} FROM cxp_proveedor_fiscal WHERE empresa_id = ? AND entidad_id = ? AND proveedor_id = ? FOR UPDATE`, [empresaId, entidadId, proveedorId]);
    const antes = actual[0] ? mapear(actual[0]) : null;
    const activo = entrada.activo === undefined ? (antes?.activo ?? true) : entrada.activo;
    if (antes) {
      await conn.execute(
        `UPDATE cxp_proveedor_fiscal SET regimen_fiscal = ?, sujeto_isr = ?, cuenta_proveedor_id = ?, cuenta_anticipo_id = ?, cuenta_gasto_id = ?, activo = ?, actualizado_por = ?
          WHERE empresa_id = ? AND entidad_id = ? AND proveedor_id = ?`,
        [regimenFiscal, entrada.sujetoIsr ? 1 : 0, cuentas.cuentaProveedorId, cuentas.cuentaAnticipoId, cuentas.cuentaGastoId, activo ? 1 : 0, actor.id, empresaId, entidadId, proveedorId]);
    } else {
      await conn.execute(
        `INSERT INTO cxp_proveedor_fiscal (empresa_id, entidad_id, proveedor_id, regimen_fiscal, sujeto_isr, cuenta_proveedor_id, cuenta_anticipo_id, cuenta_gasto_id, activo, creado_por, actualizado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, entidadId, proveedorId, regimenFiscal, entrada.sujetoIsr ? 1 : 0, cuentas.cuentaProveedorId, cuentas.cuentaAnticipoId, cuentas.cuentaGastoId, activo ? 1 : 0, actor.id, actor.id]);
    }
    const despues: ConfigFiscal = { proveedorId, entidadId, regimenFiscal, sujetoIsr: entrada.sujetoIsr, ...cuentas, activo };
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: actor.username, modulo: "contabilidad", accion: antes ? "cxp_actualizar_config_proveedor" : "cxp_crear_config_proveedor",
      detalle: JSON.stringify({ entidadId, proveedorId, usuarioId: actor.id, antes, despues }),
    });
    await conn.commit();
    return despues;
  } catch (e) {
    try { await conn.rollback(); } catch { /* conserva el error original */ }
    if (esConflictoTransitorio(e)) throw new ErrorCxp("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    throw e;
  } finally { conn.release(); }
}
