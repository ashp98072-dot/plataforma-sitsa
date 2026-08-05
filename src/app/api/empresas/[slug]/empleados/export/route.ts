import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarEmpleados } from "@/lib/rrhh/empleados";
import {
  exportarEmpleadosExcel,
  exportarEmpleadosPdf,
  generarPlantillaEmpleados,
} from "@/lib/rrhh/empleados-export";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;

  const format = new URL(req.url).searchParams.get("format") ?? "xlsx";

  try {
    if (format === "plantilla") {
      const buf = await generarPlantillaEmpleados();
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition":
            'attachment; filename="plantilla_empleados.xlsx"',
        },
      });
    }

    const empleados = await listarEmpleados(guard.empresa.id);
    const nombre = guard.empresa.nombre;

    if (format === "pdf") {
      const buf = await exportarEmpleadosPdf(empleados, nombre);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="empleados-${slug}.pdf"`,
        },
      });
    }

    const buf = await exportarEmpleadosExcel(empleados, nombre);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="empleados-${slug}.xlsx"`,
      },
    });
  } catch (err) {
    console.error("export empleados", err);
    return NextResponse.json({ error: "No se pudo exportar." }, { status: 500 });
  }
}
