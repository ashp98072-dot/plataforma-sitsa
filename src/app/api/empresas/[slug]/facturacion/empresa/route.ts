import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { CUESTIONARIO_EMPRESA } from "@/lib/facturacion/cuestionario";
import {
  guardarPerfilEmpresa,
  obtenerPerfilEmpresa,
} from "@/lib/facturacion/repository";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "facturacion");
  if (guard.error) return guard.error;
  const perfil = await obtenerPerfilEmpresa(guard.empresa.id);
  return NextResponse.json({
    cuestionario: CUESTIONARIO_EMPRESA,
    ...perfil,
    empresa: {
      id: guard.empresa.id,
      nombre: guard.empresa.nombre,
      slug: guard.empresa.slug,
    },
  });
}

const schema = z.object({
  respuestas: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.null(),
    ]),
  ),
});

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "facturacion", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const r = await guardarPerfilEmpresa(
    guard.empresa.id,
    parsed.data.respuestas,
    guard.session.id,
  );
  return NextResponse.json({
    mensaje: "Perfil de facturación de la empresa guardado.",
    completadoPct: r.completadoPct,
  });
}
