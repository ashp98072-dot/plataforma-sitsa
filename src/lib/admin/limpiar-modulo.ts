import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import type { ModuloLimpieza } from "@/lib/admin/limpiar-modulo-shared";

export type { ModuloLimpieza };
export {
  MODULOS_LIMPIEZA,
  MODULO_LIMPIEZA_LABEL,
  MODULO_LIMPIEZA_NOTA,
} from "@/lib/admin/limpiar-modulo-shared";

async function tablaExiste(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  nombre: string,
): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?
     LIMIT 1`,
    [nombre],
  );
  return rows.length > 0;
}

async function del(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  sql: string,
  params: (string | number)[],
): Promise<number> {
  const [r] = await conn.execute<ResultSetHeader>(sql, params);
  return Number(r.affectedRows ?? 0);
}

async function delSiExiste(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  tabla: string,
  sql: string,
  params: (string | number)[],
): Promise<number> {
  if (!(await tablaExiste(conn, tabla))) return 0;
  return del(conn, sql, params);
}

export async function contarModuloEmpresa(
  empresaId: number,
  modulo: ModuloLimpieza,
): Promise<Record<string, number>> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const count = async (tabla: string, where = "empresa_id = ?") => {
      if (!(await tablaExiste(conn, tabla))) return 0;
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`,
        [empresaId],
      );
      return Number(rows[0]?.n ?? 0);
    };

    switch (modulo) {
      case "rrhh":
        return {
          empleados: await count("empleados"),
          marcajes: await count("sesiones_trabajo"),
          incidencias: await count("incidencias"),
          vacaciones: await count("vacaciones"),
        };
      case "rrhh_planillas":
        return {
          periodos: await count("rrhh_planilla_periodos"),
          lineas: await count("rrhh_planilla_lineas"),
        };
      case "rrhh_vacaciones":
        return {
          solicitudes: await count("solicitudes_vacaciones"),
          vacaciones: await count("vacaciones"),
          saldos: await count("saldos_vacaciones"),
          incidencias_vacaciones: await count(
            "incidencias",
            "empresa_id = ? AND tipo IN ('Vacaciones', 'A cuenta de Vacaciones')",
          ),
        };
      case "rrhh_marcajes":
        return {
          jornadas: await count("sesiones_trabajo"),
          marcajes_en_ruta: await count("marcajes_en_ruta"),
        };
      case "rrhh_incidencias":
        return {
          incidencias: await count("incidencias"),
          evidencias: await count("evidencias_incidencias"),
        };
      case "rrhh_descuentos":
        return {
          descuentos: await count("rrhh_descuentos_maestro"),
          cuotas: await count("rrhh_descuento_cuotas"),
          abonos: await count("rrhh_descuento_abonos"),
          descuentos_heredados: await count("rrhh_descuentos"),
        };
      case "rrhh_horas_extra":
        return {
          horas_extra: await count("horas_extra_registros"),
          prestaciones: await count("rrhh_prestaciones"),
        };
      case "rrhh_inventario":
        return {
          articulos: await count("inventario_rrhh"),
          movimientos: await count("inventario_rrhh_movimientos"),
          entregas: await count("inventario_rrhh_entregas"),
        };
      case "flota":
        return {
          vehiculos: await count("flota_vehiculos"),
          viajes: await count("flota_viajes"),
          lecturas: await count("flota_lecturas"),
          servicios: await count("flota_servicios"),
          inv_equipo: await count("flota_inv_equipo"),
        };
      case "operaciones":
        return {
          planes: await count("tms_planes_viaje"),
          clientes: await count("tms_clientes"),
          lugares: await count("tms_lugares"),
          unidades: await count("tms_unidades"),
        };
      case "contabilidad":
        return {
          cuentas: await count("cont_cuentas"),
          asientos: await count("cont_asientos"),
          cxc: await count("cont_cxc"),
          cxp: await count("cont_cxp"),
        };
      case "cms":
        return { secciones: await count("cms_secciones") };
      case "reciclaje":
        return { lotes: await count("mod_reciclaje_lotes") };
      case "tarimas":
        return { ordenes: await count("mod_tarimas_ordenes") };
      default:
        return {};
    }
  } finally {
    conn.release();
  }
}

