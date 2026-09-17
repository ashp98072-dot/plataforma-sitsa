/**
 * RRHH-FISCAL-CONCEPTOS-2026 — configuración fiscal versionada de conceptos
 * de nómina para el ejercicio 2026, prevista en docs/RRHH-PLANILLAS-DISENO-
 * FISCAL-MINIMO.md §3 ("Clasificación de conceptos: configuración, no
 * renombrar prestaciones históricas").
 *
 * DECISIÓN DE DISEÑO — por qué es una constante de código y no una fila en
 * `configuracion`: el diseño original preveía claves
 * `rrhh.fiscal.conceptos.<ejercicio>.r<revision>` en la tabla `configuracion`
 * (empresa_id, parametro, valor), publicadas vía una UI que este PR NO
 * implementa (explícitamente fuera de alcance: "NO UI de configuración").
 * Sin esa UI no hay forma de que una empresa real publique esa fila sin
 * ejecutar SQL manual — y este PR tampoco puede ejecutar SQL. Publicar esta
 * configuración como una constante versionada de código (mismo patrón ya
 * aceptado para `PARAMETROS_ISR_2026` en fiscal-isr-2026.ts) desbloquea el
 * motor YA integrado sin depender de infraestructura que todavía no existe,
 * preservando el contrato (código estable, versión/revisión explícita,
 * fuente legal documentada por concepto) que pedía el diseño. Migrar esto a
 * `configuracion` con UI de publicación queda como trabajo futuro explícito
 * — no se inventa esa infraestructura aquí.
 *
 * FUENTES CONSULTADAS (no blogs como única fuente; se contrastaron varias
 * fuentes secundarias independientes y, cuando fue posible, el texto
 * oficial):
 * - Decreto 10-2012, Ley de Actualización Tributaria (LAT), Libro I, Título
 *   II "Rentas del trabajo en relación de dependencia":
 *   https://www.congreso.gob.gt/assets/uploads/info_legislativo/decretos/2012/010-2012.pdf
 *   (PDF oficial escaneado, no extraíble como texto en esta sesión — se
 *   contrastó contra múltiples fuentes secundarias convergentes, incluidas
 *   las ya vetadas en este repositorio por isr.ts y el diseño fiscal previo).
 *   - Art. 68 (hecho generador): toda retribución en dinero derivada del
 *     trabajo personal en relación de dependencia constituye renta del
 *     trabajo — incluye expresamente sueldos, bonificaciones, comisiones y
 *     viáticos no sujetos a liquidación/reintegro. Es una definición AMPLIA:
 *     todo lo no exceptuado expresamente por el Art. 70 se entiende gravado.
 *   - Art. 70 (rentas exentas), numerales 5 y 6: aguinaldo y Bono 14 exentos
 *     hasta el 100% del sueldo ordinario mensual; viáticos DENTRO y fuera
 *     del país exentos únicamente si están comprobados con facturas/
 *     documentación conforme a la legislación nacional — sin comprobar, no
 *     hay derecho a exención.
 *   - Art. 72: deducción personal anual Q48,000 sin necesidad de comprobar;
 *     crédito de IVA de planilla hasta Q12,000 (efecto Q600 en el impuesto).
 * - Decreto 13-2026 (Congreso de la República): deducción extraordinaria
 *   transitoria Q3,024, exclusiva del ejercicio 2026 — ya parametrizada en
 *   fiscal-isr-2026.ts, no se repite aquí.
 * - Decreto 78-89 y su reforma, Decreto 37-2001 (bonificación incentivo):
 *   crean/fijan la bonificación incentivo de Q250 mensuales. Tratamiento
 *   ASIMÉTRICO documentado en múltiples fuentes independientes convergentes:
 *   excluida de la base de cotización IGSS/IRTRA/INTECAP, pero SIN exención
 *   de ISR — no aparece en la lista taxativa del Art. 70 LAT, por lo que
 *   cae bajo la definición amplia del Art. 68 (bonificación = renta
 *   gravada).
 * - Decreto 76-78 (Ley Reguladora del Aguinaldo) y Decreto 42-92 (Ley de
 *   Bonificación Anual para Trabajadores del Sector Privado y Público,
 *   "Bono 14"): fijan la OBLIGATORIEDAD LABORAL y el monto de cada
 *   prestación (Bono 14 = 100% del sueldo ordinario mensual; aguinaldo
 *   anual). Estos decretos NO fijan el límite de exención FISCAL — ese
 *   límite lo fija el Art. 70 LAT (numerales 5/6, ver arriba). No confundir
 *   ambos.
 * - IGSS: base de cotización laboral/patronal. Fuentes secundarias
 *   consultadas coinciden en excluir bonificación incentivo, aguinaldo y
 *   Bono 14 de la base de cotización, e incluir comisiones. Para horas
 *   extra las fuentes consultadas se CONTRADICEN entre sí (unas afirman que
 *   cotiza, otras que no) — no se localizó en esta sesión el texto del
 *   Reglamento de Recaudación de Contribuciones del IGSS que resuelva la
 *   contradicción, así que horas extra queda `aplicaIgssLaboral: null`
 *   (pendiente), consistente con "no inventar". IRTRA/INTECAP: solo se
 *   confirmó independientemente la exclusión para bonificación incentivo
 *   (misma fuente que IGSS); para el resto de conceptos no se investigó lo
 *   suficiente en esta sesión — quedan `null` (pendiente), documentado
 *   explícitamente como gap, no como exención ni como inclusión asumida.
 *
 * IMPORTANTE: esta clasificación NO se conecta hoy a `rrhh_prestaciones`
 * (aguinaldo, Bono 14, viáticos, comisiones, bonos variables) porque esa
 * tabla solo tiene texto libre (`concepto`/`tipo`), sin código/origen
 * estable — conectar por coincidencia de texto sería fuzzy matching, que el
 * diseño prohíbe explícitamente. Esas entradas siguen bloqueando (PENDIENTE)
 * en planilla-fiscal-2026.ts hasta que exista una fuente con código/origen
 * estable (ver docs/RRHH-PLANILLAS-DISENO-FISCAL-MINIMO.md §3, "asignaciones
 * explícitas"). Lo que SÍ se conecta hoy, porque sí tiene columna propia y
 * estable en `empleados`, es `sueldo_base`, `bono_incentivo` y
 * `bono_herramientas` — ver planilla-fiscal-2026.ts.
 */

