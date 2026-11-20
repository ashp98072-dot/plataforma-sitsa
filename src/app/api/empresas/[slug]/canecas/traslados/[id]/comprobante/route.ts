import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { accesoCanecas } from "@/lib/canecas/acceso";
import { generarComprobanteTraslado, type ComprobanteTraslado } from "@/lib/canecas/comprobante-traslado";
import { getPool } from "@/lib/db";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id: rawId } = await ctx.params;
  const guard = await accesoCanecas(slug, "ver");
  if (guard.error) return guard.error;
  const id = Number(rawId);
  const versionRaw = new URL(req.url).searchParams.get("version");
  const version = versionRaw === null ? null : Number(versionRaw);
  if (!Number.isSafeInteger(id) || id < 1 || (version !== null && (!Number.isSafeInteger(version) || version < 1))) return NextResponse.json({ error: "Comprobante inválido." }, { status: 400 });
  try {
    const [docs] = await getPool().query<RowDataPacket[]>("SELECT datos,logo FROM canecas_traslado_documentos WHERE empresa_id=? AND traslado_id=? AND (? IS NULL OR version=?) ORDER BY version DESC LIMIT 1", [guard.empresa.id, id, version, version]);
    if (!docs[0]) return NextResponse.json({ error: "Comprobante no encontrado." }, { status: 404 });
    const datos = (typeof docs[0].datos === "string" ? JSON.parse(docs[0].datos) : docs[0].datos) as ComprobanteTraslado;
    const bytes = await generarComprobanteTraslado(datos, docs[0].logo ? Buffer.from(docs[0].logo) : null);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="traslado-${id}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "No se pudo generar el comprobante." }, { status: 500 }); }
}

