import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  listarDescuentos,
  crearDescuento,
  statusParaMotivo,
  CLASIFICACIONES,
  ESTADOS_DESCUENTO,
  type Clasificacion,
  type EstadoDescuento,
} from "@/lib/rrhh/descuentos";

/**
 * Fase D1: reemplaza el GET/POST plano de rrhh_descuentos por el motor
 * maestro + cuotas. rrhh_descuentos (histórico) NO se toca ni se borra —
 * simplemente deja de recibir altas nuevas desde esta pantalla; sus filas
 * siguen intactas en la base para consulta manual si hiciera falta.
 */

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const empleadoId = url.searchParams.get("empleadoId");
  const estado = url.searchParams.get("estado");
  const clasificacion = url.searchParams.get("clasificacion");
  const concepto = url.searchParams.get("concepto");

  try {
    const descuentos = await listarDescuentos(guard.empresa.id, {
      empleadoId: empleadoId ? Number(empleadoId) : undefined,
      estado:
        estado && (ESTADOS_DESCUENTO as readonly string[]).includes(estado)
          ? (estado as EstadoDescuento)
          : undefined,
      clasificacion:
        clasificacion && (CLASIFICACIONES as readonly string[]).includes(clasificacion)
          ? (clasificacion as Clasificacion)
          : undefined,
      concepto: concepto ?? undefined,
    });
    return NextResponse.json(
      { descuentos },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET rrhh/descuentos", e);
    return NextResponse.json({
      descuentos: [],
      aviso: "Importa sql/migrate-2026-08-rrhh-descuentos-d1.sql en phpMyAdmin.",
    });
  }
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  concepto: z.string().min(1),
  clasificacion: z.enum(["LEGAL", "AUTORIZADO", "JUDICIAL", "SISTEMA"]),
  motivo: z.string().optional(),
  montoOriginal: z.number().positive(),
  periodicidad: z.enum([
    "UNA_VEZ",
    "CADA_QUINCENA",
    "SOLO_QUINCENA_1",
    "SOLO_QUINCENA_2",
    "CADA_N_QUINCENAS",
    "MENSUAL",
    "MANUAL",
  ]),
  numeroCuotas: z.number().int().positive().max(60),
  cadaNQuincenas: z.number().int().positive().optional(),
  tipoQuincenaInicio: z.enum(["QUINCENA_1", "QUINCENA_2", "MENSUAL"]).optional(),
  quincenaInicio: z.union([z.literal(1), z.literal(2)]).optional(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)."),
  documentoId: z.number().int().positive().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const r = await crearDescuento(guard.empresa.id, {
    empleadoId: d.empleadoId,
    concepto: d.concepto,
    clasificacion: d.clasificacion,
    motivo: d.motivo ?? null,
    montoOriginal: d.montoOriginal,
    periodicidad: d.periodicidad,
    numeroCuotas: d.numeroCuotas,
    cadaNQuincenas: d.cadaNQuincenas ?? null,
    tipoQuincenaInicio: d.tipoQuincenaInicio ?? null,
    quincenaInicio: d.quincenaInicio ?? null,
    fechaInicio: d.fechaInicio,
    documentoId: d.documentoId ?? null,
    creadoPor: guard.session.username,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: statusParaMotivo(r.motivo) });
  }
  return NextResponse.json({ id: r.id, mensaje: "Descuento creado (borrador)." });
}
