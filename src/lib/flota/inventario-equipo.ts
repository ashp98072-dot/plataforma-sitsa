import type { RowDataPacket } from "mysql2";
import { execute, query, type SqlParams } from "@/lib/db";
import { asegurarSchemaFlota } from "@/lib/flota/schema";

const CATEGORIAS_SEED = [
  "Mecánico",
  "Electricista",
  "Herrero",
  "General",
];

const AREAS_SEED = ["Taller", "Bodega", "Predios"];

/** Evita re-chequear seed / schema en cada request (misma instancia Node). */
const seedListo = new Set<number>();

const CATALOGO_TTL_MS = 60_000;
const catalogoCache = new Map<
  number,
  { at: number; categorias: InvCategoria[]; areas: InvArea[] }
>();

export async function asegurarInventarioEquipo(empresaId: number) {
  // Si ya sembramos esta empresa en este proceso, no tocar schema ni COUNT.
  if (seedListo.has(empresaId)) return;

  await asegurarSchemaFlota();

  const [cats, areas] = await Promise.all([
    query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM flota_inv_categorias WHERE empresa_id = ?",
      [empresaId],
    ),
    query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM flota_inv_areas WHERE empresa_id = ?",
      [empresaId],
    ),
  ]);

  const jobs: Promise<unknown>[] = [];
  if (Number(cats[0]?.n ?? 0) === 0) {
    for (const nombre of CATEGORIAS_SEED) {
      jobs.push(
        execute(
          `INSERT IGNORE INTO flota_inv_categorias (empresa_id, nombre)
           VALUES (?, ?)`,
          [empresaId, nombre],
        ),
      );
    }
  }
  if (Number(areas[0]?.n ?? 0) === 0) {
    for (const nombre of AREAS_SEED) {
      jobs.push(
        execute(
          `INSERT IGNORE INTO flota_inv_areas (empresa_id, nombre)
           VALUES (?, ?)`,
          [empresaId, nombre],
        ),
      );
    }
  }
  if (jobs.length) await Promise.all(jobs);
  seedListo.add(empresaId);
}

export type InvCategoria = {
  id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
};

export type InvArea = {
  id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
};

export type InvEquipo = {
  id: number;
  codigo: string;
  nombre: string;
  categoriaId: number | null;
  categoriaNombre: string | null;
  propiedad: "empresa" | "empleado";
  areaId: number | null;
  areaNombre: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  cantidad: number;
  unidad: string;
  marca: string | null;
  serie: string | null;
  estado: string;
  notas: string | null;
};

export type InvResumen = {
  qtyEmpresa: number;
  qtyEmpleado: number;
  itemsEmpresa: number;
  itemsEmpleado: number;
  porArea: { area: string; cantidad: number; items: number }[];
  porEmpleado: { empleado: string; cantidad: number; items: number }[];
};

export async function listarCategorias(
  empresaId: number,
): Promise<InvCategoria[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, descripcion, activa
     FROM flota_inv_categorias
     WHERE empresa_id = ?
     ORDER BY nombre`,
    [empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nombre: String(r.nombre),
    descripcion: r.descripcion ? String(r.descripcion) : null,
    activa: Boolean(r.activa),
  }));
}

export async function listarAreas(empresaId: number): Promise<InvArea[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, descripcion, activa
     FROM flota_inv_areas
     WHERE empresa_id = ?
     ORDER BY nombre`,
    [empresaId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nombre: String(r.nombre),
    descripcion: r.descripcion ? String(r.descripcion) : null,
    activa: Boolean(r.activa),
  }));
}

/** Categorías + áreas con TTL corto (se invalidan al crear). */
export async function listarCatalogos(
  empresaId: number,
  forzar = false,
): Promise<{ categorias: InvCategoria[]; areas: InvArea[] }> {
  const hit = catalogoCache.get(empresaId);
  if (
    !forzar &&
    hit &&
    Date.now() - hit.at < CATALOGO_TTL_MS
  ) {
    return { categorias: hit.categorias, areas: hit.areas };
  }
  const [categorias, areas] = await Promise.all([
    listarCategorias(empresaId),
    listarAreas(empresaId),
  ]);
  catalogoCache.set(empresaId, { at: Date.now(), categorias, areas });
  return { categorias, areas };
}

export function invalidarCatalogoInventario(empresaId: number) {
  catalogoCache.delete(empresaId);
}

