import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarCredencialesColaborador } from "@/lib/rrhh/colaborador-auth";
import {
  createColaboradorSessionToken,
  setColaboradorSessionCookie,
} from "@/lib/rrhh/colaborador-session";

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

    const colaborador = await verificarCredencialesColaborador(
      parsed.data.username,
      parsed.data.password,
    );
    if (!colaborador) {
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos." },
        { status: 401 },
      );
    }

    const token = await createColaboradorSessionToken({
      empleadoId: colaborador.empleadoId,
      empresaId: colaborador.empresaId,
      empresaSlug: colaborador.empresaSlug,
      nombre: colaborador.nombre,
      debeCambiarPassword: colaborador.debeCambiarPassword,
    });
    await setColaboradorSessionCookie(token);

    const redirect = colaborador.debeCambiarPassword
      ? "/portal/cambiar-password"
      : "/portal";

    return NextResponse.json({
      user: {
        empleadoId: colaborador.empleadoId,
        nombre: colaborador.nombre,
      },
      redirect,
    });
  } catch (err) {
    console.error("portal login", err);
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