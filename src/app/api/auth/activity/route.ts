import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  createSessionToken,
  setSessionCookie,
  verifySessionToken,
} from "@/lib/session";
import { absoluteExpirySeconds, nowSeconds } from "@/lib/session-lifetime";

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — núcleo de sesiones.
 *
 * GET  — valida vigencia SIN renovar actividad. Usado al recuperar
 *        pestaña (focus/visibilitychange, ver session-inactivity-guard.tsx):
 *        esa validación NO debe contar como actividad humana ni reemitir
 *        el token — ni siquiera para migrar un token heredado. Responde
 *        401 si la sesión no existe o ya expiró (inactividad o máximo
 *        absoluto), 200 si sigue vigente.
 *
 * POST — reporta actividad humana REAL (pointerdown/keydown/touchstart
 *        con `event.isTrusted`, ya filtrados del lado del cliente antes
 *        de llegar aquí — el servidor nunca confía en esa marca, solo en
 *        que la request llegó). Preserva `authAt` tal cual (nunca lo
 *        reinicia) y actualiza `lastActivityAt` con la hora del
 *        SERVIDOR — `verifySessionToken` ya garantiza que nunca se llega
 *        aquí con una sesión ya expirada (ni por inactividad ni por el
 *        máximo absoluto), así que esta reemisión nunca extiende la
 *        sesión más allá de `authAt + 12h`. Aquí, y SOLO aquí, un token
 *        heredado (sin `authAt`/`lastActivityAt` propios) se migra al
 *        formato nuevo — nunca en una lectura pasiva.
 */

async function leerToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function GET() {
  const token = await leerToken();
  if (!token) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }
  const payload = await verifySessionToken(token);
  if (!payload) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }
  return NextResponse.json({ vigente: true });
}

export async function POST() {
  const token = await leerToken();
  if (!token) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }
  const payload = await verifySessionToken(token);
  if (!payload) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }

  const nuevoToken = await createSessionToken({
    ...payload,
    lastActivityAt: nowSeconds(),
  });
  const authAt = payload.authAt ?? nowSeconds();
  await setSessionCookie(nuevoToken, Math.max(0, absoluteExpirySeconds(authAt) - nowSeconds()));

  return NextResponse.json({ vigente: true });
}
