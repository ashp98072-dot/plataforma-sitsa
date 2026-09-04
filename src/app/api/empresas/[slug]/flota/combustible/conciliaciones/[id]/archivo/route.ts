import { existsSync, readFileSync } from "fs";
import { NextResponse } from "next/server";

import {
  obtenerArchivoConciliacionCombustible,
} from "@/lib/flota/combustible-conciliacion-consultas";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = {
  params: Promise<{
    slug: string;
    id: string;
  }>;
};

/**
 * FLOTA-COMBUSTIBLE-4 — descarga protegida del Excel original de una
 * conciliación.
 *
 * Mismo patrón ya usado en
 * src/app/api/empresas/[slug]/flota/combustible/[id]/vale/route.ts:
 * la ruta física NUNCA se acepta del cliente (query param, body, etc.) —
 * sale exclusivamente de obtenerArchivoConciliacionCombustible(), que
 * busca por conciliacion_id + empresa_id, y absPathFromRelative()
 * (src/lib/uploads.ts) resuelve esa ruta relativa SIEMPRE dentro de la
 * raíz de uploads permitida (rechaza cualquier intento de path
 * traversal). ruta_relativa nunca se expone en la respuesta.
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

  const archivo = await obtenerArchivoConciliacionCombustible(
    guard.empresa.id,
    conciliacionId,
  );

  if (!archivo) {
    return NextResponse.json(
      {
        error: "Conciliación no encontrada.",
      },
      {
        status: 404,
      },
    );
  }

  try {
    const abs = absPathFromRelative(archivo.rutaRelativa);

    if (!existsSync(abs)) {
      return NextResponse.json(
        {
          error: "El archivo ya no está disponible.",
        },
        {
          status: 404,
        },
      );
    }

    const nombreSeguro = (archivo.nombreOriginal || "conciliacion.xlsx")
      // Content-Disposition no admite comillas dobles ni saltos de línea
      // dentro del valor entre comillas.
      .replace(/["\r\n]/g, "");

    return new NextResponse(readFileSync(abs), {
      headers: {
        "Content-Type":
          archivo.mime || contentTypeFor(archivo.nombreOriginal),
        "Content-Disposition":
          `attachment; filename="${encodeURIComponent(nombreSeguro)}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error(
      "[combustible-conciliacion] descarga archivo",
      error,
    );

    return NextResponse.json(
      {
        error: "No se pudo leer el archivo.",
      },
      {
        status: 404,
      },
    );
  }
}
