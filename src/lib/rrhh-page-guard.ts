import { getSession } from "@/lib/session";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RrhhSubmodulo } from "@/lib/permisos-shared";
import type { RolGlobal } from "@/lib/roles";

export type RrhhGuardResult =
  | { ok: true }
  | { ok: false; reason: "login" | "denied" };

/** Comprueba permiso de ver en un submódulo RRHH (Admin siempre ok). */
export async function guardRrhhSub(
  submodulo: RrhhSubmodulo,
): Promise<RrhhGuardResult> {
  const session = await getSession();
  if (!session) return { ok: false, reason: "login" };
  if (session.rol === "Admin") return { ok: true };

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  if (!tienePermiso(perms, submodulo, "ver")) {
    return { ok: false, reason: "denied" };
  }
  return { ok: true };
}

/** Algún submódulo RRHH con ver (para hub / dashboard). */
export async function guardRrhhAlguno(
  submodulos: RrhhSubmodulo[],
): Promise<RrhhGuardResult> {
  const session = await getSession();
  if (!session) return { ok: false, reason: "login" };
  if (session.rol === "Admin") return { ok: true };

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  if (submodulos.some((s) => tienePermiso(perms, s, "ver"))) {
    return { ok: true };
  }
  return { ok: false, reason: "denied" };
}
