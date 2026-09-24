import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarOcupacionProgramacionIntervalo, ventanaProgramacionSegura } from "@/lib/tms/disponibilidad-programacion-intervalos";

type Ctx = { params: Promise<{ slug: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}(?::\d{2})?$/;
const REGRESO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/;

/**
 * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — disponibilidad de TODOS los
 * pilotos/auxiliares/unidades de la empresa en la fecha_plan seleccionada
 * que se está armando en el formulario de Programación (crear o editar),
 * para los buscadores de piloto/auxiliar/unidad: nunca oculta un recurso
 * ocupado, solo lo marca. Misma empresa_id de la sesión, nunca la que
 * mande el cliente (requireTenantProgramacionOTms).
 *
 * A2.2 — misma política por INTERVALOS que POST/PATCH/importación/lote
 * (disponibilidad-programacion-intervalos.ts): `fecha` + `horaCarga` +
 * `regresoEstimado` forman la ventana consultada; con hora Y regreso se
 * consulta [inicio, fin), y si falta cualquiera de los dos se consulta todo
 * `fecha` (reserva conservadora; nunca se inventa una duración). Un recurso
 * está ocupado solo si su reserva se SOLAPA con esa ventana; un viaje que
 * termina justo cuando empieza la consulta no ocupa. `excluirPlanId` excluye
 * el plan que se está editando. El contrato de respuesta no cambia.
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

  let ventana;
  try {
    ventana = ventanaProgramacionSegura({ fechaPlan: fecha, horaCarga: horaCargaParam || null, regresoEstimado: regresoEstimadoParam || null });
  } catch {
    return NextResponse.json({ error: "fecha inválida (YYYY-MM-DD)." }, { status: 400 });
  }
  const { personal, unidades, tcs } = await listarOcupacionProgramacionIntervalo(guard.empresa.id, ventana, excluirPlanId == null ? [] : [excluirPlanId]);

  return NextResponse.json(
    {
      personal: Object.fromEntries(personal),
      unidades: Object.fromEntries(unidades),
      // PROGRAMACION-TC-CAJA-REMOLQUE-1: placa (mayúsculas) del TC -> plan que lo ocupa ese día.
      tcs: Object.fromEntries(tcs ?? new Map()),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