async function limpiarRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  // Respeta el mismo orden seguro de las limpiezas parciales antes de
  // eliminar empleados. Esto también cubre las tablas RRHH agregadas en
  // fases posteriores a la implementación original de esta pantalla.
  const parciales: Array<[string, Record<string, number>]> = [
    ["planillas", await limpiarPlanillasRrhh(conn, empresaId)],
    ["vacaciones", await limpiarVacacionesRrhh(conn, empresaId)],
    ["incidencias", await limpiarIncidenciasRrhh(conn, empresaId)],
    ["marcajes", await limpiarMarcajesRrhh(conn, empresaId)],
    ["horas_extra", await limpiarHorasExtraRrhh(conn, empresaId)],
    ["inventario", await limpiarInventarioRrhh(conn, empresaId)],
    ["descuentos", await limpiarDescuentosRrhh(conn, empresaId)],
  ];
  for (const [grupo, conteos] of parciales) {
    for (const [tabla, total] of Object.entries(conteos)) {
      out[`${grupo}_${tabla}`] = total;
    }
  }

  out.flota_viajes_empleado_null = await delSiExiste(
    conn,
    "flota_viajes",
    `UPDATE flota_viajes SET empleado_id = NULL
     WHERE empresa_id = ? AND empleado_id IS NOT NULL`,
    [empresaId],
  );

  out.evidencias_incidencias = await delSiExiste(
    conn,
    "evidencias_incidencias",
    `DELETE ei FROM evidencias_incidencias ei
     INNER JOIN incidencias i ON i.id = ei.incidencia_id
     WHERE i.empresa_id = ?`,
    [empresaId],
  );
  out.evidencias_incidencias += await delSiExiste(
    conn,
    "evidencias_incidencias",
    "DELETE FROM evidencias_incidencias WHERE empresa_id = ?",
    [empresaId],
  );

  out.documentos_empleados = await delSiExiste(
    conn,
    "documentos_empleados",
    "DELETE FROM documentos_empleados WHERE empresa_id = ?",
    [empresaId],
  );

  out.detalle_consumo = await delSiExiste(
    conn,
    "detalle_consumo_vacaciones",
    `DELETE d FROM detalle_consumo_vacaciones d
     INNER JOIN incidencias i ON i.id = d.incidencia_id
     WHERE i.empresa_id = ?`,
    [empresaId],
  );
  out.detalle_consumo += await delSiExiste(
    conn,
    "detalle_consumo_vacaciones",
    `DELETE d FROM detalle_consumo_vacaciones d
     INNER JOIN saldos_vacaciones s ON s.id = d.saldo_id
     WHERE s.empresa_id = ?`,
    [empresaId],
  );

  out.vacaciones = await delSiExiste(
    conn,
    "vacaciones",
    "DELETE FROM vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  out.saldos_vacaciones = await delSiExiste(
    conn,
    "saldos_vacaciones",
    "DELETE FROM saldos_vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  out.marcajes_en_ruta = await delSiExiste(
    conn,
    "marcajes_en_ruta",
    "DELETE FROM marcajes_en_ruta WHERE empresa_id = ?",
    [empresaId],
  );
  out.incidencias = await delSiExiste(
    conn,
    "incidencias",
    "DELETE FROM incidencias WHERE empresa_id = ?",
    [empresaId],
  );
  out.sesiones_trabajo = await delSiExiste(
    conn,
    "sesiones_trabajo",
    "DELETE FROM sesiones_trabajo WHERE empresa_id = ?",
    [empresaId],
  );
  out.rrhh_descuentos = await delSiExiste(
    conn,
    "rrhh_descuentos",
    "DELETE FROM rrhh_descuentos WHERE empresa_id = ?",
    [empresaId],
  );
  out.rrhh_prestaciones = await delSiExiste(
    conn,
    "rrhh_prestaciones",
    "DELETE FROM rrhh_prestaciones WHERE empresa_id = ?",
    [empresaId],
  );
  out.rrhh_planilla_lineas = await delSiExiste(
    conn,
    "rrhh_planilla_lineas",
    "DELETE FROM rrhh_planilla_lineas WHERE empresa_id = ?",
    [empresaId],
  );
  out.rrhh_planilla_periodos = await delSiExiste(
    conn,
    "rrhh_planilla_periodos",
    "DELETE FROM rrhh_planilla_periodos WHERE empresa_id = ?",
    [empresaId],
  );
  out.inventario_rrhh = await delSiExiste(
    conn,
    "inventario_rrhh",
    "DELETE FROM inventario_rrhh WHERE empresa_id = ?",
    [empresaId],
  );
  out.empleados = await delSiExiste(
    conn,
    "empleados",
    "DELETE FROM empleados WHERE empresa_id = ?",
    [empresaId],
  );
  // configuracion + feriados se conservan (geocerca, horarios)
  return out;
}

