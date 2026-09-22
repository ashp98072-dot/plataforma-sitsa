import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarDisponibilidadProgramacionDia } from "@/lib/tms/disponibilidad-programacion-dia";

type Ctx = { params: Promise<{ slug: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}(?::\d{2})?$/;
const REGRESO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — disponibilidad de TODOS los
 * pilotos/auxiliares/unidades de la empresa en la fecha_plan seleccionada
 * que se está armando en el formulario de Programación (crear o editar),
 * para los buscadores de piloto/auxiliar/unidad: nunca oculta un recurso
 * ocupado, solo lo marca. Misma empresa_id de la sesión, nunca la que
 * mande el cliente (requireTenantProgramacionOTms).
 *
 * Comparte estados y consultas con el guardado en
 * disponibilidad-programacion-dia.ts. La hora y el regreso se aceptan
 * por compatibilidad con clientes anteriores, pero no alteran el resultado.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;

  const p = new URL(req.url).searchParams;
  const fecha = p.get("fecha") ?? "";
  if (!FECHA_RE.test(fecha)) {
    return NextResponse.json({ error: "fecha inválida (YYYY-MM-DD)." }, { status: 400 });
  }
  const horaCargaParam = p.get("horaCarga");
  if (horaCargaParam && !HORA_RE.test(horaCargaParam)) {
    return NextResponse.json({ error: "horaCarga inválida (HH:mm)." }, { status: 400 });
  }
  const regresoEstimadoParam = p.get("regresoEstimado");
  if (regresoEstimadoParam && !REGRESO_RE.test(regresoEstimadoParam)) {
    return NextResponse.json({ error: "regresoEstimado inválido (YYYY-MM-DDTHH:mm)." }, { status: 400 });
  }
  const excluirPlanIdParam = p.get("excluirPlanId");
  const excluirPlanId = excluirPlanIdParam && /^\d+$/.test(excluirPlanIdParam) ? Number(excluirPlanIdParam) : null;

  const { personal, unidades } = await listarDisponibilidadProgramacionDia(guard.empresa.id, fecha, excluirPlanId);

  return NextResponse.json(
    {
      personal: Object.fromEntries(personal),
      unidades: Object.fromEntries(unidades),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
