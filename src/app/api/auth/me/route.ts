import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-guard";
import { empresasParaUsuario } from "@/lib/empresas";

export async function GET() {
  const guard = await requireSession();
  if (guard.error) return guard.error;
  const empresas = await empresasParaUsuario({
    usuarioId: guard.user.id,
    rol: guard.user.rol,
    accesoTodas: Boolean(guard.user.accesoTodas),
  });
  return NextResponse.json({ user: guard.user, empresas });
}