async function limpiarPlanillasRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // Una planilla de prueba no debe consumir definitivamente sus insumos.
  out.cuotas_reabiertas = await delSiExiste(
    conn,
    "rrhh_descuento_cuotas",
    `UPDATE rrhh_descuento_cuotas
     SET estado = 'PENDIENTE', planilla_periodo_id = NULL, monto_aplicado = NULL,
         aplicado_en = NULL, aplicado_por = NULL
     WHERE empresa_id = ? AND planilla_periodo_id IS NOT NULL AND estado = 'APLICADA'`,
    [empresaId],
  );
  out.horas_extra_reabiertas = await delSiExiste(
    conn,
    "horas_extra_registros",
    `UPDATE horas_extra_registros
     SET estado = 'APROBADA', planilla_periodo_id = NULL, aplicado_en = NULL
     WHERE empresa_id = ? AND planilla_periodo_id IS NOT NULL
       AND estado = 'APLICADA_EN_PLANILLA'`,
    [empresaId],
  );
  out.lineas = await delSiExiste(
    conn,
    "rrhh_planilla_lineas",
    "DELETE FROM rrhh_planilla_lineas WHERE empresa_id = ?",
    [empresaId],
  );
  out.periodos = await delSiExiste(
    conn,
    "rrhh_planilla_periodos",
    "DELETE FROM rrhh_planilla_periodos WHERE empresa_id = ?",
    [empresaId],
  );
  return out;
}

async function limpiarVacacionesRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.evidencias = await delSiExiste(
    conn,
    "evidencias_incidencias",
    `DELETE e FROM evidencias_incidencias e
     INNER JOIN incidencias i ON i.id = e.incidencia_id
     WHERE i.empresa_id = ? AND i.tipo IN ('Vacaciones', 'A cuenta de Vacaciones')`,
    [empresaId],
  );
  out.consumos = await delSiExiste(
    conn,
    "detalle_consumo_vacaciones",
    `DELETE d FROM detalle_consumo_vacaciones d
     INNER JOIN saldos_vacaciones s ON s.id = d.saldo_id
     WHERE s.empresa_id = ?`,
    [empresaId],
  );
  out.solicitudes = await delSiExiste(
    conn,
    "solicitudes_vacaciones",
    "DELETE FROM solicitudes_vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  out.vacaciones = await delSiExiste(
    conn,
    "vacaciones",
    "DELETE FROM vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  out.incidencias = await delSiExiste(
    conn,
    "incidencias",
    `DELETE FROM incidencias
     WHERE empresa_id = ? AND tipo IN ('Vacaciones', 'A cuenta de Vacaciones')`,
    [empresaId],
  );
  out.saldos = await delSiExiste(
    conn,
    "saldos_vacaciones",
    "DELETE FROM saldos_vacaciones WHERE empresa_id = ?",
    [empresaId],
  );
  return out;
}

