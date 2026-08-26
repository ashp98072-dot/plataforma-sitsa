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

  // Empresa + lista de acceso en paralelo (misma latencia, menos round-trips).
  const [empresa, permitidas] = await Promise.all([
    obtenerEmpresaPorSlug(slug),
    empresasParaUsuario({
      usuarioId: session.id,
      rol: session.rol,
      accesoTodas: Boolean(session.accesoTodas),
    }),
  ]);
  if (!empresa || !empresa.activa) {
    return {
      error: NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 }),
    };
  }
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

/**
 * VIAT-1 — autorizar/entregar/liquidar viáticos. Permiso EXPLÍCITO e
 * independiente de ser supervisor o de tener acceso general a TMS: un
 * usuario puede ver/editar TMS por completo y aun así no tener
 * `viaticos:editar` — deben concedérselo aparte desde Usuarios. Mismo
 * patrón exacto que requireTenantRrhh, solo que el módulo padre es "tms"
 * en vez de "rrhh" (los viáticos viven dentro de TMS).
 */
export async function requireTenantViaticos(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (!tienePermiso(perms, "viaticos", accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} viáticos.` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/**
 * VIAT-2 — "OPERACIONES AUTORIZA, FACTURADOR PAGA": autorizar
 * (PROGRAMADO -> AUTORIZADO) es un permiso propio, separado de
 * pagar/entregar y de ser supervisor del empleado. Mismo patrón que
 * requireTenantViaticos, solo que el módulo checado es
 * "viaticos_autorizar".
 */
export async function requireTenantViaticosAutorizar(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (!tienePermiso(perms, "viaticos_autorizar", accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} la autorización de viáticos.` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/**
 * VIAT-2 — pagar/registrar entrega (AUTORIZADO -> ENTREGADO) es un permiso
 * propio, separado de autorizar. Quien solo tiene `viaticos_pagar` puede
 * ver la bandeja "Viáticos por pagar" (incluye dato bancario existente del
 * empleado) y registrar la entrega — nunca autorizar ni modificar montos
 * (eso lo bloquea actualizarMontoViatico independientemente del permiso,
 * ver src/lib/tms/viaticos.ts).
 */
export async function requireTenantViaticosPagar(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (!tienePermiso(perms, "viaticos_pagar", accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} el pago/entrega de viáticos.` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/**
 * OPS-1 — cerrar administrativamente un viaje (Descargado -> Cerrado).
 * Permiso EXPLÍCITO e independiente del rol — JefeOperaciones/
 * GerenteOperaciones lo traen por defecto, pero cualquier rol puede
 * recibirlo desde Usuarios y ningún endpoint de cierre confía en
 * `rol === "JefeOperaciones"` como autoridad. Mismo patrón exacto que
 * requireTenantViaticosAutorizar/Pagar.
 */
export async function requireTenantViajesCerrar(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (!tienePermiso(perms, "viajes_cerrar", accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} el cierre de viajes.` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/**
 * Corrección de matriz de permisos — Programación deja de depender
 * exclusivamente de "tms": mismo patrón que requireTenantViajesCerrar
 * (permiso propio, permisosEfectivos ya trae el default por rol —
 * GerenteOperaciones/JefeOperaciones/AuxiliarOperaciones/Operaciones
 * (legado) lo traen completo por defecto, Facturador no). Sigue exigiendo
 * que la empresa tenga "tms" habilitado — Programación vive dentro de
 * TMS, no es un módulo de empresa aparte. Usado por las acciones de
 * ESCRITURA de Programación (crear/editar viajes) — nunca por "ver": un
 * usuario con programacion:ver pero sin programacion:crear/editar no
 * debe poder crear/editar solo porque puede ver (ver requireTenant
 * ProgramacionOTms para la lectura compartida con TMS).
 */
export async function requireTenantProgramacion(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (!tienePermiso(perms, "programacion", accion)) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} en Programación.` },
        { status: 403 },
      ),
    };
  }
  return { session, empresa };
}

/**
 * OPS-5.2a — Rutas (catálogo maestro de rutas/servicios por cliente,
 * VIAT-4) deja de depender exclusivamente de "tms": permiso propio
 * (rutas:ver/crear/editar/eliminar). A diferencia de Programación (que
 * separa lectura compartida de escritura exclusiva en dos funciones),
 * Rutas siempre vivió dentro de "tms" sin distinguir acción — por
 * compatibilidad histórica, TODA acción acepta rutas:<accion> O
 * tms:<accion> (quien hoy edita rutas vía tms:editar debe seguir
 * pudiendo hacerlo sin regresión). Sigue exigiendo que la empresa tenga
 * "tms" habilitado — Rutas vive dentro de TMS, no es una capacidad de
 * empresa aparte (no se crea ningún flag/tabla nuevo).
 */
export async function requireTenantRutas(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (
    tienePermiso(perms, "rutas", accion) ||
    tienePermiso(perms, "tms", accion)
  ) {
    return { session, empresa };
  }
  return {
    error: NextResponse.json(
      { error: `Sin permiso para ${accion} en Rutas.` },
      { status: 403 },
    ),
  };
}

/**
 * Lectura/escritura de dependencias compartidas entre Programación y
 * TMS: acepta CUALQUIERA de los dos permisos para la MISMA acción
 * (programacion:<accion> O tms:<accion>), mismo patrón OR que
 * requireTenantViaticosAny. Evita que un usuario con programacion:ver
 * pero tms:ver=false (o viceversa) se quede sin poder cargar datos.
 *
 * Originalmente exclusivo de GET /tms/planes (alimenta TANTO el tablero
 * de Programación como la tabla de solo lectura de TMS, único caller
 * antes de OPS-5.2b, siempre con accion="ver" implícito). OPS-5.2b
 * generaliza el parámetro `accion` (default "ver", 100% compatible con
 * los callers existentes que solo pasaban `slug`) para reutilizarlo
 * también en los endpoints que Programación consume como dependencias
 * operativas reales (catálogos, disponibilidad de personal, ubicaciones/
 * contactos de cliente, configuración de viáticos de solo lectura) —
 * NUNCA para convertir programacion:* en acceso administrativo general a
 * TMS: cada endpoint decide, caso por caso y verificado por lectura de
 * su consumidor real, si su escritura es realmente una dependencia
 * operativa de Programación antes de usar accion="crear"/"editar" aquí.
 */
export async function requireTenantProgramacionOTms(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  if (
    tienePermiso(perms, "programacion", accion) ||
    tienePermiso(perms, "tms", accion)
  ) {
    return { session, empresa };
  }
  return {
    error: NextResponse.json(
      { error: `Sin permiso para ${accion} en Programación/TMS.` },
      { status: 403 },
    ),
  };
}

/**
 * OPS-5.2c — catálogo operativo de cliente (contactos/ubicaciones):
 * unifica el acceso de lectura entre Programación, Rutas y TMS, que
 * comparten las mismas dependencias operativas de tms_clientes. Agrega
 * `rutas:ver` al mismo OR que ya usa requireTenantProgramacionOTms —
 * OPS-5.2c.1 confirmó por barrido de consumidores que un usuario con
 * SOLO rutas:ver (sin programacion:ver ni tms:ver) puede abrir
 * Operaciones > Rutas, pero antes de este cambio recibía 403 al pedir
 * los contactos/ubicaciones del cliente para armar la ruta — su
 * formulario quedaba parcialmente roto. Misma capacidad de empresa que
 * los tres helpers anteriores: exige "tms" habilitado (Programación y
 * Rutas viven dentro de esa capacidad, no son módulos de empresa
 * aparte).
 *
 * Además calcula `accesoCompleto` (true solo para Admin o para quien
 * tenga tms:ver) para que el endpoint decida qué payload devolver:
 * completo para las pantallas administrativas de TMS
 * (cliente-contactos-admin.tsx/cliente-ubicaciones-admin.tsx), reducido
 * a los campos operativos para Programación/Rutas (que nunca los
 * necesitaron completos — confirmado por lectura de sus consumidores en
 * OPS-5.2c/OPS-5.2c.1). La señal se calcula aquí, en el servidor, a
 * partir de permisos efectivos reales — nunca se expone la lista
 * completa de permisos al cliente, y el endpoint NO debe decidir el
 * payload por rol, pathname, Referer ni querystring.
 */
export async function requireTenantCatalogoOperativoCliente(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<(Ok & { accesoCompleto: boolean }) | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") {
    return { session, empresa, accesoCompleto: true };
  }

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  const puedeTms = tienePermiso(perms, "tms", accion);
  const puedeProgramacion = tienePermiso(perms, "programacion", accion);
  const puedeRutas = tienePermiso(perms, "rutas", accion);

  if (!puedeTms && !puedeProgramacion && !puedeRutas) {
    return {
      error: NextResponse.json(
        { error: `Sin permiso para ${accion} en Programación/Rutas/TMS.` },
        { status: 403 },
      ),
    };
  }

  return { session, empresa, accesoCompleto: puedeTms };
}

/**
 * VIAT-3 — módulo "Operaciones > Viáticos": acepta CUALQUIERA de los tres
 * permisos de viáticos (`viaticos`, `viaticos_autorizar`, `viaticos_pagar`)
 * con la acción pedida — no crea un permiso nuevo, solo reutiliza los tres
 * ya existentes con un OR, igual que requireTenantFlotaAny/RrhhAny. Sirve
 * para la vista general (resumen + listado global): un usuario con
 * únicamente `viaticos_pagar:ver` (el facturador) debe poder verla para
 * ubicar sus AUTORIZADOS, igual que uno con únicamente `viaticos_autorizar`
 * o con el `viaticos` general de supervisión. Cada ACCIÓN puntual
 * (autorizar/pagar/liquidar) sigue exigiendo su propio permiso específico
 * en su propio endpoint — este gate solo cubre la lectura del listado.
 */
export async function requireTenantViaticosAny(
  slug: string,
  accion: AccionPermiso = "ver",
): Promise<Ok | Fail> {
  const tenant = await requireTenant(slug);
  if (tenant.error) return tenant;

  const { session, empresa } = tenant;
  if (session.rol === "Admin") return { session, empresa };

  const empresaMods = empresa.modulos.length
    ? empresa.modulos
    : modulosPorRol(session.rol);
  if (empresaMods.length && !empresaMods.includes("tms")) {
    return {
      error: NextResponse.json(
        { error: "Esta empresa no tiene el módulo TMS." },
        { status: 403 },
      ),
    };
  }

  const perms = await permisosEfectivos(session.id, session.rol as RolGlobal);
  const permisosViaticos = ["viaticos", "viaticos_autorizar", "viaticos_pagar"] as const;
  if (permisosViaticos.some((m) => tienePermiso(perms, m, accion))) {
    return { session, empresa };
  }
  return {
    error: NextResponse.json(
      { error: `Sin permiso para ${accion} viáticos.` },
      { status: 403 },
    ),
  };
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
