import { z } from "zod";
import { hoyLocal } from "./dates";

const id = z.number().int().positive().max(2147483647);
const texto = z.string().trim().min(1).max(1000);
const fecha = z.iso.date();
// DECIMAL(14,2), enviado como texto para no redondear información externa.
export const montoFiscalSchema = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
const nullableMonto = montoFiscalSchema.nullable();
export const centavosFiscales = (valor: string): bigint => BigInt(valor.replace(".", ""));
const tratamiento = z.enum(["GRAVADO", "EXENTO", "CONDICIONAL", "DESCONOCIDO"]);
const constancia = z.strictObject({
  id: texto, patronoNit: texto, numero: texto,
  periodoDesde: fecha, periodoHasta: fecha, documentoId: id,
});
const ingreso = z.strictObject({
  id: texto, codigoConcepto: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/), tipoConcepto: texto, monto: montoFiscalSchema,
  montoGravado: nullableMonto, montoExento: nullableMonto,
  tratamientoDeclarado: tratamiento, fundamentoDocumentado: texto.nullable(),
  periodoDesde: fecha, periodoHasta: fecha, patronoNit: texto,
  constanciaId: texto, documentoId: id, observacionesLimitesAnuales: texto.nullable(),
});
/**
 * ACUMULADO INICIAL DE MIGRACIÓN (sistema anterior de planillas de ESTA misma empresa). NO es "otro patrono": el acumulado
 * hasta la fecha de corte (columna `corte_antecedentes`, inclusive) ya fue calculado y descontado por el sistema anterior.
 * Los importes viven en las columnas existentes (ingresos_gravados_previos, ingresos_exentos_previos, igss_laboral_previo,
 * isr_retenido_previo) — las mismas que consume el motor; aquí solo va la metadata de origen. Quién capturó/confirmó y cuándo
 * ya lo registran creado_por / confirmado_por / confirmado_en de la revisión.
 * COMPATIBILIDAD: `migracion` es OPCIONAL y `declaracionAntecedentes` solo se AMPLÍA con un valor nuevo: los JSON anteriores
 * (SIN_ANTECEDENTES / CON_ANTECEDENTES / DESCONOCIDO, sin `migracion`) siguen parseando y se interpretan como siempre.
 */
export const migracionFiscalSchema = z.strictObject({
  referenciaOrigen: texto,
  observacion: texto.nullable(),
  documentoId: id.nullable(),
});
export type MigracionFiscal = z.infer<typeof migracionFiscalSchema>;
export const TIPO_ORIGEN_MIGRACION = "ACUMULADO_INICIAL_MIGRACION" as const;
export type TipoOrigenFiscal = "SIN_ANTECEDENTES" | "ANTECEDENTES_OTRO_PATRONO" | typeof TIPO_ORIGEN_MIGRACION | "DESCONOCIDO";

export const datosFiscalesSchema = z.strictObject({
  version: z.literal(1),
  declaracionAntecedentes: z.enum(["SIN_ANTECEDENTES", "CON_ANTECEDENTES", "DESCONOCIDO", TIPO_ORIGEN_MIGRACION]),
  migracion: migracionFiscalSchema.optional(),
  constancias: z.array(constancia).max(100),
  ingresosPreviosPorConcepto: z.array(ingreso).max(1000),
  ajustesPrevios: z.array(z.strictObject({
    id: texto, tipo: texto, fecha, documentoId: id, explicacion: texto,
  })).max(100),
  deducciones: z.array(z.strictObject({
    id: texto, tipo: z.enum(["DONACION", "SEGURO_VIDA", "IVA_PLANILLA", "PREVISION_SOCIAL_OTRA"]),
    montoSolicitado: montoFiscalSchema, fecha, documentoId: id,
    estadoComprobacion: z.enum(["PENDIENTE", "COMPROBADA", "RECHAZADA"]), motivo: texto.nullable(),
  })).max(100),
  otrosPatronos: z.strictObject({
    declaracion: z.enum(["NO", "SI", "DESCONOCIDO"]),
    agenteRetenedor: z.enum(["ESTA_EMPRESA", "OTRO_PATRONO", "PENDIENTE"]),
    remuneraciones: z.array(z.strictObject({
      id: texto, patronoNit: texto, monto: montoFiscalSchema,
      periodoDesde: fecha, periodoHasta: fecha, documentoId: id,
    })).max(100),
  }),
});
export const antecedenteFiscalSchema = z.strictObject({
  inicioFiscal: fecha.nullable(), corteAntecedentes: fecha.nullable(),
  ingresosGravadosPrevios: nullableMonto, ingresosExentosPrevios: nullableMonto,
  igssLaboralPrevio: nullableMonto, isrRetenidoPrevio: nullableMonto,
  datos: datosFiscalesSchema,
});
export type AntecedenteFiscal = z.infer<typeof antecedenteFiscalSchema>;
export type DatosFiscales = z.infer<typeof datosFiscalesSchema>;