async function limpiarMarcajesRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  return {
    marcajes_en_ruta: await delSiExiste(
      conn,
      "marcajes_en_ruta",
      "DELETE FROM marcajes_en_ruta WHERE empresa_id = ?",
      [empresaId],
    ),
    jornadas: await delSiExiste(
      conn,
      "sesiones_trabajo",
      "DELETE FROM sesiones_trabajo WHERE empresa_id = ?",
      [empresaId],
    ),
  };
}

async function limpiarIncidenciasRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.evidencias = await delSiExiste(
    conn,
    "evidencias_incidencias",
    `DELETE e FROM evidencias_incidencias e
     INNER JOIN incidencias i ON i.id = e.incidencia_id WHERE i.empresa_id = ?`,
    [empresaId],
  );
  out.consumos = await delSiExiste(
    conn,
    "detalle_consumo_vacaciones",
    `DELETE d FROM detalle_consumo_vacaciones d
     INNER JOIN incidencias i ON i.id = d.incidencia_id WHERE i.empresa_id = ?`,
    [empresaId],
  );
  out.incidencias = await delSiExiste(
    conn,
    "incidencias",
    "DELETE FROM incidencias WHERE empresa_id = ?",
    [empresaId],
  );
  return out;
}

async function limpiarDescuentosRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.cuotas = await delSiExiste(conn, "rrhh_descuento_cuotas", "DELETE FROM rrhh_descuento_cuotas WHERE empresa_id = ?", [empresaId]);
  out.abonos = await delSiExiste(conn, "rrhh_descuento_abonos", "DELETE FROM rrhh_descuento_abonos WHERE empresa_id = ?", [empresaId]);
  out.descuentos = await delSiExiste(conn, "rrhh_descuentos_maestro", "DELETE FROM rrhh_descuentos_maestro WHERE empresa_id = ?", [empresaId]);
  out.heredados = await delSiExiste(conn, "rrhh_descuentos", "DELETE FROM rrhh_descuentos WHERE empresa_id = ?", [empresaId]);
  return out;
}

async function limpiarHorasExtraRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  return {
    horas_extra: await delSiExiste(conn, "horas_extra_registros", "DELETE FROM horas_extra_registros WHERE empresa_id = ?", [empresaId]),
    prestaciones: await delSiExiste(conn, "rrhh_prestaciones", "DELETE FROM rrhh_prestaciones WHERE empresa_id = ?", [empresaId]),
  };
}

async function limpiarInventarioRrhh(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.entregas = await delSiExiste(conn, "inventario_rrhh_entregas", "DELETE FROM inventario_rrhh_entregas WHERE empresa_id = ?", [empresaId]);
  out.movimientos = await delSiExiste(conn, "inventario_rrhh_movimientos", "DELETE FROM inventario_rrhh_movimientos WHERE empresa_id = ?", [empresaId]);
  out.articulos = await delSiExiste(conn, "inventario_rrhh", "DELETE FROM inventario_rrhh WHERE empresa_id = ?", [empresaId]);
  return out;
}

