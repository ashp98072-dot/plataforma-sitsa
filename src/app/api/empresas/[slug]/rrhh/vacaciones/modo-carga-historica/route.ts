import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { cambiarModoCargaHistorica, leerModoCargaHistorica } from "@/lib/rrhh/vacaciones-modo-db";
import { MENSAJE_PREFLIGHT_BLOQUEADO } from "@/lib/rrhh/vacaciones-modo-preflight";

type Ctx = { params: Promise<{ slug: string }> };

/** Modo actual de la empresa (solo lectura). Permiso: RRHH · Vacaciones · ver (el aviso se muestra a quien ve Vacaciones). */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;
  try {
    const activo = await leerModoCargaHistorica(guard.empresa.id);
    return NextResponse.json({ activo, modo: activo ? "CARGA_HISTORICA" : "NORMAL" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/modo-carga-historica]", error);
    return NextResponse.json({ error: "No se pudo leer el modo de vacaciones." }, { status: 500 });
  }
}

const schema = z.object({ activo: z.boolean(), confirmar: z.literal(true) });

/**
 * Activa o desactiva el MODO DE CARGA HISTÓRICA de la empresa (temporal): suspende el vencimiento por antigüedad y el tope de 30 días mientras RRHH completa el historial.
 * Solo cambia la bandera (y audita); no toca saldos, incidencias, vacaciones ni evidencias. Requiere confirmación explícita y permiso de administración RRHH
 * (RRHH · Configuración · editar). La empresa sale siempre del slug/sesión.
 * ACTIVAR ejecuta antes un PREFLIGHT de solo lectura: si algún colaborador tiene consumo que no puede reconstruirse de forma verificable responde 409 con el resumen y NO cambia
 * la configuración ni audita nada. DESACTIVAR (volver a NORMAL) nunca se bloquea.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "configuracion", "editar");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta el valor del modo o la confirmación explícita." }, { status: 400 });
  try {
    const r = await cambiarModoCargaHistorica(guard.empresa.id, parsed.data.activo, { usuario: guard.session.username });
    if (r.preflight && !r.preflight.puedeActivar) {
      return NextResponse.json({ codigo: "PREFLIGHT_BLOQUEADO", error: MENSAJE_PREFLIGHT_BLOQUEADO, ...r.preflight }, { status: 409 });
    }
    return NextResponse.json({ ...r, activo: r.valorNuevo, modo: r.valorNuevo ? "CARGA_HISTORICA" : "NORMAL" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/modo-carga-historica] cambio", error);
    return NextResponse.json({ error: "No se pudo cambiar el modo. No se modificó nada." }, { status: 500 });
  }
}
