import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { configurarEntidad, EntidadInvalida, listarEntidades } from "@/lib/contabilidad/entidades";

type Ctx = { params: Promise<{ slug: string }> };
const headers = { "Cache-Control": "private, no-store" };
function fallo(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return NextResponse.json({ error: "Configuración pendiente: aplica la migración manual de entidades contables.", codigo: "MIGRACION_PENDIENTE" }, { status: 503, headers });
  if (error instanceof EntidadInvalida) return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Ya existe una entidad con ese código en esta empresa." }, { status: 409, headers });
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return NextResponse.json({ error: "Otra operación está modificando la configuración. Intenta nuevamente." }, { status: 409, headers });
  console.error("Configuración contable", { code: code ?? "desconocido" });
  return NextResponse.json({ error: "No se pudo confirmar la operación. Actualiza antes de reintentar." }, { status: 500, headers });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return guard.error;
  const admin = guard.session.rol === "Admin";
  try {
    const entidades = await listarEntidades(guard.empresa.id, admin);
    const escritura = await requireTenantModulo(slug, "contabilidad", true);
    return NextResponse.json({ entidades, empresa: { id: guard.empresa.id, nombre: guard.empresa.nombre }, puedeAdministrar: admin, puedeEscribir: !escritura.error }, { headers });
  } catch (error) { return fallo(error); }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad", true);
  if (guard.error) return guard.error;
  if (guard.session.rol !== "Admin") return NextResponse.json({ error: "Solo Admin configura los libros contables." }, { status: 403, headers });
  try {
    const id = await configurarEntidad(guard.empresa.id, guard.session.username, await req.json().catch(() => null));
    return NextResponse.json({ id, mensaje: "Configuración guardada. No se modificaron cuentas ni partidas." }, { headers });
  } catch (error) { return fallo(error); }
}
