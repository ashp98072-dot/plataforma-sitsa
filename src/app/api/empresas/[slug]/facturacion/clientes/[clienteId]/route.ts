import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { obtenerCliente } from "@/lib/clientes/repository";
import { CUESTIONARIO_CLIENTE } from "@/lib/facturacion/cuestionario";
import {
  guardarPerfilCliente,
  obtenerPerfilCliente,
} from "@/lib/facturacion/repository";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "facturacion");
  if (guard.error) return guard.error;
  const cliente = await obtenerCliente(guard.empresa.id, Number(clienteId));
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }
  const perfil = await obtenerPerfilCliente(
    guard.empresa.id,
    Number(clienteId),
  );
  return NextResponse.json({
    cuestionario: CUESTIONARIO_CLIENTE,
    cliente,
    ...perfil,
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
  const { slug, clienteId } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "facturacion", true);
  if (guard.error) return guard.error;
  const cliente = await obtenerCliente(guard.empresa.id, Number(clienteId));
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const r = await guardarPerfilCliente(
    guard.empresa.id,
    Number(clienteId),
    parsed.data.respuestas,
    guard.session.id,
  );
  return NextResponse.json({
    mensaje: "Perfil de facturación del cliente guardado.",
    completadoPct: r.completadoPct,
  });
}
