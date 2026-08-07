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
  esFlotaSubmodulo,
  esPlataformaPermisible,
  esRrhhSubmodulo,
  modulosPlataformaDesdePermisos,
  permisosEfectivos,
  tienePermiso,
  type AccionPermiso,
  type FlotaSubmodulo,
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
  if (session.rol === "Admin") return { session, empresa };

  const rolMods = modulosPorRol(session.rol);
  const empresaMods = empresa.modulos.length ? empresa.modulos : rolMods;
  const empresaOk =
    empresaMods.includes(modulo) ||
    modulo === "usuarios" ||
    modulo === "gerencia";

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  const accion: AccionPermiso = editar ? "editar" : "ver";
  const porRol = rolMods.includes(modulo);
  const porPermiso =
    tienePermiso(perms, modulo, accion) ||
    (modulo === "rrhh" &&
      perms.some(
        (p) =>
          esRrhhSubmodulo(p.modulo) &&
          tienePermiso(perms, p.modulo, accion),
      )) ||
    (modulo !== "rrhh" &&
      modulosPlataformaDesdePermisos(perms).includes(modulo));

  // Si hay matriz de permisos, un módulo de plataforma desmarcado no se
  // abre por rol (menú y API alineados).
  if (
    perms.length > 0 &&
    esPlataformaPermisible(modulo) &&
    !tienePermiso(perms, modulo, "ver")
  ) {
    return {
      error: NextResponse.json({ error: "Sin permiso de módulo." }, { status: 403 }),
    };
  }

  if (!empresaOk || (!porRol && !porPermiso)) {
    return {
      error: NextResponse.json({ error: "Sin permiso de módulo." }, { status: 403 }),
    };
  }

  if (editar) {
    const puedeEditar =
      puedeEditarModulo(session.rol, modulo) ||
      tienePermiso(perms, modulo, "editar") ||
      tienePermiso(perms, modulo, "crear") ||
      (modulo === "rrhh" &&
        perms.some(
          (p) =>
            esRrhhSubmodulo(p.modulo) &&
            (tienePermiso(perms, p.modulo, "editar") ||
              tienePermiso(perms, p.modulo, "crear")),
        )) ||
      (modulo === "flota" &&
        perms.some(
          (p) =>
            (esFlotaSubmodulo(p.modulo) || p.modulo === "flota") &&
            (tienePermiso(perms, p.modulo, "editar") ||
              tienePermiso(perms, p.modulo, "crear")),
        ));
    if (!puedeEditar) {
      return {
        error: NextResponse.json({ error: "Solo lectura." }, { status: 403 }),
      };
    }
  }
  return { session, empresa };
}

/**
 * Acceso Flota / Predios por submódulo (vehículos, servicios, lecturas…).
 * Compatible con permiso legado "flota".
 */
export async function requireTenantFlota(
  slug: string,
  submodulo: FlotaSubmodulo,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("flota")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo Flota / Predios." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  if (!tienePermiso(perms, submodulo, accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} en Predios (${submodulo}).` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/**
 * Acceso RRHH por submódulo + acción (ver/crear/editar/eliminar).
 * Admin siempre pasa. Permite acceso cruzado (ej. Operaciones → Planillas)
 * si el usuario tiene el permiso aunque su rol no incluya RRHH completo.
 */
export async function requireTenantRrhh(
  slug: string,
  submodulo: RrhhSubmodulo,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("rrhh")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo RRHH." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  if (!tienePermiso(perms, submodulo, accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} en ${submodulo}.` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/** Acepta cualquiera de varios submódulos de Predios. */
export async function requireTenantFlotaAny(
  slug: string,
  submodulos: FlotaSubmodulo[],
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("flota")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo Flota / Predios." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  if (submodulos.some((sub) => tienePermiso(perms, sub, accion))) {
    return { session, empresa };
  }
  return {
    error: NextResponse.json(
      { error: `Sin permiso para ${accion} en Predios.` },
      { status: 403 },
    ),
  };
}

/** Acepta cualquiera de varios submódulos (ej. evidencias: vacaciones o incidencias). */
export async function requireTenantRrhhAny(
  slug: string,
  submodulos: RrhhSubmodulo[],
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("rrhh")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo RRHH." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(
    session.id,
    session.rol as RolGlobal,
  );
  if (submodulos.some((sub) => tienePermiso(perms, sub, accion))) {
    return { session, empresa };
  }
  return {
    error: NextResponse.json(
      { error: `Sin permiso para ${accion}.` },
      { status: 403 },
    ),
  };
}
