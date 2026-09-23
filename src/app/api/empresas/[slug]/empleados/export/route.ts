import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarEmpleados } from "@/lib/rrhh/empleados";
import { parsearFiltrosEmpleados } from "@/lib/rrhh/empleados-filtros";
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

  const searchParams = new URL(req.url).searchParams;
  const format = searchParams.get("format") ?? "xlsx";

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

    // RRHH-EMPLEADOS-EXPORT-FILTROS-1 — exporta EXACTAMENTE el conjunto filtrado de la pantalla
    // (q, tipoContrato, formaPago, estado). La plantilla (arriba) no depende de filtros.
    // La empresa sale siempre de la sesión; ningún filtro inválido llega al SQL.
    const filtros = parsearFiltrosEmpleados(searchParams);
    if (!filtros.ok) return NextResponse.json({ error: filtros.error }, { status: 400 });
    const { q, tipoContrato, formaPago, estado } = filtros.filtros;
    const empleados = await listarEmpleados(guard.empresa.id, q, {
      completo: true,
      conDocs: false,
      tipoContrato,
      formaPago,
      estado,
    });
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