export const CONFIGURACION_CONCEPTOS_2026_EJERCICIO = 2026;
export const CONFIGURACION_CONCEPTOS_2026_REVISION = "2026.r1";

export const TRATAMIENTOS_ISR_CONCEPTO = ["GRAVADO", "EXENTO", "CONDICIONAL", "PENDIENTE"] as const;
export type TratamientoIsrConcepto = (typeof TRATAMIENTOS_ISR_CONCEPTO)[number];

export interface DefinicionConceptoFiscal2026 {
  codigo: string;
  tratamientoIsr: TratamientoIsrConcepto;
  /** Solo relevante si tratamientoIsr === "CONDICIONAL" y el límite es un tope de exención anual (p.ej. aguinaldo/Bono14). */
  categoriaLimiteAnual: string | null;
  /** true si requiere evidencia/documentación para resolver el tratamiento (p.ej. viáticos comprobables). */
  requiereEvidencia: boolean;
  /** null = pendiente de determinar (no investigado con suficiente rigor en esta sesión) — NUNCA se interpreta como "no aplica". */
  aplicaIgssLaboral: boolean | null;
  aplicaIgssPatronal: boolean | null;
  aplicaIrtra: boolean | null;
  aplicaIntecap: boolean | null;
  fuenteLegal: string;
  notas: string;
}

function def(d: DefinicionConceptoFiscal2026): DefinicionConceptoFiscal2026 {
  return d;
}

