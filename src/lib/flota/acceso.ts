import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query } from "@/lib/db";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { listarEmpresasActivas } from "@/lib/empresas";

/**
 * REGLA ÚNICA de «vehículo accesible desde una empresa»: es propio de la empresa o está explícitamente compartido con ella
 * (`flota_vehiculo_acceso`). La usan Flota (lista, edición, viajes, reportes, disponibilidad), Fondos/Gastos, Requerimientos de compra,
 * Requerimientos de viáticos, Rutas y el catálogo de planes: nadie reimplementa esta condición. `empresaExpr` es `?` (parámetro, se repite
 * 2 veces) o una columna (p. ej. `g.empresa_id`, sin parámetros).
 *
 * ALTAS / EDICIONES (validar un id que manda el cliente, listar un catálogo seleccionable): usar SIEMPRE esta regla — el vehículo debe ser
 * propio o estar compartido AHORA con la empresa activa.
 * LECTURA HISTÓRICA (mostrar la placa de un registro que ya guardó su `vehiculo_id`, reportes, PDFs): el vínculo ya fue validado al
 * escribir y el registro está acotado por su propia `empresa_id`, así que se une por `v.id = x.vehiculo_id` SIN exigir la compartición
 * actual; si luego se retira el acceso, el histórico no debe quedar con la placa vacía.
 */
export function predicadoVehiculoAccesible(alias: string, empresaExpr: string): string {
  return `(${alias}.empresa_id = ${empresaExpr} OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso fva WHERE fva.vehiculo_id = ${alias}.id AND fva.empresa_id = ${empresaExpr}))`;
}

/**
 * Una unidad propia o compartida con esta empresa.
 * Evita el falso "Vehículo no encontrado" en KT/Mónaco con flota compartida.
 */
export async function obtenerVehiculoAccesible(
  empresaId: number,
  vehiculoId: number,
  cols =
    "v.id, v.empresa_id, v.placa, v.marca, v.modelo, v.km_actual, v.en_taller, v.fecha_entrada_taller, v.motivo_taller, v.activo, v.estado, v.km_intervalo_servicio, v.km_ultimo_servicio, v.fecha_ultimo_servicio, v.odometro_funcional, v.mantenimiento_intervalo_meses, v.notas, v.rin_llanta, v.medida_llanta, v.tipo_aceite, v.descripcion, v.color, v.tipo_combustible, v.filtro_servicio_mayor, v.filtro_servicio_menor, v.empresa_activo",
): Promise<RowDataPacket | null> {
  if (!vehiculoId || !empresaId) return null;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT ${cols},
              CASE WHEN v.empresa_id = ? THEN 0 ELSE 1 END AS compartido
       FROM flota_vehiculos v
       WHERE v.id = ?
         AND ${predicadoVehiculoAccesible("v", "?")}
       LIMIT 1`,
      [empresaId, vehiculoId, empresaId, empresaId],
    );
    return rows[0] ?? null;
  } catch {
    const rows = await query<RowDataPacket[]>(
      `SELECT * FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [vehiculoId, empresaId],
    );
    return rows[0] ?? null;
  }
}

/**
 * Misma regla que obtenerVehiculoAccesible, DENTRO de la transacción del llamador (Fondos/Gastos/Compras/Viáticos/Rutas validan y escriben
 * atómicamente). Devuelve `id, placa, activo` por defecto; `null` si el vehículo no es propio ni está compartido con la empresa (otra empresa
 * sin compartir, otro tenant o id inexistente). `bloquear` agrega `LOCK IN SHARE MODE` (Compras bloquea la unidad mientras escribe).
 */
export async function obtenerVehiculoAccesibleTx(
  conn: PoolConnection,
  empresaId: number,
  vehiculoId: number,
  cols = "v.id, v.placa, v.activo",
  bloquear = false,
): Promise<RowDataPacket | null> {
  if (!vehiculoId || !empresaId) return null;
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${cols}, CASE WHEN v.empresa_id = ? THEN 0 ELSE 1 END AS compartido
       FROM flota_vehiculos v
       WHERE v.id = ? AND ${predicadoVehiculoAccesible("v", "?")}
       LIMIT 1${bloquear ? " LOCK IN SHARE MODE" : ""}`,
      [empresaId, vehiculoId, empresaId, empresaId],
    );
    return rows[0] ?? null;
  } catch (error) {
    // Solo se tolera la tabla de accesos ausente (migración pendiente): entonces cuentan únicamente las unidades propias. Un bloqueo/timeout NO se enmascara.
    if ((error as { errno?: number } | null)?.errno !== 1146) throw error;
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${cols}, 0 AS compartido FROM flota_vehiculos v WHERE v.id = ? AND v.empresa_id = ? LIMIT 1${bloquear ? " LOCK IN SHARE MODE" : ""}`,
      [vehiculoId, empresaId],
    );
    return rows[0] ?? null;
  }
}

/** True si la empresa es dueña o tiene acceso compartido. */
export async function empresaPuedeUsarVehiculo(
  empresaId: number,
  vehiculoId: number,
): Promise<boolean> {
  const v = await obtenerVehiculoAccesible(empresaId, vehiculoId, "v.id");
  return Boolean(v);
}

