import type { Modulo, RolGlobal } from "@/lib/roles";
import { MODULO_LABEL } from "@/lib/roles";

/** Submódulos de Control de Asistencias (RRHH). */
export const RRHH_SUBMODULOS = [
  "empleados",
  "marcajes",
  "reportes",
  "vacaciones",
  "en_ruta",
  "incidencias",
  "configuracion",
  "planillas",
  "descuentos",
  "prestaciones",
  "inventario",
] as const;

export type RrhhSubmodulo = (typeof RRHH_SUBMODULOS)[number];

export const RRHH_SUBMODULO_LABEL: Record<RrhhSubmodulo, string> = {
  empleados: "Empleados",
  marcajes: "Registrar Marcaje",
  reportes: "Reportes",
  vacaciones: "Vacaciones",
  en_ruta: "En Ruta",
  incidencias: "Incidencias",
  configuracion: "Configuración",
  planillas: "Planillas",
  descuentos: "Descuentos",
  prestaciones: "Prestaciones",
  inventario: "Inventario",
};

/**
 * Submódulos de Flota / Predios (alineados a control-flota).
 * Prefijo flota_ para no chocar con reportes RRHH.
 */
export const FLOTA_SUBMODULOS = [
  "flota_vehiculos",
  "flota_servicios",
  "flota_lecturas",
  "flota_reportes",
  "flota_piloto",
] as const;

export type FlotaSubmodulo = (typeof FLOTA_SUBMODULOS)[number];

export const FLOTA_SUBMODULO_LABEL: Record<FlotaSubmodulo, string> = {
  flota_vehiculos: "Vehículos",
  flota_servicios: "Servicios / Taller",
  flota_lecturas: "Lecturas km",
  flota_reportes: "Reportes flota",
  flota_piloto: "Registrar viaje (piloto)",
};

/** Módulos de plataforma (sin flota: se desglosa en FLOTA_SUBMODULOS). */
export const PLATAFORMA_PERMISIBLES = [
  "tms",
  "contabilidad",
  "reciclaje",
  "tarimas",
  "cms",
] as const;

export type PlataformaPermisible = (typeof PLATAFORMA_PERMISIBLES)[number];

export type AccionPermiso = "ver" | "crear" | "editar" | "eliminar";

export type PermisoModulo = {
  modulo: string;
  puedeVer: boolean;
  puedeCrear: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
};

export function permisoVacio(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: false,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  };
}

export function permisoFull(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: true,
    puedeEliminar: true,
  };
}

export function permisoSoloVer(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: true,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  };
}

export function esRrhhSubmodulo(m: string): m is RrhhSubmodulo {
  return (RRHH_SUBMODULOS as readonly string[]).includes(m);
}

export function esFlotaSubmodulo(m: string): m is FlotaSubmodulo {
  return (FLOTA_SUBMODULOS as readonly string[]).includes(m);
}

export function esPlataformaPermisible(m: string): m is PlataformaPermisible {
  return (PLATAFORMA_PERMISIBLES as readonly string[]).includes(m);
}

export function labelPermiso(modulo: string): string {
  if (esRrhhSubmodulo(modulo)) return RRHH_SUBMODULO_LABEL[modulo];
  if (esFlotaSubmodulo(modulo)) return FLOTA_SUBMODULO_LABEL[modulo];
  if (modulo === "flota") return MODULO_LABEL.flota;
  if (esPlataformaPermisible(modulo)) {
    return MODULO_LABEL[modulo as Modulo] ?? modulo;
  }
  return modulo;
}

/** Etiqueta amigable del rol en formularios. */
export function labelRol(rol: string): string {
  if (rol === "CoordinadorPredios") return "Predios";
  return rol;
}

/** Catálogo total asignable (RRHH + Predios + plataforma). */
export function catalogoGlobalPermisos(): string[] {
  return [...RRHH_SUBMODULOS, ...FLOTA_SUBMODULOS, ...PLATAFORMA_PERMISIBLES];
}

/** Apartados colapsables en Usuarios y agrupación del menú. */
export type GrupoPermisosId =
  | "rrhh"
  | "operaciones"
  | "flota"
  | "contabilidad"
  | "otros";

