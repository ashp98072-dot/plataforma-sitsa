import { identificarPlaca } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
import { placasPendientes } from "./placas-pendientes";

/** Clasificación de la unidad de un vale Shell. Nunca crea ni infiere vehículos: solo explica qué es y qué falta resolver. */
export type ClaseUnidad = { clase: "INTERNA" | "EXTERNA" | "AMBIGUA" | "NO_IDENTIFICADA" | "SIN_ELEGIR"; mensaje: string; candidatos: string[]; registrable: boolean; motivoNoRegistrable?: string };

export function claseUnidadShell(f: FilaCB2, cat: CatalogosCB2, vehiculoId: string): ClaseUnidad {
  const original = f.placa || "No informada", n = Number(vehiculoId);
  if (vehiculoId && Number.isInteger(n) && n > 0) {
    const v = cat.vehiculos.find(v => v.id === n);
    return v ? { clase: "INTERNA", mensaje: `Unidad interna de Flota: ${v.placa} (#${v.id}). Excel: «${original}».`, candidatos: [], registrable: false }
      : { clase: "NO_IDENTIFICADA", mensaje: `La unidad elegida (#${n}) ya no está en el catálogo interno de esta empresa; elige otra.`, candidatos: [], registrable: false };
  }
  if (vehiculoId && Number.isInteger(n) && n < 0) {
    const u = cat.unidadesExternas?.find(u => u.id === -n);
    return u ? { clase: "EXTERNA", mensaje: `Unidad externa registrada: ${u.placa} (identidad #${u.id}, no es un vehículo de Flota). Excel: «${original}».`, candidatos: [], registrable: false }
      : { clase: "NO_IDENTIFICADA", mensaje: `La unidad externa elegida (#${-n}) no existe en esta empresa; elige otra.`, candidatos: [], registrable: false };
  }
  const placa = String(f.placaNormalizada || f.placa || "").trim(), m = identificarPlaca(placa, cat.vehiculos, v => v.placa);
  if (m.estado === "AMBIGUA") return { clase: "AMBIGUA", mensaje: `Varias unidades coinciden con «${original}»: ${m.candidatos.map(v => v.placa).join(" / ")}. Elige explícitamente la correcta; no se asigna ninguna automáticamente.`, candidatos: m.candidatos.map(v => String(v.id)), registrable: false };
  if (m.estado === "INEXISTENTE") {
    const { registrables, excluidas } = placasPendientes([f], cat);
    return { clase: "NO_IDENTIFICADA", mensaje: `La placa «${original}» no coincide con ninguna unidad interna ni externa registrada. Elige una unidad de Flota (si se escribió mal, se conserva el valor original) o confírmala como unidad externa.`, candidatos: [],
      registrable: registrables.length > 0, ...(excluidas[0] ? { motivoNoRegistrable: excluidas[0].motivo } : {}) };
  }
  return { clase: "SIN_ELEGIR", mensaje: `Unidad sugerida (${m.estado.toLowerCase()}): ${m.candidatos.map(v => v.placa).join(" / ")}. Confírmala eligiéndola.`, candidatos: m.candidatos.map(v => String(v.id)), registrable: false };
}
