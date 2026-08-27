import { z } from "zod";

export class ErrorMultas extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const idSchema = z.coerce.number().int().positive().max(2147483647);
export const anioSchema = z.coerce.number().int().min(2000).max(2100);
export const mesSchema = z.coerce.number().int().min(1).max(12);
const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) => texto(max).nullable().default(null);

// DECIMAL(12,2): representación canónica decimal; cálculos solo en enteros.
export function centavos(valor: string): number {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(valor)) throw new ErrorMultas("Importe inválido: máximo dos decimales, no negativo.");
  const [entero, fraccion = ""] = valor.split(".");
  return Number(entero) * 100 + Number(fraccion.padEnd(2, "0"));
}
export function decimal(valor: number): string {
  return `${Math.floor(valor / 100)}.${String(valor % 100).padStart(2, "0")}`;
}
const dinero = z.union([z.string(), z.number().finite()]).transform(String)
  .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), "Importe inválido: máximo dos decimales.")
  .transform((v) => decimal(centavos(v)));
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number(v.slice(0, 4)) >= 1000 && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Fecha inválida.");
const responsabilidad = {
  tipo_responsabilidad: z.enum(["PILOTO", "LOGISTICA", "OTRO_COLABORADOR", "EMPRESA", "POR_DEFINIR"]),
  empleado_responsable_id: idSchema.nullable().default(null),
  responsable_texto: opcional(200),
};
const resolucion = {
  resolucion_economica: z.enum(["PENDIENTE", "EMPRESA", "COLABORADOR", "COMPARTIDO", "NO_APLICA"]),
  monto_empresa: dinero.nullable().default(null),
  monto_colaborador: dinero.nullable().default(null),
};
export const revisionSchema = z.object({
  vehiculo_id: idSchema, anio: anioSchema, mes: mesSchema, observaciones: opcional(4000),
}).strict();
export const crearMultaSchema = z.object({
  revision_id: idSchema, vehiculo_id: idSchema,
  fecha_infraccion: fecha, referencia_boleta: opcional(120),
  tipo_multa: texto(120), descripcion: texto(4000), lugar: opcional(300),
  monto_total: dinero, moneda: z.literal("GTQ").default("GTQ"),
  ...responsabilidad, ...resolucion,
  estado: z.enum(["PENDIENTE", "EN_REVISION"]).default("PENDIENTE"),
  observaciones: opcional(4000),
}).strict();
// MULTAS-3.1 (corrección P0): "descontar" se retiró del contrato. Marcar
// estado_descuento = DESCONTADO a mano, sin ningún descuento real en
// rrhh_descuentos_maestro/rrhh_descuento_cuotas detrás, es un estado falso
// — RRHH/Contabilidad no pueden confiar en él. Mientras no exista MULTAS-3.2
// (integración real con el motor de descuentos de RRHH), un colaborador/
// compartido con monto_colaborador > 0 permanece en estado_descuento =
// PENDIENTE indefinidamente; no hay ninguna acción de este módulo que pueda
// avanzarlo a DESCONTADO. El valor "DESCONTADO" se conserva en el tipo
// Multa (y en obligaciones()/tieneMovimientos()/validarMulta()) porque
// sigue siendo un estado válido del esquema — MULTAS-3.2 lo escribirá desde
// un flujo real vinculado a rrhh_descuento_id, no desde este patchSchema.
export const patchSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("datos"), tipo_multa: texto(120).optional(), descripcion: texto(4000).optional(),
    lugar: texto(300).nullable().optional(), observaciones: texto(4000).nullable().optional() }).strict(),
  z.object({ accion: z.literal("responsable"), ...responsabilidad }).strict(),
  z.object({ accion: z.literal("resolucion"), ...resolucion, observaciones: opcional(4000) }).strict(),
  z.object({ accion: z.literal("pagar") }).strict(),
  z.object({ accion: z.literal("estado"), estado: z.enum(["PENDIENTE", "EN_REVISION", "RESUELTA"]) }).strict(),
  z.object({ accion: z.literal("anular"), motivo_anulacion: texto(4000) }).strict(),
]);
export type Multa = Omit<z.infer<typeof crearMultaSchema>, "estado"> & {
  estado: "PENDIENTE" | "EN_REVISION" | "RESUELTA" | "ANULADA";
  estado_pago: "PENDIENTE" | "PAGADA" | "NO_APLICA";
  // estado_descuento: columna heredada, escrita SOLO por obligaciones()
  // (PENDIENTE/NO_APLICA) — MULTAS-3.1 ya retiró toda escritura manual a
  // DESCONTADO. MULTAS-3.2: el valor DESCONTADO ahora se DERIVA en lectura
  // (backend.ts, a partir de rrhh_descuento_id + cuotas realmente APLICADA
  // en RRHH), nunca se persiste — ver enriquecerConDescuentoRrhh().
  estado_descuento: "NO_APLICA" | "PENDIENTE" | "DESCONTADO";
  pagada_en: Date | string | null; pagada_por_usuario_id: number | null;
  descontada_en: Date | string | null; descontada_por_usuario_id: number | null;
  motivo_anulacion: string | null; anulada_en: Date | string | null; anulada_por_usuario_id: number | null;
  // MULTAS-3.2: vínculo con rrhh_descuentos_maestro.id (mismo tenant) —
  // único dato que Multas guarda de RRHH; todo lo demás (cuotas, saldo,
  // periodicidad) se consulta, nunca se duplica (ver reglas.ts:5 del
  // ticket). NULL hasta que RRHH cree y autorice un descuento real.
  rrhh_descuento_id: number | null;
};
export function validarMulta(m: Multa): void {
  const personal = ["PILOTO", "LOGISTICA", "OTRO_COLABORADOR"].includes(m.tipo_responsabilidad);
  const empleado = m.empleado_responsable_id != null;
  const libre = Boolean(m.responsable_texto?.trim());
  if (personal ? empleado === libre : empleado || libre) throw new ErrorMultas("Responsable incoherente: use exactamente un empleado o un nombre para responsabilidad personal.");
  const total = centavos(m.monto_total);
  const empresa = m.monto_empresa == null ? null : centavos(m.monto_empresa);
  const colaborador = m.monto_colaborador == null ? null : centavos(m.monto_colaborador);
  const correcto = {
    PENDIENTE: empresa === null && colaborador === null,
    EMPRESA: empresa === total && colaborador === 0,
    COLABORADOR: empresa === 0 && colaborador === total,
    COMPARTIDO: empresa != null && colaborador != null && empresa > 0 && colaborador > 0 && empresa + colaborador === total,
    NO_APLICA: empresa === 0 && colaborador === 0 && Boolean(m.observaciones?.trim()),
  }[m.resolucion_economica];
  if (!correcto) throw new ErrorMultas("Resolución económica e importes incoherentes.");
  if ((colaborador ?? 0) > 0 && !personal) throw new ErrorMultas("El monto del colaborador requiere responsable personal.");
  const pagoAplica = total > 0 && m.resolucion_economica !== "NO_APLICA";
  const descuentoAplica = (colaborador ?? 0) > 0;
  if (pagoAplica === (m.estado_pago === "NO_APLICA")) throw new ErrorMultas("Estado de pago incompatible con la obligación.");
  if (descuentoAplica === (m.estado_descuento === "NO_APLICA")) throw new ErrorMultas("Estado de descuento incompatible con la obligación.");
  if (m.estado_pago === "PAGADA" ? !m.pagada_en || !m.pagada_por_usuario_id : m.pagada_en != null || m.pagada_por_usuario_id != null)
    throw new ErrorMultas("Metadatos de pago incompletos o incompatibles.");
  if (m.estado_descuento === "DESCONTADO" ? !m.descontada_en || !m.descontada_por_usuario_id : m.descontada_en != null || m.descontada_por_usuario_id != null)
    throw new ErrorMultas("Metadatos de descuento incompletos o incompatibles.");
  // MULTAS-3.2: RESUELTA es un estado ADMINISTRATIVO (Operaciones ya decidió
  // quién asume), no financiero — NO exige que RRHH ya haya cobrado todas
  // las cuotas. Si aplica descuento, exige que exista un descuento RRHH
  // VINCULADO (rrhh_descuento_id) — no que esté totalmente recuperado.
  if (m.estado === "RESUELTA" && (m.resolucion_economica === "PENDIENTE" || m.estado_pago === "PENDIENTE" || (descuentoAplica && m.rrhh_descuento_id == null)))
    throw new ErrorMultas("No puede resolver una multa con obligaciones pendientes.");
  if (m.estado === "ANULADA" && (!m.motivo_anulacion?.trim() || !m.anulada_en || !m.anulada_por_usuario_id || tieneMovimientos(m)))
    throw new ErrorMultas("Anulación inválida o con movimientos reales.");
}
export function tieneMovimientos(m: Multa): boolean {
  return m.estado_pago === "PAGADA" || m.estado_descuento === "DESCONTADO";
}
function obligaciones(m: Multa): void {
  m.estado_pago = centavos(m.monto_total) > 0 && m.resolucion_economica !== "NO_APLICA" ? "PENDIENTE" : "NO_APLICA";
  m.estado_descuento = m.monto_colaborador != null && centavos(m.monto_colaborador) > 0 ? "PENDIENTE" : "NO_APLICA";
}
export function nuevaMulta(input: unknown): Multa {
  const m: Multa = { ...crearMultaSchema.parse(input), estado_pago: "PENDIENTE", estado_descuento: "NO_APLICA",
    pagada_en: null, pagada_por_usuario_id: null, descontada_en: null, descontada_por_usuario_id: null,
    anulada_en: null, anulada_por_usuario_id: null, motivo_anulacion: null, rrhh_descuento_id: null };
  obligaciones(m);
  validarMulta(m);
  return m;
}
export function transicion(m: Multa, input: unknown, usuarioId: number, ahora = new Date()): { multa: Multa; evento: string } {
  const p = patchSchema.parse(input);
  if (m.estado === "ANULADA") throw new ErrorMultas("Una multa anulada no admite cambios.", 409);
  const next = { ...m };
  let evento = "multa_actualizada";
  // MULTAS-3.2: con rrhh_descuento_id vinculado, responsable/reparto/monto
  // quedan congelados (secciones 17-18) y anular ya NO es este PATCH simple
  // — pasa por backend.anularMultaConDescuentoVinculado(), que decide entre
  // cancelar el descuento (sin cuotas aplicada) o rechazar con 409 (con
  // cuotas aplicada). Este guard solo bloquea la vía directa.
  if (["responsable", "resolucion", "anular"].includes(p.accion) && (tieneMovimientos(m) || m.estado === "RESUELTA" || m.rrhh_descuento_id != null))
    throw new ErrorMultas("No se permite cambiar responsabilidad, reparto o anular tras movimientos/cierre/vínculo con RRHH.", 409);
  switch (p.accion) {
    case "datos": {
      const { accion: _accion, ...datos } = p;
      void _accion;
      if (!Object.keys(datos).length) throw new ErrorMultas("Sin cambios solicitados.");
      Object.assign(next, datos);
      break;
    }
    case "responsable":
      next.tipo_responsabilidad = p.tipo_responsabilidad;
      next.empleado_responsable_id = p.empleado_responsable_id;
      next.responsable_texto = p.responsable_texto;
      evento = "multa_responsable_cambiado"; break;
    case "resolucion":
      Object.assign(next, { resolucion_economica: p.resolucion_economica, monto_empresa: p.monto_empresa,
        monto_colaborador: p.monto_colaborador, observaciones: p.observaciones });
      obligaciones(next);
      evento = "multa_resolucion_cambiada"; break;
    case "pagar":
      if (m.estado_pago !== "PENDIENTE") throw new ErrorMultas("No existe pago pendiente.", 409);
      next.estado_pago = "PAGADA"; next.pagada_en = ahora; next.pagada_por_usuario_id = usuarioId;
      evento = "multa_pagada"; break;
    // MULTAS-3.1: "descontar" retirado — ver comentario sobre patchSchema.
    // estado_descuento solo se mueve a PENDIENTE/NO_APLICA (obligaciones(),
    // caso "resolucion" arriba); ninguna rama de este switch lo lleva a
    // DESCONTADO. Eso queda para MULTAS-3.2, vinculado a un descuento real.
    case "estado":
      if (m.estado === "RESUELTA" && p.estado !== "RESUELTA") throw new ErrorMultas("No se permite reabrir una multa resuelta.", 409);
      next.estado = p.estado; break;
    case "anular":
      next.estado = "ANULADA"; next.motivo_anulacion = p.motivo_anulacion;
      next.anulada_en = ahora; next.anulada_por_usuario_id = usuarioId;
      evento = "multa_anulada"; break;
  }
  validarMulta(next);
  return { multa: next, evento };
}

