import { z } from "zod";
import { montoFiscalSchema, centavosFiscales } from "./fiscal-modelo";

/**
 * RRHH-FISCAL-ISR-MOTOR-2026 — motor puro de ISR sobre rentas del trabajo en
 * relación de dependencia, ejercicio fiscal 2026 únicamente.
 *
 * Alcance deliberado de este archivo (ver docs/RRHH-PLANILLAS-DISENO-FISCAL-
 * MINIMO.md §4 y §10, PR 2 de la lista de PRs pequeños propuestos):
 * - Función pura y determinista: sin lectura de BD, sin `Date.now()`, sin
 *   aleatoriedad. Toda cifra de entrada llega ya resuelta por el llamador.
 * - NO clasifica conceptos por nombre libre ("Aguinaldo", "Bono14", "Otro"...).
 *   La clasificación fiscal (GRAVADO/EXENTO/CONDICIONAL/PENDIENTE) y, cuando
 *   aplica, la categoría de límite de exención anual, deben llegar ya
 *   resueltas en el input — la resolución por código/origen vive en
 *   `configuracion` (`rrhh.fiscal.conceptos.<ejercicio>.r<revision>`, ver
 *   diseño §3) y corresponde a un adapter/PR separado.
 * - NO integra con `rrhh_planilla_lineas`, no cambia `isr.ts` (usado hoy por
 *   la generación de planillas en producción), no ejecuta liquidaciones ni
 *   devoluciones.
 *
 * Fuentes oficiales usadas para los parámetros 2026 (mismas ya vetadas en
 * este repositorio, no blogs):
 * - Decreto 10-2012, Ley de Actualización Tributaria, Libro I (rentas del
 *   trabajo en relación de dependencia, tarifa del impuesto):
 *   https://s3-sa-east-1.amazonaws.com/guatemala/eregulations/Media/10-2012.pdf
 * - Decreto 13-2026 (Congreso de la República): deducción extraordinaria
 *   transitoria de Q3,024, aplicable EXCLUSIVAMENTE al ejercicio fiscal 2026:
 *   https://www.congreso.gob.gt/noticias_congreso/15892/2026/
 *   https://www.congreso.gob.gt/noticias_congreso/16364/2026/
 * - SAT, obligaciones del patrono como agente de retención de ISR sobre
 *   rentas del trabajo: https://portal.sat.gob.gt/portal/descarga/1817/
 *   orientacion-legal-y-derechos-de-contribuyentes/11575/obligaciones-
 *   tributarias-de-los-patronos-como-agentes-de-retencion-del-impuesto-
 *   sobre-la-renta-generado-por-rentas-del-trabajo-en-relacion-de-
 *   dependencia.pdf
 * - Acuerdo Gubernativo 213-2013, Reglamento del Libro I del Decreto 10-2012
 *   (procedimiento de proyección/retención del patrono):
 *   https://portal.sat.gob.gt/portal/descarga/1899/legislacion-tributaria/
 *   18250/acuerdo-gubernativo-numero-213-2013-reglamento-del-libro-i-de-la-
 *   ley-de-actualizacion-tributaria-decreto-numero-10-2012-del-congreso-de-
 *   la-republica-de-guatemala-que-establece-el-impuesto-sobre-la-r.pdf
 * - IGSS, cuota laboral 4.83% (Reglamento de recaudación, Acuerdo 1421):
 *   https://www.igssgt.org/noticias/2018/11/23/igss-este-es-el-nuevo-
 *   reglamento-sobre-recaudacion-de-contribuciones-al-regimen-de-seguridad-
 *   social/ — ya reflejado en `IGSS_LABORAL_PCT` de
 *   src/lib/rrhh/contratos-pago.ts (4.83%).
 *
 * Estas son las mismas fuentes que ya respaldan `src/lib/rrhh/isr.ts` (Q48,000
 * ordinaria, Q3,024 extraordinaria 2026, tramos 5%/7% sobre Q300,000) y el
 * documento de diseño. La verificación íntegra del texto promulgado de
 * 13-2026 y de la circunscripción/criterio SAT sigue pendiente según
 * docs/RRHH-PLANILLAS-DISENO-FISCAL-MINIMO.md §9.1 — este motor no resuelve
 * esa pendiente, solo implementa los parámetros ya vetados en el repositorio.
 */

// ---------------------------------------------------------------------------
// Parámetros 2026, versionados y explícitos. Nada de números mágicos en la
// lógica de cálculo: todo lo que dependa del ejercicio vive aquí.
// ---------------------------------------------------------------------------

