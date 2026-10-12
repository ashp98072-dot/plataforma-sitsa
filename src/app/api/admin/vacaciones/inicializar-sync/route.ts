import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-guard";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { sincronizarVacacionesEmpleadosActivos } from "@/lib/rrhh/vacaciones";

export const runtime = "nodejs";

const schema = z.object({
  empresaId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  confirmacion: z.string(),
}).strict();
const headers = { "Cache-Control": "private, no-store" };

/** Operación manual exclusiva de Admin. No hay GET, scheduler ni invocación al importar/build. */
export async function POST(req: Request) {
  const guard = await requireSession();
  if (guard.error) return guard.error;
  if (guard.user.rol !== "Admin") {
    return NextResponse.json({ error: "Solo Admin puede inicializar la sincronización de vacaciones." }, { status: 403, headers });
  }
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Envía application/json." }, { status: 415, headers });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica empresaId y confirmación válidos." }, { status: 400, headers });
  const { empresaId, confirmacion } = parsed.data;
  if (confirmacion !== `INICIALIZAR VACACIONES EMPRESA ${empresaId}`) {
    return NextResponse.json({ error: "Confirmación incorrecta para la empresa indicada." }, { status: 400, headers });
  }
  try {
    const empresa = await obtenerEmpresaPorId(empresaId);
    if (!empresa?.activa) return NextResponse.json({ error: "Empresa no encontrada o inactiva." }, { status: 404, headers });
    const result = await sincronizarVacacionesEmpleadosActivos(empresa.id);
    return NextResponse.json({
      empresaId: empresa.id,
      candidatos: result.empleados,
      sincronizados: result.sincronizados,
      errores: result.errores,
      omitidos: result.empleados - result.sincronizados - result.errores,
    }, { headers });
  } catch (error) {
    console.error("[vacaciones-inicializar-sync] No se completó el batch:", error);
    return NextResponse.json({ error: "No se completó la inicialización. Revisa el log y verifica pendientes antes de reintentar." }, { status: 500, headers });
  }
}