export const GRUPOS_PERMISOS: {
  id: GrupoPermisosId;
  titulo: string;
  descripcion: string;
  modulos: string[];
}[] = [
  {
    id: "rrhh",
    titulo: "Permisos RRHH por módulos",
    descripcion: "Control de asistencias: personal, marcajes, vacaciones…",
    modulos: [...RRHH_SUBMODULOS],
  },
  {
    id: "operaciones",
    titulo: "Permisos Operaciones por módulos",
    descripcion: "TMS / logística, reciclaje y tarimas.",
    modulos: ["tms", "reciclaje", "tarimas"],
  },
  {
    id: "flota",
    titulo: "Permisos Flota / Predios por módulos",
    descripcion: "Vehículos, taller, lecturas, reportes y viajes.",
    modulos: [...FLOTA_SUBMODULOS],
  },
  {
    id: "contabilidad",
    titulo: "Permisos Contabilidad por módulos",
    descripcion: "Cuentas, asientos y cartera.",
    modulos: ["contabilidad"],
  },
  {
    id: "otros",
    titulo: "Otros módulos",
    descripcion: "Sitio web (CMS) y extras.",
    modulos: ["cms"],
  },
];

/** Grupo principal a abrir según el rol al crear usuario. */
export function grupoPrincipalDelRol(rol: RolGlobal): GrupoPermisosId {
  switch (rol) {
    case "RRHH":
      return "rrhh";
    case "Contabilidad":
      return "contabilidad";
    case "Operaciones":
      return "operaciones";
    case "CoordinadorPredios":
      return "flota";
    default:
      return "rrhh";
  }
}

/** Módulos propios del perfil (matriz principal al crear/editar usuario). */
export function modulosPropiosDelRol(rol: RolGlobal): string[] {
  switch (rol) {
    case "Admin":
      return catalogoGlobalPermisos();
    case "RRHH":
      return [...RRHH_SUBMODULOS];
    case "Contabilidad":
      return ["contabilidad"];
    case "Operaciones":
      // TMS + Predios (control-flota) + otros ops
      return ["tms", ...FLOTA_SUBMODULOS, "reciclaje", "tarimas"];
    case "CoordinadorPredios":
      return [...FLOTA_SUBMODULOS, "tms"];
    case "Visualizador":
      return [
        ...RRHH_SUBMODULOS,
        ...FLOTA_SUBMODULOS,
        "tms",
        "contabilidad",
        "reciclaje",
        "tarimas",
      ];
    default:
      return [];
  }
}

/**
 * Módulos de otras áreas / plazas que se pueden otorgar además del perfil.
 * Ej.: Operaciones → Planillas; Contabilidad → Vehículos / Predios…
 */
export function modulosOtrasAreasDelRol(rol: RolGlobal): string[] {
  if (rol === "Admin") return [];
  const propios = new Set(modulosPropiosDelRol(rol));
  return catalogoGlobalPermisos().filter((m) => !propios.has(m));
}

/** Catálogo completo editable para un rol (propios + cruzados). */
export function catalogoPermisosRol(rol: RolGlobal): string[] {
  return [...modulosPropiosDelRol(rol), ...modulosOtrasAreasDelRol(rol)];
}

