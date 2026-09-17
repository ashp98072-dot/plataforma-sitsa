import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { IGSS_LABORAL_PCT, redondearQ } from "./contratos-pago";
import { leerAntecedentesFiscalesTx } from "./fiscal-antecedentes";
import {
  calcularIsrTrabajo2026,
  type ConceptoIngresoIsr,
  type InputIsrTrabajo2026,
} from "./fiscal-isr-2026";
import { leerConceptosSnapshot, type PendientesPlanilla } from "./planilla-conceptos";

/**
 * RRHH-PLANILLAS-ISR-2026-INTEGRACION — adapter entre Planillas y el motor
 * puro `calcularIsrTrabajo2026` (mergeado por separado). El motor NO
 * consulta BD; este archivo es el ÚNICO lugar que sí lo hace para construir
 * su input, por empleado, dentro de la MISMA transacción/lock que ya usa
 * `generarLineasPeriodo`/`autorizarPeriodoPlanilla` (`bloquearPeriodosPlanilla`
 * ya bloquea TODOS los períodos de la empresa antes de llegar aquí, así que
 * las lecturas de este adapter están serializadas contra generaciones o
 * autorizaciones concurrentes de la misma empresa). Incluye antecedentes:
 * `leerAntecedentesFiscalesTx` usa la MISMA `conn` (nunca abre otra del
 * pool) — ver corrección de revisión externa, punto 1.
 *
 * Decisiones de diseño (documentadas aquí porque no hay configuración fiscal
 * de conceptos publicada todavía — ver docs/RRHH-PLANILLAS-DISENO-FISCAL-
 * MINIMO.md §3 y §9 — así que este adapter NO puede clasificar todo):
 *
 * 1. GRANULARIDAD: el cálculo fiscal corre a nivel MENSUAL equivalente
 *    (mismo nivel que el `isrMensual` que ya calcula `calcularISRMensual` en
 *    el motor viejo). El resultado (`retencionSugerida`) se entrega a
 *    `generarLineasPeriodo`, que sigue aplicando EXACTAMENTE el mismo
 *    reparto de quincenas (mitad en QUINCENA_1, conciliación contra QUINCENA_1
 *    persistida en QUINCENA_2) que ya existía — este adapter no toca esa
 *    lógica, solo reemplaza la FUENTE de `isrMensual` para el ejercicio 2026.
 *    `periodosRestantes` que se le pasa al motor es la cuenta de MESES
 *    restantes del ejercicio, incluyendo el mes del período actual.
 *
 * 2. CONCEPTOS CLASIFICADOS (sin inventar configuración):
 *    - `sueldo_base` (mensual contractual) → GRAVADO. Asentado, no está en
 *      discusión en el diseño (tabla §3: "Sueldo ordinario | Gravado").
 *    - horas extra del período (`horas_extra_registros`) → GRAVADO. También
 *      asentado en el diseño (tabla §3: "Horas extra | Gravado"). Son
 *      eventos puntuales del período, NO se proyectan a meses futuros.
 *    - `bono_incentivo` y `bono_herramientas` → PENDIENTE (bloquea) cuando
 *      son distintos de cero. El diseño marca bono incentivo "sujeto a
 *      revisión de criterio aplicable" y bono herramientas "pendiente de
 *      naturaleza" — NO están asentados, así que no se heredan del criterio
 *      implícito del motor viejo (que sí los suma como gravables) sin pasar
 *      por configuración fiscal versionada.
 *    - `rrhh_prestaciones` del período (tipo libre: aguinaldo, viáticos,
 *      "Otro", bonos variables...) → PENDIENTE (bloquea) cuando son
 *      distintas de cero. Texto libre sin clasificación posible sin
 *      configuración (diseño §3: "Otro / texto libre: Pendiente").
 *    - Cuotas/descuentos (rrhh_descuentos, cuotas de rrhh_descuentos_maestro)
 *      NO entran aquí: son descuentos de nómina, no ingreso ni deducción
 *      fiscal reconocida — quedan fuera del input fiscal por completo.
 *    En la práctica esto bloqueará la generación 2026 de cualquier empleado
 *    con bono_incentivo/bono_herramientas/prestaciones distintos de cero
 *    hasta que exista una configuración fiscal de conceptos publicada (PR
 *    aparte) — es el comportamiento pedido ("impedir cálculo automático
 *    para empleados con conceptos PENDIENTES"), documentado también en el
 *    reporte de este PR.
 *
 * 3. ACUMULADOS PROPIOS Y ANTI-DUPLICACIÓN DEL MES ACTUAL (corrección de
 *    revisión externa, punto 3): se leen TODAS las líneas de períodos de la
 *    MISMA empresa/empleado/ejercicio (por `YEAR(fecha_inicio)`, igual que
 *    `anioFiscal` en planillas.ts) que ya tienen `autorizado_en IS NOT NULL`,
 *    EXCLUYENDO el período actual. Cada línea se clasifica según si su
 *    período cae en el MISMO mes/año que el período actual o no:
 *    - Otros meses (pasados, ya cerrados): su sueldo (+bono/otros cuando el
 *      snapshot demuestre que fueron gravados, ver punto 4 más abajo) entra
 *      íntegro a `ingresosPropiosAcumulados` — ya ocurrió, no está en
 *      disputa.
 *    - MISMO mes/año que el actual (típicamente la QUINCENA_1 ya autorizada
 *      cuando se genera QUINCENA_2, o una QUINCENA_2 ya autorizada si se
 *      regenera QUINCENA_1 después): su SUELDO ya autorizado se resta del
 *      sueldo mensual completo antes de proyectar el resto del mes, en vez
 *      de sumarse dos veces (una como acumulado del mes, otra dentro de la
 *      proyección "mes actual + meses futuros"). Esto es intencionalmente
 *      genérico por `mes/año del período`, no por `tipoPeriodo`: cubre
 *      QUINCENA_1, QUINCENA_2, MENSUAL y ESPECIAL sin ramas especiales — un
 *      MENSUAL normalmente no comparte mes con ningún otro período
 *      autorizado, así que el descuento siempre da 0 y el comportamiento es
 *      exactamente el de antes (proyección = sueldo × meses restantes).
 *
 * 4. RECONSTRUCCIÓN HISTÓRICA — SOLO SUELDO SE ASUME GRAVADO SIN EVIDENCIA
 *    (corrección de revisión externa, punto 4): una línea autorizada
 *    ANTES de este PR (snapshot v1, sin `fiscal`) no demuestra que su
 *    bono_incentivo/bono_herramientas/otros_ingresos hayan sido evaluados
 *    bajo estas reglas — el motor viejo los sumaba todos como gravables sin
 *    distinción. Que esa planilla esté autorizada y congelada NO convierte
 *    retroactivamente esos montos en "gravado demostrado" para la
 *    proyección anual 2026. Por eso:
 *    - snapshot v2 (`fiscal` presente): la línea YA pasó por estas mismas
 *      reglas para poder autorizarse (bono/otros no clasificados habrían
 *      bloqueado en su momento) — se suma sueldo+bono+bonoHerramientas+
 *      otros íntegro como gravado, sin volver a evaluarlo.
 *    - snapshot v1 o ausente/ilegible: solo `sueldo_base` se incorpora como
 *      gravado (asentado, ver punto 2). Si esa línea histórica tiene
 *      bono_incentivo, bono_herramientas U otros_ingresos distintos de
 *      cero, BLOQUEA todo el cálculo — no se puede demostrar su
 *      clasificación fiscal, ni se le asigna una por herencia del motor
 *      viejo. La línea histórica en sí NUNCA se modifica: esto solo afecta
 *      si HOY se puede calcular automáticamente el período actual.
 *
 * 5. ANTECEDENTES: únicamente la última revisión CONFIRMADA de
 *    `rrhh_fiscal_empleado_ejercicio` (PR #282, vía `leerAntecedentesFiscalesTx`,
 *    misma conexión). Si no hay ninguna revisión confirmada, bloquea (no
 *    asume cero). Si la confirmada declara SIN_ANTECEDENTES, continúa con
 *    `antecedentes: null` en el input del motor (el motor ya modela ese
 *    caso).
 *
 * 6. IGSS PROYECTADO (corrección de revisión externa, punto 2): el IGSS
 *    laboral solo aplica sobre sueldo ordinario (misma base que ya usa
 *    `IGSS_LABORAL_PCT` en contratos-pago.ts/planillas.ts — "sin bono
 *    incentivo"). `igssLaboralPropio.proyectadoRestanteQ` se calcula sobre
 *    la MISMA proyección de sueldo ya anti-duplicada del punto 3 (nunca
 *    sobre `sueldo × mesesRestantes` sin ajustar), para no arrastrar el
 *    mismo doble conteo del mes actual al IGSS.
 *
 * 7. Outsourcing: igual que el motor viejo, nunca paga ISR — no pasa por
 *    este adapter en absoluto (ver planillas.ts).
 */

