import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  obtenerEstadisticasDashboard,
  obtenerResumenGerencial,
  obtenerSituacionEmpleadosHoy,
  obtenerDetalleMovimientosMensual,
} from "@/lib/rrhh/dashboard";

type Ctx = { params: Promise<{ slug: string }> };

/** Log interno de una sección que falló: identifica la consulta/driver sin exponer nada al cliente. */
function registrarFalloSeccion(seccion: string, error: unknown) {
  const e = (error ?? {}) as { code?: unknown; errno?: unknown; sqlState?: unknown; message?: unknown };
  console.error("[dashboard-rrhh] Sección no disponible", {
    seccion,
    code: e.code ?? null,
    errno: e.errno ?? null,
    sqlState: e.sqlState ?? null,
    message: typeof e.message === "string" ? e.message : String(error),
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const mes = new URL(req.url).searchParams.get("detalleMes");
  if (mes !== null) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || Number(mes.slice(0, 4)) < 1000) return NextResponse.json({ error: "Mes inválido." }, { status: 400 });
    try {
      return NextResponse.json(await obtenerDetalleMovimientosMensual(guard.empresa.id, mes), { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      console.error("[dashboard-rrhh] Detalle mensual no disponible", error);
      return NextResponse.json({ error: "No se pudo cargar el detalle mensual." }, { status: 500 });
    }
  }
  const resultados = await Promise.allSettled([
    obtenerEstadisticasDashboard(guard.empresa.id),
    obtenerResumenGerencial(guard.empresa.id),
    obtenerSituacionEmpleadosHoy(guard.empresa.id),
  ]);
  const [stats, resumen, situacion] = resultados;
  const nombres = ["Estadísticas de hoy", "Resumen mensual", "Situación del personal"];
  // Diagnóstico SOLO en el log del servidor (sección + code/errno/sqlState/message); al cliente solo llega el aviso genérico.
  resultados.forEach((r, i) => { if (r.status === "rejected") registrarFalloSeccion(nombres[i], r.reason); });
  const avisos = resultados.flatMap((r, i) => r.status === "rejected" ? [`${nombres[i]}: no disponible. Intenta nuevamente o solicita revisar el servidor.`] : []);
  return NextResponse.json({
    stats: stats.status === "fulfilled" ? stats.value : null,
    resumenGerencial: resumen.status === "fulfilled" ? resumen.value : [],
    situacionHoy: situacion.status === "fulfilled" ? situacion.value : null,
    avisos,
    empresa: guard.empresa.nombre,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
