import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§10/§11 del ticket) — problema real: al
 * fallar la validación de un formulario, el endpoint devolvía solo
 * "Datos inválidos.", sin decir qué campo. Este helper construye un
 * mensaje legible POR CAMPO ("• Campo: motivo.") a partir de un
 * ZodError, más un mapa `campos` (path -> mensaje) para que el frontend
 * pueda resaltar el campo exacto — nunca expone el valor rechazado, solo
 * la regla que falló (mismo criterio de no-filtrar-datos-sensibles ya
 * usado en empleados/route.ts).
 *
 * `etiqueta` recibe el `path` completo de cada issue de Zod (incluye
 * índices de array) para que el caller pueda dar una etiqueta específica
 * incluso a filas de un arreglo (p. ej. "Piloto habitual" vs "Auxiliar
 * habitual" según el `rol` de esa fila en el body original) — este
 * módulo no conoce la forma de ningún formulario en particular.
 */
export type EtiquetaCampo = (path: PropertyKey[]) => string;

export function mensajesPorCampo(
  error: ZodError,
  etiqueta: EtiquetaCampo,
): { campo: string; mensaje: string }[] {
  return error.issues.map((issue) => {
    const campo = issue.path.map(String).join(".");
    const texto = etiqueta(issue.path);
    return { campo, mensaje: `${texto}: ${issue.message}` };
  });
}

/**
 * Respuesta 400 lista para devolver desde un route handler: `error` es
 * el texto completo ("Título:\n• campo: mensaje\n..."), y `campos` es
 * {path: mensaje} para que el frontend marque el input exacto. Nunca
 * incluye SQL ni stack traces — solo la etiqueta del campo + el mensaje
 * de la regla Zod que se le haya dado explícitamente al construir el
 * schema.
 */
export function respuestaErrorValidacion(
  error: ZodError,
  etiqueta: EtiquetaCampo,
  titulo: string,
): NextResponse {
  const items = mensajesPorCampo(error, etiqueta);
  const resumen = `${titulo}:\n${items.map((it) => `• ${it.mensaje}`).join("\n")}`;
  const campos: Record<string, string> = {};
  for (const it of items) campos[it.campo] = it.mensaje;
  return NextResponse.json({ error: resumen, campos }, { status: 400 });
}
