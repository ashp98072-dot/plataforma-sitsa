import { createHash } from "node:crypto";

/**
 * RRHH VACACIONES — DECISIONES EXPLÍCITAS Y AUDITABLES para el aplicador de la reconstrucción (módulo PURO: sin BD ni red).
 *
 * El aplicador NO puede ejecutarse mientras exista una DECISIÓN pendiente del motor (p. ej. una vacación que cruza un aniversario, un saldo
 * insuficiente o una vacación anterior a la fecha base). Una decisión pendiente se resuelve registrando una resolución con:
 *   - `clave`     identifica la decisión (código + empleado + fechas + días de la vacación);
 *   - `huella`    SHA-256 del texto EXACTO que propuso el motor (incluye la distribución por tramo): la aprobación queda atada a lo que RRHH
 *                 vio; si los datos o la propuesta cambian, la huella ya no coincide y la resolución se rechaza;
 *   - `tipo`      ACEPTAR_PROPUESTA (se aplica tal cual la propuesta) o REPARTO_MANUAL (solo vacaciones que cruzan un aniversario: RRHH fija
 *                 cuántos días salen de cada año laboral);
 *   - `resueltoPor`, `resueltoEn`, `motivo` (mínimo 10 caracteres): quedan en la auditoría de la transacción de aplicación.
 * Una resolución que no corresponde a ninguna decisión pendiente (obsoleta, mal escrita) es un ERROR que bloquea la aplicación.
 */

export const TIPOS_DECISION = ["ACEPTAR_PROPUESTA", "REPARTO_MANUAL"] as const;
export type TipoDecision = (typeof TIPOS_DECISION)[number];
export const MIN_MOTIVO = 10;

export type RepartoManual = { anioLaboral: number; dias: number };

export type DecisionReconstruccion = {
  clave: string;
  tipo: TipoDecision;
  huella: string;
  resueltoPor: string;
  resueltoEn: string;
  motivo: string;
  reparto?: RepartoManual[];
};

/** Decisión que el motor dejó pendiente (con todo lo necesario para que RRHH la resuelva). */
export type DecisionPendiente = {
  clave: string;
  codigo: string;
  empleadoId: number;
  empleadoCodigo: string;
  empleado: string;
  origen: number;
  inicio: string;
  fin: string;
  dias: number;
  mensaje: string;
  huella: string;
  /** Plantilla lista para completar (resueltoPor, motivo) y reenviar. */
  plantilla: DecisionReconstruccion;
};

export const claveDecision = (codigo: string, empleadoCodigo: string, inicio: string, fin: string, dias: number): string =>
  [codigo, empleadoCodigo, inicio, fin, dias.toFixed(2)].join("|");

export const huellaTexto = (texto: string): string => createHash("sha256").update(texto, "utf8").digest("hex");

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Valida la ESTRUCTURA de las resoluciones recibidas. No decide si aplican (eso lo hace el plan contra las decisiones pendientes). */
export function validarDecisiones(entrada: unknown): { decisiones: DecisionReconstruccion[]; errores: string[] } {
  const errores: string[] = [];
  const decisiones: DecisionReconstruccion[] = [];
  if (entrada == null) return { decisiones, errores };
  if (!Array.isArray(entrada)) return { decisiones, errores: ["Las decisiones deben enviarse como una lista."] };
  const vistas = new Set<string>();
  entrada.forEach((raw, i) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    const nombre = `Decisión #${i + 1}`;
    const clave = typeof d.clave === "string" ? d.clave.trim() : "";
    if (!clave) { errores.push(`${nombre}: falta la clave.`); return; }
    if (vistas.has(clave)) { errores.push(`${nombre}: la clave «${clave}» está repetida.`); return; }
    vistas.add(clave);
    const tipo = d.tipo as TipoDecision;
    if (!(TIPOS_DECISION as readonly string[]).includes(String(tipo))) { errores.push(`${nombre} (${clave}): tipo inválido (use ${TIPOS_DECISION.join(" o ")}).`); return; }
    const huella = typeof d.huella === "string" ? d.huella.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{64}$/.test(huella)) { errores.push(`${nombre} (${clave}): la huella debe ser el SHA-256 (64 hex) de la propuesta que se aprobó.`); return; }
    const resueltoPor = typeof d.resueltoPor === "string" ? d.resueltoPor.trim() : "";
    if (resueltoPor.length < 3) { errores.push(`${nombre} (${clave}): indique quién resuelve (resueltoPor).`); return; }
    const resueltoEn = typeof d.resueltoEn === "string" ? d.resueltoEn.trim() : "";
    if (!resueltoEn || Number.isNaN(Date.parse(resueltoEn))) { errores.push(`${nombre} (${clave}): resueltoEn debe ser una fecha ISO válida.`); return; }
    const motivo = typeof d.motivo === "string" ? d.motivo.trim() : "";
    if (motivo.length < MIN_MOTIVO) { errores.push(`${nombre} (${clave}): el motivo debe explicar la decisión (mínimo ${MIN_MOTIVO} caracteres).`); return; }
    let reparto: RepartoManual[] | undefined;
    if (tipo === "REPARTO_MANUAL") {
      if (!Array.isArray(d.reparto) || d.reparto.length === 0) { errores.push(`${nombre} (${clave}): REPARTO_MANUAL exige el reparto por año laboral.`); return; }
      const anios = new Set<number>();
      reparto = [];
      for (const r of d.reparto as Record<string, unknown>[]) {
        const anio = Number(r?.anioLaboral), dias = Number(r?.dias);
        if (!Number.isInteger(anio) || anio < 1 || !Number.isFinite(dias) || dias <= 0 || dias > 365 || anios.has(anio)) {
          errores.push(`${nombre} (${clave}): reparto inválido (años laborales enteros ≥ 1 sin repetir, días > 0).`); reparto = undefined; break;
        }
        anios.add(anio);
        reparto.push({ anioLaboral: anio, dias: r2(dias) });
      }
      if (!reparto) return;
    } else if (d.reparto !== undefined) {
      errores.push(`${nombre} (${clave}): ACEPTAR_PROPUESTA no admite un reparto distinto del propuesto.`); return;
    }
    decisiones.push({ clave, tipo, huella, resueltoPor, resueltoEn, motivo, ...(reparto ? { reparto } : {}) });
  });
  return { decisiones, errores };
}
