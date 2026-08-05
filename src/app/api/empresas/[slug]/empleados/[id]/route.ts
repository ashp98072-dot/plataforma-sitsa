import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarEmpleado,
  codigoDuplicado,
  eliminarEmpleado,
  obtenerEmpleado,
} from "@/lib/rrhh/empleados";
import { normalizarHora } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const emp = await obtenerEmpleado(guard.empresa.id, Number(id));
  if (!emp) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  return NextResponse.json({ empleado: emp });
}

const bodySchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  puesto: z.string().optional(),
  categoriaOps: z.string().optional(),
  tipoHorario: z.enum(["Fijo", "Variable"]).default("Fijo"),
  fechaAlta: z.string().min(8),
  fechaInicioLaboral: z.string().nullable().optional(),
  horaEntradaTeorica: z.string().optional(),
  horaSalidaTeorica: z.string().optional(),
  estado: z.enum(["Activo", "Baja"]).default("Activo"),
});

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) return guard.error;
  const empId = Number(id);
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  if (await codigoDuplicado(guard.empresa.id, d.codigo, empId)) {
    return NextResponse.json(
      { error: "Código duplicado en esta empresa." },
      { status: 400 },
    );
  }
  const ok = await actualizarEmpleado(guard.empresa.id, empId, {
    codigo: d.codigo,
    nombre: d.nombre,
    puesto: d.puesto,
    categoriaOps: d.categoriaOps,
    tipoHorario: d.tipoHorario,
    fechaAlta: d.fechaAlta,
    fechaInicioLaboral: d.fechaInicioLaboral ?? null,
    horaEntradaTeorica:
      normalizarHora(d.horaEntradaTeorica ?? "08:00") ?? "08:00:00",
    horaSalidaTeorica:
      normalizarHora(d.horaSalidaTeorica ?? "17:00") ?? "17:00:00",
    estado: d.estado,
  });
  if (!ok) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  return NextResponse.json({ mensaje: "Empleado actualizado." });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "eliminar");
  if (guard.error) return guard.error;
  const result = await eliminarEmpleado(guard.empresa.id, Number(id));
  if (!result.ok) {
    return NextResponse.json({ error: result.mensaje }, { status: 404 });
  }
  return NextResponse.json({ mensaje: result.mensaje });
}
