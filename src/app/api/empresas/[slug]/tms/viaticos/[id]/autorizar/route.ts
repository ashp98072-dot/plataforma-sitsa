import { NextResponse } from "next/server";
import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { autorizarViatico } from "@/lib/tms/viaticos";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";

type Ctx = { params: Promise<{ slug: string; id: string }> };

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
 *
 * VIATICOS-FIRMA-VISUAL — multipart/form-data: `password` + `firmaImagen`
 * (PNG del canvas de firma manuscrita, OBLIGATORIO — ver ViaticosControlPanel:
 * tanto el modal individual como la bandeja masiva "Autorizar seleccionados"
 * exigen un trazo antes de poder confirmar). El formato/tamaño se valida
 * AQUÍ (magic bytes reales, nunca el nombre/extensión/Content-Type
 * declarado por el cliente) ANTES de llamar a la lib; la contraseña y el
 * guardado a disco de la imagen siguen viviendo DENTRO de
 * autorizarViatico(), en ese orden (password -> guardar archivo ->
 * transacción) — un password incorrecto nunca debe escribir la imagen a
 * disco.
 *
 * VIATICOS-FIRMA-VISUAL (hotfix PR #124) — `firmaLote` ("true"/ausente):
 * lo envía la bandeja masiva "Autorizar seleccionados" (un único trazo
 * reutilizado para todo el lote) para que quede explícito dentro del
 * payload firmado de CADA autorización — nunca se pretende que el usuario
 * dibujó una firma distinta por cada viático del lote.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticosAutorizar(slug, "editar");
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

  const firmaLote = form.get("firmaLote") === "true";

  const r = await autorizarViatico(guard.empresa.id, viaticoId, guard.session.username, {
    usuarioId: guard.session.id,
    nombreFirmante: guard.session.nombre || guard.session.username,
    rolFirmante: guard.session.rol,
    password,
    imagen,
    firmaLote,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({
    mensaje: "Viático autorizado.",
    firma: {
      firmaId: r.firma.id,
      codigoFirma: r.firma.codigoFirma,
      nombreFirmante: r.firma.nombreFirmante,
      rolFirmante: r.firma.rolFirmante,
      fechaHoraServidor: r.firma.fechaHoraServidor.toISOString(),
      tieneImagen: r.firma.tieneImagen,
    },
  });
}
