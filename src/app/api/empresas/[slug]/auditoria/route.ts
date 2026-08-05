import { NextResponse } from "next/server";
import { listarAuditoria } from "@/lib/auditoria";
import { requireTenant, requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Bitácora de acciones (TMS, flota, etc.).
 * TMS: Operaciones / Admin. Piloto no ve bitácora.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const modulo = (url.searchParams.get("modulo") ?? "").trim() || undefined;
  const limite = Number(url.searchParams.get("limite") ?? 120);

  let empresaId: number;
  if (modulo === "tms") {
    const guard = await requireTenantModulo(slug, "tms");
    if (guard.error) return guard.error;
    if (guard.session.rol === "Piloto") {
      return NextResponse.json(
        { error: "Sin permiso para ver la bitácora." },
        { status: 403 },
      );
    }
    empresaId = guard.empresa.id;
  } else {
    const guard = await requireTenant(slug);
    if (guard.error) return guard.error;
    if (guard.session.rol === "Piloto") {
      return NextResponse.json(
        { error: "Sin permiso para ver la bitácora." },
        { status: 403 },
      );
    }
    empresaId = guard.empresa.id;
  }

  const filas = await listarAuditoria({
    empresaId,
    modulo,
    limite: Number.isFinite(limite) ? limite : 120,
  });

  return NextResponse.json({ auditoria: filas });
}
