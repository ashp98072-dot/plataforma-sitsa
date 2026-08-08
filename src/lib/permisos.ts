import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import type { RolGlobal } from "@/lib/roles";
import {
  catalogoPermisosRol,
  esFlotaSubmodulo,
  esPlataformaPermisible,
  modulosPropiosDelRol,
  permisoVacio,
  permisosDefaultPorRol,
  type PermisoModulo,
} from "@/lib/permisos-shared";

export * from "@/lib/permisos-shared";

/** Caché de permisos efectivos (Hostinger): menos hits al cambiar de módulo. */
const PERMISOS_TTL_MS = 180_000;
const permisosCache = new Map<
  string,
  { at: number; data: PermisoModulo[] }
>();

export async function listarPermisosUsuario(
  usuarioId: number,
): Promise<PermisoModulo[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT modulo, puede_ver, puede_crear, puede_editar, puede_eliminar
       FROM usuario_modulo
       WHERE usuario_id = ? AND empresa_id IS NULL
       ORDER BY modulo`,
      [usuarioId],
    );
    return rows.map((r) => ({
      modulo: String(r.modulo),
      puedeVer: Boolean(r.puede_ver),
      puedeCrear: Boolean(r.puede_crear),
      puedeEditar: Boolean(r.puede_editar),
      puedeEliminar: Boolean(r.puede_eliminar),
    }));
  } catch {
    try {
      const rows = await query<RowDataPacket[]>(
        `SELECT modulo, puede_ver, puede_editar
         FROM usuario_modulo
         WHERE usuario_id = ? AND empresa_id IS NULL
         ORDER BY modulo`,
        [usuarioId],
      );
      return rows.map((r) => ({
        modulo: String(r.modulo),
        puedeVer: Boolean(r.puede_ver),
        puedeCrear: Boolean(r.puede_editar),
        puedeEditar: Boolean(r.puede_editar),
        puedeEliminar: Boolean(r.puede_editar),
      }));
    } catch {
      return [];
    }
  }
}

export async function permisosEfectivos(
  usuarioId: number,
  rol: RolGlobal,
): Promise<PermisoModulo[]> {
  if (rol === "Admin") return permisosDefaultPorRol("Admin");

  const cacheKey = `${usuarioId}:${rol}`;
  const hit = permisosCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PERMISOS_TTL_MS) return hit.data;

  const stored = await listarPermisosUsuario(usuarioId);
  if (stored.length === 0) {
    const data = permisosDefaultPorRol(rol);
    permisosCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  const defaults = permisosDefaultPorRol(rol);
  const defMap = new Map(defaults.map((p) => [p.modulo, p]));
  const catalogo = catalogoPermisosRol(rol);
  const byMod = new Map(stored.map((p) => [p.modulo, p]));
  const tienePlataformaGuardada = stored.some(
    (p) =>
      esPlataformaPermisible(p.modulo) ||
      esFlotaSubmodulo(p.modulo) ||
      p.modulo === "flota",
  );
  // Filas antiguas fuera del catálogo actual.
  const extras = stored.filter((p) => !catalogo.includes(p.modulo));

  const propiosRol = new Set(modulosPropiosDelRol(rol));
  const data = [
    ...catalogo.map((m) => {
      if (byMod.has(m)) return byMod.get(m)!;
      // Compat: usuarios Operaciones/Contabilidad guardados solo con RRHH
      // conservan los módulos propios del rol por defecto.
      if (esPlataformaPermisible(m) && !tienePlataformaGuardada) {
        return defMap.get(m) ?? permisoVacio(m);
      }
      // Submódulo Flota nuevo (ej. inventario): heredar default del rol
      // si el usuario ya tenía matriz Flota y el módulo es propio del perfil.
      if (
        esFlotaSubmodulo(m) &&
        propiosRol.has(m) &&
        tienePlataformaGuardada
      ) {
        return defMap.get(m) ?? permisoVacio(m);
      }
      return permisoVacio(m);
    }),
    ...extras,
  ];
  permisosCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

export async function guardarPermisosUsuario(
  usuarioId: number,
  permisos: PermisoModulo[],
): Promise<void> {
  permisosCache.delete(`${usuarioId}:Admin`);
  for (const key of permisosCache.keys()) {
    if (key.startsWith(`${usuarioId}:`)) permisosCache.delete(key);
  }
  await execute(
    "DELETE FROM usuario_modulo WHERE usuario_id = ? AND empresa_id IS NULL",
    [usuarioId],
  );
  for (const p of permisos) {
    // Guardamos también filas en cero para respetar desmarques explícitos.
    try {
      await execute(
        `INSERT INTO usuario_modulo
          (usuario_id, empresa_id, modulo, puede_ver, puede_crear, puede_editar, puede_eliminar)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        [
          usuarioId,
          p.modulo,
          p.puedeVer ? 1 : 0,
          p.puedeCrear ? 1 : 0,
          p.puedeEditar ? 1 : 0,
          p.puedeEliminar ? 1 : 0,
        ],
      );
    } catch {
      if (!p.puedeVer && !p.puedeCrear && !p.puedeEditar && !p.puedeEliminar) {
        continue;
      }
      await execute(
        `INSERT INTO usuario_modulo
          (usuario_id, empresa_id, modulo, puede_ver, puede_editar)
         VALUES (?, NULL, ?, ?, ?)`,
        [
          usuarioId,
          p.modulo,
          p.puedeVer ? 1 : 0,
          p.puedeEditar || p.puedeCrear || p.puedeEliminar ? 1 : 0,
        ],
      );
    }
  }
}
