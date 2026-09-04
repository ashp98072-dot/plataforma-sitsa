import { NextResponse } from "next/server";

import { registrarAuditoria } from "@/lib/auditoria";
import {
  conciliarPorVale,
  type EstadoConciliacionCombustible,
} from "@/lib/flota/combustible-conciliacion";
import {
  listarConciliacionesCombustible,
} from "@/lib/flota/combustible-conciliacion-consultas";
import {
  obtenerCargasSistemaParaConciliacion,
} from "@/lib/flota/combustible-conciliacion-db";
import {
  leerReporteCombustibleGasolinera,
} from "@/lib/flota/combustible-conciliacion-excel";
import {
  guardarConciliacionCombustible,
} from "@/lib/flota/combustible-conciliacion-persistencia";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import {
  borrarUpload,
  guardarUploadExcel,
  UploadValidationError,
} from "@/lib/uploads";

type Ctx = {
  params: Promise<{
    slug: string;
  }>;
};

const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function obtenerRangoFechas(
  fechas: Array<string | null | undefined>,
): {
  desde: string;
  hasta: string;
} | null {
  const validas = fechas
    .filter(
      (fecha): fecha is string =>
        typeof fecha === "string" &&
        fecha.trim().length > 0,
    )
    .sort((a, b) => a.localeCompare(b));

  if (!validas.length) {
    return null;
  }

  return {
    desde: validas[0],
    hasta: validas[validas.length - 1],
  };
}

function resumirEstados(
  estados: EstadoConciliacionCombustible[],
): Record<EstadoConciliacionCombustible, number> {
  const resumen: Record<
    EstadoConciliacionCombustible,
    number
  > = {
    COINCIDE: 0,
    DIFERENCIA: 0,
    SOLO_GASOLINERA: 0,
    SOLO_SISTEMA: 0,
    AMBIGUO: 0,
  };

  for (const estado of estados) {
    resumen[estado] += 1;
  }

  return resumen;
}

/**
 * FLOTA-COMBUSTIBLE-4
 *
 * Historial de conciliaciones ya guardadas (más reciente primero). Solo
 * lectura — usa "ver", no "editar". Ver
 * src/lib/flota/combustible-conciliacion-consultas.ts para el detalle de
 * la agregación (sin N+1) y el límite de 100 resultados.
 */
export async function GET(
  _req: Request,
  ctx: Ctx,
) {
  const { slug } = await ctx.params;

  const guard =
    await requireTenantFlotaCombustible(
      slug,
      "ver",
    );

  if (guard.error) {
    return guard.error;
  }

  try {
    const items = await listarConciliacionesCombustible(
      guard.empresa.id,
    );

    return NextResponse.json({ items });
  } catch (error) {
    console.error(
      "[combustible-conciliacion] listar historial",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo obtener el historial de conciliaciones.",
      },
      {
        status: 500,
      },
    );
  }
}

/**
 * FLOTA-COMBUSTIBLE-3
 *
 * Importa el reporte periódico .xlsx de la gasolinera y crea una
 * conciliación histórica contra las cargas registradas por los pilotos.
 *
 * Esta operación:
 * - NO aprueba cargas.
 * - NO rechaza cargas.
 * - NO modifica flota_combustible_cargas.
 * - NO calcula automáticamente montos a pagar.
 *
 * Solamente compara y persiste el resultado para revisión de Operaciones.
 */
