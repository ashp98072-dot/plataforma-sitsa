import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  COLABORADOR_SESSION_COOKIE,
  createColaboradorSessionToken,
  setColaboradorSessionCookie,
  verifyColaboradorSessionToken,
} from "@/lib/rrhh/colaborador-session";
import { absoluteExpirySeconds, nowSeconds } from "@/lib/session-lifetime";

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo contrato EXACTO que
 * src/app/api/auth/activity/route.ts, para la sesión de colaborador
 * (cookie `sitsa_colab_session`, portal `/portal`). Ver ese archivo para
 * el detalle de GET (valida sin renovar) vs. POST (reporta actividad
 * humana real, preserva `authAt`, actualiza `lastActivityAt`).
 */

async function leerToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(COLABORADOR_SESSION_COOKIE)?.value;
}

export async function GET() {
  const token = await leerToken();
  if (!token) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }
  const payload = await verifyColaboradorSessionToken(token);
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
  const payload = await verifyColaboradorSessionToken(token);
  if (!payload) {
    return NextResponse.json({ vigente: false }, { status: 401 });
  }

  const nuevoToken = await createColaboradorSessionToken({
    ...payload,
    lastActivityAt: nowSeconds(),
  });
  const authAt = payload.authAt ?? nowSeconds();
  await setColaboradorSessionCookie(nuevoToken, Math.max(0, absoluteExpirySeconds(authAt) - nowSeconds()));

  return NextResponse.json({ vigente: true });
}
