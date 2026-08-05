import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { hoyLocal, normalizarHora } from "@/lib/rrhh/dates";
import { obtenerParametros } from "@/lib/rrhh/config";
import { obtenerGeocerca } from "@/lib/rrhh/geocerca";
import {
  listarMarcajesRango,
  registrarMarcajeKiosko,
  registrarMarcajeManual,
} from "@/lib/rrhh/marcajes";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "marcajes", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const hoy = hoyLocal();
  const desde = url.searchParams.get("desde") ?? hoy;
  const hasta = url.searchParams.get("hasta") ?? desde;
  const [marcajes, geocerca, parametros] = await Promise.all([
    listarMarcajesRango(guard.empresa.id, desde, hasta),
    obtenerGeocerca(guard.empresa.id),
    obtenerParametros(guard.empresa.id),
  ]);
  return NextResponse.json({
    marcajes,
    empresa: {
      id: guard.empresa.id,
      nombre: guard.empresa.nombre,
      codigo: guard.empresa.codigo,
      slug: guard.empresa.slug,
    },
    geocerca: {
      activa: geocerca.activa,
      lat: geocerca.lat,
      lng: geocerca.lng,
      radioM: geocerca.radioM,
    },
    horario: {
      horaEntrada: parametros.hora_entrada_default ?? "08:00:00",
      horaSalida: parametros.hora_salida_default ?? "17:00:00",
      tolerancia: Number(parametros.minutos_tolerancia ?? 10) || 10,
    },
  });
}

const kioskoSchema = z.object({
  modo: z.literal("kiosko"),
  codigo: z.string().min(1),
  viajeLargo: z.boolean().optional(),
  latitud: z.number().min(-90).max(90).optional().nullable(),
  longitud: z.number().min(-180).max(180).optional().nullable(),
});

const manualSchema = z.object({
  empleadoId: z.number().int().positive().optional(),
  codigo: z.string().optional(),
  fechaJornada: z.string().min(8),
  hora: z.string().min(4),
  correccion: z.enum(["entrada", "salida"]).nullable().optional(),
  comentarios: z.string().optional(),
  /** compat: botones Entrada/Salida antiguos */
  tipo: z.enum(["entrada", "salida"]).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "marcajes", "crear");
  if (guard.error) return guard.error;

  const body = await req.json();

  if (body?.modo === "kiosko") {
    const parsed = kioskoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    const r = await registrarMarcajeKiosko(guard.empresa.id, {
      codigo: parsed.data.codigo,
      viajeLargo: parsed.data.viajeLargo,
      latitud: parsed.data.latitud,
      longitud: parsed.data.longitud,
    });
    if (!r.ok) {
      return NextResponse.json({ error: r.error, code: r.code }, { status: 400 });
    }
    return NextResponse.json({
      mensaje: `${r.tipo} de ${r.nombre} a las ${r.hora}`,
      ...r,
    });
  }

  // Corrección manual: no disponible para kiosco Marcaje
  if (guard.session.rol === "Marcaje") {
    return NextResponse.json(
      {
        error:
          "Este usuario solo puede marcar en kiosco. La corrección manual es de RRHH.",
      },
      { status: 403 },
    );
  }

  const parsed = manualSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Completa empleado, fecha y hora." },
      { status: 400 },
    );
  }
  const d = parsed.data;
  if (!d.empleadoId && !d.codigo) {
    return NextResponse.json({ error: "Indica empleado." }, { status: 400 });
  }
  if (!normalizarHora(d.hora)) {
    return NextResponse.json(
      { error: "Hora inválida. Use HH:MM o HH:MM:SS." },
      { status: 400 },
    );
  }

  const r = await registrarMarcajeManual(guard.empresa.id, {
    empleadoId: d.empleadoId,
    codigo: d.codigo,
    fechaJornada: d.fechaJornada,
    hora: d.hora,
    correccion: d.correccion ?? d.tipo ?? null,
    comentarios: d.comentarios,
  });

  if (!r.ok) {
    const status = r.code === "NEEDS_CORRECTION" ? 409 : 400;
    return NextResponse.json(
      {
        error: r.mensaje,
        code: r.code,
        entradaActual: r.entradaActual,
        salidaActual: r.salidaActual,
      },
      { status },
    );
  }
  return NextResponse.json({
    id: r.id,
    mensaje: r.mensaje,
    tipoMarcaje: r.tipoMarcaje,
    nombre: r.nombre,
  });
}
