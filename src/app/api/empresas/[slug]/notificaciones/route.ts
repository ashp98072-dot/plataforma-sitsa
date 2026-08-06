import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { kmPendienteServicio } from "@/lib/flota/import-excel";
import { listarVehiculosParaAlertasKm } from "@/lib/flota/acceso";

type Ctx = { params: Promise<{ slug: string }> };

type AlertaCache = {
  at: number;
  alertas: number;
  muestras: string[];
};
const alertasKmCache = new Map<number, AlertaCache>();
const ALERTAS_TTL_MS = 90_000;

export type NotificacionItem = {
  id: string;
  tipo: "aprobacion" | "alerta" | "mensaje";
  titulo: string;
  detalle: string;
  enlace: string;
  creadoAt: string | null;
  refTipo?: string;
  refId?: number;
  acciones?: ("aprobar" | "rechazar")[];
};

/**
 * Feed unificado: permisos de piloto externo pendientes + alertas de servicio.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;

  const items: NotificacionItem[] = [];
  const rol = guard.session.rol;
  const puedeAprobar =
    rol === "Admin" ||
    rol === "Operaciones" ||
    rol === "CoordinadorPredios";

  // Permisos externos pendientes
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, piloto_nombre, motivo, solicitado_por, creado_at
       FROM flota_permisos_externos
       WHERE empresa_id = ? AND estado = 'pendiente'
       ORDER BY creado_at DESC
       LIMIT 30`,
      [guard.empresa.id],
    );
    for (const r of rows) {
      if (!puedeAprobar) continue;
      items.push({
        id: `permiso-${r.id}`,
        tipo: "aprobacion",
        titulo: `Piloto externo: ${r.piloto_nombre}`,
        detalle: `${r.motivo ?? ""}${
          r.solicitado_por ? ` · Solicitó: ${r.solicitado_por}` : ""
        }`,
        enlace: `/e/${slug}/flota?tab=piloto`,
        creadoAt: r.creado_at ? String(r.creado_at) : null,
        refTipo: "permiso_externo",
        refId: Number(r.id),
        acciones: ["aprobar", "rechazar"],
      });
    }
  } catch {
    /* tabla ausente */
  }

  // Alertas de servicio (km) — query liviana + TTL (sin sync KM / schema)
  if (puedeAprobar) {
    try {
      const empresaId = guard.empresa.id;
      const hit = alertasKmCache.get(empresaId);
      let alertas: number;
      let muestras: string[];
      if (hit && Date.now() - hit.at < ALERTAS_TTL_MS) {
        alertas = hit.alertas;
        muestras = hit.muestras;
      } else {
        const vehiculos = await listarVehiculosParaAlertasKm(empresaId);
        alertas = 0;
        muestras = [];
        for (const v of vehiculos) {
          if (Number(v.activo ?? 1) === 0) continue;
          const pend = kmPendienteServicio(
            Number(v.km_actual ?? 0),
            v.km_ultimo_servicio == null ? null : Number(v.km_ultimo_servicio),
            Number(v.km_intervalo_servicio ?? 10000),
          );
          if (pend != null && pend <= 1500) {
            alertas += 1;
            if (muestras.length < 3) {
              muestras.push(
                `${v.placa}${pend <= 0 ? " (vencido)" : ` (${pend} km)`}`,
              );
            }
          }
        }
        alertasKmCache.set(empresaId, {
          at: Date.now(),
          alertas,
          muestras,
        });
      }
      if (alertas > 0) {
        items.push({
          id: "alerta-servicio",
          tipo: "alerta",
          titulo: `${alertas} unidad(es) cerca de servicio`,
          detalle: muestras.join(", ") + (alertas > 3 ? "…" : ""),
          enlace: `/e/${slug}/flota?tab=dashboard`,
          creadoAt: null,
        });
      }
    } catch {
      /* ok */
    }
  }

  return NextResponse.json({
    notificaciones: items,
    pendientes: items.filter((i) => i.tipo === "aprobacion").length,
  });
}
