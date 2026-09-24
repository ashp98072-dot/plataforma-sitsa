import { NextResponse } from "next/server";
import { requireTenantProgramacion } from "@/lib/tenant";
import { validarEdicionRapidaSchema } from "@/lib/tms/edicion-rapida-schema";
import { guardarEdicionRapida } from "@/lib/tms/edicion-rapida-guardar";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-2: POST /tms/planes/edicion-rapida (GUARDADO ATÓMICO). Mismo cuerpo que
 * /edicion-rapida/validar. Permiso `programacion:editar`; empresa y usuario SIEMPRE de la sesión (el esquema estricto no
 * acepta `empresaId`). 200 = guardado (todo el lote); 409 = los cambios ya no son válidos / lock no obtenido (no se
 * guardó nada); 400 = cuerpo inválido; 500 = error inesperado con rollback total.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON no válido." }, { status: 400 });
  }
  const parsed = validarEdicionRapidaSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "Datos inválidos." }, { status: 400 });
  }
  const r = await guardarEdicionRapida(guard.empresa.id, guard.session.username, parsed.data);
  const { status, ...cuerpoRespuesta } = r.ok ? { status: 200, ...r } : r;
  return NextResponse.json(cuerpoRespuesta, { status, headers: { "Cache-Control": "private, no-store" } });
}
