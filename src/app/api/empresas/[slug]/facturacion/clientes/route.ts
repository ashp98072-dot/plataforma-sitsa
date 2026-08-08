import { NextResponse } from "next/server";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resumenPerfilesClientes } from "@/lib/facturacion/repository";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "facturacion");
  if (guard.error) return guard.error;
  const clientes = await resumenPerfilesClientes(guard.empresa.id);
  return NextResponse.json(
    { clientes },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