export const CONFIGURACION_CONCEPTOS_2026: Readonly<Record<string, DefinicionConceptoFiscal2026>> = {
  SUELDO_BASE: def({
    codigo: "SUELDO_BASE", tratamientoIsr: "GRAVADO", categoriaLimiteAnual: null, requiereEvidencia: false,
    aplicaIgssLaboral: true, aplicaIgssPatronal: true, aplicaIrtra: true, aplicaIntecap: true,
    fuenteLegal: "Decreto 10-2012 (LAT) Art. 68 — sueldo ordinario, base de la definición de renta del trabajo.",
    notas: "Asentado, sin controversia. Base de cotización IGSS/IRTRA/INTECAP estándar.",
  }),
  HORAS_EXTRA: def({
    codigo: "HORAS_EXTRA", tratamientoIsr: "GRAVADO", categoriaLimiteAnual: null, requiereEvidencia: false,
    aplicaIgssLaboral: null, aplicaIgssPatronal: null, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "Decreto 10-2012 (LAT) Art. 68 — remuneración en dinero derivada del trabajo, sin exención específica en Art. 70.",
    notas: "ISR gravado, asentado. IGSS/IRTRA/INTECAP: fuentes secundarias consultadas se CONTRADICEN entre sí "
      + "(unas afirman que sí cotiza, otras que no); no se localizó el Reglamento de Recaudación del IGSS con "
      + "certeza en esta sesión. Queda pendiente, no se asume ninguna de las dos posturas.",
  }),
  BONO_INCENTIVO: def({
    codigo: "BONO_INCENTIVO", tratamientoIsr: "GRAVADO", categoriaLimiteAnual: null, requiereEvidencia: false,
    aplicaIgssLaboral: false, aplicaIgssPatronal: false, aplicaIrtra: false, aplicaIntecap: false,
    fuenteLegal: "ISR: Decreto 10-2012 (LAT) Art. 68 (bonificaciones incluidas en el hecho generador) — el Art. 70 "
      + "no la incluye entre las exenciones taxativas, por lo que no goza de exención de ISR. "
      + "IGSS/IRTRA/INTECAP: Decreto 78-89, reformado por Decreto 37-2001 (creación y monto Q250 mensuales) — "
      + "excluida expresamente de la base de cotización de las tres cargas.",
    notas: "Tratamiento ASIMÉTRICO deliberado: gravada para ISR, exenta de IGSS/IRTRA/INTECAP. No mezclar ambas "
      + "conclusiones (ver ticket). Este es el concepto que desbloquea la generación 2026 en la práctica: por "
      + "defecto casi todo empleado formal tiene bono_incentivo = Q250.",
  }),
  BONO_HERRAMIENTAS: def({
    codigo: "BONO_HERRAMIENTAS", tratamientoIsr: "PENDIENTE", categoriaLimiteAnual: null, requiereEvidencia: true,
    aplicaIgssLaboral: null, aplicaIgssPatronal: null, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "Sin decreto ni criterio SAT específico localizado que regule un concepto llamado "
      + "\"bono herramientas\" como término de derecho guatemalteco (a diferencia de bonificación incentivo, "
      + "aguinaldo o Bono 14, que sí son figuras legales nombradas).",
    notas: "Se paga en el sistema como monto fijo mensual en efectivo, sin captura de evidencia de reintegro de "
      + "gastos reales — no se puede demostrar si es una compensación adicional (probablemente gravada bajo el "
      + "Art. 68, igual que bono incentivo) o un reintegro documentado de herramientas de trabajo (potencialmente "
      + "exento). No se inventa la clasificación: PENDIENTE, bloquea, requiere determinación explícita con "
      + "evidencia antes de publicar una revisión que lo resuelva.",
  }),
  AGUINALDO: def({
    codigo: "AGUINALDO", tratamientoIsr: "CONDICIONAL", categoriaLimiteAnual: "AGUINALDO", requiereEvidencia: false,
    aplicaIgssLaboral: false, aplicaIgssPatronal: false, aplicaIrtra: false, aplicaIntecap: false,
    fuenteLegal: "ISR: Decreto 10-2012 (LAT) Art. 70 numeral 5 — exento hasta el 100% del sueldo ordinario mensual; "
      + "el excedente es renta gravada bajo el Art. 68. Obligatoriedad laboral (no fiscal): Decreto 76-78. "
      + "IGSS/IRTRA/INTECAP: fuentes secundarias convergentes lo excluyen de la base de cotización.",
    notas: "Límite de exención ANUAL (100% de un sueldo ordinario mensual) — debe considerar pagos propios del "
      + "mismo ejercicio y antecedentes de otro patrono (ver motor puro, `limitesExencionAnual`/`categoriaLimiteAnual` "
      + "en fiscal-isr-2026.ts, ya soporta este mecanismo). NO conectado hoy a ninguna fuente de datos real: "
      + "`rrhh_prestaciones` es texto libre sin código estable (ver docblock del archivo). Configuración lista, "
      + "sin fuente de datos que la consuma todavía.",
  }),
  BONO_14: def({
    codigo: "BONO_14", tratamientoIsr: "CONDICIONAL", categoriaLimiteAnual: "BONO_14", requiereEvidencia: false,
    aplicaIgssLaboral: false, aplicaIgssPatronal: false, aplicaIrtra: false, aplicaIntecap: false,
    fuenteLegal: "ISR: Decreto 10-2012 (LAT) Art. 70 numeral 6 — exento hasta el 100% del sueldo ordinario mensual; "
      + "el excedente es renta gravada bajo el Art. 68. Obligatoriedad laboral (no fiscal): Decreto 42-92. "
      + "IGSS/IRTRA/INTECAP: fuentes secundarias convergentes lo excluyen de la base de cotización.",
    notas: "Mismo mecanismo de límite anual que AGUINALDO, categoría propia (no comparten el mismo tope: cada "
      + "prestación tiene su propio límite de un sueldo mensual). NO conectado hoy a ninguna fuente de datos real "
      + "— mismo motivo que AGUINALDO.",
  }),
  VIATICO_COMPROBABLE: def({
    codigo: "VIATICO_COMPROBABLE", tratamientoIsr: "CONDICIONAL", categoriaLimiteAnual: null, requiereEvidencia: true,
    aplicaIgssLaboral: false, aplicaIgssPatronal: false, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "Decreto 10-2012 (LAT) Art. 70 — viáticos dentro y fuera del país exentos únicamente cuando están "
      + "comprobados con facturas/documentación conforme a la legislación nacional; sin comprobación, no hay "
      + "derecho a exención.",
    notas: "Exento SOLO con evidencia válida — sin evidencia, no se asume exento ni gravado por defecto: bloquea "
      + "(requiereEvidencia=true) hasta que se documente. No confundir con VIATICO_NO_COMPROBABLE.",
  }),
  VIATICO_NO_COMPROBABLE: def({
    codigo: "VIATICO_NO_COMPROBABLE", tratamientoIsr: "GRAVADO", categoriaLimiteAnual: null, requiereEvidencia: false,
    aplicaIgssLaboral: null, aplicaIgssPatronal: null, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "Decreto 10-2012 (LAT) Art. 68/70 — un viático no comprobado no cumple los requisitos de "
      + "exención del Art. 70 y cae bajo la definición amplia de renta del trabajo del Art. 68.",
    notas: "IGSS/IRTRA/INTECAP no investigado con suficiente rigor en esta sesión para este concepto específico: pendiente.",
  }),
  COMISION: def({
    codigo: "COMISION", tratamientoIsr: "GRAVADO", categoriaLimiteAnual: null, requiereEvidencia: false,
    aplicaIgssLaboral: true, aplicaIgssPatronal: true, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "Decreto 10-2012 (LAT) Art. 68 — comisiones incluidas expresamente en la definición de renta del trabajo.",
    notas: "ISR e IGSS laboral/patronal gravados, corroborado por fuentes convergentes. IRTRA/INTECAP no investigado "
      + "con suficiente rigor: pendiente.",
  }),
  BONO_VARIABLE: def({
    codigo: "BONO_VARIABLE", tratamientoIsr: "GRAVADO", categoriaLimiteAnual: null, requiereEvidencia: false,
    aplicaIgssLaboral: null, aplicaIgssPatronal: null, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "Decreto 10-2012 (LAT) Art. 68 — retribución en dinero derivada del trabajo; el Art. 70 no "
      + "contempla ninguna exención genérica para bonos variables/discrecionales.",
    notas: "ISR gravado por la regla general de inclusión amplia del Art. 68. IGSS/IRTRA/INTECAP dependen de la "
      + "naturaleza real de cada bono (podría no ser \"salario\" en algunos casos) — no investigado con "
      + "suficiente rigor: pendiente, no se asume.",
  }),
  OTRO: def({
    codigo: "OTRO", tratamientoIsr: "PENDIENTE", categoriaLimiteAnual: null, requiereEvidencia: true,
    aplicaIgssLaboral: null, aplicaIgssPatronal: null, aplicaIrtra: null, aplicaIntecap: null,
    fuenteLegal: "N/A — concepto sin código/origen estable ni naturaleza determinada.",
    notas: "Siempre PENDIENTE por definición: un concepto de texto libre \"Otro\" no tiene fuente legal propia que "
      + "permita clasificarlo. Nunca se resuelve por heurística de texto (ver docblock del archivo).",
  }),
};

