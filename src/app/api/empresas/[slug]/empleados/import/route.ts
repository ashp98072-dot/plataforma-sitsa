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
import { parsearPlantillaEmpleadosConAdvertencias } from "@/lib/rrhh/empleados-export";
import {
  codigoSospechosoImport,
  fusionarEmpleadoImport,
} from "@/lib/rrhh/empleados-import";
import { obtenerParametros } from "@/lib/rrhh/config";
import {
  formatoErrorImport,
  identidadEmpleadoImport,
} from "@/lib/import-errores";

type Ctx = { params: Promise<{ slug: string }> };

type AdvertenciaImportEmpleado = {
  filaExcel: number;
  codigo: string;
  nombre: string;
  motivo: string;
};

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
    const { filas, descartadas } =
      await parsearPlantillaEmpleadosConAdvertencias(buffer);
    if (filas.length === 0 && descartadas.length === 0) {
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
    let omitidos = 0;
    const errores: string[] = [];
    const advertencias: AdvertenciaImportEmpleado[] = [];

    // Filas descartadas por el parser ANTES de llegar aquí (sin código o
    // sin nombre) — antes desaparecían en silencio; ahora se cuentan
    // como omitidas y quedan visibles para revisión.
    for (const d of descartadas) {
      omitidos += 1;
      advertencias.push({
        filaExcel: d.filaExcel,
        codigo: d.codigo,
        nombre: d.nombre,
        motivo: d.motivo,
      });
    }

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

        // Validación CONSERVADORA (ver codigoSospechosoImport): NO asume
        // que todo código deba ser un DPI, solo señala casos claramente
        // anómalos (un solo dígito, o que no coincide con un DPI válido
        // de 13 dígitos presente en la misma fila). Un código sospechoso
        // NUNCA crea ni actualiza automáticamente — la seguridad tiene
        // prioridad, exista o no exista ya un empleado con ese código.
        if (codigoSospechosoImport(fila.codigo, fila.dpi)) {
          omitidos += 1;
          advertencias.push({
            filaExcel: fila.filaExcel,
            codigo: fila.codigo,
            nombre: fila.nombre,
            motivo: `Código sospechoso: ${fila.codigo}. Requiere revisión manual.`,
          });
          continue;
        }

        const existente = await obtenerEmpleadoPorCodigo(
          guard.empresa.id,
          fila.codigo,
        );

        if (existente) {
          // IMPORT-EMPLEADOS-SEGURA: una reimportación NUNCA sobreescribe
          // datos reales existentes con celdas vacías, placeholders o
          // defaults del parser (columna ausente/vacía) del Excel, y
          // nunca toca supervisorIds/horasExtraHabilitado/fechaEgreso —
          // ver fusionarEmpleadoImport().
          const payloadActualizado = fusionarEmpleadoImport(
            existente,
            payload,
            fila.camposConDefault,
          );
          await actualizarEmpleado(
            guard.empresa.id,
            existente.id,
            payloadActualizado,
          );
          actualizados += 1;
        } else {
          // Empleado nuevo: comportamiento normal de creación, sin
          // aplicar la protección de placeholders (no hay nada previo
          // que preservar).
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
    const sufijoOmitidos = omitidos > 0 ? `, ${omitidos} omitida(s)` : "";
    return NextResponse.json({
      mensaje:
        totalErr > 0
          ? `Importación: ${creados} nuevos, ${actualizados} actualizados${sufijoOmitidos}, ${totalErr} con error.`
          : `Importación: ${creados} nuevos, ${actualizados} actualizados${sufijoOmitidos}.`,
      creados,
      actualizados,
      omitidos,
      advertencias,
      errores,
    });
  } catch (err) {
    console.error("import empleados", err);
    const msg = err instanceof Error ? err.message : "No se pudo importar.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
