import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resolverTmsClienteId } from "@/lib/clientes/repository";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  activarUsuarioCliente,
  resetearPasswordUsuarioCliente,
} from "@/lib/tms/cliente-usuarios";

type Ctx = { params: Promise<{ slug: string; id: string; usuarioId: string }> };

/**
 * CLIENTE-PORTAL-1C (alcance 7) — activar/desactivar y (opcional)
 * resetear la contraseña temporal de un usuario del Portal del Cliente,
 * desde la pantalla de Clientes. Mismo patrón de mutación que
 * PATCH /api/empresas/[slug]/rrhh/empleados/[id]/portal-acceso
 * (colaborador): un solo endpoint, `accion` en el body decide la
 * mutación.
 *
 * Toda mutación valida los 3 niveles exigidos por el ticket (alcance 8):
 * empresa (guard), cliente TMS resuelto desde clientes.id (nunca
 * confiado del navegador) y que el usuario realmente pertenezca a ESE
 * cliente (activarUsuarioCliente/resetearPasswordUsuarioCliente ahora
 * filtran también por cliente_id, no solo por empresa_id — ver
 * src/lib/tms/cliente-usuarios.ts).
 */

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const schema = z.union([
  z.object({ accion: z.literal("activar"), activo: z.boolean() }),
  z.object({
    accion: z.literal("resetear"),
    passwordNueva: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  }),
]);

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id, usuarioId } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes", true);
  if (guard.error) return guard.error;

  const clienteId = parseId(id);
  const usuarioClienteId = parseId(usuarioId);
  if (!clienteId || !usuarioClienteId) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  const resolucion = await resolverTmsClienteId(guard.empresa.id, clienteId);
  if (!resolucion.ok) {
    return NextResponse.json(
      { error: resolucion.mensaje, sincronizado: false },
      { status: 409 },
    );
  }
  const tmsClienteId = resolucion.tmsClienteId;

  if (parsed.data.accion === "activar") {
    const r = await activarUsuarioCliente(
      guard.empresa.id,
      tmsClienteId,
      usuarioClienteId,
      parsed.data.activo,
    );
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 404 });
    await registrarAuditoria({
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: parsed.data.activo ? "activar_usuario_cliente" : "desactivar_usuario_cliente",
      modulo: "clientes",
      detalle: `Usuario de portal #${usuarioClienteId} (cliente "${resolucion.cliente.nombre}") ${parsed.data.activo ? "reactivado" : "desactivado"}.`,
    });
    return NextResponse.json({ mensaje: r.mensaje });
  }

  // accion === "resetear"
  const r = await resetearPasswordUsuarioCliente(
    guard.empresa.id,
    tmsClienteId,
    usuarioClienteId,
    parsed.data.passwordNueva,
  );
  if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 404 });
  // Nunca se audita ni se registra la contraseña nueva — solo el hecho
  // del reseteo (mismo criterio que la creación).
  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "resetear_password_usuario_cliente",
    modulo: "clientes",
    detalle: `Contraseña temporal reiniciada para el usuario de portal #${usuarioClienteId} (cliente "${resolucion.cliente.nombre}"); debe cambiarla en el próximo ingreso.`,
  });
  return NextResponse.json({ mensaje: r.mensaje });
}
