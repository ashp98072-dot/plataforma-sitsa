import { NextResponse } from "next/server";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import {
  alcanceFacturacion,
  denyFacturacionAlcance,
} from "@/lib/facturacion/alcance";
import { resumenPerfilesClientes } from "@/lib/facturacion/repository";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "facturacion");
  if (guard.error) return guard.error;
  const alcance = alcanceFacturacion(guard.session.rol);
  if (!alcance.verClientes) {
    return denyFacturacionAlcance(
      "Solo Operaciones administra la facturación por cliente.",
    );
  }
  const clientes = await resumenPerfilesClientes(guard.empresa.id);
  return NextResponse.json(
    { clientes },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
