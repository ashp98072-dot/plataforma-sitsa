import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarCredenciales } from "@/lib/auth";
import { homePorRol, slugPorHost } from "@/lib/dominios";
import { empresasParaUsuario } from "@/lib/empresas";
import { createSessionToken, setSessionCookie } from "@/lib/session";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Usuario y contraseña obligatorios." },
        { status: 400 },
      );
    }
    const user = await verificarCredenciales(
      parsed.data.username,
      parsed.data.password,
    );
    if (!user) {
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos." },
        { status: 401 },
      );
    }

    const empresas = await empresasParaUsuario({
      usuarioId: user.id,
      rol: user.rol,
      accesoTodas: user.accesoTodas,
    });

    const host = request.headers.get("host");
    const slugDominio = slugPorHost(host);
    const empresaDominio = slugDominio
      ? empresas.find((e) => e.slug === slugDominio) ?? null
      : null;

    // En dominio de empresa: fijar esa empresa (si el usuario tiene acceso)
    const unica = empresas.length === 1 ? empresas[0] : null;
    const activa = empresaDominio ?? unica;

    if (slugDominio && !empresaDominio) {
      return NextResponse.json(
        {
          error:
            "No tienes acceso a esta empresa en este dominio. Contacta al administrador.",
        },
        { status: 403 },
      );
    }

    const token = await createSessionToken({
      id: user.id,
      username: user.username,
      rol: user.rol,
      nombre: user.nombre ?? undefined,
      accesoTodas: user.accesoTodas,
      empresaId: activa?.id ?? null,
      empresaSlug: activa?.slug ?? null,
      empresaNombre: activa?.nombre ?? null,
    });
    await setSessionCookie(token);

    let redirect = "/select-empresa";
    if (slugDominio && activa) {
      redirect = homePorRol(user.rol, activa.slug, true);
    } else if (activa && user.rol !== "RRHH" && user.rol !== "Admin" && user.rol !== "Contabilidad") {
      // Roles con una empresa fija pueden ir directo; multi-empresa → selector
      redirect = homePorRol(user.rol, activa.slug, false);
    }

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        rol: user.rol,
        nombre: user.nombre,
      },
      empresas,
      redirect,
    });
  } catch (err) {
    console.error("login", err);
    const raw = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";

    if (raw.includes("DB_USER") || raw.includes("DB_NAME")) {
      return NextResponse.json(
        {
          error:
            "Faltan variables DB_*. Revisa Variables de entorno o .builds/config/.env",
        },
        { status: 500 },
      );
    }
    if (code === "ER_ACCESS_DENIED_ERROR" || raw.includes("Access denied")) {
      return NextResponse.json(
        {
          error:
            "MySQL rechazó usuario/contraseña. Cambia la contraseña del usuario MySQL en hPanel y pon la misma en DB_PASSWORD.",
        },
        { status: 500 },
      );
    }
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      raw.includes("ECONNREFUSED")
    ) {
      return NextResponse.json(
        {
          error:
            "No se pudo alcanzar MySQL. Usa DB_HOST=127.0.0.1 y reinicia el sitio.",
        },
        { status: 500 },
      );
    }
    if (raw.includes("Unknown database") || code === "ER_BAD_DB_ERROR") {
      return NextResponse.json(
        { error: "DB_NAME incorrecto. Debe ser u611730801_Plataforma." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Revisa MySQL / variables de entorno." },
      { status: 500 },
    );
  }
}