export class ErrorModeloFiscal extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function parsearDatosFiscales(raw: unknown): DatosFiscales {
  try {
    // MariaDB puede entregar JSON alias LONGTEXT; mysql2 también puede entregar objeto.
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = datosFiscalesSchema.safeParse(value);
    if (result.success) return result.data;
  } catch { /* Fallar cerrado, nunca sustituir JSON corrupto por datos vacíos. */ }
  throw new ErrorModeloFiscal("Datos fiscales almacenados inválidos.", 409);
}

export function documentosAntecedente(datos: DatosFiscales): number[] {
  return [...new Set([
    ...datos.constancias, ...datos.ingresosPreviosPorConcepto,
    ...datos.ajustesPrevios, ...datos.deducciones, ...datos.otrosPatronos.remuneraciones,
    ...(datos.migracion?.documentoId != null ? [{ documentoId: datos.migracion.documentoId }] : []),
  ].map((item) => item.documentoId))];
}

export const MSG_MIGRACION_SOLAPADA =
  "El acumulado fiscal inicial se solapa con una planilla autorizada del sistema. Revisa la fecha de corte para evitar doble conteo.";

/** Origen fiscal EXPLÍCITO de una revisión (los registros anteriores se derivan de su declaración). */
export function tipoOrigenFiscal(datos: DatosFiscales): TipoOrigenFiscal {
  if (datos.declaracionAntecedentes === TIPO_ORIGEN_MIGRACION) return TIPO_ORIGEN_MIGRACION;
  if (datos.declaracionAntecedentes === "CON_ANTECEDENTES") return "ANTECEDENTES_OTRO_PATRONO";
  return datos.declaracionAntecedentes;
}

/** Corte y período del acumulado de migración: cubre desde el 1 de enero del ejercicio hasta el corte, INCLUSIVE. */
export const inicioEjercicio = (ejercicio: number) => `${ejercicio}-01-01`;

