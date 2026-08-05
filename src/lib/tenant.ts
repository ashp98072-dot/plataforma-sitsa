import { NextResponse } from "next/server";
import {
  empresasParaUsuario,
  obtenerEmpresaPorSlug,
  type Empresa,
} from "./empresas";
import {
  puedeEditarModulo,
  modulosPorRol,
  type Modulo,
  type RolGlobal,
} from "./roles";
import {
  createSessionToken,
  getSession,
  setSessionCookie,
  type SessionPayload,
} from "./session";
import {
  permisosEfectivos,
  tienePermiso,
  type AccionPermiso,
  type RrhhSubmodulo,
} from "./permisos";

type Ok = { session: SessionPayload; empresa: Empresa; error?: undefined };
type Fail = { session?: undefined; empresa?: undefined; error: NextResponse };

export async function requireTenant(slug: string): Promise<Ok | Fail> {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "No autenticado." }, { status: 401 }),
    };
  }

  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!empresa || !empresa.activa) {
    return {
      error: NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 }),
    };
  }

  const permitidas = await empresasParaUsuario({
    usuarioId: session.id,
    rol: session.rol,
    accesoTodas: Boolean(session.accesoTodas),
  });
  if (!permitidas.some((e) => e.id === empresa.id)) {
    return {
      error: NextResponse.json({ error: "Sin acceso a esta empresa." }, { status: 403 }),
    };
  }

  if (session.empresaId !== empresa.id) {
    const token = await createSessionToken({
      ...session,
      empresaId: empresa.id,
      empresaSlug: empresa.slug,
      empresaNombre: empresa.nombre,
    });
    await setSessionCookie(token);
    session.empresaId = empresa.id;
    session.empresaSlug = empresa.slug;
    session.empresaNombre = empresa.nombre;
  }

  return { session, empresa };
}

export async function requireTenantModulo(
  slug: string,
  modulo: Modulo,
  editar = false,
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  const rolMods = modulosPorRol(session.rol);
  const empresaMods = empresa.modulos.length ? empresa.modulos : rolMods;
  const allowed =
    session.rol === "Admin" ||
    (rolMods.includes(modulo) &&
      (empresaMods.includes(modulo) ||
        modulo === "usuarios" ||
        modulo === "gerencia"));

  if (!allowed) {
    return {
      error: NextResponse.json({ error: "Sin permiso de módulo." }, { status: 403 }),
    };
  }
  if (editar && !puedeEditarModulo(session.rol, modulo)) {
    return {
      error: NextResponse.json({ error: "Solo lectura." }, { status: 403 }),
    };
  }
  return { session, empresa };
}

/**
 * Acceso RRHH por submódulo + acción (ver/crear/editar/eliminar).
 * Admin siempre pasa. Si hay filas en usuario_modulo se usan; si no, defaults del rol.
 */
export async function requireTenantRrhh(
  slug: string,
  submodulo: RrhhSubmodulo,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const base = await requireTenantModulo(slug, "rrhh", accion !== "ver");
  if (base.error) return base;

  if (base.session.rol === "Admin") return base;

  const perms = await permisosEfectivos(
    base.session.id,
    base.session.rol as RolGlobal,
  );
  if (!tienePermiso(perms, submodulo, accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} en ${submodulo}.` },
        { status: 403 },
      ),
    };
  }
  return base;
}

/** Acepta cualquiera de varios submódulos (ej. evidencias: vacaciones o incidencias). */
export async function requireTenantRrhhAny(
  slug: string,
  submodulos: RrhhSubmodulo[],
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  let last: Ok | Fail | null = null;
  for (const sub of submodulos) {
    const g = await requireTenantRrhh(slug, sub, accion);
    if (!g.error) return g;
    last = g;
  }
  return (
    last ?? {
      error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }),
    }
  );
}
