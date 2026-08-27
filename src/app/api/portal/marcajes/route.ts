import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  listarMarcajesEmpleadoRango,
  registrarMarcajePortal,
} from "@/lib/rrhh/marcajes";
import { z } from "zod";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { tipoFotoEmpleado } from "@/lib/rrhh/foto-empleado";

const RANGO_MAX_DIAS = 90;

function hace14Dias(hoyIso: string): string {
  const [y, m, d] = hoyIso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  fecha.setUTCDate(fecha.getUTCDate() - 14);
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-${String(
    fecha.getUTCDate(),
  ).padStart(2, "0")}`;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const url = new URL(req.url);
  const hoy = hoyLocal();
  const desdeParam = url.searchParams.get("desde");
  const hastaParam = url.searchParams.get("hasta");

  const desde = desdeParam && FECHA_RE.test(desdeParam) ? desdeParam : hace14Dias(hoy);
  const hasta = hastaParam && FECHA_RE.test(hastaParam) ? hastaParam : hoy;

  if (desde > hasta) {
    return NextResponse.json(
      { error: "La fecha 'desde' no puede ser posterior a 'hasta'." },
      { status: 400 },
    );
  }

  // Límite razonable: evita que alguien pida un rango de años completo desde
  // la URL y genere una consulta pesada sin necesidad.
  const dias =
    (Date.parse(hasta) - Date.parse(desde)) / (1000 * 60 * 60 * 24);
  if (dias > RANGO_MAX_DIAS) {
    return NextResponse.json(
      { error: `El rango máximo es de ${RANGO_MAX_DIAS} días.` },
      { status: 400 },
    );
  }

  const marcajes = await listarMarcajesEmpleadoRango(
    session.empresaId,
    session.empleadoId,
    desde,
    hasta,
  );

  return NextResponse.json({ marcajes, desde, hasta });
}

const marcarSchema = z.object({
  latitud: z.number().finite().min(-90).max(90),
  longitud: z.number().finite().min(-180).max(180),
});

export async function POST(req: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const foto = form?.get("foto");
  if (!(foto instanceof File) || !foto.size || foto.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Toma una fotografía con la cámara (máximo 10 MB) para marcar." }, { status: 400 });
  }
  const bytes = await foto.arrayBuffer();
  const mime = tipoFotoEmpleado(new Uint8Array(bytes));
  if (mime !== "image/jpeg") {
    return NextResponse.json({ error: "La fotografía debe ser una captura JPEG de la cámara." }, { status: 400 });
  }
  const parsed = marcarSchema.safeParse({
    latitud: form?.get("latitud") ? Number(form.get("latitud")) : NaN,
    longitud: form?.get("longitud") ? Number(form.get("longitud")) : NaN,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "No se recibió una ubicación GPS válida." },
      { status: 400 },
    );
  }
  let saved: Awaited<ReturnType<typeof guardarUpload>> | undefined;
  try {
  saved = await guardarUpload(session.empresaId, "evidencias", `marcaje_portal_${session.empleadoId}`, {
    name: "foto-marcaje.jpg", size: bytes.byteLength, arrayBuffer: async () => bytes,
  });
  const resultado = await registrarMarcajePortal(session.empresaId, session.empleadoId, parsed.data, { ...saved, mime });
  if (!resultado.ok) {
    borrarUpload(saved.relative);
    return NextResponse.json(
      { error: resultado.error, code: resultado.code },
      { status: resultado.code === "FUERA_GEOCERCA" ? 409 : 400 },
    );
  }
  return NextResponse.json({
    mensaje: `${resultado.tipo} registrada a las ${resultado.hora}.`,
    resultado,
  });
  } catch (error) {
    if (saved) borrarUpload(saved.relative);
    console.error("POST marcaje portal con foto", error);
    return NextResponse.json({ error: "No se pudo completar el marcaje con su fotografía. Actualiza el historial antes de reintentar." }, { status: 500 });
  }
}