export function validarAntecedenteFiscal(raw: unknown, ejercicio: number, confirmar = false, hoy: string = hoyLocal()): AntecedenteFiscal {
  const parsed = antecedenteFiscalSchema.safeParse(raw);
  if (!parsed.success || !Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 9999) {
    throw new ErrorModeloFiscal("Antecedentes fiscales inválidos.");
  }
  const a = parsed.data, d = a.datos;
  const esMigracion = d.declaracionAntecedentes === TIPO_ORIGEN_MIGRACION;
  // Una revisión tiene UN origen coherente. Fallar cerrado ante combinaciones ambiguas.
  if (!esMigracion && d.migracion !== undefined) throw new ErrorModeloFiscal("Los datos de migración solo aplican al acumulado inicial de migración.");
  if (esMigracion) {
    if (!d.migracion) throw new ErrorModeloFiscal("El acumulado inicial requiere su origen/referencia.");
    if (d.constancias.length || d.ingresosPreviosPorConcepto.length || d.ajustesPrevios.length || d.deducciones.length ||
      d.otrosPatronos.declaracion !== "NO" || d.otrosPatronos.remuneraciones.length) {
      throw new ErrorModeloFiscal(
        "El acumulado inicial de migración no puede combinarse con constancias, deducciones ni ingresos de otro patrono en la misma revisión. " +
        "Ese caso mixto no está soportado todavía.");
    }
    if (!a.corteAntecedentes) throw new ErrorModeloFiscal("El acumulado inicial requiere fecha de corte.");
    if (a.inicioFiscal !== null && a.inicioFiscal !== inicioEjercicio(ejercicio)) {
      throw new ErrorModeloFiscal("El acumulado inicial cubre desde el 1 de enero del ejercicio.");
    }
    if (a.corteAntecedentes > hoy) throw new ErrorModeloFiscal("La fecha de corte no puede ser posterior a hoy.");
  }
  const enEjercicio = (f: string) => Number(f.slice(0, 4)) === ejercicio;
  const fechas = [a.inicioFiscal, a.corteAntecedentes].filter((f): f is string => f !== null);
  const grupos = [d.constancias, d.ingresosPreviosPorConcepto, d.ajustesPrevios,
    d.deducciones, d.otrosPatronos.remuneraciones];
  for (const grupo of grupos) {
    if (new Set(grupo.map((x) => x.id)).size !== grupo.length) throw new ErrorModeloFiscal("Referencias duplicadas.");
  }
  const huellas = d.ingresosPreviosPorConcepto.map((x) => JSON.stringify([
    x.constanciaId, x.codigoConcepto, x.periodoDesde, x.periodoHasta, x.monto, x.montoGravado, x.montoExento,
  ]));
  if (new Set(huellas).size !== huellas.length) throw new ErrorModeloFiscal("Ingreso por concepto duplicado.");
  if (d.constancias.some((c, i) => d.constancias.slice(i + 1).some((other) =>
    other.documentoId === c.documentoId || (other.patronoNit === c.patronoNit && other.numero === c.numero)))) {
    throw new ErrorModeloFiscal("Respaldo de constancia duplicado.");
  }
  for (const x of [...d.constancias, ...d.ingresosPreviosPorConcepto, ...d.otrosPatronos.remuneraciones]) {
    fechas.push(x.periodoDesde, x.periodoHasta);
    if (x.periodoDesde > x.periodoHasta) throw new ErrorModeloFiscal("Período fiscal inválido.");
  }
  fechas.push(...d.ajustesPrevios.map((x) => x.fecha), ...d.deducciones.map((x) => x.fecha));
  if (fechas.some((f) => !enEjercicio(f))) throw new ErrorModeloFiscal("Fecha fuera del ejercicio fiscal.");
  for (const c of d.constancias) {
    if (a.corteAntecedentes && c.periodoHasta > a.corteAntecedentes) throw new ErrorModeloFiscal("Constancia posterior al corte.");
    if (d.constancias.some((other) => other.id !== c.id && other.patronoNit === c.patronoNit &&
      other.periodoDesde <= c.periodoHasta && other.periodoHasta >= c.periodoDesde)) {
      throw new ErrorModeloFiscal("Constancias solapadas del mismo patrono.");
    }
  }
  for (const x of d.ingresosPreviosPorConcepto) {
    const c = d.constancias.find((c) => c.id === x.constanciaId);
    if (!c || c.patronoNit !== x.patronoNit || c.documentoId !== x.documentoId ||
      x.periodoDesde < c.periodoDesde || x.periodoHasta > c.periodoHasta) {
      throw new ErrorModeloFiscal("Ingreso sin constancia compatible.");
    }
    if (x.montoGravado !== null && x.montoExento !== null &&
      centavosFiscales(x.montoGravado) + centavosFiscales(x.montoExento) !== centavosFiscales(x.monto)) {
      throw new ErrorModeloFiscal("Desglose de ingreso no concilia.");
    }
    if ((x.tratamientoDeclarado === "GRAVADO" && x.montoExento !== null && x.montoExento !== "0.00") ||
      (x.tratamientoDeclarado === "EXENTO" && x.montoGravado !== null && x.montoGravado !== "0.00")) {
      throw new ErrorModeloFiscal("Tratamiento declarado incompatible con el desglose.");
    }
  }
  if (!confirmar) return a;
  const totales = [a.ingresosGravadosPrevios, a.ingresosExentosPrevios, a.igssLaboralPrevio, a.isrRetenidoPrevio];
  if (totales.some((x) => x === null) || d.declaracionAntecedentes === "DESCONOCIDO" ||
    d.otrosPatronos.declaracion === "DESCONOCIDO") throw new ErrorModeloFiscal("Completar declaración y acumulados antes de confirmar.");
  if (esMigracion) {
    // Importes ya validados (>= 0, 2 decimales, no nulos arriba). Nada de desglose por concepto ni constancias.
    return { ...a, inicioFiscal: a.inicioFiscal ?? inicioEjercicio(ejercicio) };
  }
  if (d.declaracionAntecedentes === "SIN_ANTECEDENTES") {
    if (totales.some((x) => x !== "0.00") || d.constancias.length || d.ingresosPreviosPorConcepto.length || d.ajustesPrevios.length) {
      throw new ErrorModeloFiscal("Declaración sin antecedentes incompatible con sus datos.");
    }
  } else if (!d.constancias.length || !a.corteAntecedentes || !a.inicioFiscal) {
    throw new ErrorModeloFiscal("Antecedentes requieren fechas y constancias.");
  }
  if (d.otrosPatronos.declaracion === "SI" &&
    (!d.otrosPatronos.remuneraciones.length || d.otrosPatronos.agenteRetenedor === "PENDIENTE")) {
    throw new ErrorModeloFiscal("Completar declaración de otros patronos.");
  }
  if (d.otrosPatronos.declaracion === "NO" && d.otrosPatronos.remuneraciones.length) {
    throw new ErrorModeloFiscal("Remuneración concurrente incompatible con la declaración.");
  }
  for (const x of d.ingresosPreviosPorConcepto) {
    if (x.montoGravado === null || x.montoExento === null || x.tratamientoDeclarado === "DESCONOCIDO" ||
      !x.fundamentoDocumentado || !x.observacionesLimitesAnuales) {
      throw new ErrorModeloFiscal("Completar desglose y respaldo por concepto antes de confirmar.");
    }
  }
  const sumar = (campo: "montoGravado" | "montoExento") =>
    d.ingresosPreviosPorConcepto.reduce((sum, x) => sum + centavosFiscales(x[campo]!), BigInt(0));
  if (sumar("montoGravado") !== centavosFiscales(a.ingresosGravadosPrevios!) ||
    sumar("montoExento") !== centavosFiscales(a.ingresosExentosPrevios!)) {
    throw new ErrorModeloFiscal("Totales previos no concilian con el detalle por concepto.");
  }
  return a;
}
