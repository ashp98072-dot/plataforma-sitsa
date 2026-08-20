import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { formatoErrorImport } from "@/lib/import-errores";
import {
  generarPlantillaMarcajes,
  parsearExcelMarcajes,
  type FilaMarcajeExcel,
} from "@/lib/rrhh/marcajes-import-excel";

type Ctx = {
  params: Promise<{ slug: string }>;
};

type EmpleadoRow = RowDataPacket & {
  id: number;
  numero_empleado: string;
  nombre: string;
  estado: string;
};

type SesionRow = RowDataPacket & {
  id: number;
  id_empleado: number;
  fecha_jornada: string;
  entrada_at: Date | string | null;
  salida_at: Date | string | null;
};

type EstadoFila =
  | "valida"
  | "actualizar"
  | "conflicto"
  | "error";

type PreviewFila = {
  filaExcel: number;
  numeroEmpleado: string;
  empleadoId?: number;
  nombre?: string;
  fecha: string;
  entrada: string | null;
  salida: string | null;
  observacion: string | null;
  estado: EstadoFila;
  accion?: "crear" | "completar";
  detalle: string;
};

function identidad(numero: string, nombre?: string): string {
  if (numero && nombre) {
    return `Empleado ${numero} (${nombre})`;
  }

  if (numero) {
    return `Empleado ${numero}`;
  }

  return "Empleado sin número";
}

function esFechaIso(fecha: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha);
}

function keyEmpleadoFecha(
  empleadoId: number,
  fecha: string,
): string {
  return `${empleadoId}|${fecha}`;
}

