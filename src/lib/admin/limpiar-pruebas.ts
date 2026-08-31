import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { borrarGrupos, leer, LimpiezaBloqueada } from "./limpiar-operaciones";

export function protegerCuotasPlanilla(filas: Record<string, unknown>[]) {
  if (filas.some((f) => f.planilla_periodo_id != null)) {
    throw new LimpiezaBloqueada("Hay descuentos vinculados a una planilla. Limpia primero Planillas/nómina para liberar sus cuotas; no se modificó ningún dato.");
  }
}

/** No borra movimientos ajenos al catálogo: referencias externas bloquean todo. */
export async function limpiarClientesPrueba(conn: PoolConnection, empresaId: number) {
  const tms = await leer(conn, "tms_clientes", "empresa_id = ?", empresaId);
  // tms_cliente_id no tiene FK: validar también vínculos cruzados explícitamente.
  const clientes = await leer(conn, "clientes",
    "empresa_id = ? OR tms_cliente_id IN (SELECT id FROM tms_clientes WHERE empresa_id = ?)", empresaId, [empresaId]);
  const tmsIds = new Set(tms.filas.map((f) => Number(f.id)));
  if (clientes.filas.some((f) => f.tms_cliente_id != null && !tmsIds.has(Number(f.tms_cliente_id)))) {
    throw new LimpiezaBloqueada("Hay un cliente vinculado a TMS fuera de esta empresa o inexistente. Revisa el vínculo antes de limpiar.");
  }
  const perfiles = await leer(conn, "fact_cliente_perfil",
    "empresa_id = ? OR cliente_id IN (SELECT id FROM clientes WHERE empresa_id = ?)", empresaId, [empresaId]);
  const clienteIds = new Set(clientes.filas.map((f) => Number(f.id)));
  if (perfiles.filas.some((f) => !clienteIds.has(Number(f.cliente_id)))) {
    throw new LimpiezaBloqueada("Hay cuestionarios sin cliente de esta empresa. No se limpió ningún dato.");
  }
  return borrarGrupos(conn, [perfiles, clientes, tms]);
}

/** Solo desde módulos PRUEBAS, protegidos por Admin y confirmación del módulo. */
export async function limpiarMultasPrueba(conn: PoolConnection, empresaId: number) {
  const revisiones = await leer(conn, "ops_multas_revisiones", "empresa_id = ?", empresaId);
  const multas = await leer(conn, "ops_multas", "empresa_id = ?", empresaId);
  const documentos = await leer(conn, "ops_multa_documentos", "multa_id IN (SELECT id FROM ops_multas WHERE empresa_id = ?)", empresaId);
  const descuentoWhere = "id IN (SELECT rrhh_descuento_id FROM ops_multas WHERE empresa_id = ?)";
  const descuentos = await leer(conn, "rrhh_descuentos_maestro", descuentoWhere, empresaId);
  const cuotasWhere = "descuento_id IN (SELECT rrhh_descuento_id FROM ops_multas WHERE empresa_id = ?)";
  const cuotas = await leer(conn, "rrhh_descuento_cuotas", cuotasWhere, empresaId);
  const abonos = await leer(conn, "rrhh_descuento_abonos", cuotasWhere, empresaId);
  protegerCuotasPlanilla(cuotas.filas);
  // Multas antes del maestro por FK RESTRICT. Se conservan auditoría y archivos físicos.
  return borrarGrupos(conn, [documentos, cuotas, abonos, multas, descuentos, revisiones]);
}

/** Borrado temporal individual: no toca planillas ni elimina la multa de origen. */
export async function eliminarDescuentoPrueba(empresaId: number, id: number, usuario: string) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    // Orden multa → descuento, igual que el flujo de vinculación de Multas/RRHH.
    const multas = await leer(conn, "ops_multas", "empresa_id = ? AND rrhh_descuento_id = ?", empresaId, [id]);
    if (multas.filas.length) throw new LimpiezaBloqueada("Este descuento procede de una multa. Usa Pruebas · Multas + descuentos vinculados para limpiar ambos juntos.");
    const maestro = await leer(conn, "rrhh_descuentos_maestro", "empresa_id = ? AND id = ?", empresaId, [id]);
    if (!maestro.filas.length) throw new LimpiezaBloqueada("Descuento no encontrado en esta empresa.");
    const cuotas = await leer(conn, "rrhh_descuento_cuotas", "descuento_id IN (SELECT id FROM rrhh_descuentos_maestro WHERE empresa_id = ? AND id = ?)", empresaId, [id]);
    const abonos = await leer(conn, "rrhh_descuento_abonos", "descuento_id IN (SELECT id FROM rrhh_descuentos_maestro WHERE empresa_id = ? AND id = ?)", empresaId, [id]);
    protegerCuotasPlanilla(cuotas.filas);
    const entregas = await leer(conn, "inventario_rrhh_entregas", "descuento_id IN (SELECT id FROM rrhh_descuentos_maestro WHERE empresa_id = ? AND id = ?)", empresaId, [id]);
    if (entregas.filas.length) {
      // Preserva entrega y movimientos de inventario; únicamente libera su vínculo.
      await conn.execute("UPDATE inventario_rrhh_entregas SET descuento_id = NULL WHERE empresa_id = ? AND descuento_id = ?", [empresaId, id]);
    }
    const afectados = await borrarGrupos(conn, [cuotas, abonos, maestro]);
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "descuentos", accion: "eliminar_descuento_prueba", detalle: `Descuento #${id} ${maestro.filas[0].codigo}; monto ${maestro.filas[0].monto_original}; entrega(s) desvinculada(s): ${entregas.filas.length}; ${JSON.stringify(afectados)}` });
    await conn.commit();
    return afectados;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
