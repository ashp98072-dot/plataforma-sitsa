import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CLIENTE_SESSION_COOKIE,
  createClienteSessionToken,
  setClienteSessionCookie,
  verifyClienteSessionToken,
} from "@/lib/tms/cliente-portal-session";
import { absoluteExpirySeconds, nowSeconds } from "@/lib/session-lifetime";

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo contrato EXACTO que
 * src/app/api/auth/activity/route.ts, para la sesión del Portal del
 * Cliente (cookie `sitsa_cliente_session`, `/cliente-portal`). Ver ese
 * archivo para el detalle de GET (valida sin renovar) vs. POST (reporta
 * actividad humana real, preserva `authAt`, actualiza `lastActivityAt`).
 */

async function leerToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(CLIENTE_SESSION_COOKIE)?.value;
}

export async function GET() {
  const token = await leerToken();
  if (!token) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }
  const payload = await verifyClienteSessionToken(token);
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
  const payload = await verifyClienteSessionToken(token);
  if (!payload) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }

  const nuevoToken = await createClienteSessionToken({
    ...payload,
    lastActivityAt: nowSeconds(),
  });
  const authAt = payload.authAt ?? nowSeconds();
  await setClienteSessionCookie(nuevoToken, Math.max(0, absoluteExpirySeconds(authAt) - nowSeconds()));

  return NextResponse.json({ vigente: true });
}
