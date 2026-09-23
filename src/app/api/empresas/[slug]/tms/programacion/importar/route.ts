import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireTenantProgramacion } from "@/lib/tenant";
import {
  generarPlantillaProgramacion,
  parsearExcelProgramacion,
  type FilaProgramacionExcel,
} from "@/lib/tms/programacion-import-excel";
import {
  previsualizarImportacionProgramacion,
  confirmarImportacionProgramacion,
  type DatosResueltosFilaProgramacion,
} from "@/lib/tms/programacion-import";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — mismo límite que ya usa el importador de Rutas.

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 6 de 6) — endpoint de
 * integración final: descarga de plantilla + las dos fases (validar/
 * importar) del importador masivo de Programación. Mismo patrón de un
 * solo endpoint con el campo `accion` que ya usa
 * .../tms/rutas/importar/route.ts, simplificado porque V1 de Programación
 * es determinístico (sin `decisiones`/`decisionesCliente`: cada fila o
 * resuelve limpio contra catálogo, o es error — nunca hay que elegir
 * entre candidatos, ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-1-
 * PROPUESTA-FINAL.md).
 *
 * Este archivo NO reimplementa ninguna regla de negocio: solo conecta el
 * HTTP con las funciones ya cerradas en los PR 1-5
 * (parsearExcelProgramacion / previsualizarImportacionProgramacion /
 * confirmarImportacionProgramacion), que ya hacen — respectivamente — el
 * parseo+validación sintáctica, la revalidación de solo lectura contra
 * catálogo/BD, y la confirmación transaccional todo-o-nada (candado,
 * revalidación fresca, transacción, auditoría única). empresaId/usuario
 * SIEMPRE vienen de la sesión (`guard`), nunca del cliente HTTP.
 */

function nombreArchivoValido(nombre: string): boolean {
  return nombre.toLowerCase().endsWith(".xlsx");
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "ver");
  if (guard.error) return guard.error;

  try {
    const body = new Uint8Array(await generarPlantillaProgramacion(guard.empresa.id));
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="excel-modelo-programacion.xlsx"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("GET tms/programacion/importar (plantilla)", e);
    return NextResponse.json({ error: "No se pudo generar la plantilla." }, { status: 500 });
  }
}

/**
 * Respuesta de `accion=validar`: una entrada por fila del Excel, con el
 * crudo tal como vino (para poder mostrar algo incluso en filas con
 * error, donde no hay nada "resuelto" que mostrar) MÁS lo ya resuelto
 * desde BD cuando la fila es válida (`resuelto`, `null` si no). El
 * front-end SIEMPRE debe mostrar `resuelto` (nombres reales) y nunca los
 * campos *Excel para una fila ok — esos solo son el respaldo visual de
 * las filas con error.
 */
type FilaRespuestaValidar = {
  filaExcel: number;
  estado: "ok" | "error";
  errores: string[];
  advertencias: string[];
  fechaSalidaExcel: string | null;
  horaSalidaExcel: string | null;
  codigoRutaExcel: string;
  clienteExcel: string;
  pilotoCodigoExcel: string;
  placaExcel: string;
  auxiliar1CodigoExcel: string;
  auxiliar2CodigoExcel: string;
  tipoTrasladoExcel: string;
  tarifaExcel: number | null;
  fechaRegresoExcel: string | null;
  horaRegresoExcel: string | null;
  observacionesExcel: string;
  /** TMS-TC-PLANES-REPORTES-1 — valor recibido en la columna opcional TC / Caja / Remolque ("" si no viene). */
  tcExcel: string;
  resuelto: DatosResueltosFilaProgramacion | null;
};