export class ErrorFiscalPlanilla2026 extends Error {}

function q(n: number): string {
  const v = redondearQ(n);
  // Evita "-0.00" cuando redondearQ produce cero negativo por cancelación de punto flotante.
  return (v === 0 ? 0 : v).toFixed(2);
}

/** Meses restantes del ejercicio, incluyendo el mes del período actual (1..12). */
function mesesRestantes(mes: number): number {
  return Math.max(1, 13 - mes);
}

function mesDelPeriodo(periodo: { mes: number | null; fechaInicio: string }): number {
  if (periodo.mes != null) return periodo.mes;
  const mes = Number(periodo.fechaInicio.slice(5, 7));
  return Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : new Date(periodo.fechaInicio).getUTCMonth() + 1;
}

export type EmpleadoFiscal2026 = {
  id: number;
  codigo: string;
  sueldo: number;
  bonoIncentivo: number;
  bonoHerramientas: number;
};

export type PeriodoFiscal2026 = { id: number; mes: number | null; fechaInicio: string };

export type ResultadoAdapterFiscal2026 = {
  input: InputIsrTrabajo2026;
  antecedenteRevision: number;
};

/**
 * Construye el input del motor puro para UN empleado en UN período,
 * leyendo únicamente lo estrictamente necesario dentro de la conexión ya
 * transaccionada/bloqueada del llamador. Lanza ErrorFiscalPlanilla2026 con
 * mensaje explícito ante cualquier condición de bloqueo (ver docblock del
 * archivo) — nunca "adivina" ni cae a cero silenciosamente.
 */
