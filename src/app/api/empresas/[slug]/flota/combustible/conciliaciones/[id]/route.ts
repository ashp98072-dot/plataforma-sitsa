import { NextResponse } from "next/server";

import {
  obtenerConciliacionCombustible,
} from "@/lib/flota/combustible-conciliacion-consultas";
import { requireTenantFlotaCombustible } from "@/lib/tenant";

type Ctx = {
  params: Promise<{
    slug: string;
    id: string;
  }>;
};

/**
 * FLOTA-COMBUSTIBLE-4
 *
 * Detalle vale por vale de una conciliación ya persistida. Solo lectura
 * ("ver") — NUNCA vuelve a ejecutar conciliarPorVale(): el snapshot en
 * flota_combustible_conciliacion_filas es la verdad histórica.
 *
 * Siempre se busca por conciliacion_id + empresa_id — si el id existe
 * pero pertenece a otra empresa, devuelve 404 (no 403, para no revelar
 * que el id existe en otro tenant).
 */
export async function GET(
  _req: Request,
  ctx: Ctx,
) {
  const { slug, id } = await ctx.params;

  const guard =
    await requireTenantFlotaCombustible(
      slug,
      "ver",
    );

  if (guard.error) {
    return guard.error;
  }

  const conciliacionId = Number(id);

  if (!Number.isInteger(conciliacionId) || conciliacionId <= 0) {
    return NextResponse.json(
      {
        error: "ID inválido.",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const detalle = await obtenerConciliacionCombustible(
      guard.empresa.id,
      conciliacionId,
    );

    if (!detalle) {
      return NextResponse.json(
        {
          error: "Conciliación no encontrada.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({ item: detalle });
  } catch (error) {
    console.error(
      "[combustible-conciliacion] detalle",
      error,
    );

    return NextResponse.json(
      {
        error:
          "No se pudo obtener el detalle de la conciliación.",
      },
      {
        status: 500,
      },
    );
  }
}
