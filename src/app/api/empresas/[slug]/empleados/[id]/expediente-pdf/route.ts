import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { prepararExpedientePdf } from "@/lib/rrhh/expediente-pdf-servidor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const privadas = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/**
 * Expediente completo del empleado en UN solo PDF (bajo demanda; no modifica los documentos originales).
 * Mismo control que consultar los documentos del empleado: tenant + permiso RRHH empleados/ver + empleado de ESTA empresa.
 * No acepta rutas ni ids de documento: todo sale de la BD por (empresa_id, empleado).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400, headers: privadas });
  try {
    const empleado = await obtenerEmpleado(guard.empresa.id, id);
    if (!empleado) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404, headers: privadas });
    const r = await prepararExpedientePdf(guard.empresa.id, empleado);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: privadas });
    return new NextResponse(new Uint8Array(r.bytes), {
      headers: {
        ...privadas,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${r.filename}"`,
        "Content-Length": String(r.bytes.byteLength),
      },
    });
  } catch (error) {
    console.error("GET expediente-pdf", { empresaId: guard.empresa.id, empleadoId: id, tipoError: error instanceof Error ? error.constructor.name : typeof error });
    return NextResponse.json({ error: "No se pudo generar el expediente. Intenta nuevamente." }, { status: 500, headers: privadas });
  }
}
