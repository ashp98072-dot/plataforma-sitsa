import { proveedorRrhhGet, proveedorRrhhGuardar } from "@/lib/rrhh/proveedor-api";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return proveedorRrhhGet(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return proveedorRrhhGuardar(req, (await ctx.params).slug); }
