import { NextResponse } from "next/server";
import { requireTenantViaticosLiquidar } from "@/lib/tenant";
import { liquidarViatico } from "@/lib/tms/viaticos";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * ENTREGADO -> LIQUIDADO. VIATICOS-FIRMA: permiso EXPLÍCITO
 * `viaticos_liquidar:editar` (requireTenantViaticosLiquidar) — YA NO el
 * genérico `viaticos:editar`. Liquidación estructurada (gastos
 * comprobados/reintegro/diferencia) + firma electrónica interna
 * (contraseña actual — CORRECCIÓN URGENTE: esto NO cambió; solo
 * autorizar dejó de exigir contraseña, liquidar sigue igual). La regla
 * de "diferencia debe ser 0 exacto" y toda la aritmética monetaria viven
 * en liquidarViatico() (src/lib/tms/viaticos.ts) — este endpoint solo
 * valida forma y delega.
 *
 * VIATICOS-FIRMA-VISUAL — multipart/form-data: `gastosComprobados` +
 * `reintegro` + `observaciones` (opcional) + `password` + `firmaImagen`
 * (PNG del canvas, OBLIGATORIO). Mismo criterio de validación/orden que
 * el endpoint de autorizar (ver su JSDoc): formato/tamaño de imagen se
 * valida aquí, password + guardado a disco viven dentro de
 * liquidarViatico().
 *
 * CORRECCIÓN URGENTE — try/catch explícito (mismo motivo que
 * autorizar/route.ts): una excepción no controlada aquí escapaba sin
 * capturarse, produciendo un 500 sin cuerpo JSON que el frontend no podía
 * parsear. Ver JSDoc de autorizar/route.ts para el detalle completo.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantViaticosLiquidar(slug, "editar");
    if (guard.error) return guard.error;

    const viaticoId = Number(id);
    if (!Number.isFinite(viaticoId)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    const password = String(form.get("password") ?? "");
    if (!password) {
      return NextResponse.json({ error: "Ingresa tu contraseña actual." }, { status: 400 });
    }
    const gastosComprobados = form.has("gastosComprobados") ? String(form.get("gastosComprobados")) : "0";
    const reintegro = form.has("reintegro") ? String(form.get("reintegro")) : "0";
    const observacionesRaw = form.get("observaciones");
    const observaciones = observacionesRaw != null ? String(observacionesRaw).trim().slice(0, 300) || null : null;

    const file = form.get("firmaImagen");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "Dibuja tu firma antes de continuar." }, { status: 400 });
    }
    if (file.size > MAX_FIRMA_IMAGEN_BYTES) {
      return NextResponse.json({ error: "La imagen de la firma supera el tamaño permitido." }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    if (!esPngValido(new Uint8Array(bytes))) {
      return NextResponse.json({ error: "La imagen de la firma debe ser un PNG válido." }, { status: 400 });
    }
    const imagen = { bytes, original: file.name || "firma.png" };

    const r = await liquidarViatico(
      guard.empresa.id,
      viaticoId,
      { gastosComprobados, reintegro, observaciones },
      guard.session.username,
      {
        usuarioId: guard.session.id,
        nombreFirmante: guard.session.nombre || guard.session.username,
        rolFirmante: guard.session.rol,
        password,
        imagen,
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
        firmaId: r.firma.id,
        codigoFirma: r.firma.codigoFirma,
        nombreFirmante: r.firma.nombreFirmante,
        rolFirmante: r.firma.rolFirmante,
        fechaHoraServidor: r.firma.fechaHoraServidor.toISOString(),
        tieneImagen: r.firma.tieneImagen,
      },
    });
  } catch (error) {
    console.error("POST liquidar viático", error);
    return NextResponse.json({ error: "No se pudo liquidar el viático." }, { status: 500 });
  }
}
