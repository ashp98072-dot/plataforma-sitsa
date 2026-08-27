import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { respuestaFotoEmpleado } from "@/lib/rrhh/foto-empleado";

/** Nunca acepta un ID: solo la fotografía del colaborador autenticado. */
export async function GET() {
  const session = await getColaboradorSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  try { return await respuestaFotoEmpleado(session.empresaId, session.empleadoId); }
  catch (error) {
    console.error("GET foto propia", error);
    return NextResponse.json({ error: "No se pudo consultar la fotografía." }, { status: 500 });
  }
}
