import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { capturarAntecedentesFiscales, confirmarAntecedentesFiscales, leerAntecedentesFiscales } from "@/lib/rrhh/fiscal-antecedentes";
import { antecedenteFiscalSchema, ErrorModeloFiscal } from "@/lib/rrhh/fiscal-modelo";

type Ctx = { params: Promise<{ slug: string; empleadoId: string; ejercicio: string }> };
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const captura = z.strictObject({ expectedRevision: z.number().int().min(0).max(2147483646), antecedente: antecedenteFiscalSchema });
const confirmacion = z.strictObject({ accion: z.literal("confirmar"), revision: z.number().int().positive().max(2147483646) });

function ids(empleado: string, ejercicio: string) {
  if (!/^[1-9]\d{0,9}$/.test(empleado) || Number(empleado) > 2147483647 || !/^\d{4}$/.test(ejercicio) || Number(ejercicio) < 2000) {
    throw new ErrorModeloFiscal("Empleado o ejercicio inválido.");
  }
  return [Number(empleado), Number(ejercicio)] as const;
}
function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof ErrorModeloFiscal ? error.message : "No se pudo procesar los antecedentes fiscales." },
    { status: error instanceof ErrorModeloFiscal ? error.status : 500, headers });
}

export async function GET(_req: Request, ctx: Ctx) {
  const p = await ctx.params;
  const guard = await requireTenantRrhh(p.slug, "configuracion", "ver");
  if (guard.error) return guard.error;
  try {
    const [empleadoId, ejercicio] = ids(p.empleadoId, p.ejercicio);
    return NextResponse.json(await leerAntecedentesFiscales(guard.empresa.id, empleadoId, ejercicio), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(req: Request, ctx: Ctx) {
  const p = await ctx.params;
  const guard = await requireTenantRrhh(p.slug, "configuracion", "crear");
  if (guard.error) return guard.error;
  try {
    const [empleadoId, ejercicio] = ids(p.empleadoId, p.ejercicio);
    const parsed = captura.safeParse(await req.json());
    if (!parsed.success) throw new ErrorModeloFiscal("Captura fiscal inválida.");
    const result = await capturarAntecedentesFiscales(guard.empresa.id, empleadoId, ejercicio,
      parsed.data.antecedente, guard.session.username, parsed.data.expectedRevision);
    return NextResponse.json(result, { status: 201, headers });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? new ErrorModeloFiscal("JSON inválido.") : error);
  }
}
export async function PATCH(req: Request, ctx: Ctx) {
  const p = await ctx.params;
  const guard = await requireTenantRrhh(p.slug, "configuracion", "editar");
  if (guard.error) return guard.error;
  try {
    const [empleadoId, ejercicio] = ids(p.empleadoId, p.ejercicio);
    const parsed = confirmacion.safeParse(await req.json());
    if (!parsed.success) throw new ErrorModeloFiscal("Confirmación fiscal inválida.");
    return NextResponse.json(await confirmarAntecedentesFiscales(guard.empresa.id, empleadoId, ejercicio,
      parsed.data.revision, guard.session.username), { headers });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? new ErrorModeloFiscal("JSON inválido.") : error);
  }
}
