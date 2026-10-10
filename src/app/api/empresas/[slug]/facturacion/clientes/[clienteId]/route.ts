import { NextResponse } from "next/server";
import { z } from "zod";
import { obtenerCliente } from "@/lib/clientes/repository";
import { requireFacturacionConfig } from "@/lib/facturacion/acceso";
import { CUESTIONARIO_CLIENTE } from "@/lib/facturacion/cuestionario";
import {
  guardarPerfilCliente,
  obtenerPerfilCliente,
} from "@/lib/facturacion/repository";
import {
  esEsquemaPendiente,
  guardarRetencionIvaCliente,
  leerRetencionIvaCliente,
  MENSAJE_FALTA_MIGRACION_FACT4,
} from "@/lib/facturacion/contexto-factura";
import { RETENCIONES_IVA_PERMITIDAS } from "@/lib/facturacion/lineas-factura";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireFacturacionConfig(slug, "ver_requisitos");
  if (guard.error) return guard.error;
  const cliente = await obtenerCliente(guard.empresa.id, Number(clienteId));
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  }
  const perfil = await obtenerPerfilCliente(
    guard.empresa.id,
    Number(clienteId),
  );
  // FACT-4: retención de IVA configurada del cliente (0 = no aplica). Sin migración → 0.
  const retencionIvaPct = await leerRetencionIvaCliente(guard.empresa.id, Number(clienteId));
  return NextResponse.json({
    cuestionario: CUESTIONARIO_CLIENTE,
    cliente,
    ...perfil,
    retencionIvaPct,
    retencionesPermitidas: RETENCIONES_IVA_PERMITIDAS,
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
  // FACT-4: retención de IVA del cliente (solo 0, 15 o 30). Opcional: omitirla no la modifica.
  retencionIvaPct: z.union([z.literal(0), z.literal(15), z.literal(30)]).optional(),
});

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireFacturacionConfig(slug, "editar_requisitos");
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
  if (parsed.data.retencionIvaPct !== undefined) {
    try {
      await guardarRetencionIvaCliente(
        guard.empresa.id,
        Number(clienteId),
        parsed.data.retencionIvaPct,
        guard.session.id,
      );
    } catch (e) {
      if (esEsquemaPendiente(e)) {
        return NextResponse.json({ error: MENSAJE_FALTA_MIGRACION_FACT4 }, { status: 503 });
      }
      throw e;
    }
  }
  return NextResponse.json({
    mensaje: "Perfil de facturación del cliente guardado.",
    completadoPct: r.completadoPct,
  });
}
