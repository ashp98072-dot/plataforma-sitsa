import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resolverTmsClienteId } from "@/lib/clientes/repository";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  crearUsuarioCliente,
  listarUsuariosDeCliente,
} from "@/lib/tms/cliente-usuarios";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * CLIENTE-PORTAL-1C — administración del acceso al Portal del Cliente
 * DESDE la pantalla de Clientes (/e/[slug]/clientes), no desde TMS. La
 * ruta recibe `id` = clientes.id (el mismo id ya visible en esa
 * pantalla, el catálogo compartido) — NUNCA tms_clientes.id. El servidor
 * resuelve la relación real (resolverTmsClienteId) antes de delegar en
 * las mismas funciones de src/lib/tms/cliente-usuarios.ts que ya usa el
 * endpoint TMS-scoped (/api/empresas/[slug]/tms/clientes/[clienteId]/usuarios,
 * PR #167) — no se duplica lógica de hashing ni de listado, solo se
 * adapta el permiso/URL de entrada a como el staff realmente navega
 * (Clientes, no TMS).
 *
 * Guard: requireClientesOFacturacion(slug, "clientes", ...) — el mismo
 * permiso que ya gobierna toda la pantalla de Clientes, NO un permiso de
 * TMS aparte (un usuario de Facturación que administra el catálogo de
 * clientes no necesariamente tiene tms:editar).
 */

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes");
  if (guard.error) return guard.error;

  const clienteId = parseId(id);
  if (!clienteId) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const resolucion = await resolverTmsClienteId(guard.empresa.id, clienteId);
  if (!resolucion.ok) {
    return NextResponse.json(
      { error: resolucion.mensaje, sincronizado: false },
      { status: 409 },
    );
  }

  const usuarios = await listarUsuariosDeCliente(guard.empresa.id, resolucion.tmsClienteId);
  return NextResponse.json(
    { usuarios, cliente: { id: resolucion.cliente.id, nombre: resolucion.cliente.nombre } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  nombre: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(160),
  passwordInicial: z.string().min(6, "La contraseña temporal debe tener al menos 6 caracteres."),
  confirmarPassword: z.string().min(1),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes", true);
  if (guard.error) return guard.error;

  const clienteId = parseId(id);
  if (!clienteId) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }
  if (parsed.data.passwordInicial !== parsed.data.confirmarPassword) {
    return NextResponse.json(
      { error: "La confirmación de contraseña no coincide." },
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

  const r = await crearUsuarioCliente({
    empresaId: guard.empresa.id,
    clienteId: resolucion.tmsClienteId,
    nombre: parsed.data.nombre,
    email: parsed.data.email,
    passwordInicial: parsed.data.passwordInicial,
    creadoPor: guard.session.username,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }

  // Nunca se audita ni se registra la contraseña temporal — solo qué se
  // creó y quién lo creó (mismo criterio que el endpoint TMS-scoped).
  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "crear_usuario_cliente",
    modulo: "clientes",
    detalle: `Usuario de portal creado para cliente "${resolucion.cliente.nombre}" (clientes.id #${clienteId}, tms_clientes.id #${resolucion.tmsClienteId}): ${r.usuario.nombre} <${r.usuario.email}> (id #${r.usuario.id}), debe cambiar contraseña en el primer acceso.`,
  });

  return NextResponse.json({ usuario: r.usuario, mensaje: "Acceso al portal creado." });
}