export const PARAMETROS_ISR_2026 = {
  ejercicio: 2026,
  version: "2026.1",
  /** Deducción personal ordinaria anual. Decreto 10-2012 (LAT). */
  deduccionOrdinariaAnualQ: "48000.00",
  /**
   * Deducción extraordinaria transitoria — Decreto 13-2026, SOLO aplicable
   * al ejercicio fiscal 2026 (ver `ejercicio` arriba). No reutilizar en 2027.
   */
  deduccionExtraordinariaAnualQ: "3024.00",
  /** Cuota laboral IGSS, referencia informativa — el monto deducible llega ya calculado en el input. */
  igssLaboralPctReferencia: 0.0483,
  /**
   * Tramos del impuesto sobre renta imponible anual proyectada:
   * hasta Q300,000.00 → 5% plano; desde Q300,000.01 → Q15,000 + 7% sobre el
   * excedente de Q300,000.00 (continuo en el límite, sin salto).
   */
  tramos: {
    limiteTramoUnoQ: "300000.00",
    tasaTramoUnoPct: 5,
    baseTramoDosQ: "15000.00",
    tasaTramoDosPct: 7,
  },
  fuentes: [
    "Decreto 10-2012, Ley de Actualizacion Tributaria, Libro I (rentas del trabajo en relacion de dependencia, tarifa del impuesto).",
    "Decreto 13-2026, Congreso de la Republica: deduccion extraordinaria transitoria Q3,024, exclusiva del ejercicio fiscal 2026.",
    "Acuerdo Gubernativo 213-2013, Reglamento del Libro I del Decreto 10-2012: procedimiento de proyeccion/retencion del patrono.",
    "SAT: obligaciones tributarias de los patronos como agentes de retencion del ISR sobre rentas del trabajo.",
    "IGSS: cuota laboral 4.83% (Acuerdo 1421), reflejada en IGSS_LABORAL_PCT de contratos-pago.ts.",
  ],
} as const;

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

/**
 * Tratamiento fiscal de un concepto de ingreso PROPIO del ejercicio en
 * curso, ya resuelto por el llamador. Deliberadamente distinto del enum
 * `tratamiento` de fiscal-modelo.ts (ese es para ingresos declarados de
 * PATRONOS ANTERIORES, con semántica GRAVADO/EXENTO/CONDICIONAL/DESCONOCIDO
 * propia de una declaración externa). Aquí "PENDIENTE" representa un
 * concepto de esta empresa que todavía no tiene regla fiscal publicada.
 */
export const CONCEPTO_TRATAMIENTOS = ["GRAVADO", "EXENTO", "CONDICIONAL", "PENDIENTE"] as const;
export type ConceptoTratamientoIsr = (typeof CONCEPTO_TRATAMIENTOS)[number];

const conceptoIngresoSchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  codigoConcepto: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
  tratamiento: z.enum(CONCEPTO_TRATAMIENTOS),
  monto: montoFiscalSchema,
  /**
   * Solo relevante cuando `tratamiento === "EXENTO"` y la exención tiene
   * tope legal anual (p.ej. aguinaldo/Bono 14, limitado al equivalente del
   * salario ordinario mensual, Art. 4 LAT). El motor NO asume ni calcula
   * ese tope por nombre de concepto: el monto del tope llega en
   * `limitesExencionAnual`, resuelto externamente.
   */
  categoriaLimiteAnual: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/).nullable().optional(),
});
export type ConceptoIngresoIsr = z.infer<typeof conceptoIngresoSchema>;

const limiteExencionSchema = z.strictObject({
  categoria: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/),
  /** Tope legal anual de exención para esta categoría (Quetzales). */
  limiteQ: montoFiscalSchema,
  /**
   * Exención ya reconocida para esta categoría FUERA de este cálculo
   * (antecedentes de patrono anterior, ya conciliados). Reduce el
   * remanente disponible para no contabilizar el tope dos veces.
   */
  exencionExternaYaReconocidaQ: montoFiscalSchema,
});
export type LimiteExencionAnualIsr = z.infer<typeof limiteExencionSchema>;

const antecedentesSchema = z.strictObject({
  ingresosGravadosQ: montoFiscalSchema,
  ingresosExentosQ: montoFiscalSchema,
  igssLaboralQ: montoFiscalSchema,
  isrRetenidoQ: montoFiscalSchema,
});
export type AntecedentesIsrInput = z.infer<typeof antecedentesSchema>;

