import { z } from "zod";
import { faltantesAlta } from "./empleado-validacion";

const optStr = z.string().optional().nullable();
/**
 * Valida que un texto sea una fecha calendario real en formato YYYY-MM-DD
 * (rechaza cosas como "aaaaaaaa", "2026-13-01" o "2026-02-30").
 */
function esFechaValida(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const anio = Number(y);
  const mes = Number(mo);
  const dia = Number(d);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

const MSG_FECHA_INVALIDA = "Fecha inválida (formato esperado YYYY-MM-DD).";

/** Fecha obligatoria: string no vacío que debe ser una fecha calendario real. */
const fechaRequerida = z
  .string()
  .min(8)
  .refine(esFechaValida, { message: MSG_FECHA_INVALIDA });

/** Fecha opcional: si viene, debe ser una fecha calendario real; permite vacío/null. */
const fechaOpcional = z
  .string()
  .refine(esFechaValida, { message: MSG_FECHA_INVALIDA })
  .optional()
  .nullable()
  .or(z.literal(""));

/** Body compartido crear/actualizar empleado (ficha Monaco). */
export const empleadoBodySchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().optional().default(""),
  puesto: z.string().optional(),
  categoriaOps: z.string().optional(),
  tipoHorario: z.enum(["Fijo", "Variable"]).default("Fijo"),
  fechaAlta: fechaRequerida,
  fechaInicioLaboral: fechaOpcional,
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
  fechaNacimiento: fechaOpcional,
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
  licenciaVence: fechaOpcional,
  fechaEgreso: fechaOpcional,
  observaciones: optStr,
  cuentaBancaria: optStr,
  tipoCuenta: optStr,
  banco: optStr,
  contactoEmergencia: optStr,
  // Fase H1: elegibilidad individual de horas extra — solo RRHH/admin la
  // cambia, desde este mismo formulario de edición de empleado.
  horasExtraHabilitado: z.boolean().optional(),
  // Supervisores del empleado (ficha, sección Laboral) — uno, varios o
  // ninguno. Acepta [], un elemento, varios, o campo omitido (= sin
  // cambios/sin supervisores). Validación de existencia/misma-empresa/
  // activo/no-auto-referencia ocurre en supervisoresValidos()
  // (src/lib/rrhh/empleados.ts), no aquí.
  supervisorIds: z.array(z.number().int().positive()).max(50).optional(),
  /** Entrevista aprobada de origen; permite trasladar su papelería al expediente laboral. */
  entrevistaId: z.number().int().positive().optional(),
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