async function analizarFilas(
  empresaId: number,
  filas: FilaMarcajeExcel[],
): Promise<{
  filas: PreviewFila[];
  errores: string[];
}> {
  const resultado: PreviewFila[] = [];
  const errores: string[] = [];

  const numeros = [
    ...new Set(
      filas
        .map((f) => f.numeroEmpleado.trim())
        .filter(Boolean),
    ),
  ];

  let empleados: EmpleadoRow[] = [];

  if (numeros.length > 0) {
    const placeholders = numeros
      .map(() => "?")
      .join(",");

    empleados = await query<EmpleadoRow[]>(
      `SELECT
         id,
         numero_empleado,
         nombre,
         estado
       FROM empleados
       WHERE empresa_id = ?
         AND numero_empleado IN (${placeholders})`,
      [empresaId, ...numeros],
    );
  }

  const empleadoPorNumero = new Map(
    empleados.map((e) => [
      String(e.numero_empleado),
      e,
    ]),
  );

  const filasCandidatas: {
    fila: FilaMarcajeExcel;
    empleado: EmpleadoRow;
  }[] = [];

  const vistos = new Set<string>();

  for (const fila of filas) {
    const numero = fila.numeroEmpleado.trim();

    if (!numero) {
      const detalle = "Falta numero_empleado.";

      errores.push(
        formatoErrorImport({
          filaExcel: fila.filaExcel,
          identidad: "",
          detalle,
        }),
      );

      resultado.push({
        ...fila,
        estado: "error",
        detalle,
      });

      continue;
    }

    const empleado = empleadoPorNumero.get(numero);

    if (!empleado) {
      const detalle =
        "No se encontró el empleado en esta empresa.";

      errores.push(
        formatoErrorImport({
          filaExcel: fila.filaExcel,
          identidad: identidad(numero),
          detalle,
        }),
      );

      resultado.push({
        ...fila,
        estado: "error",
        detalle,
      });

      continue;
    }

    if (String(empleado.estado) === "Baja") {
      const detalle = "El empleado está de Baja.";

      errores.push(
        formatoErrorImport({
          filaExcel: fila.filaExcel,
          identidad: identidad(
            numero,
            String(empleado.nombre),
          ),
          detalle,
        }),
      );

      resultado.push({
        ...fila,
        empleadoId: Number(empleado.id),
        nombre: String(empleado.nombre),
        estado: "error",
        detalle,
      });

      continue;
    }

    if (!esFechaIso(fila.fecha)) {
      const detalle =
        "Fecha inválida. Use YYYY-MM-DD o DD/MM/YYYY.";

      errores.push(
        formatoErrorImport({
          filaExcel: fila.filaExcel,
          identidad: identidad(
            numero,
            String(empleado.nombre),
          ),
          detalle,
        }),
      );

      resultado.push({
        ...fila,
        empleadoId: Number(empleado.id),
        nombre: String(empleado.nombre),
        estado: "error",
        detalle,
      });

      continue;
    }

    if (!fila.entrada && !fila.salida) {
      const detalle =
        "Debe indicar al menos una hora de entrada o salida.";

      errores.push(
        formatoErrorImport({
          filaExcel: fila.filaExcel,
          identidad: identidad(
            numero,
            String(empleado.nombre),
          ),
          detalle,
        }),
      );

      resultado.push({
        ...fila,
        empleadoId: Number(empleado.id),
        nombre: String(empleado.nombre),
        estado: "error",
        detalle,
      });

      continue;
    }

    const key = keyEmpleadoFecha(
      Number(empleado.id),
      fila.fecha,
    );

    if (vistos.has(key)) {
      const detalle =
        "El archivo contiene más de una fila para el mismo empleado y fecha.";

      errores.push(
        formatoErrorImport({
          filaExcel: fila.filaExcel,
          identidad: identidad(
            numero,
            String(empleado.nombre),
          ),
          detalle,
        }),
      );

      resultado.push({
        ...fila,
        empleadoId: Number(empleado.id),
        nombre: String(empleado.nombre),
        estado: "error",
        detalle,
      });

      continue;
    }

    vistos.add(key);

    filasCandidatas.push({
      fila,
      empleado,
    });
  }

  if (filasCandidatas.length === 0) {
    return {
      filas: resultado.sort(
        (a, b) => a.filaExcel - b.filaExcel,
      ),
      errores,
    };
  }

  const ids = [
    ...new Set(
      filasCandidatas.map((x) =>
        Number(x.empleado.id),
      ),
    ),
  ];

  const fechas = filasCandidatas.map(
    (x) => x.fila.fecha,
  );

  const desde = [...fechas].sort()[0];
  const hasta = [...fechas].sort().at(-1)!;

  const placeholders = ids
    .map(() => "?")
    .join(",");

  const sesiones = await query<SesionRow[]>(
    `SELECT
       id,
       id_empleado,
       DATE_FORMAT(fecha_jornada, '%Y-%m-%d')
         AS fecha_jornada,
       entrada_at,
       salida_at
     FROM sesiones_trabajo
     WHERE empresa_id = ?
       AND id_empleado IN (${placeholders})
       AND fecha_jornada BETWEEN ? AND ?
     ORDER BY id DESC`,
    [empresaId, ...ids, desde, hasta],
  );

  const sesionPorKey = new Map<string, SesionRow>();

  for (const sesion of sesiones) {
    const key = keyEmpleadoFecha(
      Number(sesion.id_empleado),
      String(sesion.fecha_jornada),
    );

    if (!sesionPorKey.has(key)) {
      sesionPorKey.set(key, sesion);
    }
  }

  for (const item of filasCandidatas) {
    const fila = item.fila;
    const empleado = item.empleado;
    const empleadoId = Number(empleado.id);

    const existente = sesionPorKey.get(
      keyEmpleadoFecha(
        empleadoId,
        fila.fecha,
      ),
    );

    if (!existente) {
      if (!fila.entrada) {
        const detalle =
          "No existe una jornada previa. Para crearla debe incluir hora de entrada.";

        errores.push(
          formatoErrorImport({
            filaExcel: fila.filaExcel,
            identidad: identidad(
              fila.numeroEmpleado,
              String(empleado.nombre),
            ),
            detalle,
          }),
        );

        resultado.push({
          ...fila,
          empleadoId,
          nombre: String(empleado.nombre),
          estado: "error",
          detalle,
        });

        continue;
      }

      resultado.push({
        ...fila,
        empleadoId,
        nombre: String(empleado.nombre),
        estado: "valida",
        accion: "crear",
        detalle: fila.salida
          ? "Se creará entrada y salida."
          : "Se creará una jornada abierta.",
      });

      continue;
    }

    const tieneEntrada = existente.entrada_at != null;
    const tieneSalida = existente.salida_at != null;

    if (
      (tieneEntrada && fila.entrada) ||
      (tieneSalida && fila.salida)
    ) {
      resultado.push({
        ...fila,
        empleadoId,
        nombre: String(empleado.nombre),
        estado: "conflicto",
        detalle:
          "Ya existe información para uno de los campos enviados. No se sobrescribirá automáticamente.",
      });

      continue;
    }

    const completaraEntrada =
      !tieneEntrada && !!fila.entrada;

    const completaraSalida =
      !tieneSalida && !!fila.salida;

    if (!completaraEntrada && !completaraSalida) {
      resultado.push({
        ...fila,
        empleadoId,
        nombre: String(empleado.nombre),
        estado: "conflicto",
        detalle:
          "La jornada existente no requiere ninguno de los datos enviados.",
      });

      continue;
    }

    resultado.push({
      ...fila,
      empleadoId,
      nombre: String(empleado.nombre),
      estado: "actualizar",
      accion: "completar",
      detalle:
        completaraEntrada && completaraSalida
          ? "Se completarán entrada y salida faltantes."
          : completaraEntrada
            ? "Se completará la entrada faltante."
            : "Se completará la salida faltante.",
    });
  }

  resultado.sort(
    (a, b) => a.filaExcel - b.filaExcel,
  );

  return {
    filas: resultado,
    errores,
  };
}