export async function construirInputFiscalEmpleado2026(
  conn: PoolConnection,
  empresaId: number,
  ejercicio: number,
  periodo: PeriodoFiscal2026,
  empleado: EmpleadoFiscal2026,
  pendientes: PendientesPlanilla,
): Promise<ResultadoAdapterFiscal2026> {
  const mes = mesDelPeriodo(periodo);
  if (mes < 1 || mes > 12) {
    throw new ErrorFiscalPlanilla2026(`No se pudo determinar el mes fiscal del período #${periodo.id}.`);
  }

  // 1) Antecedentes: SOLO la última revisión CONFIRMADA, misma conexión
  // transaccionada del llamador (nunca abre otra del pool).
  const antecedentesInfo = await leerAntecedentesFiscalesTx(conn, empresaId, empleado.id, ejercicio);
  const confirmada = antecedentesInfo.confirmada;
  if (!confirmada) {
    throw new ErrorFiscalPlanilla2026(
      `El empleado ${empleado.codigo} (#${empleado.id}) no tiene antecedentes fiscales ${ejercicio} confirmados. ` +
        "Captura y confirma sus antecedentes (o la declaración SIN_ANTECEDENTES) antes de generar la planilla.",
    );
  }
  const antecedentesMotor =
    confirmada.datos.declaracionAntecedentes === "SIN_ANTECEDENTES"
      ? null
      : {
          ingresosGravadosQ: confirmada.ingresosGravadosPrevios as string,
          ingresosExentosQ: confirmada.ingresosExentosPrevios as string,
          igssLaboralQ: confirmada.igssLaboralPrevio as string,
          isrRetenidoQ: confirmada.isrRetenidoPrevio as string,
        };

  // 2) Acumulados propios: períodos ya AUTORIZADOS del mismo ejercicio,
  // excluyendo el período actual (ver docblock, punto 3). Se traen mes/año
  // del período de cada línea para separar "mismo mes que el actual" (anti-
  // duplicación) de "otros meses" (acumulado íntegro), y el snapshot para
  // saber si esa línea ya pasó por estas reglas (v2) o es histórica (v1).
  const [prioRows] = await conn.query<RowDataPacket[]>(
    `SELECT l.sueldo_base, l.bono_incentivo, l.bono_herramientas, l.otros_ingresos, l.igss_laboral, l.isr,
            l.conceptos_snapshot, MONTH(p.fecha_inicio) AS mes_periodo, YEAR(p.fecha_inicio) AS anio_periodo
     FROM rrhh_planilla_lineas l
     INNER JOIN rrhh_planilla_periodos p ON p.id = l.periodo_id AND p.empresa_id = l.empresa_id
     WHERE l.empresa_id = ? AND l.id_empleado = ? AND p.autorizado_en IS NOT NULL
       AND YEAR(p.fecha_inicio) = ? AND p.id <> ?
     FOR UPDATE`,
    [empresaId, empleado.id, ejercicio, periodo.id],
  );
  let acumuladoGravado = 0;
  let acumuladoMesActualSueldo = 0;
  let acumuladoIsr = 0;
  let acumuladoIgss = 0;
  const bloqueantesHistorico: string[] = [];
  for (const r of prioRows) {
    // isr/igss ya retenidos son hechos, independientes de si el desglose
    // gravado/pendiente de esa línea histórica puede demostrarse.
    acumuladoIsr += Number(r.isr ?? 0);
    acumuladoIgss += Number(r.igss_laboral ?? 0);

    const sueldoHist = Number(r.sueldo_base ?? 0);
    const bonoHist = Number(r.bono_incentivo ?? 0);
    const bonoHerrHist = Number(r.bono_herramientas ?? 0);
    const otrosHist = Number(r.otros_ingresos ?? 0);

    let snapshotHist: ReturnType<typeof leerConceptosSnapshot> = null;
    try { snapshotHist = leerConceptosSnapshot(r.conceptos_snapshot); } catch { snapshotHist = null; }
    const esV2ConFiscal = snapshotHist?.version === 2 && snapshotHist.fiscal != null;

    if (!esV2ConFiscal && (bonoHist > 0.004 || bonoHerrHist > 0.004 || otrosHist > 0.004)) {
      bloqueantesHistorico.push(
        `Un período histórico ${ejercicio} del empleado ${empleado.codigo} (línea autorizada anterior a este motor) tiene ` +
          `bono incentivo/herramientas u otros ingresos por Q${q(bonoHist + bonoHerrHist + otrosHist)} sin clasificación ` +
          "fiscal 2026 demostrable. No se hereda la clasificación del cálculo anterior: requiere revisión antes de poder " +
          "calcular ISR automático de este período.",
      );
      continue;
    }
    const gravadoHist = esV2ConFiscal ? sueldoHist + bonoHist + bonoHerrHist + otrosHist : sueldoHist;
    acumuladoGravado += gravadoHist;
    if (Number(r.anio_periodo) === ejercicio && Number(r.mes_periodo) === mes) {
      acumuladoMesActualSueldo += sueldoHist;
    }
  }
  if (bloqueantesHistorico.length) {
    throw new ErrorFiscalPlanilla2026(
      `No se puede calcular el ISR 2026 automático del empleado ${empleado.codigo} (#${empleado.id}): ${bloqueantesHistorico.join(" ")}`,
    );
  }

  const ingresosPropiosAcumulados: ConceptoIngresoIsr[] = [];
  if (acumuladoGravado > 0.004) {
    ingresosPropiosAcumulados.push({
      id: "acumulado-historico",
      codigoConcepto: "ACUMULADO_HISTORICO",
      tratamiento: "GRAVADO",
      monto: q(acumuladoGravado),
      categoriaLimiteAnual: null,
    });
  }

  // 3) Proyección restante: sueldo mensual vigente, restando lo del mes
  // actual que YA quedó en acumulados (ver docblock, punto 3), más los
  // meses futuros completos; más los eventos puntuales de ESTE período
  // (horas extra gravadas, prestaciones libres pendientes de clasificar).
  const restantes = mesesRestantes(mes);
  const mesesFuturosCompletos = Math.max(0, 12 - mes);
  const sueldoRestanteMesActual = Math.max(0, empleado.sueldo - acumuladoMesActualSueldo);
  const proyeccionSueldoTotal = sueldoRestanteMesActual + empleado.sueldo * mesesFuturosCompletos;

  const bloqueantes: string[] = [];
  const proyectados: ConceptoIngresoIsr[] = [];

  if (proyeccionSueldoTotal > 0.004) {
    proyectados.push({
      id: "sueldo-mensual",
      codigoConcepto: "SUELDO_BASE",
      tratamiento: "GRAVADO",
      monto: q(proyeccionSueldoTotal),
      categoriaLimiteAnual: null,
    });
  }
  if (empleado.bonoIncentivo > 0.004) {
    bloqueantes.push(
      `Bono incentivo (Q${q(empleado.bonoIncentivo)}/mes) del empleado ${empleado.codigo} no tiene clasificación fiscal ` +
        "2026 publicada (PENDIENTE): sujeto a revisión de criterio aplicable, ver docs/RRHH-PLANILLAS-DISENO-FISCAL-MINIMO.md.",
    );
  }
  if (empleado.bonoHerramientas > 0.004) {
    bloqueantes.push(
      `Bono herramientas (Q${q(empleado.bonoHerramientas)}/mes) del empleado ${empleado.codigo} no tiene clasificación ` +
        "fiscal 2026 publicada (PENDIENTE): naturaleza pendiente de determinar.",
    );
  }
  for (const h of pendientes.horasExtra) {
    if (h.monto <= 0.004) continue;
    proyectados.push({
      id: `he-${h.id}`,
      codigoConcepto: "HORAS_EXTRA",
      tratamiento: "GRAVADO",
      monto: q(h.monto),
      categoriaLimiteAnual: null,
    });
  }
  for (const p of pendientes.prestacionesLegado) {
    if (p.monto <= 0.004) continue;
    bloqueantes.push(
      `Prestación "${p.concepto}" (Q${q(p.monto)}) del empleado ${empleado.codigo} no tiene clasificación fiscal 2026 ` +
        "publicada (PENDIENTE): concepto de texto libre, requiere clasificación explícita antes de calcular ISR automático.",
    );
  }
  if (bloqueantes.length) {
    throw new ErrorFiscalPlanilla2026(
      `No se puede calcular el ISR 2026 automático del empleado ${empleado.codigo} (#${empleado.id}): ${bloqueantes.join(" ")}`,
    );
  }

  // 4) IGSS laboral: acumulado real de períodos ya autorizados + proyectado
  // sobre la MISMA proyección de sueldo anti-duplicada de arriba (nunca
  // sobre bono/otros — misma base que ya usa IGSS_LABORAL_PCT en el resto
  // de Planillas).
  const igssProyectado = redondearQ(proyeccionSueldoTotal * IGSS_LABORAL_PCT);

  const input: InputIsrTrabajo2026 = {
    ejercicio,
    fechaCorte: periodo.fechaInicio,
    periodosRestantes: restantes,
    ingresosPropiosAcumulados,
    ingresosPropiosProyectadosRestantes: proyectados,
    limitesExencionAnual: [],
    antecedentes: antecedentesMotor,
    igssLaboralPropio: { acumuladoQ: q(acumuladoIgss), proyectadoRestanteQ: q(igssProyectado) },
    isrRetenidoPropioQ: q(acumuladoIsr),
    deduccionesAdicionalesAdmitidas: [],
  };

  return { input, antecedenteRevision: confirmada.revision };
}

/**
 * Recalcula el ISR 2026 de un empleado y devuelve el par (input, resultado)
 * listo para guardar en el snapshot o comparar contra uno guardado.
 */
export async function calcularFiscal2026Empleado(
  conn: PoolConnection,
  empresaId: number,
  ejercicio: number,
  periodo: PeriodoFiscal2026,
  empleado: EmpleadoFiscal2026,
  pendientes: PendientesPlanilla,
) {
  const { input, antecedenteRevision } = await construirInputFiscalEmpleado2026(
    conn, empresaId, ejercicio, periodo, empleado, pendientes,
  );
  const resultado = calcularIsrTrabajo2026(input);
  return { input, resultado, antecedenteRevision };
}