/**
 * Resuelve la definición fiscal de un concepto por su código estable. Si el
 * código no está en la configuración 2026, devuelve la definición de OTRO
 * (PENDIENTE, bloquea) — nunca "adivina" una clasificación para un código
 * desconocido. Lanza si se pide un ejercicio distinto de 2026: esta
 * configuración es exclusiva de 2026 y NO se reutiliza automáticamente para
 * otro ejercicio (cada ejercicio requiere su propia revisión, publicada por
 * separado, igual que ya exige PARAMETROS_ISR_2026 en fiscal-isr-2026.ts).
 */
export function resolverConceptoFiscal2026(codigo: string, ejercicio: number): DefinicionConceptoFiscal2026 {
  if (ejercicio !== CONFIGURACION_CONCEPTOS_2026_EJERCICIO) {
    throw new Error(
      `La configuración fiscal de conceptos ${CONFIGURACION_CONCEPTOS_2026_REVISION} es exclusiva del ejercicio ` +
        `${CONFIGURACION_CONCEPTOS_2026_EJERCICIO}. Ejercicio recibido: ${ejercicio}. No se reutiliza automáticamente.`,
    );
  }
  return CONFIGURACION_CONCEPTOS_2026[codigo] ?? CONFIGURACION_CONCEPTOS_2026.OTRO;
}
