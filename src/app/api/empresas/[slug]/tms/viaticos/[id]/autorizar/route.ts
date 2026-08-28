import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { autorizarViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  password: z.string().min(1, "Ingresa tu contraseña actual."),
});

/**
 * VIAT-2 — PROGRAMADO -> AUTORIZADO. "OPERACIONES AUTORIZA, FACTURADOR
 * PAGA": permiso EXPLÍCITO `viaticos_autorizar:editar`
 * (requireTenantViaticosAutorizar), separado del permiso de pagar/entregar
 * (`viaticos_pagar`) y NUNCA por ser supervisor del empleado ni por tener
 * acceso general de edición a TMS — ver decisión "SUPERVISOR != APROBADOR"
 * documentada en src/lib/tenant.ts.
 *
 * VIATICOS-FIRMA: requiere firma electrónica interna (contraseña actual
 * del usuario, verificada server-side — NUNCA se guarda ni se envía un
 * hash al cliente). "nombre"/"rol" del firmante se toman de la SESIÓN del
 * servidor, nunca del cliente.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticosAutorizar(slug, "editar");
  if (guard.error) return guard.error;

  const viaticoId = Number(id);
  if (!Number.isFinite(viaticoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const r = await autorizarViatico(guard.empresa.id, viaticoId, guard.session.username, {
    usuarioId: guard.session.id,
    nombreFirmante: guard.session.nombre || guard.session.username,
    rolFirmante: guard.session.rol,
    password: parsed.data.password,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({
    mensaje: "Viático autorizado.",
    firma: {
      codigoFirma: r.firma.codigoFirma,
      nombreFirmante: r.firma.nombreFirmante,
      rolFirmante: r.firma.rolFirmante,
      fechaHoraServidor: r.firma.fechaHoraServidor.toISOString(),
    },
  });
}
