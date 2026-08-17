import { NextResponse } from "next/server";
import { z } from "zod";
import { cambiarPasswordColaborador } from "@/lib/rrhh/colaborador-auth";
import {
  createColaboradorSessionToken,
  getColaboradorSession,
  setColaboradorSessionCookie,
} from "@/lib/rrhh/colaborador-session";

const schema = z.object({
  passwordActual: z.string().min(1),
  passwordNueva: z.string().min(6),
});

export async function POST(request: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "La nueva contraseña debe tener al menos 6 caracteres." },
      { status: 400 },
    );
  }

  const result = await cambiarPasswordColaborador(
    session.empleadoId,
    parsed.data.passwordActual,
    parsed.data.passwordNueva,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.mensaje }, { status: 400 });
  }

  // Reemitimos el token: la sesión anterior tenía debeCambiarPassword=true
  // y el middleware la sigue viendo así hasta que haya un token nuevo.
  const token = await createColaboradorSessionToken({
    empleadoId: session.empleadoId,
    empresaId: session.empresaId,
    empresaSlug: session.empresaSlug,
    nombre: session.nombre,
    debeCambiarPassword: false,
  });
  await setColaboradorSessionCookie(token);

  return NextResponse.json({ ok: true, redirect: "/portal" });
}