export async function POST(
  req: Request,
  ctx: Ctx,
) {
  const { slug } = await ctx.params;

  const guard =
    await requireTenantFlotaCombustible(
      slug,
      "editar",
    );

  if (guard.error) {
    return guard.error;
  }

  /*
   * Asegurar el esquema antes de intentar guardar la conciliación.
   */
  try {
    await asegurarSchemaFlota();
  } catch (error) {
    console.error(
      "[combustible-conciliacion] asegurar schema",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo preparar el módulo de conciliación.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Leer multipart/form-data.
   */
  let form: FormData;

  try {
    form = await req.formData();
  } catch (error) {
    console.error(
      "[combustible-conciliacion] formData inválido",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo leer el archivo enviado.",
      },
      {
        status: 400,
      },
    );
  }

  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        error:
          "Debes seleccionar un archivo Excel .xlsx.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Validación temprana de extensión.
   * guardarUploadExcel() vuelve a validarlo server-side.
   */
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json(
      {
        error:
          "Solo se aceptan archivos Excel .xlsx.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Leer los bytes para analizarlos con ExcelJS.
   */
  let contenido: Buffer;

  try {
    contenido = Buffer.from(
      await file.arrayBuffer(),
    );
  } catch (error) {
    console.error(
      "[combustible-conciliacion] lectura del archivo",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo leer el archivo Excel.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Interpretar el reporte real de la gasolinera.
   */
  let reporte: Awaited<
    ReturnType<
      typeof leerReporteCombustibleGasolinera
    >
  >;

  try {
    reporte =
      await leerReporteCombustibleGasolinera(
        contenido,
      );
  } catch (error) {
    console.error(
      "[combustible-conciliacion] Excel inválido",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo procesar el Excel. Verifica que sea un archivo .xlsx válido y que contenga las columnas requeridas del reporte de combustible.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Tiene que existir al menos una fila válida.
   * Las filas inválidas se devolverán como descartadas.
   */
  if (!reporte.filas.length) {
    return NextResponse.json(
      {
        error:
          "El Excel no contiene filas válidas para conciliar.",
        descartadas:
          reporte.descartadas,
      },
      {
        status: 400,
      },
    );
  }

  /*
   * El período de comparación se determina usando FECHA DE CONSUMO
   * del reporte, no la fecha de creación de las cargas del sistema.
   */
  const rango = obtenerRangoFechas(
    reporte.filas.map(
      (fila) => fila.fechaConsumo,
    ),
  );

  if (!rango) {
    return NextResponse.json(
      {
        error:
          "No fue posible determinar el período del reporte.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Obtener únicamente las cargas del sistema que pertenecen al
   * período cubierto por el reporte.
   */
  let cargasSistema: Awaited<
    ReturnType<
      typeof obtenerCargasSistemaParaConciliacion
    >
  >;

  try {
    cargasSistema =
      await obtenerCargasSistemaParaConciliacion(
        guard.empresa.id,
        rango.desde,
        rango.hasta,
      );
  } catch (error) {
    console.error(
      "[combustible-conciliacion] cargas sistema",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudieron consultar las cargas de combustible del período.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Comparación pura:
   *
   * COINCIDE
   * DIFERENCIA
   * SOLO_GASOLINERA
   * SOLO_SISTEMA
   * AMBIGUO
   */
  const resultados = conciliarPorVale(
    cargasSistema,
    reporte.filas,
  );

  const resumen = resumirEstados(
    resultados.map(
      (resultado) => resultado.estado,
    ),
  );

  /*
   * Guardar físicamente el Excel.
   *
   * Se hace después de haber validado y procesado el reporte para no
   * conservar archivos inválidos.
   */
  let archivoGuardado: {
    relative: string;
    original: string;
    size: number;
  };

  try {
    archivoGuardado =
      await guardarUploadExcel(
        guard.empresa.id,
        "flota",
        "conciliacion_combustible",
        file,
      );
  } catch (error) {
    if (
      error instanceof UploadValidationError
    ) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    console.error(
      "[combustible-conciliacion] guardar archivo",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo guardar el archivo de conciliación.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Persistir cabecera + snapshot de filas.
   *
   * guardarConciliacionCombustible() utiliza una transacción:
   * si una fila falla, ninguna fila ni cabecera queda guardada.
   */
  try {
    const guardada =
      await guardarConciliacionCombustible({
        empresaId:
          guard.empresa.id,

        archivo: {
          nombreOriginal:
            archivoGuardado.original,

          rutaRelativa:
            archivoGuardado.relative,

          mime:
            file.type?.trim() ||
            MIME_XLSX,

          tamano:
            archivoGuardado.size,
        },

        hoja:
          reporte.hoja,

        subidoPor:
          guard.session.username,

        resultados,

        descartadas:
          reporte.descartadas,
      });

    /*
     * Auditoría.
     *
     * La conciliación ya quedó persistida cuando llegamos aquí.
     * Si la auditoría falla, NO debemos borrar el Excel ni hacer que
     * Operaciones repita la importación.
     */
    try {
      await registrarAuditoria({
        empresaId:
          guard.empresa.id,

        usuario:
          guard.session.username,

        accion:
          "conciliar_combustible",

        modulo:
          "flota",

        detalle:
          `Conciliación combustible #${guardada.conciliacionId} · ` +
          `${archivoGuardado.original} · ` +
          `${rango.desde} a ${rango.hasta} · ` +
          `${resultados.length} resultado(s) · ` +
          `${reporte.descartadas.length} descartada(s)`,
      });
    } catch (auditError) {
      console.error(
        "[combustible-conciliacion] auditoría",
        auditError,
      );
    }

    return NextResponse.json({
      ok: true,

      conciliacionId:
        guardada.conciliacionId,

      archivo:
        archivoGuardado.original,

      hoja:
        reporte.hoja,

      periodo: {
        desde:
          rango.desde,

        hasta:
          rango.hasta,
      },

      filasExcelValidas:
        reporte.filas.length,

      filasDescartadas:
        reporte.descartadas.length,

      cargasSistema:
        cargasSistema.length,

      filasGuardadas:
        guardada.filasGuardadas,

      resumen,

      descartadas:
        reporte.descartadas,
    });
  } catch (error) {
    /*
     * El archivo físico ya existe, pero la transacción DB falló.
     * Se elimina para evitar archivos huérfanos.
     */
    borrarUpload(
      archivoGuardado.relative,
    );

    console.error(
      "[combustible-conciliacion] persistencia",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo guardar la conciliación. No se realizó ningún cambio en las cargas de combustible.",
      },
      {
        status: 500,
      },
    );
  }
}