/**
 * Tipos de deducción adicional admisibles durante la PROYECCIÓN (este
 * motor). SAT distingue proyección de liquidación definitiva anual: la
 * deducción ordinaria (Q48,000), la extraordinaria 2026 (Q3,024) y el IGSS
 * laboral YA se aplican por separado (ver PARAMETROS_ISR_2026 e
 * `igssLaboralPropio`/`antecedentes.igssLaboralQ`); este enum cerrado es
 * SOLO para previsión social adicional legalmente admisible en la
 * proyección periódica. Donaciones, seguro de vida y la Planilla/crédito de
 * IVA se acreditan hasta la liquidación definitiva anual (Decreto 10-2012,
 * Reglamento 213-2013) y NO deben restarse mes a mes aquí — ese motor de
 * liquidación es un PR aparte, todavía no implementado. Ampliar esta lista
 * exige la misma verificación legal que el resto de PARAMETROS_ISR_2026.
 */
export const TIPOS_DEDUCCION_PROYECCION_2026 = ["PREVISION_SOCIAL_OTRA"] as const;
export type TipoDeduccionProyeccion2026 = (typeof TIPOS_DEDUCCION_PROYECCION_2026)[number];

/**
 * Tipos reconocidos que corresponden EXCLUSIVAMENTE a liquidación anual
 * definitiva, nunca a proyección. Solo se usan para dar un mensaje de
 * bloqueo más útil; cualquier tipo fuera de TIPOS_DEDUCCION_PROYECCION_2026
 * se bloquea igual, esté o no en esta lista (ver `validarTipoDeduccion`).
 */
const TIPOS_DEDUCCION_SOLO_LIQUIDACION_2026 = ["DONACION", "SEGURO_VIDA", "IVA_PLANILLA"] as const;

const deduccionAdmitidaSchema = z.strictObject({
  tipo: z.string().trim().min(1).max(80),
  /** Monto ya admitido (evaluación de comprobación/límite ocurrió antes de llegar aquí). */
  montoAdmitidoQ: montoFiscalSchema,
});
export type DeduccionAdmitidaIsr = z.infer<typeof deduccionAdmitidaSchema>;

const inputSchema = z.strictObject({
  ejercicio: z.number().int(),
  fechaCorte: z.iso.date(),
  /** Períodos de pago que faltan en el ejercicio (p.ej. quincenas/meses restantes). 0 = sin períodos para distribuir. */
  periodosRestantes: z.number().int().min(0).max(60),
  /** Ingresos propios ya percibidos/confirmados este ejercicio, por concepto. */
  ingresosPropiosAcumulados: z.array(conceptoIngresoSchema).max(500),
  /** Proyección ya resuelta por el llamador del resto del ejercicio, por concepto. */
  ingresosPropiosProyectadosRestantes: z.array(conceptoIngresoSchema).max(500),
  /** Topes de exención anual referenciados por `categoriaLimiteAnual`. */
  limitesExencionAnual: z.array(limiteExencionSchema).max(50).optional(),
  /** null = SIN_ANTECEDENTES confirmado o antecedentes no disponibles todavía; el motor no asume cero por defecto sin advertirlo. */
  antecedentes: antecedentesSchema.nullable(),
  igssLaboralPropio: z.strictObject({
    acumuladoQ: montoFiscalSchema,
    proyectadoRestanteQ: montoFiscalSchema,
  }),
  /** ISR ya retenido por ESTA empresa en el ejercicio, antes del período que se está calculando. */
  isrRetenidoPropioQ: montoFiscalSchema,
  /**
   * Deducciones adicionales ya admitidas para la PROYECCIÓN — `tipo` debe
   * estar en TIPOS_DEDUCCION_PROYECCION_2026 (validado en tiempo de
   * ejecución con error explícito; ver `validarTipoDeduccion`). NO enviar
   * aquí donaciones, seguro de vida ni Planilla IVA: corresponden a
   * liquidación anual definitiva, no a proyección.
   */
  deduccionesAdicionalesAdmitidas: z.array(deduccionAdmitidaSchema).max(50),
});
export type InputIsrTrabajo2026 = z.input<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface ResultadoIsrTrabajo2026 {
  ejercicio: 2026;
  rentaBrutaProyectada: string;
  rentaGravadaProyectada: string;
  rentaExenta: string;
  deduccionOrdinaria: string;
  deduccionExtraordinaria2026: string;
  igssDeducible: string;
  otrasDeduccionesAdmitidas: string;
  rentaImponible: string;
  isrAnual: string;
  isrRetenidoPrevio: string;
  isrRetenidoPropio: string;
  /** isrAnual - isrRetenidoPrevio - isrRetenidoPropio. Puede ser negativo. */
  saldoIsr: string;
  /** max(0, saldoIsr). Nunca negativo. */
  ajustePendiente: string;
  /** max(0, -saldoIsr). Informativo: este PR NO ejecuta la devolución. */
  posibleDevolucion: string;
  /** ajustePendiente / periodosRestantes, redondeado. Nunca negativo; 0 si no hay saldo o no quedan períodos. */
  retencionSugerida: string;
  parametrosRevision: { ejercicio: number; version: string; fuentes: readonly string[] };
  advertencias: string[];
}