async function limpiarFlota(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  out.viaje_evidencias = await delSiExiste(
    conn,
    "flota_viaje_evidencias",
    "DELETE FROM flota_viaje_evidencias WHERE empresa_id = ?",
    [empresaId],
  );
  out.lectura_evidencias = await delSiExiste(
    conn,
    "flota_lectura_evidencias",
    "DELETE FROM flota_lectura_evidencias WHERE empresa_id = ?",
    [empresaId],
  );
  out.inv_equipo = await delSiExiste(
    conn,
    "flota_inv_equipo",
    "DELETE FROM flota_inv_equipo WHERE empresa_id = ?",
    [empresaId],
  );
  out.inv_areas = await delSiExiste(
    conn,
    "flota_inv_areas",
    "DELETE FROM flota_inv_areas WHERE empresa_id = ?",
    [empresaId],
  );
  out.inv_categorias = await delSiExiste(
    conn,
    "flota_inv_categorias",
    "DELETE FROM flota_inv_categorias WHERE empresa_id = ?",
    [empresaId],
  );
  out.servicio_adjuntos = await delSiExiste(
    conn,
    "flota_servicio_adjuntos",
    "DELETE FROM flota_servicio_adjuntos WHERE empresa_id = ?",
    [empresaId],
  );
  out.lecturas = await delSiExiste(
    conn,
    "flota_lecturas",
    "DELETE FROM flota_lecturas WHERE empresa_id = ?",
    [empresaId],
  );
  out.servicios = await delSiExiste(
    conn,
    "flota_servicios",
    "DELETE FROM flota_servicios WHERE empresa_id = ?",
    [empresaId],
  );
  out.viajes = await delSiExiste(
    conn,
    "flota_viajes",
    "DELETE FROM flota_viajes WHERE empresa_id = ?",
    [empresaId],
  );
  out.permisos_externos = await delSiExiste(
    conn,
    "flota_permisos_externos",
    "DELETE FROM flota_permisos_externos WHERE empresa_id = ?",
    [empresaId],
  );
  // Quitar acceso compartido de esta empresa (no borra vehículos ajenos)
  out.vehiculo_acceso = await delSiExiste(
    conn,
    "flota_vehiculo_acceso",
    "DELETE FROM flota_vehiculo_acceso WHERE empresa_id = ?",
    [empresaId],
  );
  // Acceso de otros a vehículos de esta empresa
  out.vehiculo_acceso += await delSiExiste(
    conn,
    "flota_vehiculo_acceso",
    `DELETE a FROM flota_vehiculo_acceso a
     INNER JOIN flota_vehiculos v ON v.id = a.vehiculo_id
     WHERE v.empresa_id = ?`,
    [empresaId],
  );
  out.vehiculos = await delSiExiste(
    conn,
    "flota_vehiculos",
    "DELETE FROM flota_vehiculos WHERE empresa_id = ?",
    [empresaId],
  );
  return out;
}

async function limpiarOperaciones(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  // Desvincular viajes de flota (no se borran)
  out.flota_viajes_plan_null = await delSiExiste(
    conn,
    "flota_viajes",
    `UPDATE flota_viajes SET plan_id = NULL
     WHERE empresa_id = ? AND plan_id IS NOT NULL`,
    [empresaId],
  );

  out.evidencias = await delSiExiste(
    conn,
    "tms_evidencias",
    "DELETE FROM tms_evidencias WHERE empresa_id = ?",
    [empresaId],
  );
  out.plan_auxiliares = await delSiExiste(
    conn,
    "tms_plan_auxiliares",
    `DELETE a FROM tms_plan_auxiliares a
     INNER JOIN tms_planes_viaje p ON p.id = a.plan_id
     WHERE p.empresa_id = ?`,
    [empresaId],
  );
  out.plan_paradas = await delSiExiste(
    conn,
    "tms_plan_paradas",
    `DELETE pp FROM tms_plan_paradas pp
     INNER JOIN tms_planes_viaje p ON p.id = pp.plan_id
     WHERE p.empresa_id = ?`,
    [empresaId],
  );
  out.planes = await delSiExiste(
    conn,
    "tms_planes_viaje",
    "DELETE FROM tms_planes_viaje WHERE empresa_id = ?",
    [empresaId],
  );
  out.personal = await delSiExiste(
    conn,
    "tms_personal",
    "DELETE FROM tms_personal WHERE empresa_id = ?",
    [empresaId],
  );
  out.unidades = await delSiExiste(
    conn,
    "tms_unidades",
    "DELETE FROM tms_unidades WHERE empresa_id = ?",
    [empresaId],
  );
  out.lugares = await delSiExiste(
    conn,
    "tms_lugares",
    "DELETE FROM tms_lugares WHERE empresa_id = ?",
    [empresaId],
  );
  out.clientes = await delSiExiste(
    conn,
    "tms_clientes",
    "DELETE FROM tms_clientes WHERE empresa_id = ?",
    [empresaId],
  );
  return out;
}

