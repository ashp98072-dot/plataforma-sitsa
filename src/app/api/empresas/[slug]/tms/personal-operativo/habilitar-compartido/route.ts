import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion } from "@/lib/tenant";
import { empresasParaUsuario } from "@/lib/empresas";
import { habilitarCompartido } from "@/lib/tms/personal-operativo";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({
  empleadoId: z.number().int().positive(),
  tipo: z.enum(["Piloto", "Auxiliar"]),
});

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — habilita a un empleado de OTRA
 * empresa del grupo para operar en esta empresa (crea/reactiva una fila
 * tms_personal COMPARTIDA). La empresa de origen del empleado DEBE estar
 * entre las que el usuario administra (§multiempresa): no se puede
 * "prestar" personal de una empresa fuera de su alcance. NUNCA cambia el
 * empleado ni su empresa_id; NO lo agrega a la planilla de esta empresa.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const empresasUsuario = await empresasParaUsuario({
    usuarioId: guard.session.id,
    rol: guard.session.rol,
    accesoTodas: Boolean(guard.session.accesoTodas),
  });

  try {
    const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
    const personal = await habilitarCompartido(
      guard.empresa.id,
      parsed.data.empleadoId,
      parsed.data.tipo,
      actor,
      empresasUsuario.map((e) => e.id),
    );
    return NextResponse.json({ personal, mensaje: "Personal compartido habilitado." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo habilitar el personal compartido.";
    const status = /acceso a la empresa de origen/.test(msg) ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
