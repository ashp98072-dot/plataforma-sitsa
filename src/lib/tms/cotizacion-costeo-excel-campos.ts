/** Campos aditivos Excel 2026. NULL = sin configurar; no se inventan costos. */
export const CAMPOS_EXCEL_PARAMETROS = [
  {
    "key": "seguroMercaderiaAnual",
    "col": "seguro_mercaderia_anual",
    "type": "DECIMAL(14,2)",
    "label": "Seguro mercadería anual",
    "group": "Seguros"
  },
  {
    "key": "cantidadCamiones",
    "col": "cantidad_camiones",
    "type": "INT",
    "label": "Cantidad de camiones/flota",
    "group": "Prorrateo"
  },
  {
    "key": "viajesAnuales",
    "col": "viajes_anuales",
    "type": "DECIMAL(10,2)",
    "label": "Viajes estimados anuales",
    "group": "Prorrateo"
  },
  {
    "key": "diasDepreciacionMes",
    "col": "dias_depreciacion_mes",
    "type": "DECIMAL(5,2)",
    "label": "Días operativos depreciación",
    "group": "Prorrateo"
  },
  {
    "key": "diasGastosMes",
    "col": "dias_gastos_mes",
    "type": "DECIMAL(5,2)",
    "label": "Días operativos gastos",
    "group": "Prorrateo"
  },
  {
    "key": "gastosAdministracion",
    "col": "gastos_administracion",
    "type": "DECIMAL(14,2)",
    "label": "Gastos administración",
    "group": "Gastos globales"
  },
  {
    "key": "gastosMantenimiento",
    "col": "gastos_mantenimiento",
    "type": "DECIMAL(14,2)",
    "label": "Gastos mantenimiento",
    "group": "Gastos globales"
  },
  {
    "key": "gastosSeguridad",
    "col": "gastos_seguridad",
    "type": "DECIMAL(14,2)",
    "label": "Seguridad",
    "group": "Gastos globales"
  },
  {
    "key": "gastosPredios",
    "col": "gastos_predios",
    "type": "DECIMAL(14,2)",
    "label": "Predios",
    "group": "Gastos globales"
  },
  {
    "key": "diasLaboralesMes",
    "col": "dias_laborales_mes",
    "type": "DECIMAL(5,2)",
    "label": "Días laborales salarios",
    "group": "Personal"
  }
] as const;
export const CAMPOS_EXCEL_PERFIL = [
  {
    "key": "viajesMes",
    "col": "viajes_mes",
    "type": "DECIMAL(10,2)",
    "label": "Viajes estimados mensuales",
    "group": "Operación"
  },
  {
    "key": "precioLlanta",
    "col": "precio_llanta",
    "type": "DECIMAL(12,2)",
    "label": "Precio por llanta",
    "group": "Mantenimiento"
  },
  {
    "key": "cantidadLlantas",
    "col": "cantidad_llantas",
    "type": "INT",
    "label": "Cantidad de llantas",
    "group": "Mantenimiento"
  },
  {
    "key": "salarioPilotoMensual",
    "col": "salario_piloto_mensual",
    "type": "DECIMAL(12,2)",
    "label": "Salario piloto mensual",
    "group": "Personal"
  },
  {
    "key": "salarioAuxiliarMensual",
    "col": "salario_auxiliar_mensual",
    "type": "DECIMAL(12,2)",
    "label": "Salario auxiliar mensual",
    "group": "Personal"
  }
] as const;
export type ParametrosExcel = {
  seguroMercaderiaAnual?: number | null;
  cantidadCamiones?: number | null;
  viajesAnuales?: number | null;
  diasDepreciacionMes?: number | null;
  diasGastosMes?: number | null;
  gastosAdministracion?: number | null;
  gastosMantenimiento?: number | null;
  gastosSeguridad?: number | null;
  gastosPredios?: number | null;
  diasLaboralesMes?: number | null;
};
export type PerfilExcel = {
  salarioPilotoMensual?: number | null;
  salarioAuxiliarMensual?: number | null;
  viajesMes?: number | null;
  precioLlanta?: number | null;
  cantidadLlantas?: number | null;
};
export function mapCamposExcel<T extends {key:string;col:string}>(r: Record<string, unknown>, campos: readonly T[]): Record<T["key"], number | null> {
  return Object.fromEntries(campos.map(c => [c.key, r[c.col] == null ? null : Number(r[c.col])])) as Record<T["key"], number | null>;
}
