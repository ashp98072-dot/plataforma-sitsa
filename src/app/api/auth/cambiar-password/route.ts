import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-guard";
import { cambiarPasswordUsuarioActual } from "@/lib/auth";
import { MSG_CAMBIO_PASSWORD_FALLIDO, validarCambioPassword } from "@/lib/cambio-password";
import { clearSessionCookie } from "@/lib/session";

/**
 * MENÚ DE CUENTA — POST /api/auth/cambiar-password: el usuario autenticado cambia SU PROPIA contraseña.
 * - El usuario sale SIEMPRE de la sesión (requireSession); el esquema ESTRICTO rechaza cualquier id/username del cuerpo.
 * - Respuestas genéricas; nunca devuelve ni registra contraseñas ni hashes.
 * - Tras el cambio cierra la sesión actual (borra la cookie): el cliente redirige a /login. La sesión es un JWT sin
 *   versión en BD, así que no hay invalidación más precisa sin cambiar el esquema.
 */
const schema = z
  .object({
    passwordActual: z.string().max(256),
    passwordNueva: z.string().max(256),
    confirmarPassword: z.string().max(256),
  })
  .strict();

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const guard = await requireSession();
  if (guard.error) return guard.error;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore });
  }
  const parsed = schema.safeParse(cuerpo);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore });
  }
  const error = validarCambioPassword(parsed.data);
  if (error) return NextResponse.json({ error }, { status: 400, headers: noStore });

  try {
    const r = await cambiarPasswordUsuarioActual(guard.user.id, parsed.data.passwordActual, parsed.data.passwordNueva);
    if (!r.ok) {
      return NextResponse.json({ error: MSG_CAMBIO_PASSWORD_FALLIDO }, { status: 400, headers: noStore });
    }
  } catch {
    // Sin detalle del error: podría arrastrar parámetros de la consulta.
    console.error("cambiar-password: error inesperado al actualizar la contraseña");
    return NextResponse.json({ error: MSG_CAMBIO_PASSWORD_FALLIDO }, { status: 500, headers: noStore });
  }

  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: "/login" }, { headers: noStore });
}
