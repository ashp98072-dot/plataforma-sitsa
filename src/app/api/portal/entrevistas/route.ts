import { NextResponse } from "next/server";
import { z } from "zod";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  actualizarEntrevista,
  listarEntrevistasPorEntrevistador,
} from "@/lib/rrhh/entrevistas";

/**
 * Igual que el resto del portal: empresaId/empleadoId SIEMPRE salen de la
 * sesión del colaborador, nunca de query/body.
 */
export async function GET() {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const entrevistas = await listarEntrevistasPorEntrevistador(
    session.empresaId,
    session.empleadoId,
  );
  return NextResponse.json({ entrevistas });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  estado: z.enum(["Programada", "Realizada", "Cancelada", "No asistió"]).optional(),
  resultado: z.enum(["Pendiente", "Aprobado", "Rechazado"]).optional(),
  notas: z.string().max(2000).optional().nullable(),
});

/**
 * PATCH /api/portal/entrevistas
 * El entrevistador solo puede marcar estado/resultado/notas de SUS PROPIAS
 * entrevistas asignadas — nunca reprogramar fecha ni reasignar a otro
 * entrevistador, eso lo hace RRHH desde el calendario.
 */
export async function PATCH(req: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { id, ...patch } = parsed.data;

  // Verifica que la entrevista sea del entrevistador que hace la petición,
  // no solo que exista en la empresa — así nadie marca resultado de una
  // entrevista ajena.
  const propias = await listarEntrevistasPorEntrevistador(
    session.empresaId,
    session.empleadoId,
  );
  if (!propias.some((e) => e.id === id)) {
    return NextResponse.json(
      { error: "Esta entrevista no está asignada a ti." },
      { status: 403 },
    );
  }

  const r = await actualizarEntrevista(session.empresaId, id, patch);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}