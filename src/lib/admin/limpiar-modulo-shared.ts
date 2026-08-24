export const MODULOS_LIMPIEZA = [
  "rrhh",
  "rrhh_planillas",
  "rrhh_vacaciones",
  "rrhh_marcajes",
  "rrhh_incidencias",
  "rrhh_descuentos",
  "rrhh_horas_extra",
  "rrhh_inventario",
  "flota_kilometraje",
  "flota",
  "operaciones",
  "contabilidad",
  "cms",
  "reciclaje",
  "tarimas",
] as const;

export type ModuloLimpieza = (typeof MODULOS_LIMPIEZA)[number];

export const MODULO_LIMPIEZA_LABEL: Record<ModuloLimpieza, string> = {
  rrhh: "RRHH completo (incluye empleados y todos sus datos)",
  rrhh_planillas: "RRHH · Planillas / nómina",
  rrhh_vacaciones: "RRHH · Vacaciones y solicitudes",
  rrhh_marcajes: "RRHH · Marcajes y jornadas",
  rrhh_incidencias: "RRHH · Incidencias y evidencias",
  rrhh_descuentos: "RRHH · Descuentos y cuotas",
  rrhh_horas_extra: "RRHH · Horas extra y prestaciones",
  rrhh_inventario: "RRHH · Inventario y entregas",
  flota_kilometraje: "Flota · Limpiar kilometraje actual de todos los vehículos",
  flota: "Flota / Predios (vehículos, viajes, lecturas…)",
  operaciones: "Operaciones / TMS (planes, evidencias, catálogos)",
  contabilidad: "Contabilidad",
  cms: "Sitio Web (CMS)",
  reciclaje: "Reciclaje",
  tarimas: "Tarimas",
};

/** Qué NO se borra al limpiar cada módulo (para la UI). */
export const MODULO_LIMPIEZA_NOTA: Record<ModuloLimpieza, string> = {
  rrhh: "Borra todos los datos operativos de RRHH, incluidos empleados. No toca usuarios ni configuración.",
  rrhh_planillas: "Borra periodos y líneas de nómina. Conserva empleados, descuentos y horas extra; los deja disponibles para probar otra planilla.",
  rrhh_vacaciones: "Borra solicitudes, registros, consumos y saldos de vacaciones. Conserva empleados y las incidencias que no sean de vacaciones.",
  rrhh_marcajes: "Borra jornadas y marcajes en ruta. Conserva empleados, vacaciones e incidencias.",
  rrhh_incidencias: "Borra incidencias y sus evidencias/consumos. Conserva empleados, marcajes y saldos de vacaciones.",
  rrhh_descuentos: "Borra descuentos nuevos y heredados, cuotas y abonos. Conserva empleados, planillas e inventario; las entregas quedan sin descuento vinculado.",
  rrhh_horas_extra: "Borra registros de horas extra y prestaciones adicionales. Conserva empleados y planillas.",
  rrhh_inventario: "Borra entregas, movimientos y artículos del inventario RRHH. Conserva empleados y descuentos; se desvincula el origen de inventario.",
  flota_kilometraje: "Limpia únicamente el kilometraje actual de los vehículos propios de esta empresa. Conserva vehículos, viajes, lecturas y servicios históricos.",
  flota: "No toca RRHH, planes TMS, usuarios ni contabilidad.",
  operaciones: "No toca RRHH, Flota (viajes/vehículos), usuarios ni contabilidad.",
  contabilidad: "No toca RRHH, Flota ni TMS.",
  cms: "Solo secciones del sitio web de esa empresa.",
  reciclaje: "Solo lotes de reciclaje de esa empresa.",
  tarimas: "Solo órdenes de tarimas de esa empresa.",
};