// ---------------------------------------------------------------------------
// MULTAS-3.2 — puente hacia el motor de descuentos de RRHH (sin duplicarlo).
// ---------------------------------------------------------------------------

/**
 * Clasificación elegida para el descuento RRHH creado desde una multa
 * (sección 13 del ticket). De las 5 existentes (LEGAL/AUTORIZADO/JUDICIAL/
 * SISTEMA/INVENTARIO): JUDICIAL queda descartada porque exige documento_id
 * (autorizarDescuento lo rechaza sin documento) y esta fase NO trabaja
 * documentos/evidencias (fuera de alcance, sección 30); SISTEMA sugiere
 * origen automático sin intervención humana, pero aquí SIEMPRE hay una
 * autorización real de RRHH de por medio; LEGAL sugiere una deducción de
 * ley (tipo IGSS), no es el caso. AUTORIZADO es la más correcta: un monto
 * que la empresa (Operaciones, y luego RRHH al autorizar el descuento)
 * decide/autoriza descontarle al colaborador — exactamente lo que ocurre
 * aquí. No se amplía el enum/columna (es VARCHAR(20) sin lista cerrada en
 * BD, ver descuentos.ts) — se reutiliza un valor ya existente.
 */
export const CLASIFICACION_MULTA_RRHH = "AUTORIZADO" as const;

/** Concepto estable, sin datos administrativos internos (sección 12). */
export const CONCEPTO_MULTA_RRHH = "Multa de tránsito";

/**
 * Motivo visible en la boleta del colaborador — solo datos operativos.
 * placa_historica no forma parte del tipo Multa (se guarda aparte, ver
 * backend.ts crearMulta) — se recibe explícita, tal como ya la lee
 * actualizarMulta desde la fila real de ops_multas.
 */
export function motivoDescuentoMulta(m: { placa_historica: string; referencia_boleta: string | null; descripcion: string }): string {
  const partes = [
    `Unidad ${m.placa_historica}`,
    m.referencia_boleta ? `Boleta ${m.referencia_boleta}` : null,
    m.descripcion.slice(0, 160),
  ].filter(Boolean);
  return partes.join(" · ");
}
