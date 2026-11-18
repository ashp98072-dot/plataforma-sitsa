import { identificarPlaca, placaComparable } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";

export type PlacaPendiente = { placa: string; filas: number; tipos: ("VEHICULO" | "MOTOCICLETA")[] };
export type PlacaExcluida = { texto: string; filas: number; motivo: string };

const cuerpo = (p: string) => p.replace(/^[A-Z](?=\d{3}[A-Z]{3}$)/, "");
function distancia(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Placas de filas pendientes que NO existen en Flota ni entre las unidades externas. Solo se proponen las que tienen forma de placa
 * y no se parecen (a un carácter) a una placa conocida: las demás se excluyen con su motivo y jamás se registran automáticamente.
 * Nada se registra aquí: el tipo (VEHÍCULO/MOTOCICLETA) lo elige la persona. */
export function placasPendientes(filas: FilaCB2[], cat: CatalogosCB2) {
  const conteo = new Map<string, { texto: string; filas: number }>();
  for (const f of filas) {
    if (!f.candidato || f.bloqueada || ["IGNORADA", "RESUELTA"].includes(f.estado)) continue;
    const texto = String(f.placaNormalizada || f.placa || "").trim();
    if (identificarPlaca(texto, cat.vehiculos, v => v.placa).estado !== "INEXISTENTE") continue;
    const k = placaComparable(texto) || `TEXTO:${texto}`, e = conteo.get(k) ?? { texto, filas: 0 }; e.filas++; conteo.set(k, e);
  }
  const registrables: PlacaPendiente[] = [], excluidas: PlacaExcluida[] = [];
  for (const { texto, filas: n } of conteo.values()) {
    const c = placaComparable(texto);
    if (!/^[A-Z]?\d{3}[A-Z]{3}$/.test(c)) { excluidas.push({ texto, filas: n, motivo: "No tiene forma de placa: no se registra como unidad." }); continue; }
    const parecida = cat.vehiculos.find(v => { const b = cuerpo(placaComparable(v.placa)); return b.length === 6 && distancia(b, cuerpo(c)) <= 1; });
    if (parecida) { excluidas.push({ texto, filas: n, motivo: `Placa sospechosa: casi igual a ${parecida.placa}. Corrige el Excel o elige esa unidad; no se registra como nueva.` }); continue; }
    registrables.push({ placa: texto, filas: n, tipos: /^M\d{3}[A-Z]{3}$/.test(c) ? ["MOTOCICLETA"] : /^[A-LN-Z]\d{3}[A-Z]{3}$/.test(c) ? ["VEHICULO"] : ["VEHICULO", "MOTOCICLETA"] });
  }
  return { registrables, excluidas };
}
/** Referencia estable derivada de la placa comparable: la misma placa nunca crea dos unidades al reintentar. */
export const referenciaUnidadShell = (placa: string) => `shell:${placaComparable(placa)}`;
