import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireTenantCatalogoOperativoCliente,
  requireTenantModulo,
} from "@/lib/tenant";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  crearUsuarioCliente,
  listarUsuariosDeCliente,
} from "@/lib/tms/cliente-usuarios";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * CLIENTE-PORTAL-1 (alcance D) — alta del acceso al Portal del Cliente,
 * SOLO desde staff interno. Mismo patrón que
 * /tms/clientes/[clienteId]/contactos (VIAT-4): GET con
 * requireTenantCatalogoOperativoCliente (lectura de catálogo operativo),
 * POST con requireTenantModulo(slug, "tms", true) (escritura). Un cliente
 * nunca puede llamar esta ruta — no hay ningún camino de sesión de
 * cliente que la alcance, y este endpoint tampoco valida sesión de
 * cliente (solo staff).
 */

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantCatalogoOperativoCliente(slug);
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  try {
    const usuarios = await listarUsuariosDeCliente(guard.empresa.id, cid);
    return NextResponse.json(
      { usuarios },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET tms/clientes/[clienteId]/usuarios", e);
    return NextResponse.json({
      usuarios: [],
      aviso:
        "No se pudo leer el catálogo de usuarios. Verifica que la migración CLIENTE-PORTAL-1 esté aplicada.",
    });
  }
}

const schema = z.object({
  nombre: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(160),
  passwordInicial: z.string().min(6, "La contraseña temporal debe tener al menos 6 caracteres."),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  const r = await crearUsuarioCliente({
    empresaId: guard.empresa.id,
    clienteId: cid,
    nombre: parsed.data.nombre,
    email: parsed.data.email,
    passwordInicial: parsed.data.passwordInicial,
    creadoPor: guard.session.username,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }

  // No se audita ni se registra la contraseña temporal en ningún momento
  // (alcance H del ticket) — solo qué se creó y quién lo creó.
  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "crear_usuario_cliente",
    modulo: "tms",
    detalle: `Usuario de portal creado para cliente #${cid}: ${r.usuario.nombre} <${r.usuario.email}> (id #${r.usuario.id}), debe cambiar contraseña en el primer acceso.`,
  });

  return NextResponse.json({ usuario: r.usuario, mensaje: "Acceso al portal creado." });
}
