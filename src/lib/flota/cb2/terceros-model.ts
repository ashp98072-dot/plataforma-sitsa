import { z } from "zod";
import { identificarPlaca, nombreComparable, placaComparable } from "../combustible-coincidencias";

const texto = z.string().trim().min(1).max(160).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const altaPiloto = z.object({ confirmarCoincidencias: z.boolean().optional(), referencia: texto, nombre: texto }).strict();
export const altaUnidad = z.object({ confirmarCoincidencias: z.boolean().optional(), referencia: texto, placa: texto.refine(v => !!placaComparable(v)), tipo: z.enum(["VEHICULO", "MOTOCICLETA"]), descripcion: texto }).strict();
export const altaAsociacion = z.object({ pilotoId: z.number().int().positive(), unidadId: z.number().int().positive(), relacion: z.enum(["CONTRATISTA", "INDEPENDIENTE", "TERCERIZADO"]), evidencia: texto }).strict();
export const altaCatalogo = z.discriminatedUnion("recurso", [altaPiloto.extend({ recurso: z.literal("PILOTO") }), altaUnidad.extend({ recurso: z.literal("UNIDAD") }), altaAsociacion.extend({ recurso: z.literal("ASOCIACION") })]);
export type PilotoTercero = { id: number; referencia: string; nombre: string };
export type UnidadTercera = { id: number; referencia: string; placa: string; tipo: string; descripcion: string };
export type CatalogosTerceros = { pilotos: PilotoTercero[]; unidades: UnidadTercera[]; asociaciones: AsociacionExterna[] };
export type AsociacionExterna = {
  id: number; piloto_id: number; unidad_id: number; nombre: string; placa: string;
  tipo: string; descripcion: string; relacion: string; estado: string; revision: number;
  piloto_referencia: string; unidad_referencia: string;
  creado_por?: number; verificado_por?: number | null;
};
/** Nombre solo no identifica una persona: exige asociación verificada nombre+unidad, sin homónimos. */
export function reconocerTercero(nombre: string, placa: string, catalogo: AsociacionExterna[], identidades?: Pick<CatalogosTerceros, "pilotos" | "unidades">) {
  const n = nombreComparable(nombre), p = placaComparable(placa);
  if (!n || !p) return { estado: "PENDIENTE" as const, asociacion: null };
  // Incluir revocadas/pendientes en detección de colisiones: nunca redirigir silenciosamente.
  const personas = catalogo.filter(a => nombreComparable(a.nombre) === n);
  const registradas = identidades?.unidades ?? [...new Map(catalogo.map(a => [a.unidad_id, { id: a.unidad_id, placa: a.placa }])).values()];
  const ids = new Set(identificarPlaca(placa, registradas, u => u.placa).candidatos.map(u => u.id));
  const unidades = catalogo.filter(a => ids.has(a.unidad_id));
  const candidatas = personas.filter(a => ids.has(a.unidad_id));
  const segura = candidatas.length === 1 && candidatas[0].estado === "VERIFICADA"
    && new Set(personas.map(a => a.piloto_id)).size === 1 && new Set(unidades.map(a => a.unidad_id)).size === 1
    && (!identidades || (new Set(identidades.pilotos.filter(a => nombreComparable(a.nombre) === n).map(a => a.id)).size === 1 && ids.size === 1));
  return { estado: segura ? "UNICA_VERIFICADA" as const : "PENDIENTE" as const, asociacion: segura ? candidatas[0] : null };
}
