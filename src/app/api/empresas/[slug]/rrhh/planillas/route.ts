import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  contarEmpleadosActivos,
  listarPeriodos,
  asegurarSchemaPlanillas,
  crearPeriodo,
} from "@/lib/rrhh/planillas";
import { registrarAuditoria } from "@/lib/auditoria";

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
  // Fase P0: identidad opcional de quincena/mes — aditivo, no rompe
  // clientes existentes que solo envían codigo/fechaInicio/fechaFin/notas.
  tipoPeriodo: z.enum(["QUINCENA_1", "QUINCENA_2", "MENSUAL", "ESPECIAL"]).optional(),
  numeroQuincena: z.union([z.literal(1), z.literal(2)]).optional(),
  mes: z.number().int().min(1).max(12).optional(),
  anio: z.number().int().min(2000).max(2100).optional(),
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
    const r = await crearPeriodo(guard.empresa.id, {
      codigo: d.codigo,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      notas: d.notas ?? null,
      creadoPor: guard.session.username,
      tipoPeriodo: d.tipoPeriodo ?? null,
      numeroQuincena: d.numeroQuincena ?? null,
      mes: d.mes ?? null,
      anio: d.anio ?? null,
    });
    if (!r.ok) {
      const status =
        r.motivo === "fechas_invalidas"
          ? 400
          : r.motivo === "error"
            ? 500
            : 409; // solapado | codigo_duplicado | lock
      return NextResponse.json({ error: r.mensaje }, { status });
    }
    await registrarAuditoria({
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: "crear_periodo_planilla",
      modulo: "rrhh",
      detalle: `Periodo #${r.id} ${d.codigo} · ${d.fechaInicio} → ${d.fechaFin}${d.tipoPeriodo ? ` · ${d.tipoPeriodo}` : ""}`,
    });
    return NextResponse.json({
      id: r.id,
      mensaje: "Periodo de planilla creado (borrador).",
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo crear el periodo de planilla." },
      { status: 500 },
    );
  }
}