function combinarFilaRespuesta(
  fila: FilaProgramacionExcel,
  preview: { estado: "ok" | "error"; errores: string[]; advertencias: string[]; datos: DatosResueltosFilaProgramacion | null },
): FilaRespuestaValidar {
  return {
    filaExcel: fila.filaExcel,
    estado: preview.estado,
    errores: preview.errores,
    advertencias: preview.advertencias,
    fechaSalidaExcel: fila.fechaSalidaExcel,
    horaSalidaExcel: fila.horaSalidaExcel,
    codigoRutaExcel: fila.codigoRutaExcel,
    clienteExcel: fila.clienteExcel,
    pilotoCodigoExcel: fila.pilotoCodigoExcel,
    placaExcel: fila.placaExcel,
    auxiliar1CodigoExcel: fila.auxiliar1CodigoExcel,
    auxiliar2CodigoExcel: fila.auxiliar2CodigoExcel,
    tipoTrasladoExcel: fila.tipoTrasladoExcel,
    tarifaExcel: fila.tarifaExcel,
    fechaRegresoExcel: fila.fechaRegresoExcel,
    horaRegresoExcel: fila.horaRegresoExcel,
    observacionesExcel: fila.observacionesExcel,
    tcExcel: fila.tcExcel ?? "",
    resuelto: preview.datos,
  };
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;

  const form = await req.formData();
  const archivo = form.get("archivo");
  const accion = String(form.get("accion") ?? "validar");

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Selecciona un archivo Excel." }, { status: 400 });
  }
  if (accion !== "validar" && accion !== "importar") {
    return NextResponse.json({ error: "Acción de importación inválida." }, { status: 400 });
  }
  // No se confía en el nombre/MIME del archivo como validación real —
  // eso lo hace el parser sobre el contenido. Esta comprobación es solo
  // un rechazo rápido y claro antes de gastar tiempo parseando algo que
  // ya se sabe que no es un .xlsx por su nombre.
  if (!nombreArchivoValido(archivo.name)) {
    return NextResponse.json({ error: "El archivo debe ser Excel .xlsx." }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 15 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());

  // El límite de 500 filas útiles lo aplica parsearExcelProgramacion
  // internamente (lanza un Error claro si se excede) — no se duplica esa
  // regla aquí.
  let filasExcel: FilaProgramacionExcel[];
  try {
    filasExcel = await parsearExcelProgramacion(buffer);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "No se pudo leer el Excel.";
    return NextResponse.json({ error: detalle }, { status: 400 });
  }

  if (filasExcel.length === 0) {
    return NextResponse.json(
      { error: 'La hoja "Programacion" no contiene filas de datos.' },
      { status: 400 },
    );
  }

  if (accion === "validar") {
    try {
      const preview = await previsualizarImportacionProgramacion(guard.empresa.id, filasExcel);
      const previewPorFila = new Map(preview.filas.map((f) => [f.filaExcel, f]));
      const filas: FilaRespuestaValidar[] = filasExcel.map((fila) => {
        const p = previewPorFila.get(fila.filaExcel);
        return combinarFilaRespuesta(
          fila,
          p ?? { estado: "error", errores: ["No se pudo validar esta fila."], advertencias: [], datos: null },
        );
      });
      return NextResponse.json({ accion: "validar", filas, resumen: preview.resumen });
    } catch (e) {
      console.error("POST tms/programacion/importar validar", e);
      return NextResponse.json({ error: "No se pudo analizar el archivo." }, { status: 500 });
    }
  }

  // accion === "importar" — se vuelve a parsear el archivo recibido en
  // ESTA misma solicitud (arriba); confirmarImportacionProgramacion hace
  // TODO lo demás (GET_LOCK, revalidación fresca, transacción todo-o-
  // nada, personal/unidad/lugares/plan/auxiliares/paradas/viáticos,
  // auditoría única) — nada de eso se duplica aquí.
  try {
    const hashArchivo = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    const resultado = await confirmarImportacionProgramacion(
      guard.empresa.id,
      guard.session.username,
      archivo.name,
      hashArchivo,
      filasExcel,
    );
    return NextResponse.json({ accion: "importar", resultado });
  } catch (e) {
    console.error("POST tms/programacion/importar importar", e);
    return NextResponse.json(
      { error: "No se pudo completar la importación. No se guardó ningún cambio." },
      { status: 500 },
    );
  }
}
