export const MODULOS_LIMPIEZA = [
  "rrhh",
  "flota",
  "operaciones",
  "contabilidad",
  "cms",
  "reciclaje",
  "tarimas",
] as const;

export type ModuloLimpieza = (typeof MODULOS_LIMPIEZA)[number];

export const MODULO_LIMPIEZA_LABEL: Record<ModuloLimpieza, string> = {
  rrhh: "RRHH (empleados, marcajes, vacaciones…)",
  flota: "Flota / Predios (vehículos, viajes, lecturas…)",
  operaciones: "Operaciones / TMS (planes, evidencias, catálogos)",
  contabilidad: "Contabilidad",
  cms: "Sitio Web (CMS)",
  reciclaje: "Reciclaje",
  tarimas: "Tarimas",
};

/** Qué NO se borra al limpiar cada módulo (para la UI). */
export const MODULO_LIMPIEZA_NOTA: Record<ModuloLimpieza, string> = {
  rrhh: "No toca Flota, TMS, usuarios ni la geocerca/configuración RRHH.",
  flota: "No toca RRHH, planes TMS, usuarios ni contabilidad.",
  operaciones: "No toca RRHH, Flota (viajes/vehículos), usuarios ni contabilidad.",
  contabilidad: "No toca RRHH, Flota ni TMS.",
  cms: "Solo secciones del sitio web de esa empresa.",
  reciclaje: "Solo lotes de reciclaje de esa empresa.",
  tarimas: "Solo órdenes de tarimas de esa empresa.",
};
