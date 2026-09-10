import { z } from "zod";
import { normalizarHora } from "@/lib/rrhh/dates";
import type { EtiquetaCampo } from "@/lib/validacion-http";

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§10/§12 del ticket) — schemas compartidos
 * entre POST (crear) y PATCH (editar) de una ruta, con mensajes de Zod
 * pensados para el nuevo formato "Campo: motivo" (ver etiquetaCampoRuta
 * más abajo y respuestaErrorValidacion en @/lib/validacion-http) — cada
 * `.min()/.max()/.regex()` lleva SOLO el motivo (nunca repite el nombre
 * del campo, eso lo agrega el label al armar el mensaje final).
 */

export const paradaSchema = z.object({
  tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
  lugarNombre: z.string().min(1, "es obligatorio.").max(200, "máximo 200 caracteres."),
  clienteUbicacionId: z.number().int().positive("ubicación no válida.").optional(),
});

export const personalSchema = z.object({
  empleadoId: z.number().int().positive("empleado no válido."),
  rol: z.enum(["Piloto", "Auxiliar"]),
  viaticoMonto: z.number().min(0, "debe ser mayor o igual a Q0.00.").max(9999999999.99, "valor demasiado grande.").nullable().optional(),
});

/** Reutiliza normalizarHora() (src/lib/rrhh/dates.ts) — mismo criterio de formato que ya usa el resto de la app, nunca una regex propia paralela. */
const horaHabitualSchema = z.string().max(20).refine((v) => normalizarHora(v) != null, {
  error: "formato inválido (usa HH:MM, 24 horas).",
});

const tarifaReferenciaSchema = z.number()
  .min(0, "debe ser mayor o igual a Q0.00.")
  .max(9999999999.99, "valor demasiado grande.");

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const crearRutaSchema = z.object({
  clienteId: z.number({ error: "selecciona un cliente." }).int("selecciona un cliente.").positive("selecciona un cliente."),
  codigo: z.string({ error: "es obligatorio." }).min(1, "es obligatorio.").max(40, "máximo 40 caracteres."),
  nombre: z.string().max(200, "máximo 200 caracteres.").optional(),
  ubicacionCargaId: z.number().int().positive("ubicación no válida.").optional(),
  lugarCargaTexto: z.string().max(300, "máximo 300 caracteres.").optional(),
  destinoDescripcion: z.string().max(300, "máximo 300 caracteres.").optional(),
  horaHabitual: horaHabitualSchema.optional(),
  tarifaReferencia: tarifaReferenciaSchema.nullable().optional(),
  // RUTAS-TARIFARIO-HISTORIAL-1 (§5) — metadatos del cambio de tarifa;
  // solo tienen efecto si tarifaReferencia viene con valor.
  tarifaVigenteDesde: z.string().regex(FECHA_REGEX, "fecha inválida (usa AAAA-MM-DD).").optional(),
  tarifaMotivo: z.string().max(300, "máximo 300 caracteres.").optional(),
  // TMS-SIN-COSTO-OPERATIVO-1: negocio confirmó que ya no se utiliza — se
  // deja aceptado aquí SOLO por compatibilidad con clientes/integraciones
  // antiguas que aún lo envíen (nunca exigido); crearRuta (cliente-rutas.ts)
  // ya no lo lee ni lo persiste. La UI nueva (rutas/page.tsx) no lo envía.
  costoOperativo: z.number().min(0).max(9999999999.99).nullable().optional(),
  // RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§4) — flota_vehiculos.id de la misma empresa (validado en cliente-rutas.ts); null lo quita.
  unidadRecurrenteId: z.number().int().positive("unidad no válida.").nullable().optional(),
  contactoClienteId: z.number().int().positive("contacto no válido.").optional(),
  observaciones: z.string().max(300, "máximo 300 caracteres.").optional(),
  paradas: z.array(paradaSchema).max(20, "máximo 20 paradas.").optional(),
  personalPredeterminado: z.array(personalSchema).max(9, "máximo 1 piloto y 8 auxiliares.").optional(),
});

export const actualizarRutaSchema = z.object({
  codigo: z.string().min(1, "es obligatorio.").max(40, "máximo 40 caracteres.").optional(),
  nombre: z.string().max(200, "máximo 200 caracteres.").nullable().optional(),
  ubicacionCargaId: z.number().int().positive("ubicación no válida.").nullable().optional(),
  lugarCargaTexto: z.string().max(300, "máximo 300 caracteres.").nullable().optional(),
  destinoDescripcion: z.string().max(300, "máximo 300 caracteres.").nullable().optional(),
  horaHabitual: horaHabitualSchema.nullable().optional(),
  tarifaReferencia: tarifaReferenciaSchema.nullable().optional(),
  tarifaVigenteDesde: z.string().regex(FECHA_REGEX, "fecha inválida (usa AAAA-MM-DD).").optional(),
  tarifaMotivo: z.string().max(300, "máximo 300 caracteres.").optional(),
  costoOperativo: z.number().min(0).max(9999999999.99).nullable().optional(),
  unidadRecurrenteId: z.number().int().positive("unidad no válida.").nullable().optional(),
  contactoClienteId: z.number().int().positive("contacto no válido.").nullable().optional(),
  observaciones: z.string().max(300, "máximo 300 caracteres.").nullable().optional(),
  paradas: z.array(paradaSchema).max(20, "máximo 20 paradas.").optional(),
  personalPredeterminado: z.array(personalSchema).max(9, "máximo 1 piloto y 8 auxiliares.").optional(),
  activo: z.boolean().optional(),
});

const ETIQUETAS: Record<string, string> = {
  clienteId: "Cliente", codigo: "Código", nombre: "Nombre/descripción",
  ubicacionCargaId: "Lugar de carga (ubicación guardada)", lugarCargaTexto: "Lugar de carga",
  destinoDescripcion: "Destino", horaHabitual: "Hora habitual",
  tarifaReferencia: "Tarifa de referencia", tarifaVigenteDesde: "Vigente desde",
  tarifaMotivo: "Motivo del cambio de tarifa", costoOperativo: "Costo operativo",
  unidadRecurrenteId: "Unidad recurrente",
  contactoClienteId: "Contacto del cliente", observaciones: "Observaciones", activo: "Estado",
  paradas: "Paradas",
};

/**
 * §10/§11 del ticket — etiqueta legible por campo, incluyendo filas de
 * `personalPredeterminado` (distingue "Piloto habitual" de "Auxiliar
 * habitual" mirando el `rol` de ESA fila en el body original — el
 * ZodError por sí solo no lo sabe, `body` sí) y de `paradas` (por
 * número, "Parada N").
 */
export function etiquetaCampoRuta(path: PropertyKey[], body: unknown): string {
  const [first, index, campo] = path;
  if (first === "personalPredeterminado") {
    const fila = (body as { personalPredeterminado?: { rol?: string }[] } | null)?.personalPredeterminado?.[Number(index)];
    const base = fila?.rol === "Piloto" ? "Piloto habitual" : fila?.rol === "Auxiliar" ? "Auxiliar habitual" : "Personal habitual";
    if (campo === "viaticoMonto") return `${base} (viático)`;
    return base;
  }
  if (first === "paradas") {
    return typeof index === "number" ? `Parada ${index + 1}` : "Paradas";
  }
  return ETIQUETAS[String(first)] ?? String(first || "Valor");
}

export const etiquetaCampoRutaFactory = (body: unknown): EtiquetaCampo => (path) => etiquetaCampoRuta(path, body);
