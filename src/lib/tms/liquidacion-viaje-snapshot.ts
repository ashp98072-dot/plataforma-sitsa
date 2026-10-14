import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  CONCEPTOS_NO_DISPONIBLES_SNAPSHOT,
  type SnapshotOperativoViaje,
} from "./liquidacion-viaje-shared";

/**
 * LIQUIDACIÓN DE VIAJES, FASE 3 — fotografía operativa del viaje al liquidar (SOLO LECTURA).
 *
 * Reúne «cómo estaba operado el viaje» desde las tablas existentes (plan, cliente, lugares, unidad, personal, auxiliares,
 * piloto extra, cuadrilla registrada y el registro físico de Flota). NO escribe nada, NO modifica Programación ni las
 * asignaciones actuales, NO crea costos/cargos. Toda lectura va acotada por `empresa_id` (tenant-safe) y, dentro de la
 * transacción de liquidación, bajo el lock del plan, de modo que el snapshot es coherente con el evento que lo guarda.
 *
 * El resultado es EVIDENCIA HISTÓRICA: se serializa en `snapshot_json` del evento y no es una fuente mutable.
 */

interface FilaPlanSnapshot extends RowDataPacket {
  id: number;
  codigo: string;
  fecha_plan: string | null;
  estado: string;
  tipo_viaje: string | null;
  referencia_cliente: string | null;
  cliente_id: number | null;
  cliente: string | null;
  ruta_codigo_historico: string | null;
  lugar_descarga_historico: string | null;
  origen: string | null;
  destino_catalogo: string | null;
  tarifa_comercial: string | null;
  tarifa_id: number | null;
  tarifa_nombre_historico: string | null;
  tarifa_monto_historico: string | null;
  tarifa_moneda_historico: string | null;
  unidad_id: number | null;
  placa: string | null;
  tc_vehiculo_id: number | null;
  tc_placa_historica: string | null;
  tc_externo_placa: string | null;
  tc_placa_actual: string | null;
  piloto_id: number | null;
  piloto: string | null;
  auxiliar_id: number | null;
  auxiliar_legado: string | null;
  piloto_externo_nombre: string | null;
  auxiliares_externos: string | null;
  unidad_externa_placa: string | null;
  unidad_externa_descripcion: string | null;
  transportista_externo: string | null;
}

const texto = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v));
const FMT = "%Y-%m-%dT%H:%i";

/**
 * Snapshot operativo del viaje o `null` si el viaje no existe en la empresa. `conexion` puede ser el pool (vista previa) o la
 * conexión de la transacción (snapshot definitivo).
 */