export async function GET(
  _req: Request,
  ctx: Ctx,
) {
  const { slug } = await ctx.params;

  const guard = await requireTenantRrhh(
    slug,
    "marcajes",
    "ver",
  );

  if (guard.error) {
    return guard.error;
  }

  if (guard.session.rol === "Marcaje") {
    return NextResponse.json(
      {
        error:
          "El usuario de kiosko no puede descargar la plantilla de importación.",
      },
      { status: 403 },
    );
  }

  const buffer = await generarPlantillaMarcajes();

const body = new Uint8Array(buffer);

return new NextResponse(body, {
  status: 200,
  headers: {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":
      'attachment; filename="plantilla-marcajes-rrhh.xlsx"',
    "Cache-Control": "no-store",
  },
});
}

export async function POST(
  req: Request,
  ctx: Ctx,
) {
  const { slug } = await ctx.params;

  const guard = await requireTenantRrhh(
    slug,
    "marcajes",
    "editar",
  );

  if (guard.error) {
    return guard.error;
  }

  if (guard.session.rol === "Marcaje") {
    return NextResponse.json(
      {
        error:
          "El usuario de kiosko no puede importar marcajes.",
      },
      { status: 403 },
    );
  }

  const form = await req.formData();

  const archivo = form.get("archivo");
  const accion = String(
    form.get("accion") ?? "validar",
  );

  if (!(archivo instanceof File)) {
    return NextResponse.json(
      {
        error: "Selecciona un archivo Excel.",
      },
      { status: 400 },
    );
  }

  if (
    accion !== "validar" &&
    accion !== "importar"
  ) {
    return NextResponse.json(
      {
        error: "Acción de importación inválida.",
      },
      { status: 400 },
    );
  }

  const nombre = archivo.name.toLowerCase();

  if (
    !nombre.endsWith(".xlsx") &&
    !nombre.endsWith(".xlsm")
  ) {
    return NextResponse.json(
      {
        error:
          "El archivo debe ser Excel .xlsx o .xlsm.",
      },
      { status: 400 },
    );
  }

  let filasExcel: FilaMarcajeExcel[];

  try {
    const buffer = Buffer.from(
      await archivo.arrayBuffer(),
    );

    filasExcel = await parsearExcelMarcajes(
      buffer,
    );
  } catch (err) {
    const detalle =
      err instanceof Error
        ? err.message
        : "No se pudo leer el Excel.";

    return NextResponse.json(
      {
        error: detalle,
      },
      { status: 400 },
    );
  }

  if (filasExcel.length === 0) {
    return NextResponse.json(
      {
        error:
          "El archivo no contiene filas de marcajes.",
      },
      { status: 400 },
    );
  }

  if (filasExcel.length > 2000) {
    return NextResponse.json(
      {
        error:
          "El archivo supera el límite de 2000 filas por importación.",
      },
      { status: 400 },
    );
  }

  const analisis = await analizarFilas(
    guard.empresa.id,
    filasExcel,
  );

  const resumenBase = {
    total: analisis.filas.length,
    validas: analisis.filas.filter(
      (f) => f.estado === "valida",
    ).length,
    actualizables: analisis.filas.filter(
      (f) => f.estado === "actualizar",
    ).length,
    conflictos: analisis.filas.filter(
      (f) => f.estado === "conflicto",
    ).length,
    errores: analisis.filas.filter(
      (f) => f.estado === "error",
    ).length,
  };

  if (accion === "validar") {
    return NextResponse.json({
      accion: "validar",
      resumen: resumenBase,
      filas: analisis.filas,
      erroresDetalle: analisis.errores,
    });
  }

  let creados = 0;
  let completados = 0;
  let omitidos = 0;

  for (const fila of analisis.filas) {
    if (
      fila.estado !== "valida" &&
      fila.estado !== "actualizar"
    ) {
      omitidos += 1;
      continue;
    }

    if (!fila.empleadoId) {
      omitidos += 1;
      continue;
    }

    const entradaAt = fila.entrada
      ? `${fila.fecha} ${fila.entrada}`
      : null;

    const salidaAt = fila.salida
      ? `${fila.fecha} ${fila.salida}`
      : null;

    if (fila.accion === "crear") {
      await execute(
        `INSERT INTO sesiones_trabajo
          (
            empresa_id,
            id_empleado,
            fecha_jornada,
            entrada_at,
            salida_at,
            estado,
            comentarios_rrhh
          )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          guard.empresa.id,
          fila.empleadoId,
          fila.fecha,
          entradaAt,
          salidaAt,
          salidaAt ? "CERRADA" : "ABIERTA",
          fila.observacion
            ? `[Importación Excel] ${fila.observacion}`
            : "[Importación Excel]",
        ],
      );

      creados += 1;
      continue;
    }

    const existentes =
      await query<SesionRow[]>(
        `SELECT
           id,
           id_empleado,
           DATE_FORMAT(fecha_jornada, '%Y-%m-%d')
             AS fecha_jornada,
           entrada_at,
           salida_at
         FROM sesiones_trabajo
         WHERE empresa_id = ?
           AND id_empleado = ?
           AND fecha_jornada = ?
         ORDER BY id DESC
         LIMIT 1`,
        [
          guard.empresa.id,
          fila.empleadoId,
          fila.fecha,
        ],
      );

    const existente = existentes[0];

    if (!existente) {
      omitidos += 1;
      continue;
    }

    const nuevaEntrada =
      existente.entrada_at == null
        ? entradaAt
        : null;

    const nuevaSalida =
      existente.salida_at == null
        ? salidaAt
        : null;

    if (!nuevaEntrada && !nuevaSalida) {
      omitidos += 1;
      continue;
    }

    await execute(
      `UPDATE sesiones_trabajo
       SET
         entrada_at = COALESCE(
           entrada_at,
           ?
         ),
         salida_at = COALESCE(
           salida_at,
           ?
         ),
         estado = CASE
           WHEN COALESCE(salida_at, ?) IS NOT NULL
             THEN 'CERRADA'
           ELSE estado
         END,
         comentarios_rrhh =
           CASE
             WHEN ? IS NULL
               THEN comentarios_rrhh
             WHEN comentarios_rrhh IS NULL
               OR comentarios_rrhh = ''
               THEN ?
             ELSE CONCAT(
               comentarios_rrhh,
               ' | ',
               ?
             )
           END
       WHERE id = ?
         AND empresa_id = ?`,
      [
        nuevaEntrada,
        nuevaSalida,
        nuevaSalida,
        fila.observacion
          ? `[Importación Excel] ${fila.observacion}`
          : "[Importación Excel]",
        fila.observacion
          ? `[Importación Excel] ${fila.observacion}`
          : "[Importación Excel]",
        fila.observacion
          ? `[Importación Excel] ${fila.observacion}`
          : "[Importación Excel]",
        Number(existente.id),
        guard.empresa.id,
      ],
    );

    completados += 1;
  }

  return NextResponse.json({
    accion: "importar",
    mensaje:
      `Importación finalizada: ${creados} creados, ` +
      `${completados} completados y ${omitidos} omitidos.`,
    resumen: {
      ...resumenBase,
      creados,
      completados,
      omitidos,
    },
    filas: analisis.filas,
    erroresDetalle: analisis.errores,
  });
}