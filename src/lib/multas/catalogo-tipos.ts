/**
 * SIMPLIFICAR FORMULARIO DE MULTAS + CATÁLOGO PREDEFINIDO — catálogo
 * ÚNICO y reutilizable de tipos de multa, agrupado por categoría (select
 * con <optgroup> en el formulario). Fuente central: nunca duplicar este
 * arreglo en otro componente.
 *
 * `tipo_multa` (backend, reglas.ts) sigue siendo `texto(120)` libre — no
 * se agrega un enum en el schema ni en la base de datos. Este catálogo es
 * la única fuente que RESTRINGE lo que el formulario puede enviar (vía el
 * <select>), pero el backend sigue aceptando cualquier string no vacío —
 * así los registros históricos (con texto libre que no está en este
 * catálogo) siguen siendo válidos y no requieren conversión.
 */

export type OpcionTipoMulta = { value: string; label: string };
export type CategoriaMulta = { categoria: string; opciones: OpcionTipoMulta[] };

export const CATALOGO_TIPOS_MULTA: CategoriaMulta[] = [
  {
    categoria: "Conducción",
    opciones: [
      { value: "EXCESO_VELOCIDAD", label: "Exceso de velocidad" },
      { value: "VIRAR_LUGAR_NO_PERMITIDO", label: "Virar en lugar no permitido" },
      { value: "VUELTA_U_NO_PERMITIDA", label: "Vuelta en U no permitida" },
      { value: "CAMBIO_CARRIL_INDEBIDO", label: "Cambio de carril indebido" },
      { value: "REBASE_INDEBIDO", label: "Rebase / adelantamiento indebido" },
      { value: "NO_RESPETAR_PRIORIDAD", label: "No respetar prioridad o derecho de vía" },
      { value: "NO_UTILIZAR_DIRECCIONAL", label: "No utilizar señal de giro / maniobra" },
      { value: "MANIOBRA_PELIGROSA", label: "Maniobra peligrosa" },
      { value: "CONDUCCION_IMPRUDENTE", label: "Conducción imprudente" },
    ],
  },
  {
    categoria: "Señalización y circulación",
    opciones: [
      { value: "SEMAFORO_SENAL_TRANSITO", label: "Semáforo / señal de tránsito" },
      { value: "CIRCULACION_RESTRINGIDA", label: "Circulación en lugar restringido" },
      { value: "ESTACIONAMIENTO_INDEBIDO", label: "Estacionamiento indebido" },
      { value: "OBSTRUCCION_VIA", label: "Obstrucción de la vía" },
    ],
  },
  {
    categoria: "Documentación",
    opciones: [
      { value: "DOCUMENTACION_VEHICULO", label: "Documentación del vehículo" },
      { value: "LICENCIA_DOCUMENTACION_PILOTO", label: "Licencia / documentación del piloto" },
      { value: "TARJETA_CIRCULACION", label: "Tarjeta de circulación" },
      { value: "PLACAS", label: "Placas" },
      { value: "SEGURO", label: "Seguro" },
    ],
  },
  {
    categoria: "Carga / transporte pesado",
    opciones: [
      { value: "SOBREPESO", label: "Sobrepeso" },
      { value: "DESBALANCE_CARGA", label: "Desbalance de carga" },
      { value: "CARGA_SOBREDIMENSIONADA", label: "Dimensiones / carga sobredimensionada" },
      { value: "CARGA_MAL_ASEGURADA", label: "Carga mal asegurada" },
      { value: "NO_PASAR_PESAJE", label: "No pasar por puesto de control o pesaje" },
    ],
  },
  {
    categoria: "Vehículo",
    opciones: [
      { value: "VEHICULO_NO_REGLAMENTARIO", label: "Vehículo en condiciones no reglamentarias" },
      { value: "USO_INDEBIDO_LUCES_SENALES", label: "Uso indebido de luces / señales auditivas" },
    ],
  },
  {
    categoria: "Incidentes",
    opciones: [
      { value: "ACCIDENTE_INCIDENTE_VIAL", label: "Accidente / incidente vial" },
      { value: "DANO_INFRAESTRUCTURA", label: "Daño a infraestructura" },
    ],
  },
  {
    categoria: "Otros",
    opciones: [
      { value: "INCUMPLIMIENTO_RUTA_NORMATIVA", label: "Incumplimiento de ruta o normativa" },
      { value: "OTRA", label: "Otra" },
    ],
  },
];

/** Valor especial: exige "Detalle adicional" (ver requiereDetalleAdicional). */
export const TIPO_MULTA_OTRA = "OTRA";

/** Lista plana [{value,label}] — para buscar por value sin recorrer categorías a mano. */
export const OPCIONES_TIPO_MULTA: OpcionTipoMulta[] = CATALOGO_TIPOS_MULTA.flatMap((c) => c.opciones);

/**
 * Etiqueta visible para un `tipo_multa` guardado (código del catálogo o
 * texto histórico libre). Nunca convierte ni sobrescribe: si el valor no
 * está en el catálogo actual (multa histórica, o un tipo retirado del
 * catálogo en el futuro), se muestra el valor guardado tal cual.
 */
export function labelDeTipoMulta(valor: string): string {
  return OPCIONES_TIPO_MULTA.find((o) => o.value === valor)?.label ?? valor;
}

/**
 * Regla combinada (Fase "REGLA OTRA" + "REGLA NO_APLICA" del ticket):
 * el campo único "Detalle adicional" es obligatorio si el tipo elegido es
 * "OTRA" o si la resolución económica es "NO_APLICA" — nunca los dos
 * campos separados que existían antes (Descripción / Observaciones).
 */
export function requiereDetalleAdicional(tipoMulta: string, resolucionEconomica: string): boolean {
  return tipoMulta === TIPO_MULTA_OTRA || resolucionEconomica === "NO_APLICA";
}

/**
 * Mensaje de validación del formulario — null si no hay error. Cuando el
 * tipo es "OTRA" se prioriza ese mensaje (más específico: pide describir
 * la infracción) aunque también aplique NO_APLICA.
 */
export function validarDetalleAdicional(
  tipoMulta: string,
  resolucionEconomica: string,
  detalleAdicional: string,
): string | null {
  if (detalleAdicional.trim()) return null;
  if (tipoMulta === TIPO_MULTA_OTRA) return "Describe el tipo de multa.";
  if (resolucionEconomica === "NO_APLICA") return "Indica por qué no aplica resolución económica.";
  return null;
}
