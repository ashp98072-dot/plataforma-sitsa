import { z } from "zod";
import { faltantesAlta } from "./empleado-validacion";

const optStr = z.string().optional().nullable();
const optNum = z.number().optional().nullable();

/** Body compartido crear/actualizar empleado (ficha Monaco). */
export const empleadoBodySchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().optional().default(""),
  puesto: z.string().optional(),
  categoriaOps: z.string().optional(),
  tipoHorario: z.enum(["Fijo", "Variable"]).default("Fijo"),
  fechaAlta: z.string().min(8),
  fechaInicioLaboral: z.string().nullable().optional(),
  horaEntradaTeorica: z.string().optional(),
  horaSalidaTeorica: z.string().optional(),
  estado: z.enum(["Activo", "Baja"]).default("Activo"),
  dpi: z
    .string()
    .regex(/^\d{13}$/, "El DPI debe tener 13 dígitos")
    .optional()
    .nullable()
    .or(z.literal("")),
  nit: optStr,
  igss: optStr,
  irtra: optStr,
  telefono: optStr,
  email: z.string().email("Email inválido").optional().nullable().or(z.literal("")),
  direccion: optStr,
  sexo: optStr,
  fechaNacimiento: optStr,
  tipoContrato: optStr,
  formaPago: optStr,
  sueldoBase: z.number().min(0, "El sueldo base no puede ser negativo").optional().nullable(),
  bonoIncentivo: z.number().min(0, "La bonificación no puede ser negativa").optional().nullable(),
  bonoHerramientas: z.number().min(0, "El bono de herramientas no puede ser negativo").optional().nullable(),
  profesion: optStr,
  primerNombre: optStr,
  segundoNombre: optStr,
  tercerNombre: optStr,
  cuartoNombre: optStr,
  primerApellido: optStr,
  segundoApellido: optStr,
  apellidoCasada: optStr,
  paisOrigen: optStr,
  municipio: optStr,
  etnia: optStr,
  religion: optStr,
  idioma: optStr,
  licenciaNumero: optStr,
  licenciaTipo: optStr,
  licenciaVence: optStr,
  fechaEgreso: optStr,
  observaciones: optStr,
  cuentaBancaria: optStr,
  tipoCuenta: optStr,
  banco: optStr,
  contactoEmergencia: optStr,
});

export type EmpleadoBody = z.infer<typeof empleadoBodySchema>;

/** Valida campos obligatorios del cuestionario Monaco. */
export function validarAltaMonaco(data: EmpleadoBody): string | null {
  const { labels } = faltantesAlta(data as Record<string, unknown>);
  if (labels.length === 0) return null;
  return `Faltan campos obligatorios: ${labels.slice(0, 8).join(", ")}${
    labels.length > 8 ? ` (+${labels.length - 8} más)` : ""
  }.`;
}