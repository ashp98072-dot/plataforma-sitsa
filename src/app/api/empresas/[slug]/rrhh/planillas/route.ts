import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  contarEmpleadosActivos,
  listarPeriodos,
  asegurarSchemaPlanillas,
} from "@/lib/rrhh/planillas";
import { execute } from "@/lib/db";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "ver");
  if (guard.error) return guard.error;
  try {
    await asegurarSchemaPlanillas();
    const [planillas, conteo] = await Promise.all([
      listarPeriodos(guard.empresa.id),
      contarEmpleadosActivos(guard.empresa.id),
    ]);
    return NextResponse.json({
      planillas,
      empleadosActivos: conteo.total,
      empleadosFormales: conteo.formales,
      empleadosOutsourcing: conteo.outsourcing,
    });
  } catch {
    return NextResponse.json({
      planillas: [],
      empleadosActivos: 0,
      empleadosFormales: 0,
      empleadosOutsourcing: 0,
      aviso:
        "No se pudo leer planillas. Verifica MySQL o importa sql/migrate-2026-08-rrhh-planillas-lineas.sql.",
    });
  }
}

const schema = z.object({
  codigo: z.string().min(1),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  notas: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  try {
    await asegurarSchemaPlanillas();
    const r = await execute(
      `INSERT INTO rrhh_planilla_periodos
        (empresa_id, codigo, fecha_inicio, fecha_fin, estado, notas, creado_por)
       VALUES (?, ?, ?, ?, 'Borrador', ?, ?)`,
      [
        guard.empresa.id,
        d.codigo,
        d.fechaInicio,
        d.fechaFin,
        d.notas ?? null,
        guard.session.username,
      ],
    );
    return NextResponse.json({
      id: r.insertId,
      mensaje: "Periodo de planilla creado (borrador).",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/Duplicate|uq_planilla/i.test(msg)) {
      return NextResponse.json(
        { error: "Ya existe un periodo con ese código." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "No se pudo crear el periodo de planilla." },
      { status: 500 },
    );
  }
}
