export const ROLES = [
  "Admin",
  "RRHH",
  "Marcaje",
  "Contabilidad",
  "Operaciones",
  "CoordinadorPredios",
  "Piloto",
  "Visualizador",
] as const;

export type RolGlobal = (typeof ROLES)[number];

export const MODULOS = [
  "rrhh",
  "tms",
  "flota",
  "contabilidad",
  "gerencia",
  "cms",
  "reciclaje",
  "tarimas",
  "usuarios",
] as const;

export type Modulo = (typeof MODULOS)[number];

/** Solo Admin ve todas por rol. RRHH/Contabilidad usan el flag acceso_todas_empresas. */
export function rolVeTodasLasEmpresas(rol: RolGlobal): boolean {
  return rol === "Admin";
}

export function modulosPorRol(rol: RolGlobal): Modulo[] {
  switch (rol) {
    case "Admin":
      return [...MODULOS];
    case "RRHH":
      return ["rrhh", "gerencia"];
    case "Marcaje":
      return ["rrhh"];
    case "Contabilidad":
      return ["contabilidad", "gerencia"];
    case "Operaciones":
      return ["tms", "flota", "reciclaje", "tarimas", "gerencia"];
    case "CoordinadorPredios":
      return ["flota", "tms"];
    case "Piloto":
      return ["flota"];
    case "Visualizador":
      return ["gerencia", "rrhh", "tms", "flota", "contabilidad", "reciclaje", "tarimas"];
    default:
      return ["gerencia"];
  }
}

export function puedeEditarModulo(rol: RolGlobal, modulo: Modulo): boolean {
  if (rol === "Visualizador" || rol === "Marcaje") return false;
  if (rol === "Admin") return true;
  if (rol === "RRHH") return modulo === "rrhh";
  if (rol === "Contabilidad") return modulo === "contabilidad";
  if (rol === "Operaciones") {
    return (
      modulo === "tms" ||
      modulo === "flota" ||
      modulo === "reciclaje" ||
      modulo === "tarimas"
    );
  }
  if (rol === "CoordinadorPredios") return modulo === "flota";
  if (rol === "Piloto") return false;
  return false;
}

export const MODULO_LABEL: Record<Modulo, string> = {
  rrhh: "Control de asistencias",
  tms: "TMS / Logística",
  flota: "Flota / Predios",
  contabilidad: "Contabilidad",
  gerencia: "Gerencia",
  cms: "Sitio Web (CMS)",
  reciclaje: "Reciclaje",
  tarimas: "Tarimas",
  usuarios: "Usuarios",
};
