import Decimal from "decimal.js";
import { ErrorCxp } from "./errores";
import { normalizarFacturaCompra } from "@/lib/compras/factura-compra";
import { REGIMENES_FISCALES, type RegimenFiscal } from "./isr-proveedor";

/** Importe DECIMAL(14,2): hasta 12 enteros y 2 decimales. Nunca redondea en silencio un dato con más decimales. */
export function importe(valor: unknown, etiqueta: string, { permitirCero = false } = {}): string {
  const texto = typeof valor === "number" ? (Number.isFinite(valor) ? String(valor) : "") : typeof valor === "string" ? valor.trim() : "";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(texto)) throw new ErrorCxp(`${etiqueta}: indica un importe válido con máximo dos decimales.`, 400, "IMPORTE_INVALIDO");
  const d = new Decimal(texto);
  if (d.isNegative() || (!permitirCero && d.isZero())) throw new ErrorCxp(`${etiqueta}: debe ser mayor que cero.`, 400, "IMPORTE_INVALIDO");
  return d.toFixed(2);
}

export function fechaIso(valor: unknown, etiqueta: string): string {
  const s = typeof valor === "string" ? valor.trim() : "";
  const d = /^[1-9]\d{3}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null;
  if (!d || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ErrorCxp(`${etiqueta}: fecha inválida (AAAA-MM-DD).`, 400, "FECHA_INVALIDA");
  return s;
}

export function textoOpcional(valor: unknown, max: number, etiqueta: string): string {
  const s = typeof valor === "string" ? valor.trim().replace(/\s+/g, " ") : "";
  if (s.length > max) throw new ErrorCxp(`${etiqueta}: máximo ${max} caracteres.`, 400, "TEXTO_LARGO");
  return s;
}

export function idPositivo(valor: unknown, etiqueta: string): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && /^[1-9]\d*$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) throw new ErrorCxp(`${etiqueta}: identificador inválido.`, 400, "ID_INVALIDO");
  return n;
}

export function idOpcional(valor: unknown, etiqueta: string): number | null {
  return valor == null || valor === "" ? null : idPositivo(valor, etiqueta);
}

export function regimenValido(valor: unknown): RegimenFiscal {
  if (typeof valor === "string" && (REGIMENES_FISCALES as readonly string[]).includes(valor)) return valor as RegimenFiscal;
  throw new ErrorCxp("Régimen fiscal inválido. Valores permitidos: GENERAL, PEQUENO_CONTRIBUYENTE.", 400, "REGIMEN_INVALIDO");
}

/** Serie (opcional) y número (obligatorio) con su forma normalizada para el control de duplicados (misma regla que Compras). */
export function documentoNormalizado(serie: unknown, numero: unknown) {
  const s = textoOpcional(serie, 40, "Serie");
  const n = textoOpcional(numero, 60, "Número");
  const norm = normalizarFacturaCompra(s, n);
  if (!norm) throw new ErrorCxp("Número de factura: es obligatorio.", 400, "NUMERO_OBLIGATORIO");
  if (norm.serie.length > 40 || norm.numero.length > 60) throw new ErrorCxp("Serie o número demasiado largos.", 400, "TEXTO_LARGO");
  return { serie: s, numero: n, serieNorm: norm.serie, numeroNorm: norm.numero };
}
