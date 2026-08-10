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
import { obtenerParametros } from "@/lib/rrhh/config";
import {
  formatoErrorImport,
  identidadEmpleadoImport,
} from "@/lib/import-errores";

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

    const cfg = await obtenerParametros(guard.empresa.id);
    const entradaDef = cfg.hora_entrada_default || "08:00:00";
    const salidaDef = cfg.hora_salida_default || "17:00:00";

    let creados = 0;
    let actualizados = 0;
    const errores: string[] = [];

    for (const fila of filas) {
      const identidad = identidadEmpleadoImport({
        codigo: fila.codigo,
        nombre: fila.nombre,
      });
      try {
        if (!fila.fechaAlta) {
          errores.push(
            formatoErrorImport({
              filaExcel: fila.filaExcel,
              identidad,
              detalle: "falta fecha de contratación",
            }),
          );
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
          dpi: fila.dpi,
          primerNombre: fila.primerNombre || undefined,
          segundoNombre: fila.segundoNombre || undefined,
          primerApellido: fila.primerApellido || undefined,
          segundoApellido: fila.segundoApellido || undefined,
          apellidoCasada: fila.apellidoCasada || undefined,
          nit: fila.nit || undefined,
          igss: fila.igss || undefined,
          irtra: fila.irtra || undefined,
          sexo: fila.sexo || undefined,
          fechaNacimiento: (() => {
            if (!fila.fechaNacimiento) return null;
            try {
              return formatearFecha(fila.fechaNacimiento);
            } catch {
              return null;
            }
          })(),
          puesto: fila.puesto,
          categoriaOps: fila.categoriaOps,
          tipoHorario: fila.tipoHorario,
          tipoContrato: fila.tipoContrato || undefined,
          formaPago: fila.formaPago || undefined,
          profesion: fila.profesion || undefined,
          fechaAlta,
          fechaInicioLaboral: fechaInicio,
          horaEntradaTeorica:
            normalizarHora(fila.horaEntradaTeorica) || entradaDef,
          horaSalidaTeorica:
            normalizarHora(fila.horaSalidaTeorica) || salidaDef,
          estado: fila.estado,
          sueldoBase: fila.sueldoBase,
          bonoIncentivo: fila.bonoIncentivo,
          bonoHerramientas: fila.bonoHerramientas,
          telefono: fila.telefono || undefined,
          email: fila.email || undefined,
          direccion: fila.direccion || undefined,
          paisOrigen: fila.paisOrigen || undefined,
          municipio: fila.municipio || undefined,
          etnia: fila.etnia || undefined,
          religion: fila.religion || undefined,
          idioma: fila.idioma || undefined,
          licenciaNumero: fila.licenciaNumero || undefined,
          licenciaTipo: fila.licenciaTipo || undefined,
          licenciaVence: (() => {
            if (!fila.licenciaVence) return null;
            try {
              return formatearFecha(fila.licenciaVence);
            } catch {
              return null;
            }
          })(),
          cuentaBancaria: fila.cuentaBancaria || undefined,
          tipoCuenta: fila.tipoCuenta || undefined,
          banco: fila.banco || undefined,
          contactoEmergencia: fila.contactoEmergencia || undefined,
          observaciones: fila.observaciones || undefined,
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
        errores.push(
          formatoErrorImport({
            filaExcel: fila.filaExcel,
            identidad,
            detalle: msg,
          }),
        );
      }
    }

    const totalErr = errores.length;
    return NextResponse.json({
      mensaje:
        totalErr > 0
          ? `Importación: ${creados} nuevos, ${actualizados} actualizados, ${totalErr} con error.`
          : `Importación: ${creados} nuevos, ${actualizados} actualizados.`,
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