export function permisosDefaultPorRol(rol: RolGlobal): PermisoModulo[] {
  if (rol === "Admin") {
    return catalogoPermisosRol("Admin").map((m) => permisoFull(m));
  }

  const propios = modulosPropiosDelRol(rol);
  const cruzados = modulosOtrasAreasDelRol(rol);

  if (rol === "Visualizador") {
    return [
      ...propios.map((m) => permisoSoloVer(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "RRHH" || rol === "Contabilidad" || rol === "Operaciones") {
    return [
      ...propios.map((m) => permisoFull(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "CoordinadorPredios") {
    return [
      ...propios.map((m) =>
        esFlotaSubmodulo(m) ? permisoFull(m) : permisoSoloVer(m),
      ),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  return catalogoPermisosRol(rol).map((m) => permisoVacio(m));
}

export function mergePermisosConCatalogo(
  rol: RolGlobal,
  base: PermisoModulo[],
): PermisoModulo[] {
  const map = new Map(base.map((p) => [p.modulo, p]));
  // Compat: si solo venía el paraguas "flota", expandir a submódulos.
  const legacyFlota = map.get("flota");
  if (legacyFlota) {
    for (const sub of FLOTA_SUBMODULOS) {
      if (!map.has(sub)) {
        map.set(sub, { ...legacyFlota, modulo: sub });
      }
    }
  }
  return catalogoPermisosRol(rol).map(
    (m) => map.get(m) ?? permisoVacio(m),
  );
}

export function tienePermiso(
  permisos: PermisoModulo[],
  modulo: string,
  accion: AccionPermiso,
): boolean {
  const p = permisos.find((x) => x.modulo === modulo);
  if (p) {
    switch (accion) {
      case "ver":
        if (p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar) {
          return true;
        }
        break;
      case "crear":
        if (p.puedeCrear) return true;
        break;
      case "editar":
        if (p.puedeEditar) return true;
        break;
      case "eliminar":
        if (p.puedeEliminar) return true;
        break;
    }
  }
  // Paraguas legacy "flota" → cualquier submódulo Predios
  if (esFlotaSubmodulo(modulo)) {
    return tienePermisoDirecto(permisos, "flota", accion);
  }
  return false;
}

function tienePermisoDirecto(
  permisos: PermisoModulo[],
  modulo: string,
  accion: AccionPermiso,
): boolean {
  const p = permisos.find((x) => x.modulo === modulo);
  if (!p) return false;
  switch (accion) {
    case "ver":
      return p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar;
    case "crear":
      return p.puedeCrear;
    case "editar":
      return p.puedeEditar;
    case "eliminar":
      return p.puedeEliminar;
    default:
      return false;
  }
}

/** Plataforma + rrhh/flota derivados de la matriz (para menú / acceso). */
export function modulosPlataformaDesdePermisos(
  permisos: PermisoModulo[],
): Modulo[] {
  const out = new Set<Modulo>();
  for (const p of permisos) {
    if (!tienePermiso(permisos, p.modulo, "ver") && p.modulo !== "flota") {
      continue;
    }
    if (p.modulo === "flota" && tienePermisoDirecto(permisos, "flota", "ver")) {
      out.add("flota");
      continue;
    }
    if (!tienePermiso(permisos, p.modulo, "ver")) continue;
    if (esPlataformaPermisible(p.modulo)) {
      out.add(p.modulo);
    }
    if (esRrhhSubmodulo(p.modulo)) {
      out.add("rrhh");
    }
    if (esFlotaSubmodulo(p.modulo)) {
      out.add("flota");
    }
  }
  return [...out];
}

export const RRHH_NAV: {
  sub: RrhhSubmodulo;
  label: string;
  path: string;
}[] = [
  { sub: "empleados", label: "Empleados", path: "empleados" },
  { sub: "marcajes", label: "Registrar Marcaje", path: "marcajes" },
  { sub: "reportes", label: "Reportes", path: "reportes" },
  { sub: "vacaciones", label: "Vacaciones / En Ruta", path: "vacaciones" },
  { sub: "incidencias", label: "Incidencias", path: "incidencias" },
  { sub: "planillas", label: "Planillas", path: "planillas" },
  { sub: "descuentos", label: "Descuentos", path: "descuentos" },
  { sub: "prestaciones", label: "Prestaciones", path: "prestaciones" },
  { sub: "inventario", label: "Inventario", path: "inventario" },
  { sub: "configuracion", label: "Configuración", path: "configuracion" },
];

/** Navegación Predios / control-flota. */
export const FLOTA_NAV: {
  sub: FlotaSubmodulo;
  label: string;
  path: string;
}[] = [
  { sub: "flota_vehiculos", label: "Vehículos", path: "vehiculos" },
  { sub: "flota_servicios", label: "Servicios", path: "servicios" },
  { sub: "flota_lecturas", label: "Lecturas", path: "lecturas" },
  { sub: "flota_reportes", label: "Reportes flota", path: "reportes" },
  { sub: "flota_piloto", label: "Registrar viaje", path: "piloto" },
];
