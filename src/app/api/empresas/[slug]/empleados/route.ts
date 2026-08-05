import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  codigoDuplicado,
  crearEmpleado,
  listarEmpleados,
} from "@/lib/rrhh/empleados";
import { normalizarHora } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const empleados = await listarEmpleados(guard.empresa.id, q);
  return NextResponse.json({ empleados });
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

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "crear");
  if (guard.error) return guard.error;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  if (await codigoDuplicado(guard.empresa.id, d.codigo)) {
    return NextResponse.json(
      { error: "Ya existe un empleado con ese código." },
      { status: 400 },
    );
  }
  const he =
    normalizarHora(d.horaEntradaTeorica ?? "08:00") ?? "08:00:00";
  const hs =
    normalizarHora(d.horaSalidaTeorica ?? "17:00") ?? "17:00:00";

  const id = await crearEmpleado(guard.empresa.id, {
    codigo: d.codigo,
    nombre: d.nombre,
    puesto: d.puesto,
    categoriaOps: d.categoriaOps,
    tipoHorario: d.tipoHorario,
    fechaAlta: d.fechaAlta,
    fechaInicioLaboral: d.fechaInicioLaboral ?? null,
    horaEntradaTeorica: he,
    horaSalidaTeorica: hs,
    estado: d.estado,
  });
  return NextResponse.json({ id, mensaje: "Empleado creado." });
}
