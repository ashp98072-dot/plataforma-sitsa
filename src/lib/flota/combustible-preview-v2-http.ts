import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { analizarProveedorV2, resumirProveedorV2 } from "./combustible-importacion-v2";
import { ErrorArchivoProveedor, validarArchivoImportacion } from "./combustible-importacion-parser";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";

async function formularioAcotado(req: Request) {
  const max = MAX_UPLOAD_BYTES + 64 * 1024; // archivo + cabeceras/campos multipart
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data;") || !req.body) throw new ErrorArchivoProveedor("Se requiere formulario multipart.");
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || BigInt(length) > BigInt(max))) throw new ErrorArchivoProveedor("Solicitud demasiado grande.", 413);
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel(); throw new ErrorArchivoProveedor("Solicitud demasiado grande.", 413); }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    return await new Response(body, { headers: { "content-type": req.headers.get("content-type")! } }).formData();
  } catch (e) {
    if (e instanceof ErrorArchivoProveedor) throw e;
    throw new ErrorArchivoProveedor("Formulario multipart inválido o interrumpido.");
  } finally { reader.releaseLock(); }
}

export async function proveedoresPreviewV2Http(slug: string) {
  const g = await requireTenantFlotaCombustible(slug, "conciliar", { soloLectura: true });
  if (g.error) return g.error;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const proveedores = await query<RowDataPacket[]>("SELECT id, nombre_comercial AS nombre FROM compras_proveedores WHERE empresa_id=? AND activo=1 ORDER BY nombre_comercial", [g.empresa.id]);
    return NextResponse.json({ proveedores }, { headers });
  } catch { return NextResponse.json({ error: "No se pudieron cargar proveedores." }, { status: 500, headers }); }
}

/** Preview v2 sin token de confirmación, uploads, bootstrap de esquema ni escrituras. */
export async function previewProveedorV2Http(req: Request, slug: string) {
  const g = await requireTenantFlotaCombustible(slug, "conciliar", { soloLectura: true });
  if (g.error) return g.error;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const form = await formularioAcotado(req);
    const perfil = form.get("perfil"), file = form.get("file"), proveedorId = Number(form.get("proveedorId"));
    if ((perfil !== "HALEL" && perfil !== "SHELL") || !(file instanceof File) || !Number.isSafeInteger(proveedorId) || proveedorId <= 0) {
      return NextResponse.json({ error: "Proveedor, perfil HALEL/SHELL y archivo son obligatorios." }, { status: 400, headers });
    }
    validarArchivoImportacion(file);
    const proveedor = await query<RowDataPacket[]>("SELECT id FROM compras_proveedores WHERE empresa_id=? AND id=? AND activo=1", [g.empresa.id, proveedorId]);
    if (!proveedor.length) return NextResponse.json({ error: "Proveedor no disponible para esta empresa." }, { status: 403, headers });
    const analisis = await analizarProveedorV2(Buffer.from(await file.arrayBuffer()), perfil);
    const claves = [...new Set(analisis.filas.flatMap(f => f.identidadCandidata ? [f.identidadCandidata] : []))];
    const previas = new Set<string>();
    try {
      for (let i = 0; i < claves.length; i += 200) {
        const lote = claves.slice(i, i + 200);
        // Solo evidencia que realmente dispone de proveedor y clave. No se atribuye identidad a importaciones legacy.
        const rows = await query<RowDataPacket[]>(`SELECT DISTINCT f.clave_operacion FROM flota_combustible_conciliacion_filas f
          JOIN flota_combustible_conciliaciones c ON c.empresa_id=f.empresa_id AND c.id=f.conciliacion_id
          WHERE c.empresa_id=? AND c.proveedor_id=? AND c.perfil_parser='HALEL'
          AND f.clave_operacion IN (${lote.map(() => "?").join(",")})`, [g.empresa.id, proveedorId, ...lote]);
        rows.forEach(r => previas.add(String(r.clave_operacion)));
      }
      analisis.coberturaPrevios = "Solo evidencia HALEL C2B de esta empresa y proveedor; no certifica ausencia en históricos legacy ni en consumos independientes.";
    } catch (e) {
      if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes((e as { code?: string }).code ?? "")) throw e;
      analisis.coberturaPrevios = "Búsqueda de previos no disponible: falta el esquema C2B. No se modifica el esquema.";
    }
    analisis.filas.forEach(f => {
      f.posiblePrevio = !!f.identidadCandidata && previas.has(f.identidadCandidata);
      if (f.posiblePrevio) f.motivos.push("Posible aparición previa: excluida de totales elegibles hasta revisión");
    });
    resumirProveedorV2(analisis);
    return NextResponse.json(analisis, { headers });
  } catch (e) {
    if (e instanceof ErrorArchivoProveedor) return NextResponse.json({ error: e.message }, { status: e.status, headers });
    // No registrar contenido de celdas o errores del driver que puedan contener información del archivo.
    console.error("[combustible-preview-v2] No se pudo completar el análisis");
    return NextResponse.json({ error: "No se pudo analizar el archivo o consultar el historial." }, { status: 500, headers });
  }
}
