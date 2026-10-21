import { NextResponse } from "next/server";
import type { ZodError, z } from "zod";
import { cuerpoErrores, erroresDeZod, respuestaDeExcepcion, type CampoDominio, type ConfigErrores } from "@/lib/validacion-formulario";

/**
 * ERRORES DE VALIDACIÓN POR LÍNEA — Solicitudes de fondo y Gastos operativos. Nombres tal como los ve el usuario en pantalla
 * (fondos/page.tsx y gastos/page.tsx); las líneas se numeran como "Línea N" igual que el formulario.
 */
const ETIQUETAS_COMUNES: Record<string, string> = {
  entidadRequirenteId: "Empresa requirente",
  requirenteEmpleadoId: "Requirente",
  requirenteNombre: "Requirente",
  requirenteUsuarioId: "Requirente",
  solicitanteUsuarioId: "Solicitante",
  observaciones: "Observaciones",
  lineas: "Líneas de gasto",
  categoria: "Categoría",
  descripcion: "Descripción",
  cantidad: "Cantidad",
  monto: "Monto",
  fechaViaje: "Fecha de viaje",
  empleadoId: "Empleado",
  vehiculoId: "Unidad",
  clienteId: "Cliente",
  planId: "Viaje / Plan",
  metodoPago: "Método de pago",
  accion: "Acción",
};

const MENSAJES_COMUNES: ConfigErrores["mensajes"] = {
  entidadRequirenteId: { requerido: "selecciona la empresa requirente.", positivo: "selecciona la empresa requirente." },
  requirenteUsuarioId: { requerido: "selecciona un requirente.", positivo: "selecciona un requirente válido." },
  requirenteEmpleadoId: { positivo: "selecciona un requirente válido." },
  solicitanteUsuarioId: { requerido: "selecciona el solicitante.", positivo: "selecciona un solicitante válido." },
  categoria: { requerido: "selecciona una categoría.", opcion: "selecciona una categoría." },
  metodoPago: { opcion: "selecciona un método de pago válido." },
  empleadoId: { positivo: "selecciona un empleado válido." },
  vehiculoId: { positivo: "selecciona una unidad válida." },
  clienteId: { positivo: "selecciona un cliente válido." },
  planId: { positivo: "selecciona un viaje válido." },
  fechaViaje: { formato: "usa una fecha válida." },
  fechaRequerimiento: { requerido: "la fecha es obligatoria.", formato: "usa una fecha válida." },
  fechaSolicitud: { requerido: "la fecha es obligatoria.", formato: "usa una fecha válida." },
  accion: { opcion: "la acción no es válida." },
};

export const CONFIG_FONDOS: ConfigErrores = {
  etiquetas: {
    ...ETIQUETAS_COMUNES,
    fechaRequerimiento: "Fecha de requerimiento",
    empleadoNombreOverride: "Nombre",
    cuentaOverride: "Cuenta",
    cargoOverride: "Cargo",
    autorizanteEmpleadoId: "Autorizante",
    motivoRechazo: "Motivo del rechazo",
  },
  colecciones: { lineas: "Línea" },
  mensajes: MENSAJES_COMUNES,
  moneda: ["monto"],
};

export const CONFIG_GASTOS: ConfigErrores = {
  etiquetas: {
    ...ETIQUETAS_COMUNES,
    fechaSolicitud: "Fecha de solicitud",
    numeroCuentaPago: "Cuenta",
    tieneFactura: "Factura",
    activo: "Activo",
  },
  colecciones: { lineas: "Línea" },
  mensajes: MENSAJES_COMUNES,
  moneda: ["monto"],
};

/**
 * Errores de negocio de UNA línea (relaciones inexistentes, cuenta de transferencia móvil…): se infiere el campo del texto
 * para poder señalar "Línea N — Empleado / Unidad / Cliente / Viaje / Cuenta".
 */
