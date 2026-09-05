import type { PoolConnection, RowDataPacket } from "mysql2/promise";
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
  const pendientes = [...new Set(clientes.filas
    .filter((f) => f.tms_cliente_id != null && !tmsIds.has(Number(f.tms_cliente_id)))
    .map((f) => Number(f.tms_cliente_id)))];
  for (let i = 0; i < pendientes.length; i += 250) {
    // Lectura actual en la misma transacción: ausencia no equivale a otra empresa.
    // Estos registros solo se validan; nunca se incorporan al grupo a borrar.
    const [vinculos] = await conn.query<RowDataPacket[]>(
      "SELECT id, empresa_id FROM tms_clientes WHERE id IN (?) ORDER BY id FOR UPDATE",
      [pendientes.slice(i, i + 250)]);
    if (vinculos.some((f) => Number(f.empresa_id) !== empresaId)) {
      throw new LimpiezaBloqueada("Hay un cliente vinculado a TMS de otra empresa. Revisa el vínculo antes de limpiar; no se borró ningún dato.");
    }
    if (vinculos.length) {
      throw new LimpiezaBloqueada("El catálogo TMS cambió durante la limpieza. Intenta nuevamente; no se borró ningún dato.");
    }
  }
  const perfiles = await leer(conn, "fact_cliente_perfil",
    "empresa_id = ? OR cliente_id IN (SELECT id FROM clientes WHERE empresa_id = ?)", empresaId, [empresaId]);
  const clienteIds = new Set(clientes.filas.map((f) => Number(f.id)));
  if (perfiles.filas.some((f) => !clienteIds.has(Number(f.cliente_id)))) {
    throw new LimpiezaBloqueada("Hay cuestionarios sin cliente de esta empresa. No se limpió ningún dato.");
  }
  const dependencias = [];
  for (const tabla of ["tms_cliente_contactos", "tms_cliente_ubicaciones"]) {
    const grupo = await leer(conn, tabla,
      "empresa_id = ? OR cliente_id IN (SELECT id FROM tms_clientes WHERE empresa_id = ?)", empresaId, [empresaId]);
    if (grupo.filas.some((f) => !tmsIds.has(Number(f.cliente_id)))) {
      throw new LimpiezaBloqueada(`Hay registros en ${tabla} sin cliente TMS de esta empresa. Revisa el vínculo; no se limpió ningún dato.`);
    }
    // Las rutas guardan estos vínculos sin FK; también proteger referencias cruzadas.
    // Las paradas de viajes conservan su propia dirección histórica (sin FK).
    const referencias = tabla === "tms_cliente_contactos"
      ? [["tms_cliente_rutas", "contacto_cliente_id"]]
      : [["tms_cliente_rutas", "ubicacion_carga_id"], ["tms_cliente_ruta_paradas", "cliente_ubicacion_id"]];
    for (const [origen, columna] of referencias) {
      for (let i = 0; i < grupo.filas.length; i += 250) {
        const [usados] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM ${origen} WHERE ${columna} IN (?) LIMIT 1 FOR UPDATE`,
          [grupo.filas.slice(i, i + 250).map((f) => f.id)]);
        if (usados.length) throw new LimpiezaBloqueada(`Hay registros vinculados en ${origen}. Limpia primero las rutas; no se limpió ningún dato.`);
      }
    }
    dependencias.push(grupo);
  }
  // LIMPIEZA-TMS-OPERACIONES-REINICIO-1 — usuarios del Portal del
  // Cliente: acceso propio del cliente (email/password_hash/salt),
  // NUNCA un usuario global de src/lib/tenant.ts (`usuarios`). Su FK
  // compuesta (empresa_id, cliente_id) -> tms_clientes ES real (a
  // diferencia de contactos/ubicaciones hacia rutas), así que
  // borrarGrupos()/validarReferencias() ya la protege automáticamente
  // sin necesidad de un chequeo manual adicional: si
  // tms_solicitudes_cliente.creado_por_usuario_cliente_id (RESTRICT)
  // todavía referencia a alguno de estos usuarios, la limpieza completa
  // se bloquea aquí en vez de fallar a medias.
  const usuariosPortal = await leer(conn, "tms_cliente_usuarios",
    "empresa_id = ? OR cliente_id IN (SELECT id FROM tms_clientes WHERE empresa_id = ?)", empresaId, [empresaId]);
  if (usuariosPortal.filas.some((f) => !tmsIds.has(Number(f.cliente_id)))) {
    throw new LimpiezaBloqueada("Hay usuarios del Portal del Cliente sin cliente TMS de esta empresa. Revisa el vínculo; no se limpió ningún dato.");
  }
  return borrarGrupos(conn, [perfiles, ...dependencias, usuariosPortal, clientes, tms]);
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
