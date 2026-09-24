import { NextResponse } from "next/server";
import { requireTenantProgramacion } from "@/lib/tenant";
import { validarEdicionRapidaSchema } from "@/lib/tms/edicion-rapida-schema";
import { validarEdicionRapida } from "@/lib/tms/edicion-rapida-validar";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-1: POST /tms/planes/edicion-rapida/validar. SOLO LECTURA: valida el ESTADO FINAL
 * de un lote de cambios de piloto/auxiliares/unidad/TC (no escribe nada). Permiso `programacion:editar` y empresa
 * SIEMPRE de la sesión: el cuerpo (esquema estricto) no acepta `empresaId`. Responde 200 con el resultado por fila
 * (`ok` = ninguna fila en error); 400 solo si el cuerpo es inválido.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON no válido." }, { status: 400 });
  }
  const parsed = validarEdicionRapidaSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Datos inválidos." }, { status: 400 });
  }
  const resultado = await validarEdicionRapida(guard.empresa.id, parsed.data);
  return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
}
