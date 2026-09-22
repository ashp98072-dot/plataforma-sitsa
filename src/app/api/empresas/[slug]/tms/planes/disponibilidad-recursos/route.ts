import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { finViajeDesdeInput, inicioViaje } from "@/lib/tms/disponibilidad-traslapes";
import { listarConflictosPersonal, listarConflictosUnidades } from "@/lib/tms/disponibilidad-recursos-lista";

type Ctx = { params: Promise<{ slug: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}(?::\d{2})?$/;
const REGRESO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — disponibilidad de TODOS los
 * pilotos/auxiliares/unidades de la empresa contra el intervalo del viaje
 * que se está armando en el formulario de Programación (crear o editar),
 * para los buscadores de piloto/auxiliar/unidad: nunca oculta un recurso
 * ocupado, solo lo marca. Misma empresa_id de la sesión, nunca la que
 * mande el cliente (requireTenantProgramacionOTms).
 *
 * Reutiliza el MISMO motor de "ocupación real" que ya usa el guardado
 * (disponibilidad-traslapes.ts) — ver disponibilidad-recursos-lista.ts —
 * así que el resultado es exactamente el mismo criterio que después
 * aplicará el backend al validar el guardado (sección 11 del ticket): el
 * color gris en la UI y el rechazo del servidor nunca pueden divergir
 * porque comparten el mismo código.
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

  const intervalo = {
    inicio: inicioViaje(fecha, horaCargaParam),
    fin: finViajeDesdeInput(regresoEstimadoParam),
  };

  const [personal, unidades] = await Promise.all([
    listarConflictosPersonal(guard.empresa.id, intervalo, excluirPlanId),
    listarConflictosUnidades(guard.empresa.id, intervalo, excluirPlanId),
  ]);

  return NextResponse.json(
    {
      personal: Object.fromEntries(personal),
      unidades: Object.fromEntries(unidades),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
