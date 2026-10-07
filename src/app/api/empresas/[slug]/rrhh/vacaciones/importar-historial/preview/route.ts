import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { parsearCsv } from "@/lib/rrhh/vacaciones-historial-import";
import { leerXlsx } from "@/lib/rrhh/vacaciones-historial-xlsx";
import { previsualizarHistorial } from "@/lib/rrhh/vacaciones-historial-preview";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Importar historial de vacaciones — VISTA PREVIA / SIMULACIÓN. SOLO LECTURA: no escribe nada en la base de datos ni en disco
 * (el archivo se procesa en memoria). Aplicar la reconstrucción en producción NO existe en este endpoint (paso posterior y controlado).
 * La empresa siempre sale de la sesión/slug, nunca del archivo. Permiso: RRHH · Vacaciones · editar.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;

  let archivo: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("archivo");
    archivo = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "Envía el archivo como multipart/form-data (campo «archivo»)." }, { status: 400 });
  }
  if (!archivo || archivo.size === 0) return NextResponse.json({ error: "Selecciona un archivo .csv o .xlsx." }, { status: 400 });
  if (archivo.size > MAX_BYTES) return NextResponse.json({ error: "El archivo supera 5 MB." }, { status: 413 });

  const nombre = archivo.name.toLowerCase();
  try {
    let leido: Awaited<ReturnType<typeof leerXlsx>>;
    if (nombre.endsWith(".xlsx")) leido = await leerXlsx(await archivo.arrayBuffer());
    else if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) leido = parsearCsv(await archivo.text());
    else return NextResponse.json({ error: "Formato no soportado: usa .csv o .xlsx." }, { status: 400 });
    const preview = await previsualizarHistorial(guard.empresa.id, leido);
    return NextResponse.json(preview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[vacaciones/importar-historial/preview]", error);
    return NextResponse.json({ error: "No se pudo leer el archivo. Verifica el formato." }, { status: 422 });
  }
}
