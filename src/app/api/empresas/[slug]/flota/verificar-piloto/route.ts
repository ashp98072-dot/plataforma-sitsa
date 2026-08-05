import { NextResponse } from "next/server";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { buscarEmpleadoPorNombre } from "@/lib/flota/pilotos";

type Ctx = { params: Promise<{ slug: string }> };

/** Verifica si el nombre del piloto existe en empleados RRHH activos. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const nombre = new URL(req.url).searchParams.get("nombre")?.trim() ?? "";
  if (nombre.length < 2) {
    return NextResponse.json({
      encontrado: false,
      mensaje: "Escribe al menos 2 caracteres del nombre.",
    });
  }

  const emp = await buscarEmpleadoPorNombre(guard.empresa.id, nombre);
  if (emp) {
    return NextResponse.json({
      encontrado: true,
      empleado: emp,
      mensaje: `Coincide con RRHH: ${emp.nombre} (${emp.codigo}).`,
    });
  }

  return NextResponse.json({
    encontrado: false,
    mensaje:
      "No está en personal activo de RRHH. Si es externo o en prueba, solicita permiso a Operaciones.",
  });
}
