import { lineaDocumentoRetirar, lineaDocumentoServir } from "@/lib/compras/linea-documentos-api";
type Ctx = { params: Promise<{ slug: string; docId: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, docId } = await ctx.params;
  return lineaDocumentoServir(slug, docId);
}
export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, docId } = await ctx.params;
  return lineaDocumentoRetirar(req, slug, docId);
}