async function limpiarContabilidad(
  conn: Awaited<ReturnType<ReturnType<typeof getPool>["getConnection"]>>,
  empresaId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.detalle = await delSiExiste(
    conn,
    "cont_asiento_detalle",
    `DELETE d FROM cont_asiento_detalle d
     INNER JOIN cont_asientos a ON a.id = d.asiento_id
     WHERE a.empresa_id = ?`,
    [empresaId],
  );
  out.asientos = await delSiExiste(
    conn,
    "cont_asientos",
    "DELETE FROM cont_asientos WHERE empresa_id = ?",
    [empresaId],
  );
  out.cxc = await delSiExiste(
    conn,
    "cont_cxc",
    "DELETE FROM cont_cxc WHERE empresa_id = ?",
    [empresaId],
  );
  out.cxp = await delSiExiste(
    conn,
    "cont_cxp",
    "DELETE FROM cont_cxp WHERE empresa_id = ?",
    [empresaId],
  );
  out.cuentas = await delSiExiste(
    conn,
    "cont_cuentas",
    "DELETE FROM cont_cuentas WHERE empresa_id = ?",
    [empresaId],
  );
  return out;
}

export async function limpiarModuloEmpresa(opts: {
  empresaId: number;
  empresaCodigo: string;
  modulo: ModuloLimpieza;
  usuario: string;
}): Promise<{ afectados: Record<string, number>; restantes: Record<string, number> }> {
  const pool = getPool();
  const conn = await pool.getConnection();
  let afectados: Record<string, number> = {};
  try {
    await conn.beginTransaction();
    switch (opts.modulo) {
      case "rrhh":
        afectados = await limpiarRrhh(conn, opts.empresaId);
        break;
      case "rrhh_planillas":
        afectados = await limpiarPlanillasRrhh(conn, opts.empresaId);
        break;
      case "rrhh_vacaciones":
        afectados = await limpiarVacacionesRrhh(conn, opts.empresaId);
        break;
      case "rrhh_marcajes":
        afectados = await limpiarMarcajesRrhh(conn, opts.empresaId);
        break;
      case "rrhh_incidencias":
        afectados = await limpiarIncidenciasRrhh(conn, opts.empresaId);
        break;
      case "rrhh_descuentos":
        afectados = await limpiarDescuentosRrhh(conn, opts.empresaId);
        break;
      case "rrhh_horas_extra":
        afectados = await limpiarHorasExtraRrhh(conn, opts.empresaId);
        break;
      case "rrhh_inventario":
        afectados = await limpiarInventarioRrhh(conn, opts.empresaId);
        break;
      case "flota":
        afectados = await limpiarFlota(conn, opts.empresaId);
        break;
      case "operaciones":
        afectados = await limpiarOperaciones(conn, opts.empresaId);
        break;
      case "contabilidad":
        afectados = await limpiarContabilidad(conn, opts.empresaId);
        break;
      case "cms":
        afectados = {
          secciones: await delSiExiste(
            conn,
            "cms_secciones",
            "DELETE FROM cms_secciones WHERE empresa_id = ?",
            [opts.empresaId],
          ),
        };
        break;
      case "reciclaje":
        afectados = {
          lotes: await delSiExiste(
            conn,
            "mod_reciclaje_lotes",
            "DELETE FROM mod_reciclaje_lotes WHERE empresa_id = ?",
            [opts.empresaId],
          ),
        };
        break;
      case "tarimas":
        afectados = {
          ordenes: await delSiExiste(
            conn,
            "mod_tarimas_ordenes",
            "DELETE FROM mod_tarimas_ordenes WHERE empresa_id = ?",
            [opts.empresaId],
          ),
        };
        break;
      default:
        throw new Error("Módulo no soportado.");
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  try {
    await registrarAuditoria({
      empresaId: opts.empresaId,
      usuario: opts.usuario,
      accion: "limpiar_modulo",
      modulo: opts.modulo,
      detalle: `Limpieza módulo ${opts.modulo} empresa ${opts.empresaCodigo}`,
    });
  } catch {
    /* bitácora opcional */
  }

  const restantes = await contarModuloEmpresa(opts.empresaId, opts.modulo);
  return { afectados, restantes };
}
