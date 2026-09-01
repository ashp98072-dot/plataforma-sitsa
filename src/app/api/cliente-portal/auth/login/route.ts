import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarCredencialesCliente } from "@/lib/tms/cliente-usuarios";
import {
  createClienteSessionToken,
  setClienteSessionCookie,
} from "@/lib/tms/cliente-portal-session";

const schema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

// Mensaje único para email inexistente / password incorrecta / usuario
// inactivo / cliente inactivo — nunca se distingue el motivo exacto en la
// respuesta (alcance G del ticket: no filtrar si el email existe).
const CREDENCIALES_INVALIDAS = "Credenciales inválidas.";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: CREDENCIALES_INVALIDAS }, { status: 400 });
  }

  const cliente = await verificarCredencialesCliente(
    parsed.data.email,
    parsed.data.password,
  );
  if (!cliente) {
    return NextResponse.json({ error: CREDENCIALES_INVALIDAS }, { status: 401 });
  }

  const token = await createClienteSessionToken({
    usuarioClienteId: cliente.usuarioClienteId,
    empresaId: cliente.empresaId,
    clienteId: cliente.clienteId,
    nombre: cliente.nombre,
    debeCambiarPassword: cliente.debeCambiarPassword,
  });
  await setClienteSessionCookie(token);

  const redirect = cliente.debeCambiarPassword
    ? "/cliente-portal/cambiar-password"
    : "/cliente-portal";

  return NextResponse.json({
    user: {
      usuarioClienteId: cliente.usuarioClienteId,
      nombre: cliente.nombre,
    },
    redirect,
  });
}
