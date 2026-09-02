import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { crearSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import { listarViajesCliente } from "@/lib/tms/cliente-portal-seguimiento";

/**
 * CLIENTE-PORTAL-2 — solicitudes del cliente autenticado. Todo el scope
 * (empresaId/clienteId/usuarioClienteId) sale de requireClienteSession()
 * (JWT + revalidación DB, ver cliente-portal-guard.ts) — nunca de un
 * body/query enviado por el navegador. El body de POST ni siquiera tiene
 * campos para empresaId/clienteId/usuarioClienteId/estado/planId/version
 * — no hay forma de que el cliente los envíe por accidente ni a
 * propósito.
 */

const paradaSchema = z.object({
  lugarNombre: z.string().trim().min(1).max(200),
  clienteUbicacionId: z.number().int().positive().optional().nullable(),
  referencia: z.string().trim().max(300).optional().nullable(),
});

const crearSchema = z.object({
  fechaSolicitada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  horaSolicitada: z.string().trim().optional().nullable(),
  referenciaCliente: z.string().trim().max(120).optional().nullable(),
  observaciones: z.string().trim().max(500).optional().nullable(),
  origen: paradaSchema,
  entregas: z.array(paradaSchema).min(1, "Agrega al menos una entrega."),
  destino: paradaSchema,
});

export async function GET(req: Request) {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado") || undefined;
  const fechaDesde = url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = url.searchParams.get("fechaHasta") || undefined;

  // CLIENTE-PORTAL-4 (sección 13): listarViajesCliente() reutiliza
  // exactamente la misma consulta que listarSolicitudesCliente
  // (CLIENTE-PORTAL-2) y solo AGREGA el estado LIVE del viaje cuando la
  // solicitud ya tiene plan — no es una segunda fuente de verdad.
  // Se remapea de vuelta a la forma original de esta respuesta
  // (compatibilidad total con el frontend ya desplegado) más 2 campos
  // nuevos aditivos: planCodigo/estadoViaje.
  const viajes = await listarViajesCliente(session.empresaId, session.clienteId, {
    estado,
    fechaDesde,
    fechaHasta,
  });
  const solicitudes = viajes.map((v) => ({
    id: v.solicitudId,
    estado: v.estadoSolicitud,
    fechaSolicitada: v.fechaSolicitada,
    horaSolicitada: v.horaSolicitada,
    referenciaCliente: v.referenciaCliente,
    cantidadEntregas: v.cantidadEntregas,
    planId: v.planId,
    creadoEn: v.creadoEn,
    planCodigo: v.planCodigo,
    estadoViaje: v.estadoViaje,
  }));
  return NextResponse.json(
    { solicitudes },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  const r = await crearSolicitudCliente(
    {
      empresaId: session.empresaId,
      clienteId: session.clienteId,
      usuarioClienteId: session.usuarioClienteId,
    },
    parsed.data,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json(
    { solicitud: r.solicitud, mensaje: "Solicitud enviada correctamente." },
    { status: 201 },
  );
}
