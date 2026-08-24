import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { ahoraLocal, hoyLocal, normalizarHora } from "@/lib/rrhh/dates";
import { obtenerParametros } from "@/lib/rrhh/config";
import { obtenerGeocerca } from "@/lib/rrhh/geocerca";
import {
  listarMarcajesRango,
  registrarMarcajeKiosko,
  registrarMarcajeManual,
} from "@/lib/rrhh/marcajes";
import { asegurarCorreccionTzGuatemala } from "@/lib/tz-guatemala-migrate";
import { borrarUpload, contentTypeFor, guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "marcajes", "ver");
  if (guard.error) return guard.error;

  await asegurarCorreccionTzGuatemala();

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
      horaEntrada: parametros.hora_entrada_default ?? "07:00:00",
      horaSalida: parametros.hora_salida_default ?? "16:00:00",
      horaSalidaSabado: parametros.hora_salida_sabado ?? "11:00:00",
      tolerancia: Number(parametros.minutos_tolerancia ?? 0) || 0,
      toleranciaSemanal:
        Number(parametros.minutos_tolerancia_semanal ?? 20) || 20,
      minutosParaFalta: Number(parametros.minutos_para_falta ?? 60) || 60,
    },
  });
}

const kioskoSchema = z.object({
  modo: z.literal("kiosko"),
  dpi: z.string().regex(/^\d{13}$/),
  viajeLargo: z.boolean(),
  latitud: z.number().min(-90).max(90),
  longitud: z.number().min(-180).max(180),
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

  await asegurarCorreccionTzGuatemala();

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const parsed = kioskoSchema.safeParse({
      modo: String(form.get("modo") ?? ""),
      dpi: String(form.get("dpi") ?? "").replace(/\D/g, ""),
      viajeLargo: String(form.get("viajeLargo") ?? "false") === "true",
      latitud: Number(form.get("latitud")),
      longitud: Number(form.get("longitud")),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "DPI, fotografía y ubicación GPS son obligatorios." },
        { status: 400 },
      );
    }
    const foto = form.get("foto");
    if (!(foto instanceof File) || !foto.type.startsWith("image/") || foto.size <= 0) {
      return NextResponse.json({ error: "Toma una fotografía con la cámara para marcar." }, { status: 400 });
    }
    if (foto.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "La fotografía supera el máximo de 10 MB." }, { status: 400 });
    }
    const empleado = await query<RowDataPacket[]>(
      `SELECT empresa_id FROM empleados WHERE dpi = ? AND estado <> 'Baja' LIMIT 1`,
      [parsed.data.dpi],
    );
    if (!empleado[0]) {
      return NextResponse.json({ error: "No se encontró un empleado activo con ese DPI." }, { status: 404 });
    }
    try {
      await query<RowDataPacket[]>("SELECT id FROM marcaje_evidencias LIMIT 0");
    } catch {
      return NextResponse.json(
        { error: "La migración de fotografías de marcaje todavía no está aplicada." },
        { status: 503 },
      );
    }
    const empresaEmpleadoId = Number(empleado[0].empresa_id);
    let saved: Awaited<ReturnType<typeof guardarUpload>>;
    try {
      saved = await guardarUpload(
        empresaEmpleadoId,
        "evidencias",
        `marcaje_${parsed.data.dpi.slice(-4)}`,
        foto,
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "No se pudo guardar la fotografía." },
        { status: 400 },
      );
    }
    const r = await registrarMarcajeKiosko(guard.empresa.id, {
      codigo: parsed.data.dpi,
      viajeLargo: parsed.data.viajeLargo,
      latitud: parsed.data.latitud,
      longitud: parsed.data.longitud,
      requerirUbicacionRegistrada: true,
    });
    if (!r.ok) {
      borrarUpload(saved.relative);
      return NextResponse.json({ error: r.error, code: r.code }, { status: 400 });
    }
    try {
      await execute(
        `INSERT INTO marcaje_evidencias
          (empresa_id, sesion_id, tipo, ruta_relativa, nombre_original, mime, tamano,
           latitud, longitud, ubicacion_id, capturado_en, registrado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.empresaId,
          r.sesionId,
          r.tipo.toLowerCase(),
          saved.relative,
          saved.original,
          contentTypeFor(saved.original),
          saved.size,
          parsed.data.latitud,
          parsed.data.longitud,
          r.ubicacionId ?? null,
          ahoraLocal(),
          guard.session.username,
        ],
      );
    } catch (err) {
      borrarUpload(saved.relative);
      console.error("POST marcaje evidencia", err);
      return NextResponse.json(
        { error: "El marcaje se registró, pero no se pudo asociar la fotografía. Comunícate con RRHH." },
        { status: 500 },
      );
    }
    return NextResponse.json({
      mensaje: `${r.tipo} de ${r.nombre} a las ${r.hora}`,
      ...r,
    });
  }

  const body = await req.json();

  if (body?.modo === "kiosko") {
    return NextResponse.json(
      { error: "La fotografía tomada desde la cámara y el GPS son obligatorios para marcar." },
      { status: 400 },
    );
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
