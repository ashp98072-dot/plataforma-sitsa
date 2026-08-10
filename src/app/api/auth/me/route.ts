import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-guard";
import { empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";

export async function GET() {
  const guard = await requireSession();
  if (guard.error) return guard.error;
  const [empresas, permisos] = await Promise.all([
    empresasParaUsuario({
      usuarioId: guard.user.id,
      rol: guard.user.rol,
      accesoTodas: Boolean(guard.user.accesoTodas),
    }),
    permisosEfectivos(guard.user.id, guard.user.rol as RolGlobal),
  ]);
  return NextResponse.json({ user: guard.user, empresas, permisos });
}
