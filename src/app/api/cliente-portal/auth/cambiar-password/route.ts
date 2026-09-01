import { NextResponse } from "next/server";
import { z } from "zod";
import { cambiarPasswordCliente } from "@/lib/tms/cliente-usuarios";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import {
  createClienteSessionToken,
  setClienteSessionCookie,
} from "@/lib/tms/cliente-portal-session";

const schema = z.object({
  passwordActual: z.string().min(1),
  passwordNueva: z.string().min(6),
});

export async function POST(request: Request) {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "La nueva contraseña debe tener al menos 6 caracteres." },
      { status: 400 },
    );
  }

  const result = await cambiarPasswordCliente(
    {
      usuarioClienteId: session.usuarioClienteId,
      empresaId: session.empresaId,
      clienteId: session.clienteId,
    },
    parsed.data.passwordActual,
    parsed.data.passwordNueva,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.mensaje }, { status: 400 });
  }

  // Reemitimos el token: la sesión anterior tenía debeCambiarPassword=true
  // y el middleware la sigue viendo así hasta que haya un token nuevo.
  const token = await createClienteSessionToken({
    usuarioClienteId: session.usuarioClienteId,
    empresaId: session.empresaId,
    clienteId: session.clienteId,
    nombre: session.nombre,
    debeCambiarPassword: false,
  });
  await setClienteSessionCookie(token);

  return NextResponse.json({ ok: true, redirect: "/cliente-portal" });
}
