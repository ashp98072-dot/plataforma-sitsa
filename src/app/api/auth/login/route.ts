import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarCredenciales } from "@/lib/auth";
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

    const unica = empresas.length === 1 ? empresas[0] : null;
    const token = await createSessionToken({
      id: user.id,
      username: user.username,
      rol: user.rol,
      nombre: user.nombre ?? undefined,
      accesoTodas: user.accesoTodas,
      empresaId: unica?.id ?? null,
      empresaSlug: unica?.slug ?? null,
      empresaNombre: unica?.nombre ?? null,
    });
    await setSessionCookie(token);

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        rol: user.rol,
        nombre: user.nombre,
      },
      empresas,
      redirect: unica
        ? `/e/${unica.slug}/dashboard`
        : "/select-empresa",
    });
  } catch (err) {
    console.error("login", err);
    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Revisa MySQL / .env.local" },
      { status: 500 },
    );
  }
}
