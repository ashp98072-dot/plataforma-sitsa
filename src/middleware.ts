import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { homePorRol, slugPorHost } from "@/lib/dominios";
import { getAuthSecretBytes } from "@/lib/auth-secret";

const PUBLIC = ["/login", "/site"];
const COOKIE = "sitsa_session";

const COLABORADOR_COOKIE = "sitsa_colab_session";
const PORTAL_PUBLIC = ["/portal/login"];

function getSecret(): Uint8Array {
  return getAuthSecretBytes();
}

type SessionLite = { rol?: string; empresaSlug?: string | null };

async function readSession(
  token: string | undefined,
): Promise<SessionLite | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      rol: payload.rol ? String(payload.rol) : undefined,
      empresaSlug: payload.empresaSlug
        ? String(payload.empresaSlug)
        : null,
    };
  } catch {
    return null;
  }
}

type ColaboradorSessionLite = {
  empleadoId?: number;
  debeCambiarPassword?: boolean;
};

/** Igual que readSession pero para la cookie separada del portal de colaborador. */
async function readColaboradorSession(
  token: string | undefined,
): Promise<ColaboradorSessionLite | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const empleadoId = payload.empleadoId ? Number(payload.empleadoId) : undefined;
    if (!empleadoId) return null;
    return {
      empleadoId,
      debeCambiarPassword: Boolean(payload.debeCambiarPassword),
    };
  } catch {
    return null;
  }
}

/** Rutas cortas en dominio de empresa → rutas /e/[slug]/... */
function rewriteEmpresaPath(pathname: string, slug: string): string | null {
  if (pathname === "/dashboard-rrhh" || pathname === "/dashboardrrhh") {
    return `/e/${slug}/dashboard-rrhh`;
  }
  if (
    pathname === "/dashboard-operaciones" ||
    pathname === "/dashboardoperaciones"
  ) {
    return `/e/${slug}/dashboard-operaciones`;
  }
  if (pathname === "/personal" || pathname === "/empleados") {
    return `/e/${slug}/rrhh/empleados`;
  }
  if (pathname === "/vacaciones") return `/e/${slug}/rrhh/vacaciones`;
  if (pathname === "/marcajes" || pathname === "/asistencias") {
    return `/e/${slug}/rrhh/marcajes`;
  }
  if (pathname === "/planillas") return `/e/${slug}/rrhh/planillas`;
  if (pathname === "/descuentos") return `/e/${slug}/rrhh/descuentos`;
  if (pathname === "/prestaciones") return `/e/${slug}/rrhh/prestaciones`;
  if (pathname === "/configuracion-rrhh" || pathname === "/config-rrhh") {
    return `/e/${slug}/rrhh/configuracion`;
  }
  if (pathname === "/en-ruta" || pathname === "/enruta") {
    return `/e/${slug}/rrhh/en-ruta`;
  }
  if (pathname === "/reportes") return `/e/${slug}/rrhh/reportes`;
  if (pathname === "/incidencias") return `/e/${slug}/rrhh/incidencias`;
  if (pathname === "/contabilidad") return `/e/${slug}/contabilidad`;
  if (pathname === "/facturacion") return `/e/${slug}/facturacion`;
  if (pathname === "/clientes") return `/e/${slug}/clientes`;
  if (pathname === "/tms" || pathname === "/transporte") {
    return `/e/${slug}/tms`;
  }
  if (
    pathname === "/disponibilidad" ||
    pathname === "/disponibilidad-flota"
  ) {
    return `/e/${slug}/disponibilidad`;
  }
  if (pathname === "/flota") return `/e/${slug}/flota`;
  if (pathname === "/usuarios") return `/e/${slug}/usuarios`;
  if (pathname === "/cms") return `/e/${slug}/cms`;
  if (pathname.startsWith("/rrhh")) {
    // /rrhh central en dominio corporativo → hub RRHH de ESTA empresa
    if (pathname === "/rrhh") return `/e/${slug}/dashboard-rrhh`;
    return `/e/${slug}${pathname}`;
  }
  return null;
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

  // --- Portal de colaborador: cookie y flujo totalmente separados del staff ---
  // Se resuelve aquí, antes que nada, para que jamás caiga en la lógica de
  // abajo (que redirige a /login usando la cookie de staff sitsa_session).
  if (pathname.startsWith("/portal")) {
    const colabToken = request.cookies.get(COLABORADOR_COOKIE)?.value;
    const colabSession = await readColaboradorSession(colabToken);
    const colabValid = Boolean(colabSession);
    const isPortalPublic = PORTAL_PUBLIC.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );

    if (!colabValid && !isPortalPublic) {
      return NextResponse.redirect(new URL("/portal/login", request.url));
    }
    if (colabValid && pathname === "/portal/login") {
      const dest = colabSession!.debeCambiarPassword
        ? "/portal/cambiar-password"
        : "/portal";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    if (
      colabValid &&
      colabSession!.debeCambiarPassword &&
      pathname !== "/portal/cambiar-password"
    ) {
      // Primer login o después de un reset: no lo dejamos navegar a nada
      // más hasta que cambie la contraseña.
      return NextResponse.redirect(
        new URL("/portal/cambiar-password", request.url),
      );
    }
    return NextResponse.next();
  }

  const host = request.headers.get("host");
  const empresaSlug = slugPorHost(host);
  const dominioEmpresa = Boolean(empresaSlug);

  const isPublic = PUBLIC.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const token = request.cookies.get(COOKIE)?.value;
  const session = await readSession(token);
  const valid = Boolean(session);

  if (!valid && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // --- Dominio de una empresa (logiserviciosmonaco.com, tarimascenter.com…) ---
  if (dominioEmpresa && empresaSlug) {
    if (valid && (pathname === "/login" || pathname === "/select-empresa")) {
      const dest = homePorRol(session!.rol ?? "Operaciones", empresaSlug, true);
      return NextResponse.redirect(new URL(dest, request.url));
    }
    if (valid && pathname === "/") {
      const dest = homePorRol(session!.rol ?? "Operaciones", empresaSlug, true);
      return NextResponse.redirect(new URL(dest, request.url));
    }
    // Evitar mezclar otra empresa por URL
    if (pathname.startsWith("/e/") && !pathname.startsWith(`/e/${empresaSlug}`)) {
      const dest = homePorRol(session?.rol ?? "Operaciones", empresaSlug, true);
      return NextResponse.redirect(new URL(dest, request.url));
    }

    const target = rewriteEmpresaPath(pathname, empresaSlug);
    if (target) {
      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // --- Dominio plataforma (Hostinger genérico / multiempresa) ---
  if (valid && (pathname === "/login" || pathname === "/")) {
    return NextResponse.redirect(new URL("/select-empresa", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};