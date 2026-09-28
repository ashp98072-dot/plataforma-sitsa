import { proveedorRrhhGet, proveedorRrhhGuardar } from "@/lib/rrhh/proveedor-api";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return proveedorRrhhGet(req, slug, id); }
export async function PATCH(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return proveedorRrhhGuardar(req, slug, id); }
