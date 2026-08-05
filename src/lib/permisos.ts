import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import type { RolGlobal } from "@/lib/roles";
import {
  catalogoPermisosRol,
  esFlotaSubmodulo,
  esPlataformaPermisible,
  permisoVacio,
  permisosDefaultPorRol,
  type PermisoModulo,
} from "@/lib/permisos-shared";

export * from "@/lib/permisos-shared";

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
  const stored = await listarPermisosUsuario(usuarioId);
  if (stored.length === 0) return permisosDefaultPorRol(rol);

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

  return [
    ...catalogo.map((m) => {
      if (byMod.has(m)) return byMod.get(m)!;
      // Compat: usuarios Operaciones/Contabilidad guardados solo con RRHH
      // conservan los módulos propios del rol por defecto.
      if (esPlataformaPermisible(m) && !tienePlataformaGuardada) {
        return defMap.get(m) ?? permisoVacio(m);
      }
      return permisoVacio(m);
    }),
    ...extras,
  ];
}

export async function guardarPermisosUsuario(
  usuarioId: number,
  permisos: PermisoModulo[],
): Promise<void> {
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
