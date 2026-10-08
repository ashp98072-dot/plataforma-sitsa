import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  calcularSaldoTotalDisponible,
  contarDiasHabiles,
  listarVacaciones,
  obtenerHistorialPeriodos,
  obtenerPeriodosDisponibles,
  registrarIncidenciaSinSaldo,
} from "@/lib/rrhh/vacaciones";
import { registrarVacaciones } from "@/lib/rrhh/vacaciones-registro";
import { TIPOS_VACACIONES } from "@/lib/rrhh/vacaciones-eliminar-ui";

type Ctx = { params: Promise<{ slug: string }> };

const TIPOS_CON_SALDO = new Set([
  "Vacaciones",
  "A cuenta de Vacaciones",
]);

/**
 * RRHH-VACACIONES-FILTROS-HISTORIAL-1 — GET acepta empleadoId/tipo/desde/hasta, todos OPCIONALES e independientes:
 * `empleadoId` sigue siendo también el que decide si se calcula saldo/periodos (comportamiento sin cambios cuando no
 * se manda ningún filtro nuevo). El frontend hace DOS llamadas separadas — una con el empleado del FORMULARIO (para
 * saldo/periodos, ignora `vacaciones`) y otra con los filtros del HISTORIAL (ignora saldo/periodos) — así nunca se
 * mezclan esas dos responsabilidades. Validación aquí, nunca solo en el cliente.
 *
 * AJUSTE PR #376 (punto 1) — `soloResumen=1` (exige `empleadoId`): la llamada de saldo/periodos del formulario deja
 * de ejecutar `listarVacaciones()` (y por lo tanto el conteo de evidencias del historial completo) por completo.
 * Antes, cargar la página hacía ese trabajo dos veces (una para saldo/periodos, ignorando `vacaciones`; otra real
 * para el historial) — con `soloResumen=1` la primera llamada ya no toca el historial en absoluto.
 */
const filtrosSchema = z.object({
  empleadoId: z.coerce.number().int().positive().max(2147483647).optional(),
  tipo: z.enum(TIPOS_VACACIONES).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  soloResumen: z.enum(["1"]).optional(),
}).refine((v) => !v.desde || !v.hasta || v.desde <= v.hasta, { message: "El rango de fechas no es válido." })
  .refine((v) => !v.soloResumen || v.empleadoId, { message: "soloResumen requiere empleadoId." });

/** Historial completo de períodos (ADITIVO): si falla no rompe la respuesta de saldo/registro (y la clave `historial` simplemente se omite). */
async function historialSeguro(empresaId: number, empleadoId: number) {
  try {
    return await obtenerHistorialPeriodos(empresaId, empleadoId);
  } catch (error) {
    console.error("[vacaciones] historial de períodos:", error);
    return null;
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const crudo = Object.fromEntries(
    ["empleadoId", "tipo", "desde", "hasta", "soloResumen"]
      .map((c) => [c, url.searchParams.get(c)])
      .filter(([, v]) => v !== null && v !== ""),
  );
  const parsed = filtrosSchema.safeParse(crudo);
  if (!parsed.success) {
    return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
  }
  const { empleadoId, tipo, desde, hasta, soloResumen } = parsed.data;

  if (soloResumen && empleadoId) {
    try {
      const saldo = await calcularSaldoTotalDisponible(guard.empresa.id, empleadoId);
      const periodos = await obtenerPeriodosDisponibles(guard.empresa.id, empleadoId);
      return NextResponse.json({ saldo, periodos, historial: (await historialSeguro(guard.empresa.id, empleadoId)) ?? undefined });
    } catch {
      return NextResponse.json({
        saldo: null,
        periodos: [],
        aviso: "Importa sql/migrate-2026-08-rrhh-core.sql para saldos FIFO.",
      });
    }
  }

  const vacaciones = await listarVacaciones(guard.empresa.id, { empleadoId, tipo, desde, hasta });

  if (empleadoId) {
    try {
      const saldo = await calcularSaldoTotalDisponible(
        guard.empresa.id,
        empleadoId,
      );
      const periodos = await obtenerPeriodosDisponibles(
        guard.empresa.id,
        empleadoId,
      );
      return NextResponse.json({ vacaciones, saldo, periodos, historial: (await historialSeguro(guard.empresa.id, empleadoId)) ?? undefined });
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
  /** Decisión explícita de RRHH para un registro HISTÓRICO que cruza un aniversario o tiene déficit (atada a la huella de la propuesta). */
  decision: z.object({ huella: z.string().length(64), motivo: z.string().max(500) }).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "crear");
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
    // Registro normal sin cambios; si la fecha de inicio cae en un período que HOY está Vencido es un registro HISTÓRICO (ver vacaciones-registro.ts).
    const r = await registrarVacaciones({
      empresaId: guard.empresa.id,
      idEmpleado: d.empleadoId,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      diasATomar: dias,
      tipo: d.tipo,
      decision: d.decision,
      usuario: guard.session.username,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: r.mensaje, ...(r.codigo ? { codigo: r.codigo } : {}), ...(r.requiereDecision ? { requiereDecision: true } : {}), ...(r.plan ? { plan: r.plan } : {}) },
        { status: r.codigo === "DECISION_REQUERIDA" ? 409 : 400 },
      );
    }
    return NextResponse.json({
      mensaje: r.mensaje,
      desglose: r.desglose,
      incidenciaId: r.incidenciaId,
      diasHabiles: dias,
      ...(r.historico ? { historico: true, plan: r.plan } : {}),
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
