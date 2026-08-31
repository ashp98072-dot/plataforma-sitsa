import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { requireTenantViaticosAny } from "@/lib/tenant";
import { query } from "@/lib/db";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * VIATICOS-HISTORIAL-FIRMA-1 — historial de firmas (autorización +
 * liquidación) de UN viático, para el botón "Ver firmas" de
 * ViaticosControlPanel/ViaticosPorPagarPanel.
 *
 * Permiso: requireTenantViaticosAny(slug, "ver") — CUALQUIERA de
 * viaticos/viaticos_autorizar/viaticos_pagar/viaticos_liquidar con
 * `ver`, mismo guard que ya usa el endpoint hermano de imagen
 * (.../tms/viaticos/firmas/[firmaId]/imagen) — el Facturador (solo
 * `viaticos_pagar`) debe poder confirmar quién autorizó antes de pagar
 * (sección 12 del ticket), sin que esto le dé ningún permiso de
 * autorizar/liquidar.
 *
 * `empresaId` SIEMPRE viene de la sesión (guard.empresa.id) — nunca del
 * cliente. Verifica explícitamente que el viático pertenece a esta
 * empresa (mismo patrón que autorizar/liquidar route.ts) para responder
 * 404 en vez de una lista vacía silenciosa cuando el id no existe o es
 * de otra empresa.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantViaticosAny(slug, "ver");
    if (guard.error) return guard.error;

    const viaticoId = Number(id);
    if (!Number.isFinite(viaticoId)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const existe = await query<RowDataPacket[]>(
      `SELECT id FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [viaticoId, guard.empresa.id],
    );
    if (!existe[0]) {
      return NextResponse.json({ error: "Viático no encontrado." }, { status: 404 });
    }

    const firmas = await listarFirmasViatico(guard.empresa.id, viaticoId);
    return NextResponse.json(
      { firmas },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("GET firmas viático", error);
    return NextResponse.json({ error: "No se pudieron obtener las firmas." }, { status: 500 });
  }
}