function camposDominio(campoCuenta: string): CampoDominio[] {
  return [
    { patron: /transferencia m[oó]vil/i, campo: campoCuenta, etiqueta: "Cuenta" },
    { patron: /empleado/i, campo: "empleadoId", etiqueta: "Empleado" },
    { patron: /veh[ií]culo|unidad/i, campo: "vehiculoId", etiqueta: "Unidad" },
    { patron: /cliente/i, campo: "clienteId", etiqueta: "Cliente" },
    { patron: /viaje|plan\b/i, campo: "planId", etiqueta: "Viaje / Plan" },
  ];
}
export const CAMPOS_DOMINIO_FONDOS = camposDominio("cuentaOverride");
export const CAMPOS_DOMINIO_GASTOS = camposDominio("numeroCuentaPago");

/**
 * Pre-validación PURA (sin base de datos) de la cuenta de «Transferencia móvil», para que ese error salga junto con los demás de la
 * misma línea y no recién dentro de la transacción. Misma regla que normalizarDestinoPago (gastos.ts): obligatoria, 8–15 dígitos,
 * «+» solo al inicio, ignorando espacios y guiones. Si la cuenta no viene en el payload pero hay empleado, el destino sale del
 * teléfono de RRHH y lo valida el servidor (requiere consultar la base): aquí no se prejuzga.
 *
 * `nullEsVacio`: en Gastos `null` significa «campo vacío» (error); en Fondos `null`/ausente significa «usa el dato del empleado».
 */
const REGEX_MOVIL = /^\+?\d{8,15}$/;
const MSG_MOVIL_OBLIGATORIA = "es obligatoria para transferencia móvil.";
const MSG_MOVIL_FORMATO = 'para transferencia móvil debe tener entre 8 y 15 dígitos (puede iniciar con "+").';

/** Qué le pasa a la cuenta móvil de una fila: "falta", "formato" o null (válida / no aplica). Tolerante a filas con otros campos inválidos. */
export function problemaCuentaMovil(fila: unknown, campo: string, nullEsVacio: boolean): "falta" | "formato" | null {
  if (!fila || typeof fila !== "object") return null;
  const l = fila as Record<string, unknown>;
  if (l.metodoPago !== "Transferencia móvil") return null;
  const cuenta = l[campo];
  if (cuenta !== undefined && cuenta !== null && typeof cuenta !== "string") return null; // tipo inválido: ya lo señala el schema
  const sinDato = cuenta === undefined || (cuenta === null && !nullEsVacio);
  if (sinDato) return l.empleadoId == null ? "falta" : null;
  const limpio = (cuenta ?? "").trim();
  if (!limpio) return "falta";
  return REGEX_MOVIL.test(limpio.replace(/[\s-]/g, "")) ? null : "formato";
}

/**
 * Aplica la pre-validación a un schema de FILA. Usa `when: () => true` porque Zod 4 omite los refinamientos de una fila cuando otro
 * campo falla por tipo/enum (p. ej. categoría vacía) y aquí se quiere informar TODO junto.
 */
export function conCuentaMovil<S extends z.ZodType>(schema: S, campo: string, nullEsVacio: boolean, omitirSi?: (fila: unknown) => boolean): S {
  const problema = (fila: unknown) => (omitirSi?.(fila) ? null : problemaCuentaMovil(fila, campo, nullEsVacio));
  return schema
    .refine((fila) => problema(fila) !== "falta", { path: [campo], message: MSG_MOVIL_OBLIGATORIA, when: () => true })
    .refine((fila) => problema(fila) !== "formato", { path: [campo], message: MSG_MOVIL_FORMATO, when: () => true }) as S;
}

/** 400 con `error` (compatibilidad) + `errores` estructurados, a partir de un ZodError. */
export function respuestaErroresZod(error: ZodError, cfg: ConfigErrores, payload: unknown): NextResponse {
  return NextResponse.json(cuerpoErrores(erroresDeZod(error, cfg, payload)), { status: 400 });
}

/** catch de una operación: validación de negocio -> 400 + errores; mensaje de dominio -> 400; error técnico -> 500 seguro (se registra en el servidor). */
export function respuestaFalloOperacion(error: unknown, contexto: string): NextResponse {
  const r = respuestaDeExcepcion(error);
  if (r.status === 500) console.error(contexto, error);
  return NextResponse.json(r.cuerpo, { status: r.status });
}
