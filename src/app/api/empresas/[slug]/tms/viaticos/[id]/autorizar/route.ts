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
 * documentada en src/lib/tenant.ts. La ausencia de contraseña (ver abajo)
 * NUNCA significa ausencia de permisos — este guard sigue siendo la
 * primera verificación, antes de tocar cualquier dato del body.
 *
 * CORRECCIÓN URGENTE — AUTORIZAR ya NO reautentica con contraseña. Prueba
 * de identidad suficiente para esta firma interna simbólica: sesión
 * autenticada (`guard.session`) + permiso EXPLÍCITO ya verificado arriba +
 * firma manuscrita dibujada (imagen PNG obligatoria). "nombre"/"rol" del
 * firmante se toman de la SESIÓN del servidor, nunca del cliente.
 * liquidarViatico (endpoint hermano) SIGUE exigiendo contraseña sin
 * cambios — ver su propio route.ts.
 *
 * VIATICOS-FIRMA-VISUAL — multipart/form-data: `firmaImagen` (PNG del
 * canvas de firma manuscrita, OBLIGATORIO — ver ViaticosControlPanel:
 * tanto el modal individual como la bandeja masiva "Autorizar
 * seleccionados" exigen un trazo antes de poder confirmar) + `firmaLote`
 * opcional. El formato/tamaño se valida AQUÍ (magic bytes reales, nunca
 * el nombre/extensión/Content-Type declarado por el cliente) ANTES de
 * llamar a la lib; el guardado a disco de la imagen sigue viviendo DENTRO
 * de autorizarViatico(), ANTES de abrir la transacción.
 *
 * VIATICOS-FIRMA-VISUAL (hotfix PR #124) — `firmaLote` ("true"/ausente):
 * lo envía la bandeja masiva "Autorizar seleccionados" (un único trazo
 * reutilizado para todo el lote) para que quede explícito dentro del
 * payload firmado de CADA autorización — nunca se pretende que el usuario
 * dibujó una firma distinta por cada viático del lote.
 *
 * CORRECCIÓN URGENTE — try/catch explícito: antes, cualquier excepción no
 * controlada dentro de autorizarViatico() (p. ej. un fallo real de DB o
 * de escritura a disco) escapaba de este handler sin capturarse. Next.js
 * responde entonces con un 500 genérico SIN cuerpo JSON — el frontend
 * (`await res.json()`) fallaba al parsear esa respuesta y terminaba
 * mostrando el mensaje genérico "Error de conexión.", ocultando el error
 * real. Ahora se captura y se devuelve un JSON `{error}` explícito,
 * mismo patrón que el resto de endpoints del proyecto (ver p. ej.
 * errorMultas en src/lib/multas/http.ts).
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
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
  } catch (error) {
    console.error("POST autorizar viático", error);
    return NextResponse.json({ error: "No se pudo autorizar el viático." }, { status: 500 });
  }
}