// ---------------------------------------------------------------------------
// Errores explícitos — el motor nunca adivina.
// ---------------------------------------------------------------------------

export class ErrorMotorIsr2026 extends Error {
  constructor(message: string, public readonly codigo: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Dinero: centavos enteros (bigint) de principio a fin. Reutiliza
// `centavosFiscales` del modelo fiscal (PR #282) para la misma convención de
// parseo ya vigente en `fiscal-modelo.ts`/`fiscal-antecedentes.ts`.
// ---------------------------------------------------------------------------

function formatQ(centavos: bigint): string {
  const negativo = centavos < BigInt(0);
  const abs = negativo ? -centavos : centavos;
  const entero = abs / BigInt(100);
  const dec = abs % BigInt(100);
  return `${negativo ? "-" : ""}${entero.toString()}.${dec.toString().padStart(2, "0")}`;
}

/** División con redondeo half-up al centavo. Único punto donde se redondea antes del resultado final, porque la norma exige montos a 2 decimales. */
function redondearDivisionCentavos(numerador: bigint, denominador: bigint): bigint {
  if (denominador <= BigInt(0)) throw new ErrorMotorIsr2026("División inválida en el motor ISR (denominador <= 0).", "DIVISION_INVALIDA");
  const negativo = numerador < BigInt(0);
  const n = negativo ? -numerador : numerador;
  const cociente = n / denominador;
  const resto = n % denominador;
  const redondeado = resto * BigInt(2) >= denominador ? cociente + BigInt(1) : cociente;
  return negativo ? -redondeado : redondeado;
}

interface AcumuladorLimite {
  limiteC: bigint;
  usadoC: bigint;
}

function procesarConceptos(
  conceptos: ConceptoIngresoIsr[],
  limites: Map<string, AcumuladorLimite>,
  advertencias: string[],
): { gravadoC: bigint; exentoC: bigint } {
  let gravadoC = BigInt(0);
  let exentoC = BigInt(0);
  for (const c of conceptos) {
    if (c.tratamiento === "PENDIENTE" || c.tratamiento === "CONDICIONAL") {
      throw new ErrorMotorIsr2026(
        `El concepto "${c.codigoConcepto}" (id ${c.id}) no tiene clasificación fiscal firme (${c.tratamiento}). ` +
          "El motor no puede adivinar: clasifique el concepto antes de calcular.",
        "CONCEPTO_SIN_CLASIFICAR",
      );
    }
    const montoC = centavosFiscales(c.monto);
    if (c.tratamiento === "GRAVADO") {
      gravadoC += montoC;
      continue;
    }
    // EXENTO desde aquí.
    if (!c.categoriaLimiteAnual) {
      exentoC += montoC;
      continue;
    }
    const limite = limites.get(c.categoriaLimiteAnual);
    if (!limite) {
      throw new ErrorMotorIsr2026(
        `Falta el límite de exención anual para la categoría "${c.categoriaLimiteAnual}" requerida por el concepto "${c.codigoConcepto}" (id ${c.id}).`,
        "LIMITE_EXENCION_FALTANTE",
      );
    }
    const remanenteC = limite.limiteC - limite.usadoC;
    const exentoAplicadoC = remanenteC > BigInt(0) ? (montoC < remanenteC ? montoC : remanenteC) : BigInt(0);
    const gravadoAplicadoC = montoC - exentoAplicadoC;
    limite.usadoC += exentoAplicadoC;
    exentoC += exentoAplicadoC;
    gravadoC += gravadoAplicadoC;
    if (gravadoAplicadoC > BigInt(0)) {
      advertencias.push(
        `El concepto "${c.codigoConcepto}" (id ${c.id}) superó el límite de exención anual de la categoría "${c.categoriaLimiteAnual}"; ` +
          `Q${formatQ(gravadoAplicadoC)} del monto se trató como gravado.`,
      );
    }
  }
  return { gravadoC, exentoC };
}

/**
 * Bloquea cualquier deducción que no esté en TIPOS_DEDUCCION_PROYECCION_2026.
 * Motor SOLO PROYECCION: donaciones, seguro de vida y Planilla IVA
 * corresponden a liquidación anual definitiva (otro PR, no implementado
 * aquí) y nunca deben restarse mes a mes en la proyección.
 */
function validarTipoDeduccion(d: DeduccionAdmitidaIsr): void {
  if ((TIPOS_DEDUCCION_PROYECCION_2026 as readonly string[]).includes(d.tipo)) return;
  const esDeLiquidacion = (TIPOS_DEDUCCION_SOLO_LIQUIDACION_2026 as readonly string[]).includes(d.tipo);
  throw new ErrorMotorIsr2026(
    `La deducción "${d.tipo}" no es admisible en la PROYECCIÓN de ISR 2026.` +
      (esDeLiquidacion
        ? " Corresponde a la liquidación definitiva anual, no a la proyección periódica; ese motor es un PR aparte."
        : ` Tipos admitidos en proyección: ${TIPOS_DEDUCCION_PROYECCION_2026.join(", ")}.`),
    "DEDUCCION_NO_ADMITIDA_EN_PROYECCION",
  );
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

/**
 * calcularIsrTrabajo2026 — función pura y determinista. No lee BD, no usa
 * Date.now(), no muta el input. Misma entrada siempre produce la misma
 * salida.
 */
export function calcularIsrTrabajo2026(rawInput: unknown): ResultadoIsrTrabajo2026 {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ErrorMotorIsr2026(
      `Entrada inválida para el motor ISR 2026: ${parsed.error.issues[0]?.message ?? "estructura no reconocida"}.`,
      "ENTRADA_INVALIDA",
    );
  }
  const input = parsed.data;

  if (input.ejercicio !== 2026) {
    throw new ErrorMotorIsr2026(
      `Este motor solo calcula parámetros del ejercicio 2026. Ejercicio recibido: ${input.ejercicio}. ` +
        "Un ejercicio distinto requiere su propia función versionada con parámetros propios (ver PARAMETROS_ISR_2026).",
      "EJERCICIO_NO_SOPORTADO",
    );
  }

  const limites = new Map<string, AcumuladorLimite>();
  for (const l of input.limitesExencionAnual ?? []) {
    if (limites.has(l.categoria)) {
      throw new ErrorMotorIsr2026(`Límite de exención duplicado para la categoría "${l.categoria}".`, "LIMITE_DUPLICADO");
    }
    limites.set(l.categoria, {
      limiteC: centavosFiscales(l.limiteQ),
      usadoC: centavosFiscales(l.exencionExternaYaReconocidaQ),
    });
  }

  const advertencias: string[] = [];

  // Acumulados antes que proyectados: consumen el remanente de los topes de
  // exención primero, en el orden cronológico natural (lo ya percibido).
  const acumulados = procesarConceptos(input.ingresosPropiosAcumulados, limites, advertencias);
  const proyectados = procesarConceptos(input.ingresosPropiosProyectadosRestantes, limites, advertencias);

  const antecedentes = input.antecedentes;
  if (!antecedentes) {
    advertencias.push(
      "No se recibieron antecedentes fiscales confirmados; el cálculo solo considera ingresos de esta empresa. " +
        "Confirme antecedentes (o la declaración SIN_ANTECEDENTES) antes de usar este resultado para autorizar retención.",
    );
  }
  const antecedentesGravadoC = antecedentes ? centavosFiscales(antecedentes.ingresosGravadosQ) : BigInt(0);
  const antecedentesExentoC = antecedentes ? centavosFiscales(antecedentes.ingresosExentosQ) : BigInt(0);
  const antecedentesIgssC = antecedentes ? centavosFiscales(antecedentes.igssLaboralQ) : BigInt(0);
  const antecedentesIsrRetenidoC = antecedentes ? centavosFiscales(antecedentes.isrRetenidoQ) : BigInt(0);

  const rentaGravadaC = acumulados.gravadoC + proyectados.gravadoC + antecedentesGravadoC;
  const rentaExentaC = acumulados.exentoC + proyectados.exentoC + antecedentesExentoC;
  const rentaBrutaC = rentaGravadaC + rentaExentaC;

  const deduccionOrdinariaC = centavosFiscales(PARAMETROS_ISR_2026.deduccionOrdinariaAnualQ);
  const deduccionExtraordinariaC = centavosFiscales(PARAMETROS_ISR_2026.deduccionExtraordinariaAnualQ);
  const igssDeducibleC =
    centavosFiscales(input.igssLaboralPropio.acumuladoQ) +
    centavosFiscales(input.igssLaboralPropio.proyectadoRestanteQ) +
    antecedentesIgssC;
  for (const d of input.deduccionesAdicionalesAdmitidas) validarTipoDeduccion(d);
  const otrasDeduccionesC = input.deduccionesAdicionalesAdmitidas.reduce(
    (sum, d) => sum + centavosFiscales(d.montoAdmitidoQ),
    BigInt(0),
  );

  const deduccionesTotalesC = deduccionOrdinariaC + deduccionExtraordinariaC + igssDeducibleC + otrasDeduccionesC;
  const rentaImponibleC = rentaGravadaC > deduccionesTotalesC ? rentaGravadaC - deduccionesTotalesC : BigInt(0);

  const limiteTramoUnoC = centavosFiscales(PARAMETROS_ISR_2026.tramos.limiteTramoUnoQ);
  let isrAnualC: bigint;
  if (rentaImponibleC <= limiteTramoUnoC) {
    isrAnualC = redondearDivisionCentavos(rentaImponibleC * BigInt(PARAMETROS_ISR_2026.tramos.tasaTramoUnoPct), BigInt(100));
  } else {
    const excedenteC = rentaImponibleC - limiteTramoUnoC;
    const baseC = centavosFiscales(PARAMETROS_ISR_2026.tramos.baseTramoDosQ);
    isrAnualC = baseC + redondearDivisionCentavos(excedenteC * BigInt(PARAMETROS_ISR_2026.tramos.tasaTramoDosPct), BigInt(100));
  }

  const isrRetenidoPrevioC = antecedentesIsrRetenidoC;
  const isrRetenidoPropioC = centavosFiscales(input.isrRetenidoPropioQ);
  const saldoC = isrAnualC - isrRetenidoPrevioC - isrRetenidoPropioC;
  const ajustePendienteC = saldoC > BigInt(0) ? saldoC : BigInt(0);
  const posibleDevolucionC = saldoC < BigInt(0) ? -saldoC : BigInt(0);

  let retencionSugeridaC = BigInt(0);
  if (ajustePendienteC > BigInt(0)) {
    if (input.periodosRestantes > 0) {
      retencionSugeridaC = redondearDivisionCentavos(ajustePendienteC, BigInt(input.periodosRestantes));
    } else {
      advertencias.push(
        "Hay saldo de ISR pendiente pero no quedan períodos restantes en el ejercicio. " +
          "Este motor no ejecuta liquidaciones: requiere un evento de liquidación en otro módulo.",
      );
    }
  }
  if (posibleDevolucionC > BigInt(0)) {
    advertencias.push(
      "El cálculo proyecta una posible devolución/ajuste a favor del empleado. " +
        "Este motor no ejecuta devoluciones, solo informa el monto (posibleDevolucion).",
    );
  }

  return {
    ejercicio: 2026,
    rentaBrutaProyectada: formatQ(rentaBrutaC),
    rentaGravadaProyectada: formatQ(rentaGravadaC),
    rentaExenta: formatQ(rentaExentaC),
    deduccionOrdinaria: formatQ(deduccionOrdinariaC),
    deduccionExtraordinaria2026: formatQ(deduccionExtraordinariaC),
    igssDeducible: formatQ(igssDeducibleC),
    otrasDeduccionesAdmitidas: formatQ(otrasDeduccionesC),
    rentaImponible: formatQ(rentaImponibleC),
    isrAnual: formatQ(isrAnualC),
    isrRetenidoPrevio: formatQ(isrRetenidoPrevioC),
    isrRetenidoPropio: formatQ(isrRetenidoPropioC),
    saldoIsr: formatQ(saldoC),
    ajustePendiente: formatQ(ajustePendienteC),
    posibleDevolucion: formatQ(posibleDevolucionC),
    retencionSugerida: formatQ(retencionSugeridaC),
    parametrosRevision: {
      ejercicio: PARAMETROS_ISR_2026.ejercicio,
      version: PARAMETROS_ISR_2026.version,
      fuentes: PARAMETROS_ISR_2026.fuentes,
    },
    advertencias,
  };
}
