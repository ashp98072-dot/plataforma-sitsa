import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { redondearQ } from "./contratos-pago";
import { leerAntecedentesFiscales } from "./fiscal-antecedentes";
import {
  calcularIsrTrabajo2026,
  type ConceptoIngresoIsr,
  type InputIsrTrabajo2026,
} from "./fiscal-isr-2026";
import type { PendientesPlanilla } from "./planilla-conceptos";

/**
 * RRHH-PLANILLAS-ISR-2026-INTEGRACION — adapter entre Planillas y el motor
 * puro `calcularIsrTrabajo2026` (mergeado por separado). El motor NO
 * consulta BD; este archivo es el ÚNICO lugar que sí lo hace para construir
 * su input, por empleado, dentro de la MISMA transacción/lock que ya usa
 * `generarLineasPeriodo`/`autorizarPeriodoPlanilla` (`bloquearPeriodosPlanilla`
 * ya bloquea TODOS los períodos de la empresa antes de llegar aquí, así que
 * las lecturas de este adapter están serializadas contra generaciones o
 * autorizaciones concurrentes de la misma empresa).
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
 * 3. ACUMULADOS PROPIOS: se agregan en UN solo concepto GRAVADO ("ya
 *    ocurrió, ya se retuvo, no está en disputa") sumando sueldo_base +
 *    bono_incentivo + bono_herramientas + otros_ingresos de TODAS las
 *    líneas de períodos de la MISMA empresa/empleado/ejercicio (por
 *    `YEAR(fecha_inicio)`, igual que `anioFiscal` en planillas.ts) que ya
 *    tienen `autorizado_en IS NOT NULL`, EXCLUYENDO el período actual — así
 *    nunca aparece a la vez como acumulado y como proyección, y un
 *    borrador/regenerado nunca cuenta como retención ya ejecutada. No se
 *    reclasifica esa historia por concepto: ya fue gravada bajo lo que
 *    estuviera vigente cuando se autorizó.
 *
 * 4. PROYECCIÓN RESTANTE: sueldo/bono_incentivo/bono_herramientas
 *    contractuales MENSUALES del empleado × meses restantes del ejercicio
 *    (incluyendo el mes actual) — asume que la condición salarial vigente
 *    HOY se mantiene el resto del año (misma hipótesis que ya usaba
 *    implícitamente el motor viejo, que aplicaba el mismo `isrMensual` mes
 *    tras mes hasta la siguiente regeneración). Un alta a mitad de año o un
 *    cambio salarial no necesitan caso especial: los acumulados reflejan
 *    solo períodos que realmente existen y están autorizados, y la
 *    proyección siempre usa el sueldo VIGENTE ahora.
 *
 * 5. ANTECEDENTES: únicamente la última revisión CONFIRMADA de
 *    `rrhh_fiscal_empleado_ejercicio` (PR #282, `leerAntecedentesFiscales`).
 *    Si no hay ninguna revisión confirmada, bloquea (no asume cero). Si la
 *    confirmada declara SIN_ANTECEDENTES, continúa con `antecedentes: null`
 *    en el input del motor (el motor ya modela ese caso).
 *
 * 6. Outsourcing: igual que el motor viejo, nunca paga ISR — no pasa por
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

  // 1) Antecedentes: SOLO la última revisión CONFIRMADA.
  const antecedentesInfo = await leerAntecedentesFiscales(empresaId, empleado.id, ejercicio);
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
  // excluyendo el período actual (ver docblock, punto 3).
  const [prioRows] = await conn.query<RowDataPacket[]>(
    `SELECT l.sueldo_base, l.bono_incentivo, l.bono_herramientas, l.otros_ingresos, l.igss_laboral, l.isr
     FROM rrhh_planilla_lineas l
     INNER JOIN rrhh_planilla_periodos p ON p.id = l.periodo_id AND p.empresa_id = l.empresa_id
     WHERE l.empresa_id = ? AND l.id_empleado = ? AND p.autorizado_en IS NOT NULL
       AND YEAR(p.fecha_inicio) = ? AND p.id <> ?
     FOR UPDATE`,
    [empresaId, empleado.id, ejercicio, periodo.id],
  );
  let acumuladoGravado = 0;
  let acumuladoIsr = 0;
  let acumuladoIgss = 0;
  for (const r of prioRows) {
    acumuladoGravado += Number(r.sueldo_base ?? 0) + Number(r.bono_incentivo ?? 0) + Number(r.bono_herramientas ?? 0) + Number(r.otros_ingresos ?? 0);
    acumuladoIsr += Number(r.isr ?? 0);
    acumuladoIgss += Number(r.igss_laboral ?? 0);
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

  // 3) Proyección restante: concepto actual + resto del ejercicio (ver
  // docblock, punto 4), más los eventos puntuales de ESTE período (horas
  // extra gravadas, prestaciones libres pendientes de clasificar).
  const restantes = mesesRestantes(mes);
  const bloqueantes: string[] = [];
  const proyectados: ConceptoIngresoIsr[] = [];

  if (empleado.sueldo > 0.004) {
    proyectados.push({
      id: "sueldo-mensual",
      codigoConcepto: "SUELDO_BASE",
      tratamiento: "GRAVADO",
      monto: q(empleado.sueldo * restantes),
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

  // 4) ISR propio ya retenido en el ejercicio (solo períodos autorizados,
  // ver punto 3) — el período actual todavía no tiene ISR retenido real.
  const input: InputIsrTrabajo2026 = {
    ejercicio,
    fechaCorte: periodo.fechaInicio,
    periodosRestantes: restantes,
    ingresosPropiosAcumulados,
    ingresosPropiosProyectadosRestantes: proyectados,
    limitesExencionAnual: [],
    antecedentes: antecedentesMotor,
    igssLaboralPropio: { acumuladoQ: q(acumuladoIgss), proyectadoRestanteQ: "0.00" },
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
