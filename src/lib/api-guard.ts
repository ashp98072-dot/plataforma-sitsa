import { NextResponse } from "next/server";
import {
  puedeEditarModulo,
  modulosPorRol,
  type Modulo,
} from "./roles";
import { getSession, type SessionPayload } from "./session";

type Ok = { user: SessionPayload; error?: undefined };
type Fail = { user?: undefined; error: NextResponse };

export async function requireSession(): Promise<Ok | Fail> {
  const user = await getSession();
  if (!user) {
    return {
      error: NextResponse.json({ error: "No autenticado." }, { status: 401 }),
    };
  }
  return { user };
}

export async function requireEmpresa(): Promise<Ok | Fail> {
  const session = await requireSession();
  if (session.error) return session;
  if (!session.user.empresaId) {
    return {
      error: NextResponse.json(
        { error: "Selecciona una empresa primero." },
        { status: 400 },
      ),
    };
  }
  return session;
}

export async function requireModulo(
  modulo: Modulo,
  editar = false,
): Promise<Ok | Fail> {
  const session = await requireEmpresa();
  if (session.error) return session;
  const allowed = modulosPorRol(session.user.rol);
  if (!allowed.includes(modulo) && session.user.rol !== "Admin") {
    return {
      error: NextResponse.json({ error: "Sin permiso de módulo." }, { status: 403 }),
    };
  }
  if (editar && !puedeEditarModulo(session.user.rol, modulo)) {
    return {
      error: NextResponse.json({ error: "Solo lectura." }, { status: 403 }),
    };
  }
  return session;
}
