import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { extname } from "path";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantGastos } from "@/lib/tenant";
import {
  borrarUpload,
  contentTypeFor,
  guardarUpload,
  getUploadsRoot,
  UploadValidationError,
  validarRutaArchivoEmpresa,
} from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };
type ArchivoRow = RowDataPacket & {
  activo: number;
  factura_ruta_relativa: string | null;
  factura_nombre_original: string | null;
  factura_mime: string | null;
  factura_tamano: number | null;
};

const EXTENSIONES = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

async function obtener(empresaId: number, gastoId: number) {
  const rows = await query<ArchivoRow[]>(
    `SELECT activo, factura_ruta_relativa, factura_nombre_original, factura_mime, factura_tamano
     FROM tms_gastos_operativos WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [gastoId, empresaId],
  );
  return rows[0] ?? null;
}

function idValido(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function borrarArchivoDeEmpresa(empresaId: number, ruta: string | null) {
  if (ruta && validarRutaArchivoEmpresa(empresaId, ruta)) borrarUpload(ruta);
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const id = idValido(raw);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const gasto = await obtener(guard.empresa.id, id);
  if (!gasto?.factura_ruta_relativa || !gasto.factura_nombre_original) {
    return NextResponse.json({ error: "Comprobante no encontrado." }, { status: 404 });
  }
  try {
    const rutaSegura = validarRutaArchivoEmpresa(guard.empresa.id, gasto.factura_ruta_relativa);
    if (!rutaSegura) return NextResponse.json({ error: "Ruta de comprobante inválida." }, { status: 404 });
    const contenido = await readFile(rutaSegura);
    const nombre = gasto.factura_nombre_original.replace(/["\r\n]/g, "");
    return new NextResponse(contenido, { headers: {
      "Content-Type": gasto.factura_mime || contentTypeFor(nombre),
      "Content-Disposition": `inline; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    // GASTOS-COMPROBANTE-404-3 (instrumentación TEMPORAL de diagnóstico,
    // aprobada explícitamente — retirar una vez confirmada la causa raíz
    // real del 404 en producción, ver PR correspondiente).
    //
    // Solo registra: raíz de uploads resuelta, ruta relativa guardada en
    // BD, ruta absoluta calculada, si existe en disco, y el código de
    // error del filesystem (ENOENT/EACCES/etc.) — nunca contenido del
    // archivo, nunca sesión/cookies/secretos, nunca otros campos de BD.
    // La respuesta al cliente NO cambia: sigue siendo exactamente el
    // mismo 404 de siempre.
    let uploadsRoot: string;
    try {
      uploadsRoot = getUploadsRoot();
    } catch (rootError) {
      uploadsRoot = `ERROR: ${rootError instanceof Error ? rootError.message : String(rootError)}`;
    }
    const rutaAbsolutaCalculada = validarRutaArchivoEmpresa(guard.empresa.id, gasto.factura_ruta_relativa);
    console.error("[comprobante] 404 en disco — diagnóstico temporal", {
      uploadsRoot,
      rutaRelativa: gasto.factura_ruta_relativa,
      rutaAbsolutaCalculada,
      existe: rutaAbsolutaCalculada ? existsSync(rutaAbsolutaCalculada) : null,
      codigoError: (error as NodeJS.ErrnoException)?.code ?? "desconocido",
    });
    return NextResponse.json({ error: "Comprobante no encontrado en disco." }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;
  const id = idValido(raw);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const gasto = await obtener(guard.empresa.id, id);
  if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
  if (!gasto.activo) return NextResponse.json({ error: "El gasto ya no puede editarse." }, { status: 409 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
  if (!EXTENSIONES.has(extname(file.name).toLowerCase()) || !MIMES.has(file.type)) {
    return NextResponse.json({ error: "Formato no permitido. Usa PDF, JPG, JPEG o PNG." }, { status: 400 });
  }
  let guardado: Awaited<ReturnType<typeof guardarUpload>>;
  try {
    guardado = await guardarUpload(guard.empresa.id, "documentos", `gasto${id}-factura`, file);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "No se pudo guardar el comprobante." }, { status: 500 });
  }
  try {
    await execute(
      `UPDATE tms_gastos_operativos
       SET factura_ruta_relativa = ?, factura_nombre_original = ?, factura_mime = ?, factura_tamano = ?, tiene_factura = 1
       WHERE id = ? AND empresa_id = ? AND activo = 1`,
      [guardado.relative, guardado.original, file.type, guardado.size, id, guard.empresa.id],
    );
  } catch (error) {
    borrarUpload(guardado.relative);
    throw error;
  }
  borrarArchivoDeEmpresa(guard.empresa.id, gasto.factura_ruta_relativa);
  return NextResponse.json({ mensaje: gasto.factura_ruta_relativa ? "Comprobante reemplazado." : "Comprobante adjuntado.", nombre: guardado.original, tamano: guardado.size });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;
  const id = idValido(raw);
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const gasto = await obtener(guard.empresa.id, id);
  if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
  if (!gasto.activo) return NextResponse.json({ error: "El gasto ya no puede editarse." }, { status: 409 });
  await execute(
    `UPDATE tms_gastos_operativos SET factura_ruta_relativa = NULL, factura_nombre_original = NULL,
       factura_mime = NULL, factura_tamano = NULL, tiene_factura = 0
     WHERE id = ? AND empresa_id = ? AND activo = 1`,
    [id, guard.empresa.id],
  );
  borrarArchivoDeEmpresa(guard.empresa.id, gasto.factura_ruta_relativa);
  return NextResponse.json({ mensaje: "Comprobante eliminado." });
}
