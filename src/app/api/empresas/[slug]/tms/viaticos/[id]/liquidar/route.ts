import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticosLiquidar } from "@/lib/tenant";
import { liquidarViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  gastosComprobados: z.union([z.string(), z.number()]).transform(String).optional(),
  reintegro: z.union([z.string(), z.number()]).transform(String).optional(),
  observaciones: z.string().max(300).optional().nullable(),
  password: z.string().min(1, "Ingresa tu contraseña actual."),
});

/**
 * ENTREGADO -> LIQUIDADO. VIATICOS-FIRMA: permiso EXPLÍCITO
 * `viaticos_liquidar:editar` (requireTenantViaticosLiquidar) — YA NO el
 * genérico `viaticos:editar`. Liquidación estructurada (gastos
 * comprobados/reintegro/diferencia) + firma electrónica interna
 * (contraseña actual). La regla de "diferencia debe ser 0 exacto" y toda
 * la aritmética monetaria viven en liquidarViatico() (src/lib/tms/
 * viaticos.ts) — este endpoint solo valida forma y delega.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticosLiquidar(slug, "editar");
  if (guard.error) return guard.error;

  const viaticoId = Number(id);
  if (!Number.isFinite(viaticoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const r = await liquidarViatico(
    guard.empresa.id,
    viaticoId,
    {
      gastosComprobados: d.gastosComprobados ?? "0",
      reintegro: d.reintegro ?? "0",
      observaciones: d.observaciones ?? null,
    },
    guard.session.username,
    {
      usuarioId: guard.session.id,
      nombreFirmante: guard.session.nombre || guard.session.username,
      rolFirmante: guard.session.rol,
      password: d.password,
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    },
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({
    mensaje: "Viático liquidado.",
    firma: {
      codigoFirma: r.firma.codigoFirma,
      nombreFirmante: r.firma.nombreFirmante,
      rolFirmante: r.firma.rolFirmante,
      fechaHoraServidor: r.firma.fechaHoraServidor.toISOString(),
    },
  });
}
