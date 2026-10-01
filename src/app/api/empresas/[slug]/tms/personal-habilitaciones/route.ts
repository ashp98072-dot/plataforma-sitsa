import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import { requireTenantModulo } from "@/lib/tenant";
import {
  ESTADOS_HABILITACION,
  ROLES_HABILITACION,
  HabilitacionError,
  fijarHabilitacion,
  listarHabilitacionesEmpresa,
} from "@/lib/tms/personal-habilitaciones";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — administración del catálogo de habilitaciones operativas
 * (tms_personal_habilitaciones). Mismo permiso ya existente `tms` (ver/editar) — NO se crea un permiso
 * nuevo en este PR, por decisión explícita del ticket. empresa_id SIEMPRE sale del guard, nunca del
 * cliente — ningún `empleadoId` se acepta sin antes confirmar que pertenece a ESA empresa (ver
 * fijarHabilitacion, que valida empleados.empresa_id antes de escribir).
 *
 * GET: vista por empleado (id, nombre, puesto, categoriaOps) + sus habilitaciones (activas e inactivas,
 * la pantalla de administración decide qué mostrar) — pensada para alimentar directamente la UI de
 * "Habilitaciones operativas" sin un segundo fetch a personal-ops.
 *
 * PUT: upsert de UNA habilitación (empleadoId + rol + estado). `estado: null` la desactiva (activo=0, sin
 * borrar historial — ver fijarHabilitacion). Cubre las 3 operaciones de escritura del ticket (crear/
 * activar, cambiar estado, desactivar) con un solo verbo, sobre la UNIQUE KEY real (empresa_id,
 * empleado_id, rol).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", false);
  if (guard.error) return guard.error;

  const empresaId = guard.empresa.id;
  const [empleados, habilitaciones] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, puesto, categoria_ops, estado FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`,
      [empresaId],
    ),
    listarHabilitacionesEmpresa(empresaId),
  ]);

  const porEmpleado = new Map<number, typeof habilitaciones>();
  for (const h of habilitaciones) {
    porEmpleado.set(h.empleadoId, [...(porEmpleado.get(h.empleadoId) ?? []), h]);
  }

  const resultado = empleados.map((e) => ({
    id: Number(e.id),
    codigo: e.codigo != null ? String(e.codigo) : null,
    nombre: String(e.nombre),
    puesto: e.puesto != null ? String(e.puesto) : null,
    categoriaOps: e.categoria_ops != null ? String(e.categoria_ops) : null,
    habilitaciones: (porEmpleado.get(Number(e.id)) ?? []).map((h) => ({ rol: h.rol, estado: h.estado, activo: h.activo })),
  }));

  return NextResponse.json({ empleados: resultado });
}

const PutSchema = z.object({
  empleadoId: z.number().int().positive(),
  rol: z.enum(ROLES_HABILITACION),
  estado: z.enum(ESTADOS_HABILITACION).nullable(),
});

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos: empleadoId, rol (PILOTO|AUXILIAR) y estado (HABILITADO|CAPACITACION|null) son requeridos." }, { status: 400 });
  }

  try {
    await fijarHabilitacion(guard.empresa.id, parsed.data.empleadoId, parsed.data.rol, parsed.data.estado);
  } catch (e) {
    if (e instanceof HabilitacionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
