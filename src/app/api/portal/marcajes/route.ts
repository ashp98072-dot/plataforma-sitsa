import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  listarMarcajesEmpleadoRango,
  registrarMarcajePortal,
} from "@/lib/rrhh/marcajes";
import { z } from "zod";

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
  const parsed = marcarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "No se recibió una ubicación GPS válida." },
      { status: 400 },
    );
  }
  const resultado = await registrarMarcajePortal(
    session.empresaId,
    session.empleadoId,
    parsed.data,
  );
  if (!resultado.ok) {
    return NextResponse.json(
      { error: resultado.error, code: resultado.code },
      { status: resultado.code === "FUERA_GEOCERCA" ? 409 : 400 },
    );
  }
  return NextResponse.json({
    mensaje: `${resultado.tipo} registrada a las ${resultado.hora}.`,
    resultado,
  });
}
