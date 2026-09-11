import { NextResponse } from "next/server";
import {
  createClienteSessionToken,
  getClienteSession,
  setClienteSessionCookie,
} from "@/lib/tms/cliente-portal-session";
import {
  currentServerSeconds,
  sessionAbsoluteExpiresAt,
  sessionIdleExpiresAt,
} from "@/lib/session-lifetime";

function responseFor(session: { authAt: number; lastActivityAt: number }) {
  return NextResponse.json({ serverNow: currentServerSeconds(), lastActivityAt: session.lastActivityAt, idleExpiresAt: sessionIdleExpiresAt(session.lastActivityAt), absoluteExpiresAt: sessionAbsoluteExpiresAt(session.authAt) });
}

export async function GET() {
  const session = await getClienteSession();
  const authAt = session?.authAt;
  const lastActivityAt = session?.lastActivityAt;
  return authAt && lastActivityAt ? responseFor({ authAt, lastActivityAt }) : NextResponse.json({ error: "Sesión expirada." }, { status: 401 });
}

export async function POST() {
  const session = await getClienteSession();
  if (!session?.authAt || !session.lastActivityAt) return NextResponse.json({ error: "Sesión expirada." }, { status: 401 });
  const now = currentServerSeconds();
  const renewed = { authAt: session.authAt, lastActivityAt: now };
  await setClienteSessionCookie(await createClienteSessionToken(session, { renewActivity: true, nowSeconds: now }));
  return responseFor(renewed);
}
