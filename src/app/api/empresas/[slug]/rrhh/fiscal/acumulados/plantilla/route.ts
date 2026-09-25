import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { cargarEmpleadosPlantilla, generarPlantillaAcumulados } from "@/lib/rrhh/fiscal-importacion";
import { nombrePlantilla } from "@/lib/rrhh/fiscal-importacion-ui";
import { hoyLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };
export const runtime = "nodejs";

/**
 * GET — plantilla .xlsx de acumulados fiscales iniciales, prellenada con los empleados Activos y Bajas relevantes de la empresa
 * de la SESIÓN (código, DPI, nombre, ejercicio). Solo lectura: no crea nada en BD. Permiso: RRHH · configuracion · ver.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "configuracion", "ver");
  if (guard.error) return guard.error;
  const solicitado = new URL(req.url).searchParams.get("ejercicio");
  const ejercicio = solicitado && /^\d{4}$/.test(solicitado) ? Number(solicitado) : Number(hoyLocal().slice(0, 4));
  if (ejercicio < 2000) return NextResponse.json({ error: "Ejercicio inválido." }, { status: 400 });
  try {
    const empleados = await cargarEmpleadosPlantilla(guard.empresa.id, ejercicio);
    const buffer = await generarPlantillaAcumulados(empleados, ejercicio);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombrePlantilla(ejercicio)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("plantilla acumulados fiscales", error);
    return NextResponse.json({ error: "No se pudo generar la plantilla." }, { status: 500 });
  }
}
