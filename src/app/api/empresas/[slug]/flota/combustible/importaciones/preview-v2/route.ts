import { previewProveedorV2Http, proveedoresPreviewV2Http } from "@/lib/flota/combustible-preview-v2-http";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return proveedoresPreviewV2Http((await ctx.params).slug);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return previewProveedorV2Http(req, (await ctx.params).slug);
}
