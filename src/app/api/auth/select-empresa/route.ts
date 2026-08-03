import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-guard";
import { empresasParaUsuario, obtenerEmpresaPorId } from "@/lib/empresas";
import { createSessionToken, setSessionCookie } from "@/lib/session";

const schema = z.object({ empresaId: z.number().int().positive() });

export async function POST(request: Request) {
  const guard = await requireSession();
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "empresaId requerido." }, { status: 400 });
  }

  const permitidas = await empresasParaUsuario({
    usuarioId: guard.user.id,
    rol: guard.user.rol,
    accesoTodas: Boolean(guard.user.accesoTodas),
  });
  const ok = permitidas.some((e) => e.id === parsed.data.empresaId);
  if (!ok) {
    return NextResponse.json(
      { error: "No tienes acceso a esa empresa." },
      { status: 403 },
    );
  }

  const empresa = await obtenerEmpresaPorId(parsed.data.empresaId);
  if (!empresa) {
    return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  }

  const token = await createSessionToken({
    ...guard.user,
    empresaId: empresa.id,
    empresaSlug: empresa.slug,
    empresaNombre: empresa.nombre,
  });
  await setSessionCookie(token);

  return NextResponse.json({
    empresa,
    redirect: `/e/${empresa.slug}/dashboard`,
  });
}
