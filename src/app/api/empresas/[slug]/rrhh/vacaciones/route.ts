import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import {
  calcularSaldoTotalDisponible,
  contarDiasHabiles,
  listarVacaciones,
  obtenerPeriodosDisponibles,
  registrarIncidenciaSinSaldo,
  registrarVacacionesFifo,
} from "@/lib/rrhh/vacaciones";

type Ctx = { params: Promise<{ slug: string }> };

const TIPOS_CON_SALDO = new Set([
  "Vacaciones",
  "A cuenta de Vacaciones",
]);

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const empleadoId = Number(url.searchParams.get("empleadoId") ?? "0");
  const vacaciones = await listarVacaciones(guard.empresa.id);

  if (empleadoId > 0) {
    try {
      const saldo = await calcularSaldoTotalDisponible(
        guard.empresa.id,
        empleadoId,
      );
      const periodos = await obtenerPeriodosDisponibles(
        guard.empresa.id,
        empleadoId,
      );
      return NextResponse.json({ vacaciones, saldo, periodos });
    } catch {
      return NextResponse.json({
        vacaciones,
        saldo: null,
        periodos: [],
        aviso: "Importa sql/migrate-2026-08-rrhh-core.sql para saldos FIFO.",
      });
    }
  }

  return NextResponse.json({ vacaciones });
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  diasHabiles: z.number().positive().optional(),
  tipo: z.string().default("Vacaciones"),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const dias =
    d.diasHabiles ??
    (await contarDiasHabiles(guard.empresa.id, d.fechaInicio, d.fechaFin));

  if (TIPOS_CON_SALDO.has(d.tipo)) {
    const r = await registrarVacacionesFifo({
      empresaId: guard.empresa.id,
      idEmpleado: d.empleadoId,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      diasATomar: dias,
      tipo: d.tipo,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.mensaje }, { status: 400 });
    }
    return NextResponse.json({
      mensaje: r.mensaje,
      desglose: r.desglose,
      incidenciaId: r.incidenciaId,
      diasHabiles: dias,
    });
  }

  const r = await registrarIncidenciaSinSaldo({
    empresaId: guard.empresa.id,
    idEmpleado: d.empleadoId,
    tipo: d.tipo,
    fechaInicio: d.fechaInicio,
    fechaFin: d.fechaFin,
    dias,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({
    mensaje: r.mensaje,
    incidenciaId: r.incidenciaId,
    diasHabiles: dias,
  });
}
