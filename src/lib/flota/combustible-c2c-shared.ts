import Decimal from "decimal.js";

/**
 * C-2C — conciliación controlada «reporte de proveedor (C-2B) ↔ vale interno». Parte PURA (sin BD).
 *
 * Regla primaria: empresa + proveedor + número de vale normalizado. Placa, monto, galones, precio y fecha SOLO se comparan una vez
 * hallado el candidato; la fecha C-2B es de REPORTE (no certifica consumo) y el piloto es solo contexto. Nada de esto modifica el vale.
 */

export const ESTADOS_C2C = [
  "PENDIENTE", "COINCIDENCIA_EXACTA", "COINCIDENCIA_CON_DIFERENCIAS", "SIN_VALE_INTERNO", "VALE_INTERNO_SIN_REPORTE", "AMBIGUA", "DESCARTADA_MANUAL",
] as const;
export type EstadoC2c = (typeof ESTADOS_C2C)[number];
export const MODOS_C2C = ["AUTO", "MANUAL"] as const;
export type ModoC2c = (typeof MODOS_C2C)[number];

/** Tolerancias EXPLÍCITAS y fijas (no porcentuales). */
export const TOLERANCIA_MONTO = "0.01";
export const TOLERANCIA_GALONES = "0.001";
export const TOLERANCIA_PRECIO = "0.01";

export const CAMPOS_COMPARADOS = ["PLACA", "MONTO", "GALONES", "PRECIO", "FECHA"] as const;
export type CampoComparado = (typeof CAMPOS_COMPARADOS)[number];
export type Diferencia = {
  campo: CampoComparado;
  /** DISTINTA = ambos valores existen y difieren; FALTANTE = falta uno de los dos (no cuenta como diferencia). */
  tipo: "DISTINTA" | "FALTANTE";
  proveedor: string | null;
  interno: string | null;
  /** interno − proveedor para importes (cadena decimal); null si no aplica. */
  delta: string | null;
};

/** Conservadora: NFC, trim, espacios internos = uno, mayúsculas. NO quita ceros a la izquierda ni guiones. */
/** Misma regla que `normalizarPlacaImportada` del parser C-2B (se replica aquí porque el parser importa node:crypto y este módulo lo usa el cliente; un test exige igualdad). */
export const normalizarPlacaImportada = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase().replace(/[‐‑–—]/g, "-").replace(/\s*-\s*/g, "-");

export const normalizarVale = (s: string | null | undefined) => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();

export type DatosProveedor = { placaNormalizada: string; galones: string | null; precio: string | null; total: string | null; fechaReporte: string | null };
export type DatosVale = { placa: string | null; galones: string | null; monto: string | null; precio: string | null; fechaConsumo: string | null };

function importe(a: string | null, b: string | null, campo: CampoComparado, tolerancia: string): Diferencia | null {
  if (a == null || b == null) return a == null && b == null ? null : { campo, tipo: "FALTANTE", proveedor: a, interno: b, delta: null };
  const delta = new Decimal(b).minus(a);
  return delta.abs().lte(tolerancia) ? null : { campo, tipo: "DISTINTA", proveedor: a, interno: b, delta: delta.toString() };
}

/** Diferencias secundarias entre la fila canónica del proveedor y UN vale interno. Orden estable. */
export function compararFilaConVale(p: DatosProveedor, v: DatosVale): Diferencia[] {
  const r: (Diferencia | null)[] = [];
  const pp = p.placaNormalizada ? normalizarPlacaImportada(p.placaNormalizada) : null, pv = v.placa ? normalizarPlacaImportada(v.placa) : null;
  r.push(pp == null || pv == null ? (pp == null && pv == null ? null : { campo: "PLACA", tipo: "FALTANTE", proveedor: pp, interno: pv, delta: null })
    : pp === pv ? null : { campo: "PLACA", tipo: "DISTINTA", proveedor: pp, interno: pv, delta: null });
  r.push(importe(p.total, v.monto, "MONTO", TOLERANCIA_MONTO));
  r.push(importe(p.galones, v.galones, "GALONES", TOLERANCIA_GALONES));
  r.push(importe(p.precio, v.precio, "PRECIO", TOLERANCIA_PRECIO));
  r.push(p.fechaReporte == null || v.fechaConsumo == null ? (p.fechaReporte == null && v.fechaConsumo == null ? null : { campo: "FECHA", tipo: "FALTANTE", proveedor: p.fechaReporte, interno: v.fechaConsumo, delta: null })
    : p.fechaReporte === v.fechaConsumo ? null : { campo: "FECHA", tipo: "DISTINTA", proveedor: p.fechaReporte, interno: v.fechaConsumo, delta: null });
  return r.filter((d): d is Diferencia => d != null);
}

/** Una diferencia «cuenta» solo si ambos valores existen y difieren (un dato faltante no impide la coincidencia exacta). */
export const hayDiferencias = (d: Diferencia[]) => d.some(x => x.tipo === "DISTINTA");

export type ResultadoClasificacion = { estado: EstadoC2c; candidatos: number; diferencias: Diferencia[]; motivo?: string };

/**
 * Clasifica UNA fila canónica: 0 candidatos → SIN_VALE_INTERNO; >1 → AMBIGUA (nunca se elige); 1 → comparación.
 * `competidoras` = otras filas canónicas del MISMO proveedor con la misma clave de vale: si hay, también AMBIGUA.
 */
export function clasificarFila(p: DatosProveedor, candidatos: DatosVale[], competidoras = 0): ResultadoClasificacion {
  if (competidoras > 0) return { estado: "AMBIGUA", candidatos: candidatos.length, diferencias: [], motivo: "VARIAS_FILAS_MISMO_VALE" };
  if (candidatos.length === 0) return { estado: "SIN_VALE_INTERNO", candidatos: 0, diferencias: [] };
  if (candidatos.length > 1) return { estado: "AMBIGUA", candidatos: candidatos.length, diferencias: [], motivo: "VARIOS_VALES_MISMA_CLAVE" };
  const diferencias = compararFilaConVale(p, candidatos[0]);
  return { estado: hayDiferencias(diferencias) ? "COINCIDENCIA_CON_DIFERENCIAS" : "COINCIDENCIA_EXACTA", candidatos: 1, diferencias };
}

/** Etiqueta corta para badges: «PLACA», «MONTO Q0.50»… */
export function etiquetaDiferencia(d: Diferencia): string {
  if (d.tipo === "FALTANTE") return `${d.campo} faltante`;
  if (d.delta != null && (d.campo === "MONTO" || d.campo === "PRECIO")) return `${d.campo} Q${new Decimal(d.delta).abs().toFixed(2)}`;
  if (d.delta != null) return `${d.campo} ${new Decimal(d.delta).abs().toString()}`;
  return d.campo;
}
