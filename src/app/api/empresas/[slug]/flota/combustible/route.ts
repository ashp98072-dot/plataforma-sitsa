import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { asegurarSchemaFlotaLectura } from "@/lib/flota/schema";
import {
  listarCargasCombustibleRevision,
  type EstadoCargaCombustible,
} from "@/lib/flota/combustible";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 2) — bandeja de revisión de Operaciones:
 * listado de cargas de combustible registradas por los pilotos, con
 * filtros de estado/fecha/vehículo. Guardado por requireTenantFlota
 * Combustible("ver") — permiso propio, ver src/lib/tenant.ts.
 */

const ESTADOS: EstadoCargaCombustible[] = ["PENDIENTE", "APROBADO", "RECHAZADO"];

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;
  await asegurarSchemaFlotaLectura().catch(() => undefined);

  const url = new URL(req.url);
  const estadoRaw = url.searchParams.get("estado");
  const estado = estadoRaw && (ESTADOS as string[]).includes(estadoRaw) ? (estadoRaw as EstadoCargaCombustible) : undefined;
  const desde = url.searchParams.get("desde") || undefined;
  const hasta = url.searchParams.get("hasta") || undefined;
  const vehiculoIdRaw = url.searchParams.get("vehiculoId");
  const vehiculoId = vehiculoIdRaw && Number.isInteger(Number(vehiculoIdRaw)) ? Number(vehiculoIdRaw) : undefined;

  const { items, resumen } = await listarCargasCombustibleRevision(guard.empresa.id, {
    estado,
    desde,
    hasta,
    vehiculoId,
  });
  return NextResponse.json({
    items: items.map((c) => ({
      ...c,
      url: `/api/empresas/${slug}/flota/combustible/${c.id}/vale`,
    })),
    resumen,
  });
}