/** Vehículos propios + compartidos con esta empresa. */
export async function listarVehiculosAccesibles(
  empresaId: number,
): Promise<RowDataPacket[]> {
  // Schema lo asegura la ruta API; no bloquear cada listado.
  // PROGRAMACION-TC-CAJA-REMOLQUE-1: `tipo_unidad` se intenta primero; si la
  // columna aún no existe (migración sin aplicar) el segundo intento es
  // EXACTAMENTE la consulta de siempre (sin perder las unidades compartidas).
  const consulta = (conTipo: boolean) =>
    query<RowDataPacket[]>(
      `SELECT v.id, v.empresa_id, v.placa, v.marca, v.modelo, v.descripcion,
              ${conTipo ? "v.tipo_unidad," : ""}
              v.color, v.tipo_combustible, v.chasis, v.capacidad, v.km_actual,
              v.km_intervalo_servicio, v.km_ultimo_servicio, v.fecha_ultimo_servicio,
              v.odometro_funcional, v.mantenimiento_intervalo_meses,
              v.credito, v.empresa_activo, v.nit, v.condicion_propiedad, v.seguros,
              v.notas, v.activo, v.estado, v.en_taller, v.fecha_entrada_taller,
              v.motivo_taller, v.rin_llanta, v.medida_llanta, v.tipo_aceite,
              v.filtro_servicio_mayor, v.filtro_servicio_menor,
              e.codigo AS empresa_duena_codigo, e.nombre AS empresa_duena_nombre,
              CASE WHEN v.empresa_id = ? THEN 0 ELSE 1 END AS compartido
       FROM flota_vehiculos v
       LEFT JOIN empresas e ON e.id = v.empresa_id
       WHERE ${predicadoVehiculoAccesible("v", "?")}
       ORDER BY v.activo DESC, v.placa`,
      [empresaId, empresaId, empresaId],
    );
  try {
    try {
      return await consulta(true);
    } catch {
      return await consulta(false);
    }
  } catch {
    return query<RowDataPacket[]>(
      `SELECT * FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
      [empresaId],
    );
  }
}

/**
 * Catálogo SELECCIONABLE para altas/ediciones (Fondos, Gastos, Compras, Viáticos, Rutas): los vehículos PROPIOS + COMPARTIDOS con la empresa activa
 * (la regla de Flota, listarVehiculosAccesibles), solo ACTIVOS y sin duplicados. Cada fila trae `compartido` y la empresa dueña
 * (`empresa_duena_nombre`) para rotular «Frescofresh · Compartido». Los inactivos solo se conservan en históricos (no se ofrecen para registros nuevos).
 */
export async function listarVehiculosActivosAccesibles(empresaId: number, limite = 1000): Promise<RowDataPacket[]> {
  const vistos = new Set<number>();
  return (await listarVehiculosAccesibles(empresaId))
    .filter((r) => Number(r.activo ?? 1) === 1 && !vistos.has(Number(r.id)) && vistos.add(Number(r.id)))
    .slice(0, limite);
}

/**
 * Lectura liviana para el poll de notificaciones: sin sync de KM ni SELECT *.
 */
export async function listarVehiculosParaAlertasKm(
  empresaId: number,
): Promise<RowDataPacket[]> {
  try {
    return await query<RowDataPacket[]>(
      `SELECT v.placa, v.activo, v.km_actual, v.km_ultimo_servicio, v.km_intervalo_servicio
       FROM flota_vehiculos v
       WHERE v.empresa_id = ?
          OR EXISTS (
            SELECT 1 FROM flota_vehiculo_acceso a
            WHERE a.vehiculo_id = v.id AND a.empresa_id = ?
          )`,
      [empresaId, empresaId],
    );
  } catch {
    return query<RowDataPacket[]>(
      `SELECT placa, activo, km_actual, km_ultimo_servicio, km_intervalo_servicio
       FROM flota_vehiculos WHERE empresa_id = ?`,
      [empresaId],
    );
  }
}

export async function empresasAccesoVehiculo(
  vehiculoId: number,
): Promise<number[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT empresa_id FROM flota_vehiculo_acceso WHERE vehiculo_id = ?",
      [vehiculoId],
    );
    return rows.map((r) => Number(r.empresa_id));
  } catch {
    return [];
  }
}

/** Accesos de varias unidades en una sola query. */
export async function empresasAccesoPorVehiculos(
  vehiculoIds: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  const ids = [...new Set(vehiculoIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT vehiculo_id, empresa_id FROM flota_vehiculo_acceso
       WHERE vehiculo_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of rows) {
      const vid = Number(r.vehiculo_id);
      const list = map.get(vid) ?? [];
      list.push(Number(r.empresa_id));
      map.set(vid, list);
    }
  } catch {
    /* tabla ausente */
  }
  return map;
}

export async function guardarAccesoVehiculo(
  vehiculoId: number,
  empresaIds: number[],
  empresaDuenia: number,
): Promise<void> {
  await asegurarSchemaFlota().catch(() => undefined);
  await execute("DELETE FROM flota_vehiculo_acceso WHERE vehiculo_id = ?", [
    vehiculoId,
  ]);
  const unicos = [...new Set(empresaIds.map(Number))].filter(
    (id) => id > 0 && id !== empresaDuenia,
  );
  for (const eid of unicos) {
    await execute(
      "INSERT IGNORE INTO flota_vehiculo_acceso (vehiculo_id, empresa_id) VALUES (?, ?)",
      [vehiculoId, eid],
    );
  }
}

export async function listarEmpresasActivasSimple(): Promise<
  { id: number; codigo: string; nombre: string; slug: string }[]
> {
  const rows = await listarEmpresasActivas();
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    slug: r.slug,
  }));
}
