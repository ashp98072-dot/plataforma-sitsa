import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { respuestaMiniaturaEmpleado } from "@/lib/rrhh/foto-empleado-miniatura";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return guard.error;
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  try {
    if (!await obtenerEmpleado(guard.empresa.id, id)) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return await respuestaMiniaturaEmpleado(req, guard.empresa.id, id);
  } catch (error) {
    console.error("GET miniatura empleado", error);
    return NextResponse.json({ error: "No se pudo consultar la fotografía." }, {
      status: 500, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
