import { proveedorGet, proveedorGuardar } from "@/lib/compras/proveedor-api";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return proveedorGet(req, slug, id); }
export async function PATCH(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return proveedorGuardar(req, slug, id); }