export async function listarEquipo(
  empresaId: number,
  opts?: { propiedad?: string; q?: string },
): Promise<InvEquipo[]> {
  const params: SqlParams = [empresaId];
  let where = "e.empresa_id = ?";
  if (opts?.propiedad === "empresa" || opts?.propiedad === "empleado") {
    where += " AND e.propiedad = ?";
    params.push(opts.propiedad);
  }
  if (opts?.q?.trim()) {
    where += ` AND (
      e.codigo LIKE ? OR e.nombre LIKE ? OR e.empleado_nombre LIKE ?
      OR COALESCE(c.nombre,'') LIKE ? OR COALESCE(a.nombre,'') LIKE ?
    )`;
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like, like, like);
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT e.id, e.codigo, e.nombre, e.categoria_id, c.nombre AS categoria_nombre,
            e.propiedad, e.area_id, a.nombre AS area_nombre,
            e.empleado_id, e.empleado_nombre, e.cantidad, e.unidad,
            e.marca, e.serie, e.estado, e.notas
     FROM flota_inv_equipo e
     LEFT JOIN flota_inv_categorias c ON c.id = e.categoria_id
     LEFT JOIN flota_inv_areas a ON a.id = e.area_id
     WHERE ${where}
     ORDER BY e.propiedad, e.nombre`,
    params,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    categoriaId: r.categoria_id != null ? Number(r.categoria_id) : null,
    categoriaNombre: r.categoria_nombre ? String(r.categoria_nombre) : null,
    propiedad: String(r.propiedad) === "empleado" ? "empleado" : "empresa",
    areaId: r.area_id != null ? Number(r.area_id) : null,
    areaNombre: r.area_nombre ? String(r.area_nombre) : null,
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    empleadoNombre: r.empleado_nombre ? String(r.empleado_nombre) : null,
    cantidad: Number(r.cantidad ?? 0),
    unidad: String(r.unidad || "Unidad"),
    marca: r.marca ? String(r.marca) : null,
    serie: r.serie ? String(r.serie) : null,
    estado: String(r.estado || "Activo"),
    notas: r.notas ? String(r.notas) : null,
  }));
}

/** Resumen desde ítems ya cargados (0 queries extra). */
export function resumenDesdeItems(items: InvEquipo[]): InvResumen {
  let qtyEmpresa = 0;
  let qtyEmpleado = 0;
  let itemsEmpresa = 0;
  let itemsEmpleado = 0;
  const areaMap = new Map<string, { cantidad: number; items: number }>();
  const empMap = new Map<string, { cantidad: number; items: number }>();

  for (const it of items) {
    if (it.estado === "Baja") continue;
    if (it.propiedad === "empresa") {
      qtyEmpresa += it.cantidad;
      itemsEmpresa += 1;
      const key = it.areaNombre || "(Sin área)";
      const cur = areaMap.get(key) ?? { cantidad: 0, items: 0 };
      cur.cantidad += it.cantidad;
      cur.items += 1;
      areaMap.set(key, cur);
    } else {
      qtyEmpleado += it.cantidad;
      itemsEmpleado += 1;
      const key = it.empleadoNombre || "(Sin nombre)";
      const cur = empMap.get(key) ?? { cantidad: 0, items: 0 };
      cur.cantidad += it.cantidad;
      cur.items += 1;
      empMap.set(key, cur);
    }
  }

  return {
    qtyEmpresa,
    qtyEmpleado,
    itemsEmpresa,
    itemsEmpleado,
    porArea: [...areaMap.entries()]
      .map(([area, v]) => ({ area, ...v }))
      .sort((a, b) => a.area.localeCompare(b.area)),
    porEmpleado: [...empMap.entries()]
      .map(([empleado, v]) => ({ empleado, ...v }))
      .sort((a, b) => a.empleado.localeCompare(b.empleado)),
  };
}

export async function resumenInventario(
  empresaId: number,
): Promise<InvResumen> {
  const [rows, porArea, porEmpleado] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN propiedad = 'empresa' THEN cantidad ELSE 0 END) AS qty_empresa,
         SUM(CASE WHEN propiedad = 'empleado' THEN cantidad ELSE 0 END) AS qty_empleado,
         COUNT(CASE WHEN propiedad = 'empresa' THEN 1 END) AS items_empresa,
         COUNT(CASE WHEN propiedad = 'empleado' THEN 1 END) AS items_empleado
       FROM flota_inv_equipo
       WHERE empresa_id = ? AND estado <> 'Baja'`,
      [empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT COALESCE(a.nombre, '(Sin área)') AS area,
              SUM(e.cantidad) AS cantidad,
              COUNT(*) AS items
       FROM flota_inv_equipo e
       LEFT JOIN flota_inv_areas a ON a.id = e.area_id
       WHERE e.empresa_id = ? AND e.propiedad = 'empresa' AND e.estado <> 'Baja'
       GROUP BY COALESCE(a.nombre, '(Sin área)')
       ORDER BY area`,
      [empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT COALESCE(e.empleado_nombre, '(Sin nombre)') AS empleado,
              SUM(e.cantidad) AS cantidad,
              COUNT(*) AS items
       FROM flota_inv_equipo e
       WHERE e.empresa_id = ? AND e.propiedad = 'empleado' AND e.estado <> 'Baja'
       GROUP BY COALESCE(e.empleado_nombre, '(Sin nombre)')
       ORDER BY empleado`,
      [empresaId],
    ),
  ]);
  const r = rows[0];
  return {
    qtyEmpresa: Number(r?.qty_empresa ?? 0),
    qtyEmpleado: Number(r?.qty_empleado ?? 0),
    itemsEmpresa: Number(r?.items_empresa ?? 0),
    itemsEmpleado: Number(r?.items_empleado ?? 0),
    porArea: porArea.map((x) => ({
      area: String(x.area),
      cantidad: Number(x.cantidad ?? 0),
      items: Number(x.items ?? 0),
    })),
    porEmpleado: porEmpleado.map((x) => ({
      empleado: String(x.empleado),
      cantidad: Number(x.cantidad ?? 0),
      items: Number(x.items ?? 0),
    })),
  };
}
