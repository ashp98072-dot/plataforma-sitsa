import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-de-al-menos-16-caracteres";
});
afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

async function importFresh() {
  return await import("./middleware");
}

function req(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const headers: Record<string, string> = { host: "app.plataforma-inexistente.invalid" };
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieHeader) headers.cookie = cookieHeader;
  return new NextRequest(new Request(`https://app.plataforma-inexistente.invalid${pathname}`, { headers }));
}

async function tokenStaff(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
  return new SignJWT({ id: 1, username: "hsitan", rol: "Operaciones", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(typeof claims.iat === "number" ? claims.iat : undefined)
    .setExpirationTime(typeof claims.exp === "number" ? claims.exp : "12h")
    .sign(secret);
}

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — verifica que el middleware use
 * EXACTAMENTE la misma lógica temporal que session.ts/
 * colaborador-session.ts/cliente-portal-session.ts (compartida vía
 * session-lifetime.ts) — no una reimplementación propia que pudiera
 * divergir. Dominio de plataforma (host sin mapear en dominios.ts), no
 * dominio de empresa, para no arrastrar la lógica de reescritura de rutas
 * (ajena a este ticket).
 */
describe("middleware — vigencia de sesión (SEGURIDAD-SESION-AUTOREFRESCO Fase 1)", () => {
  it("sesión con formato nuevo (authAt/lastActivityAt) vigente -> deja pasar (NextResponse.next)", async () => {
    const { middleware } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const token = await tokenStaff({ authAt: now - 60, lastActivityAt: now - 30 });
    const res = await middleware(req("/select-empresa", { sitsa_session: token }));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("inactivo 30 min o más (formato nuevo) -> redirige a /login, aunque exp (12h) no haya llegado", async () => {
    const { middleware } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const token = await tokenStaff({ authAt: now - 3600, lastActivityAt: now - 30 * 60 });
    const res = await middleware(req("/select-empresa", { sitsa_session: token }));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("12h o más desde authAt (formato nuevo) -> redirige a /login", async () => {
    const { middleware } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const token = await tokenStaff({ authAt: now - 12 * 3600, lastActivityAt: now, exp: now + 999_999 });
    const res = await middleware(req("/select-empresa", { sitsa_session: token }));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("token heredado (sin authAt/lastActivityAt) con iat reciente -> deja pasar", async () => {
    const { middleware } = await importFresh();
    const res = await middleware(req("/select-empresa", { sitsa_session: await tokenStaff({}) }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("token heredado con iat de 30 min o más -> redirige a /login", async () => {
    const { middleware } = await importFresh();
    const iatViejo = Math.floor(Date.now() / 1000) - 30 * 60;
    const res = await middleware(req("/select-empresa", { sitsa_session: await tokenStaff({ iat: iatViejo }) }));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("sin cookie -> redirige a /login (comportamiento previo, sin cambios)", async () => {
    const { middleware } = await importFresh();
    const res = await middleware(req("/select-empresa"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("ruta pública (/login) nunca redirige aunque no haya sesión — evita loop", async () => {
    const { middleware } = await importFresh();
    const res = await middleware(req("/login"));
    expect(res.headers.get("location")).toBeNull();
  });
});
