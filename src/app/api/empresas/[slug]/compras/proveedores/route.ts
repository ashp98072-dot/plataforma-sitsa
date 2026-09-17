import { proveedorGet, proveedorGuardar } from "@/lib/compras/proveedor-api";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return proveedorGet(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return proveedorGuardar(req, (await ctx.params).slug); }
