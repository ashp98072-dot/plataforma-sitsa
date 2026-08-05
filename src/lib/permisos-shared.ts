import type { RolGlobal } from "@/lib/roles";

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

export function permisosDefaultPorRol(rol: RolGlobal): PermisoModulo[] {
  if (rol === "Admin" || rol === "RRHH") {
    return RRHH_SUBMODULOS.map((m) => ({
      modulo: m,
      puedeVer: true,
      puedeCrear: true,
      puedeEditar: true,
      puedeEliminar: true,
    }));
  }
  if (rol === "Visualizador") {
    return RRHH_SUBMODULOS.map((m) => ({
      modulo: m,
      puedeVer: true,
      puedeCrear: false,
      puedeEditar: false,
      puedeEliminar: false,
    }));
  }
  return RRHH_SUBMODULOS.map((m) => permisoVacio(m));
}

export function tienePermiso(
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
  { sub: "configuracion", label: "Configuración", path: "configuracion" },
];
