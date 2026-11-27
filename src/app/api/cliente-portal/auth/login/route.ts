import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarCredencialesCliente } from "@/lib/tms/cliente-usuarios";
import { ErrorProteccionLogin, protegerLogin, registrarFalloProteccion } from "@/lib/auth-intentos";
import { leerCuerpoJson, respuestaBloqueado, respuestaNoDisponible } from "@/lib/auth-intentos-http";
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
  // B3: un cuerpo que no es JSON es un error del cliente (400), no del servidor.
  const cuerpo = await leerCuerpoJson(request);
  const parsed = cuerpo.ok ? schema.safeParse(cuerpo.valor) : null;
  if (!parsed?.success) {
    return NextResponse.json({ error: CREDENCIALES_INVALIDAS }, { status: 400 });
  }

  // A4: límite de intentos por correo y por origen (persistente, compartido entre instancias). Mismo mensaje genérico para cualquier fallo.
  let resultado;
  try {
    resultado = await protegerLogin({ alcance: "cliente", identificador: parsed.data.email, headers: request.headers }, () =>
      verificarCredencialesCliente(parsed.data.email, parsed.data.password));
  } catch (e) {
    if (e instanceof ErrorProteccionLogin) { registrarFalloProteccion("cliente-portal", e); return respuestaNoDisponible(); }
    throw e;
  }
  if (resultado.tipo === "bloqueado") return respuestaBloqueado(resultado.retryAfterS);
  if (resultado.tipo === "credenciales") {
    return NextResponse.json({ error: CREDENCIALES_INVALIDAS }, { status: 401 });
  }
  const cliente = resultado.valor;

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
