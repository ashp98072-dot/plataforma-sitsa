import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/login", "/site"];
const COOKIE = "sitsa_session";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    return new TextEncoder().encode("dev-insecure-secret-change-me-32");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const token = request.cookies.get(COOKIE)?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, getSecret());
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (!valid && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (valid && pathname === "/login") {
    return NextResponse.redirect(new URL("/select-empresa", request.url));
  }
  if (valid && pathname === "/") {
    return NextResponse.redirect(new URL("/select-empresa", request.url));
  }
  // /rrhh es ruta autenticada (panel central)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
