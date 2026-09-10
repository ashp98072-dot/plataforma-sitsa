import { NextResponse } from "next/server";
import { requireTenantProgramacion } from "@/lib/tenant";
import { empresasParaUsuario } from "@/lib/empresas";
import { buscarEmpleadosOtrasEmpresas, type TipoPersonal } from "@/lib/tms/personal-operativo";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — buscador de empleados de OTRAS
 * empresas (solo las que el usuario administra) para habilitarlos como
 * personal compartido. Devuelve empleados activos con categoría/puesto de
 * Piloto o Auxiliar. Nunca expone empleados de empresas fuera del alcance
 * del usuario.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const tipoRaw = url.searchParams.get("tipo");
  const tipo: TipoPersonal = tipoRaw === "Auxiliar" ? "Auxiliar" : "Piloto";

  const empresasUsuario = await empresasParaUsuario({
    usuarioId: guard.session.id,
    rol: guard.session.rol,
    accesoTodas: Boolean(guard.session.accesoTodas),
  });

  try {
    const empleados = await buscarEmpleadosOtrasEmpresas(
      guard.empresa.id,
      empresasUsuario.map((e) => e.id),
      q,
      tipo,
    );
    return NextResponse.json({ empleados }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ empleados: [] });
  }
}
