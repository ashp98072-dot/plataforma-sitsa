import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  FechaInvalidaError,
  formatearFecha,
  normalizarHora,
} from "@/lib/rrhh/dates";
import {
  actualizarEmpleado,
  crearEmpleado,
  obtenerEmpleadoPorCodigo,
} from "@/lib/rrhh/empleados";
import { parsearPlantillaEmpleados } from "@/lib/rrhh/empleados-export";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "crear");
  if (guard.error) return guard.error;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Archivo Excel requerido." },
        { status: 400 },
      );
    }
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json(
        { error: "Solo se aceptan archivos .xlsx" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filas = await parsearPlantillaEmpleados(buffer);
    if (filas.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron filas válidas." },
        { status: 400 },
      );
    }

    let creados = 0;
    let actualizados = 0;
    const errores: string[] = [];

    for (const fila of filas) {
      try {
        if (!fila.fechaAlta) {
          errores.push(`${fila.codigo}: falta fecha de contratación.`);
          continue;
        }
        const fechaAlta = formatearFecha(fila.fechaAlta);
        let fechaInicio: string | null = null;
        if (fila.fechaInicioLaboral) {
          fechaInicio = formatearFecha(fila.fechaInicioLaboral);
        }
        const payload = {
          codigo: fila.codigo,
          nombre: fila.nombre,
          puesto: fila.puesto,
          tipoHorario: fila.tipoHorario,
          fechaAlta,
          fechaInicioLaboral: fechaInicio,
          horaEntradaTeorica:
            normalizarHora(fila.horaEntradaTeorica) || "08:00:00",
          horaSalidaTeorica:
            normalizarHora(fila.horaSalidaTeorica) || "17:00:00",
          estado: fila.estado,
        };

        const existente = await obtenerEmpleadoPorCodigo(
          guard.empresa.id,
          fila.codigo,
        );
        if (existente) {
          await actualizarEmpleado(guard.empresa.id, existente.id, payload);
          actualizados += 1;
        } else {
          await crearEmpleado(guard.empresa.id, payload);
          creados += 1;
        }
      } catch (e) {
        const msg =
          e instanceof FechaInvalidaError
            ? e.message
            : e instanceof Error
              ? e.message
              : "error";
        errores.push(`${fila.codigo}: ${msg}`);
      }
    }

    return NextResponse.json({
      mensaje: `Importación: ${creados} nuevos, ${actualizados} actualizados.`,
      creados,
      actualizados,
      errores,
    });
  } catch (err) {
    console.error("import empleados", err);
    const msg = err instanceof Error ? err.message : "No se pudo importar.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
