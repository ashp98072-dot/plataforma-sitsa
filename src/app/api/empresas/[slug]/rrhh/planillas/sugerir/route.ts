import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerRangoPeriodo } from "@/lib/rrhh/periodos";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Fase P0: sugiere fecha_inicio/fecha_fin para un periodo QUINCENA_1 /
 * QUINCENA_2 / MENSUAL de un mes/año dados, reutilizando la misma lógica ya
 * usada por Incidencias/Reportes (obtenerRangoPeriodo + el ciclo_quincenal
 * configurable por empresa) — no se reimplementa el cálculo de quincenas.
 * ESPECIAL no tiene sugerencia (fechas siempre manuales).
 * Las fechas sugeridas son solo eso: el usuario las confirma o ajusta antes
 * de guardar; lo que se persiste sigue siendo fechaInicio/fechaFin reales.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  const mes = Number(url.searchParams.get("mes"));
  const anio = Number(url.searchParams.get("anio"));

  if (
    !tipo ||
    !["QUINCENA_1", "QUINCENA_2", "MENSUAL"].includes(tipo) ||
    !Number.isFinite(mes) ||
    mes < 1 ||
    mes > 12 ||
    !Number.isFinite(anio) ||
    anio < 2000 ||
    anio > 2100
  ) {
    return NextResponse.json(
      { error: "Parámetros inválidos (tipo, mes, anio)." },
      { status: 400 },
    );
  }

  const etiqueta =
    tipo === "QUINCENA_1"
      ? "Quincena 1"
      : tipo === "QUINCENA_2"
        ? "Quincena 2"
        : "Mes actual";
  const fechaRef = new Date(anio, mes - 1, 1);
  const rango = await obtenerRangoPeriodo(guard.empresa.id, etiqueta, fechaRef);

  if (!rango) {
    return NextResponse.json(
      { error: "No se pudo calcular el rango sugerido." },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { fechaInicio: rango.desde, fechaFin: rango.hasta },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
