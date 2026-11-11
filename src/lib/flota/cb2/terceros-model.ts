import { z } from "zod";
import { nombreComparable, placaComparable } from "../combustible-coincidencias";

const texto = z.string().trim().min(1).max(160).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const altaTercero = z.object({
  proveedorId: z.number().int().positive(), pilotoReferencia: texto, nombre: texto,
  unidadReferencia: texto, placa: texto.refine(v => !!placaComparable(v)),
  tipo: z.enum(["VEHICULO", "MOTOCICLETA"]), descripcion: texto,
  relacion: z.enum(["CONTRATISTA", "INDEPENDIENTE", "TERCERIZADO"]), evidencia: texto,
}).strict();
export type AsociacionExterna = {
  id: number; piloto_id: number; unidad_id: number; nombre: string; placa: string;
  tipo: string; descripcion: string; relacion: string; estado: string; revision: number;
  piloto_referencia: string; unidad_referencia: string;
};
/** Nombre solo no identifica una persona: exige asociación verificada nombre+unidad, sin homónimos. */
export function reconocerTercero(nombre: string, placa: string, catalogo: AsociacionExterna[]) {
  const n = nombreComparable(nombre), p = placaComparable(placa);
  if (!n || !p) return { estado: "PENDIENTE" as const, asociacion: null };
  // Incluir revocadas/pendientes en detección de colisiones: nunca redirigir silenciosamente.
  const personas = catalogo.filter(a => nombreComparable(a.nombre) === n);
  const unidades = catalogo.filter(a => placaComparable(a.placa) === p);
  const candidatas = personas.filter(a => placaComparable(a.placa) === p);
  const segura = candidatas.length === 1 && candidatas[0].estado === "VERIFICADA"
    && new Set(personas.map(a => a.piloto_id)).size === 1 && new Set(unidades.map(a => a.unidad_id)).size === 1;
  return { estado: segura ? "UNICA_VERIFICADA" as const : "PENDIENTE" as const, asociacion: segura ? candidatas[0] : null };
}
