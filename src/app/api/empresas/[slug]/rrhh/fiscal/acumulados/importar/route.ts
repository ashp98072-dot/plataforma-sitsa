import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { ErrorModeloFiscal } from "@/lib/rrhh/fiscal-modelo";
import { importarAcumuladosFiscales } from "@/lib/rrhh/fiscal-antecedentes";
import { analizarArchivoAcumulados, construirItemsImportacion, ErrorArchivoAcumulados } from "@/lib/rrhh/fiscal-importacion";
import { MAX_BYTES_ACUMULADOS, puedeImportar } from "@/lib/rrhh/fiscal-importacion-ui";

type Ctx = { params: Promise<{ slug: string }> };
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/**
 * POST multipart (file + modo):
 *  - modo=analizar  → DRY-RUN: lee el Excel y devuelve válidas/advertencias/errores por fila. NO escribe nada.
 *  - modo=importar  → vuelve a analizar el MISMO archivo en el servidor (no confía en la vista previa ni en filas del cliente) y, si
 *    no hay errores, crea los BORRADORES en UNA transacción todo-o-nada (revalida empleado, revisión, anti doble conteo y modelo).
 *    Nunca confirma.
 * Permiso: RRHH · configuracion · crear (el mismo de la captura individual). La empresa sale de la sesión.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "configuracion", "crear");
  if (guard.error) return guard.error;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const modo = form.get("modo");
    if (!(file instanceof File)) return NextResponse.json({ error: "Archivo Excel requerido." }, { status: 400, headers });
    if (modo !== "analizar" && modo !== "importar") return NextResponse.json({ error: "Modo inválido." }, { status: 400, headers });
    if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Solo se aceptan archivos .xlsx." }, { status: 400, headers });
    if (file.size > MAX_BYTES_ACUMULADOS) return NextResponse.json({ error: "El archivo excede el tamaño máximo de 5 MB." }, { status: 413, headers });

    const buffer = Buffer.from(await file.arrayBuffer());
    const analisis = await analizarArchivoAcumulados(guard.empresa.id, buffer);
    if (modo === "analizar") return NextResponse.json({ analisis }, { headers });

    if (!puedeImportar(analisis)) {
      return NextResponse.json({ error: "El archivo tiene errores. Corrígelos y vuelve a analizarlo; no se guardó nada.", analisis }, { status: 422, headers });
    }
    const items = construirItemsImportacion(analisis);
    const r = await importarAcumuladosFiscales(guard.empresa.id, items, guard.session.username, file.name);
    return NextResponse.json({ importados: r.importados }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ErrorArchivoAcumulados) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ErrorModeloFiscal) return NextResponse.json({ error: `${error.message} No se guardó nada.` }, { status: error.status, headers });
    console.error("importar acumulados fiscales (rollback total)", error);
    return NextResponse.json({ error: "No se pudo importar. No se guardó nada." }, { status: 500, headers });
  }
}
