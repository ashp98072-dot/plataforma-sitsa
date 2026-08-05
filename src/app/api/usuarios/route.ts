import { NextResponse } from "next/server";
import { z } from "zod";
import {
  actualizarUsuario,
  crearUsuario,
  listarUsuarios,
} from "@/lib/auth";
import { requireSession } from "@/lib/api-guard";
import { ROLES } from "@/lib/roles";
import { RRHH_SUBMODULOS } from "@/lib/permisos";

function requireAdmin() {
  return requireSession().then((guard) => {
    if (guard.error) return guard;
    if (guard.user.rol !== "Admin") {
      return {
        error: NextResponse.json(
          { error: "Solo el administrador puede gestionar usuarios." },
          { status: 403 },
        ),
      };
    }
    return guard;
  });
}

const permisoSchema = z.object({
  modulo: z.string(),
  puedeVer: z.boolean(),
  puedeCrear: z.boolean(),
  puedeEditar: z.boolean(),
  puedeEliminar: z.boolean(),
});

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const usuarios = await listarUsuarios();
  return NextResponse.json({
    usuarios,
    submodulos: RRHH_SUBMODULOS,
  });
}

const createSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(4),
  nombre: z.string().optional(),
  email: z.string().optional(),
  rol: z.enum(ROLES),
  accesoTodas: z.boolean().default(false),
  empresaIds: z.array(z.number()).default([]),
  permisos: z.array(permisoSchema).optional(),
});

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  try {
    const id = await crearUsuario(parsed.data);
    return NextResponse.json({ id, mensaje: "Usuario creado." });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo crear (¿usuario duplicado?)." },
      { status: 500 },
    );
  }
}

const updateSchema = z.object({
  id: z.number(),
  nombre: z.string().optional(),
  email: z.string().optional(),
  rol: z.enum(ROLES),
  accesoTodas: z.boolean(),
  activo: z.boolean(),
  empresaIds: z.array(z.number()),
  password: z.string().optional(),
  permisos: z.array(permisoSchema).optional(),
});

export async function PUT(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { id, ...rest } = parsed.data;
  await actualizarUsuario(id, rest);
  return NextResponse.json({ mensaje: "Usuario actualizado." });
}
