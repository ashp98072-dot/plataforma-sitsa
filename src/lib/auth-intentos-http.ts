import { NextResponse } from "next/server";

/**
 * A4 — respuestas HTTP comunes de los tres logins. Mensajes GENÉRICOS: no revelan si el identificador existe, ni detalles de la base o de la protección.
 */
const SIN_CACHE = { "Cache-Control": "no-store, private", Pragma: "no-cache" };

/** Cuerpo JSON de la solicitud, o `null` si no es JSON válido (B3: la ruta responde 400, no 500). */
export async function leerCuerpoJson(request: Request): Promise<{ ok: true; valor: unknown } | { ok: false }> {
  try { return { ok: true, valor: await request.json() }; } catch { return { ok: false }; }
}

export function respuestaBloqueado(retryAfterS: number): NextResponse {
  return NextResponse.json({ error: "Demasiados intentos. Intenta de nuevo más tarde." }, { status: 429, headers: { ...SIN_CACHE, "Retry-After": String(retryAfterS) } });
}

export function respuestaNoDisponible(): NextResponse {
  return NextResponse.json({ error: "El inicio de sesión no está disponible en este momento. Intenta de nuevo en unos minutos." }, { status: 503, headers: { ...SIN_CACHE, "Retry-After": "60" } });
}