export async function construirSnapshotOperativo(
  conexion: Pick<PoolConnection, "query">,
  empresaId: number,
  planId: number,
): Promise<SnapshotOperativoViaje | null> {
  const [filas] = await conexion.query<FilaPlanSnapshot[]>(
    `SELECT p.id, p.codigo, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan, p.estado, p.tipo_viaje, p.referencia_cliente,
            p.cliente_id, c.nombre AS cliente, p.ruta_codigo_historico, p.lugar_descarga_historico,
            lc.nombre AS origen, ld.nombre AS destino_catalogo,
            p.tarifa_comercial, p.tarifa_id, p.tarifa_nombre_historico, p.tarifa_monto_historico, p.tarifa_moneda_historico,
            p.unidad_id, u.placa, p.tc_vehiculo_id, p.tc_placa_historica, p.tc_externo_placa, tcv.placa AS tc_placa_actual,
            p.piloto_id, pil.nombre AS piloto, p.auxiliar_id, aux.nombre AS auxiliar_legado,
            p.piloto_externo_nombre, p.auxiliares_externos, p.unidad_externa_placa, p.unidad_externa_descripcion, p.transportista_externo
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
       LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id AND lc.empresa_id = p.empresa_id
       LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id AND ld.empresa_id = p.empresa_id
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id AND u.empresa_id = p.empresa_id
       LEFT JOIN flota_vehiculos tcv ON tcv.id = p.tc_vehiculo_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id AND pil.empresa_id = p.empresa_id
       LEFT JOIN tms_personal aux ON aux.id = p.auxiliar_id AND aux.empresa_id = p.empresa_id
      WHERE p.id = ? AND p.empresa_id = ?`,
    [planId, empresaId],
  );
  const p = filas[0];
  if (!p) return null;

  const [extras] = await conexion.query<(RowDataPacket & { personal_id: number; nombre: string })[]>(
    `SELECT x.personal_id, per.nombre
       FROM tms_plan_pilotos_adicionales x
       INNER JOIN tms_personal per ON per.id = x.personal_id AND per.empresa_id = x.empresa_id
      WHERE x.empresa_id = ? AND x.plan_id = ? ORDER BY x.orden, x.id`,
    [empresaId, planId],
  );
  const [auxRows] = await conexion.query<(RowDataPacket & { personal_id: number; nombre: string })[]>(
    `SELECT a.personal_id, per.nombre
       FROM tms_plan_auxiliares a
       INNER JOIN tms_personal per ON per.id = a.personal_id AND per.empresa_id = ?
      WHERE a.plan_id = ? ORDER BY a.orden, a.id`,
    [empresaId, planId],
  );
  const [cuadrillaRows] = await conexion.query<(RowDataPacket & { tipo: string; id_empleado: number | null; nombre: string })[]>(
    `SELECT tipo, id_empleado, nombre FROM tms_plan_cuadrilla WHERE empresa_id = ? AND plan_id = ? ORDER BY orden, id`,
    [empresaId, planId],
  );
  const [fisicos] = await conexion.query<(RowDataPacket & {
    estado: string | null; km_salida: number | null; km_llegada: number | null; hora_salida: string | null; hora_llegada: string | null;
  })[]>(
    `SELECT estado, km_salida, km_llegada,
            DATE_FORMAT(hora_salida, '${FMT}') AS hora_salida, DATE_FORMAT(hora_llegada, '${FMT}') AS hora_llegada
       FROM flota_viajes WHERE plan_id = ? AND empresa_id = ? ORDER BY id DESC LIMIT 1`,
    [planId, empresaId],
  );

  // Auxiliares: la tabla de varios auxiliares manda; si no tiene filas, el auxiliar singular legado (misma regla que Programación).
  const auxiliares = auxRows.length
    ? auxRows.map((a) => ({ personalId: Number(a.personal_id), nombre: String(a.nombre) }))
    : p.auxiliar_id != null && p.auxiliar_legado
      ? [{ personalId: Number(p.auxiliar_id), nombre: String(p.auxiliar_legado) }]
      : [];

  const tipoViaje = texto(p.tipo_viaje) ?? "Propio";
  const f = fisicos[0];
  const kmSalida = f?.km_salida != null ? Number(f.km_salida) : null;
  const kmLlegada = f?.km_llegada != null ? Number(f.km_llegada) : null;
  const tcPlaca = tipoViaje === "Tercerizado" ? texto(p.tc_externo_placa) : (texto(p.tc_placa_actual) ?? texto(p.tc_placa_historica));

  return {
    version: 1,
    plan: {
      id: Number(p.id),
      codigo: String(p.codigo),
      fechaPlan: p.fecha_plan,
      estado: String(p.estado),
      tipoViaje,
      referenciaCliente: texto(p.referencia_cliente),
    },
    cliente: { id: p.cliente_id != null ? Number(p.cliente_id) : null, nombre: texto(p.cliente) },
    ruta: {
      codigo: texto(p.ruta_codigo_historico),
      origen: texto(p.origen),
      destino: texto(p.lugar_descarga_historico) ?? texto(p.destino_catalogo),
    },
    tarifa: {
      comercial: p.tarifa_comercial != null ? String(p.tarifa_comercial) : null,
      tarifaId: p.tarifa_id != null ? Number(p.tarifa_id) : null,
      nombre: texto(p.tarifa_nombre_historico),
      montoCatalogo: p.tarifa_monto_historico != null ? String(p.tarifa_monto_historico) : null,
      moneda: texto(p.tarifa_moneda_historico),
    },
    unidad: { id: p.unidad_id != null ? Number(p.unidad_id) : null, placa: texto(p.placa) ?? texto(p.unidad_externa_placa) },
    tc: {
      placa: tcPlaca,
      origen: tcPlaca ? (tipoViaje === "Tercerizado" ? "EXTERNO" : "INTERNO") : null,
    },
    piloto: { personalId: p.piloto_id != null ? Number(p.piloto_id) : null, nombre: texto(p.piloto) ?? texto(p.piloto_externo_nombre) },
    pilotosExtra: extras.map((x) => ({ personalId: Number(x.personal_id), nombre: String(x.nombre) })),
    auxiliares,
    cuadrilla: cuadrillaRows.map((c) => ({
      tipo: c.tipo === "INTERNO" ? "INTERNO" : "EXTERNO",
      empleadoId: c.id_empleado != null ? Number(c.id_empleado) : null,
      nombre: String(c.nombre),
    })),
    tercerizado:
      tipoViaje === "Tercerizado"
        ? {
            pilotoExterno: texto(p.piloto_externo_nombre),
            auxiliaresExternos: texto(p.auxiliares_externos),
            unidadExternaPlaca: texto(p.unidad_externa_placa),
            unidadExternaDescripcion: texto(p.unidad_externa_descripcion),
            transportistaExterno: texto(p.transportista_externo),
          }
        : null,
    viajeFisico: f
      ? {
          estado: texto(f.estado),
          kmSalida,
          kmLlegada,
          kmRecorridos: kmSalida != null && kmLlegada != null && kmLlegada >= kmSalida ? kmLlegada - kmSalida : null,
          horaSalida: texto(f.hora_salida),
          horaLlegada: texto(f.hora_llegada),
        }
      : null,
    noDisponible: [...CONCEPTOS_NO_DISPONIBLES_SNAPSHOT],
  };
}
