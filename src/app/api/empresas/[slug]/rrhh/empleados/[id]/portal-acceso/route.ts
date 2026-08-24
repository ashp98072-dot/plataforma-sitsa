import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import {
  activarCredencialColaborador,
  cambiarUsernameColaborador,
  crearCredencialColaborador,
  obtenerCredencialPorEmpleado,
  resetearPasswordColaborador,
} from "@/lib/rrhh/colaborador-auth";

type Ctx = { params: Promise<{ slug: string; id: string }> };

function parseEmpleadoId(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Acceso al portal de un empleado (o null si nunca se le creó). */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;

  const empleadoId = parseEmpleadoId(id);
  if (!empleadoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const credencial = await obtenerCredencialPorEmpleado(empleadoId);
  return NextResponse.json({ credencial });
}

const crearSchema = z.object({
  username: z.string().trim().min(3, "El usuario debe tener al menos 3 caracteres."),
  passwordInicial: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
});

/** Crea el acceso al portal por primera vez para este empleado. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) return guard.error;

  const empleadoId = parseEmpleadoId(id);
  if (!empleadoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  const r = await crearCredencialColaborador({
    empresaId: guard.empresa.id,
    empleadoId,
    username: parsed.data.username,
    passwordInicial: parsed.data.passwordInicial,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}

const patchSchema = z.union([
  z.object({
    accion: z.literal("resetear"),
    passwordNueva: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  }),
  z.object({
    accion: z.literal("activar"),
    activo: z.boolean(),
  }),
  z.object({
    accion: z.literal("cambiar-username"),
    username: z.string().trim().min(3, "El usuario debe tener al menos 3 caracteres."),
  }),
]);

/** Cambia usuario/contraseña, o activa/desactiva el acceso existente. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) return guard.error;

  const empleadoId = parseEmpleadoId(id);
  if (!empleadoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  // activarCredencialColaborador no valida empresa internamente (a diferencia
  // de crear/resetear), así que confirmamos aquí que el empleado es de esta
  // empresa antes de tocar su credencial — evita cruces entre tenants.
  const empleado = await obtenerEmpleado(guard.empresa.id, empleadoId);
  if (!empleado) {
    return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
  }

  if (parsed.data.accion === "resetear") {
    const r = await resetearPasswordColaborador(
      guard.empresa.id,
      empleadoId,
      parsed.data.passwordNueva,
    );
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 400 });
    return NextResponse.json({ mensaje: r.mensaje });
  }

  if (parsed.data.accion === "cambiar-username") {
    const r = await cambiarUsernameColaborador(
      guard.empresa.id,
      empleadoId,
      parsed.data.username,
    );
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 400 });
    return NextResponse.json({ mensaje: r.mensaje });
  }

  const r = await activarCredencialColaborador(empleadoId, parsed.data.activo);
  if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 400 });
  return NextResponse.json({ mensaje: r.mensaje });
}
