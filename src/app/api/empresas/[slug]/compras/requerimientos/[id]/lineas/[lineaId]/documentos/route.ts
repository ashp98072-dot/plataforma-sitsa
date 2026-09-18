import { lineaDocumentosGet, lineaDocumentoSubir } from "@/lib/compras/linea-documentos-api";
type Ctx = { params: Promise<{ slug: string; id: string; lineaId: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id, lineaId } = await ctx.params;
  return lineaDocumentosGet(slug, id, lineaId);
}
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id, lineaId } = await ctx.params;
  return lineaDocumentoSubir(req, slug, id, lineaId);
}
