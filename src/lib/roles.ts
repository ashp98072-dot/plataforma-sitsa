export const ROLES = [
  "Admin",
  "RRHH",
  "Marcaje",
  "Contabilidad",
  "Operaciones",
  "GerenteOperaciones",
  "JefeOperaciones",
  "AuxiliarOperaciones",
  "Facturador",
  "CoordinadorPredios",
  "CoordinadorCompras",
  "Piloto",
  "Visualizador",
] as const;

export type RolGlobal = (typeof ROLES)[number];

export const MODULOS = [
  "rrhh",
  "tms",
  "flota",
  "clientes",
  "facturacion",
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
      return ["contabilidad", "facturacion", "clientes", "gerencia"];
    case "Operaciones":
      return [
        "tms",
        "flota",
        "clientes",
        "facturacion",
        "reciclaje",
        "tarimas",
        "gerencia",
      ];
    // OPS-1: jerarquía operativa real, separada del rol legado
    // "Operaciones" (que se mantiene sin cambios para no afectar usuarios
    // existentes — ver permisos-shared.ts). El techo por rol aquí es el
    // MÓDULO grueso (para menú/fallback de empresa); la autoridad real de
    // cada acción sigue viviendo en el permiso explícito
    // (viaticos_autorizar/viaticos_pagar/viajes_cerrar), nunca en
    // `rol === "..."`.
    case "GerenteOperaciones":
    case "JefeOperaciones":
      return ["tms", "clientes", "gerencia"];
    case "AuxiliarOperaciones":
      return ["tms", "clientes"];
    case "Facturador":
      // "tms" se necesita porque viaticos_pagar/facturación de viajes
      // viven dentro del módulo TMS (ver requireTenantViaticosPagar) —
      // Facturador NO obtiene edición general de TMS por esto, solo el
      // permiso explícito viaticos_pagar la habilita.
      return ["tms", "facturacion"];
    case "CoordinadorPredios":
      // Solo Flota/Predios. TMS solo si se otorga en permisos.
      return ["flota"];
    case "CoordinadorCompras":
      return ["flota"];
    case "Piloto":
      return ["flota"];
    case "Visualizador":
      return [
        "gerencia",
        "rrhh",
        "tms",
        "flota",
        "clientes",
        "facturacion",
        "contabilidad",
        "reciclaje",
        "tarimas",
      ];
    default:
      return ["gerencia"];
  }
}

export function puedeEditarModulo(rol: RolGlobal, modulo: Modulo): boolean {
  if (rol === "Visualizador" || rol === "Marcaje") return false;
  if (rol === "Admin") return true;
  if (rol === "RRHH") return modulo === "rrhh";
  if (rol === "Contabilidad") {
    return (
      modulo === "contabilidad" ||
      modulo === "facturacion" ||
      modulo === "clientes"
    );
  }
  if (rol === "Operaciones") {
    return (
      modulo === "tms" ||
      modulo === "flota" ||
      modulo === "clientes" ||
      modulo === "facturacion" ||
      modulo === "reciclaje" ||
      modulo === "tarimas"
    );
  }
  if (rol === "GerenteOperaciones" || rol === "JefeOperaciones" || rol === "AuxiliarOperaciones") {
    return modulo === "tms" || modulo === "clientes";
  }
  if (rol === "Facturador") {
    // Edición de TMS/viajes NO se concede por rol — solo por el permiso
    // explícito viaticos_pagar (ver requireTenantViaticosPagar), que no
    // pasa por esta función.
    return modulo === "facturacion";
  }
  if (rol === "CoordinadorPredios") return modulo === "flota";
  if (rol === "CoordinadorCompras") return modulo === "flota";
  if (rol === "Piloto") return false;
  return false;
}

/**
 * Deriva módulos "implícitos" a partir de los módulos base de una
 * empresa: Clientes/Facturación se habilitan automáticamente cuando la
 * empresa ya opera TMS/Contabilidad/Reciclaje/Tarimas (el modulos_json de
 * la empresa no siempre los lista explícitamente, pero conceptualmente
 * ya los necesita — p.ej. TMS factura a sus clientes). Extraído de
 * src/app/e/[slug]/layout.tsx (que lo usa para el menú) para reutilizarlo
 * también en la matriz de permisos de Usuarios, sin duplicar la regla.
 */
export function derivarModulosEmpresa(baseMods: Modulo[]): Modulo[] {
  return [
    ...new Set([
      ...baseMods,
      ...(baseMods.some((m) =>
        (["tms", "contabilidad", "reciclaje", "tarimas", "clientes"] as Modulo[]).includes(m),
      )
        ? (["clientes"] as Modulo[])
        : []),
      ...(baseMods.some((m) =>
        (["contabilidad", "facturacion", "clientes"] as Modulo[]).includes(m),
      ) ||
      baseMods.some((m) => (["tms", "reciclaje", "tarimas"] as Modulo[]).includes(m))
        ? (["facturacion"] as Modulo[])
        : []),
    ]),
  ] as Modulo[];
}

export const MODULO_LABEL: Record<Modulo, string> = {
  rrhh: "Control de asistencias",
  tms: "TMS / Logística",
  flota: "Flota / Predios",
  clientes: "Clientes",
  facturacion: "Facturación",
  contabilidad: "Contabilidad",
  gerencia: "Gerencia",
  cms: "Sitio Web (CMS)",
  reciclaje: "Reciclaje",
  tarimas: "Tarimas",
  usuarios: "Usuarios",
};
