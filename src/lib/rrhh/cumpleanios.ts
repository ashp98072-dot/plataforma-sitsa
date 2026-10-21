import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { contarDocumentosPorTipo } from "./documentos-por-tipo";
import {
  MAX_FILAS_CUMPLEANIOS,
  edadQueCumple,
  fechaCumpleanios,
  nombreMes,
  tipoDocumentoComprobanteCumpleanios,
  type CumpleaniosEmpleado,
  type FechaCumpleanios,
  type ListadoCumpleanios,
  type ResumenCumpleanios,
} from "./cumpleanios-shared";

export * from "./cumpleanios-shared";

/**
 * RRHH — Cumpleaños por mes. SOLO LECTURA sobre `empleados.fecha_nacimiento` (DATE NULL, ya existente en la ficha del
 * empleado; no se crea columna ni se modifica el dato). Acotado por empresa + mes de nacimiento (+ estado). Solo expone lo
 * mínimo para preparar pedidos (código, nombre, fecha, edad, puesto, área): nunca DPI, NIT, IGSS, dirección ni teléfono.
 */

const t = (v: unknown): string => (v == null ? "" : String(v).trim());

interface FilaCumple extends RowDataPacket {
  id: number;
  codigo: string | null;
  nombre: string | null;
  puesto: string | null;
  area: string | null;
  estado: string | null;
  fecha_nacimiento: string;
}

/**
 * Empleados que cumplen años en `mes` (por MES de `fecha_nacimiento`, no por año de nacimiento) de la empresa dada.
 * Por defecto solo `Activo`; con `incluirInactivos` también `Baja`. Orden: día del mes ASC y nombre. La empresa debe venir de
 * la sesión/tenant del servidor, nunca del cliente.
 */
export async function listarCumpleaniosDelMes(
  empresaId: number,
  mes: number,
  anio: number,
  opciones: { incluirInactivos?: boolean } = {},
): Promise<ListadoCumpleanios> {
  const incluirInactivos = opciones.incluirInactivos === true;
  const filas = await query<FilaCumple[]>(
    `SELECT id, codigo, nombre, puesto, categoria_ops AS area, estado,
            DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento
       FROM empleados
      WHERE empresa_id = ? AND fecha_nacimiento IS NOT NULL AND MONTH(fecha_nacimiento) = ?
        ${incluirInactivos ? "" : "AND estado = 'Activo'"}
      ORDER BY DAY(fecha_nacimiento) ASC, nombre ASC, id ASC
      LIMIT ${MAX_FILAS_CUMPLEANIOS + 1}`,
    [empresaId, mes],
  );
  const truncado = filas.length > MAX_FILAS_CUMPLEANIOS;
  const empleados: CumpleaniosEmpleado[] = [];
  for (const f of truncado ? filas.slice(0, MAX_FILAS_CUMPLEANIOS) : filas) {
    const fecha = fechaCumpleanios(f.fecha_nacimiento, anio);
    if (!fecha) continue;
    empleados.push({
      id: Number(f.id),
      codigo: t(f.codigo),
      nombre: t(f.nombre),
      puesto: t(f.puesto),
      area: t(f.area),
      estado: t(f.estado),
      fecha: fecha.iso,
      dia: fecha.dia,
      edad: edadQueCumple(f.fecha_nacimiento, anio),
      comprobantes: 0,
    });
  }
  // Comprobantes del AÑO consultado (UNA consulta agrupada); sin tabla de documentos aún ⇒ todos «Sin comprobante».
  try {
    const cuenta = await contarDocumentosPorTipo(empresaId, empleados.map((e) => e.id), tipoDocumentoComprobanteCumpleanios(anio));
    for (const e of empleados) e.comprobantes = cuenta.get(e.id) ?? 0;
  } catch (e) {
    if ((e as { errno?: number }).errno !== 1146) throw e;
  }
  return { mes, anio, nombreMes: nombreMes(mes), incluirInactivos, total: empleados.length, truncado, empleados };
}

/**
 * Resumen para el dashboard: UN conteo y como máximo `limite` filas (nunca la lista completa). Solo Activos. `hoyIso` es la
 * fecha de hoy en Guatemala (YYYY-MM-DD); si coincide con el mes consultado, los «próximos» arrancan hoy.
 */
export async function resumenCumpleaniosDelMes(
  empresaId: number,
  mes: number,
  anio: number,
  hoyIso: string,
  limite = 5,
): Promise<ResumenCumpleanios> {
  const filtro = "empresa_id = ? AND fecha_nacimiento IS NOT NULL AND MONTH(fecha_nacimiento) = ? AND estado = 'Activo'";
  const [conteo] = await query<(RowDataPacket & { n: number })[]>(`SELECT COUNT(*) AS n FROM empleados WHERE ${filtro}`, [empresaId, mes]);
  const total = Number(conteo?.n ?? 0);
  const esMesActual = hoyIso.startsWith(`${anio}-${String(mes).padStart(2, "0")}-`);
  const diaHoy = esMesActual ? Number(hoyIso.slice(8, 10)) : 1;
  const max = Math.max(1, Math.min(10, Math.trunc(limite)));
  const filas = total === 0
    ? []
    : await query<FilaCumple[]>(
        `SELECT id, nombre, DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento FROM empleados
          WHERE ${filtro} AND DAY(fecha_nacimiento) >= ?
          ORDER BY DAY(fecha_nacimiento) ASC, nombre ASC, id ASC LIMIT ${max}`,
        [empresaId, mes, diaHoy],
      );
  const proximos = filas
    .map((f) => ({ f, fecha: fechaCumpleanios(f.fecha_nacimiento, anio) }))
    .filter((x): x is { f: FilaCumple; fecha: FechaCumpleanios } => x.fecha != null)
    .slice(0, max)
    .map(({ f, fecha }) => ({ id: Number(f.id), nombre: t(f.nombre), dia: fecha.dia, fecha: fecha.iso }));
  return { mes, anio, nombreMes: nombreMes(mes), total, proximos };
}

