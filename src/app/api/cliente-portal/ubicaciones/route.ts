import { NextResponse } from "next/server";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { listarUbicacionesCliente } from "@/lib/tms/cliente-ubicaciones";

/**
 * CLIENTE-PORTAL-2 (sección 5) — ubicaciones guardadas del cliente
 * (tms_cliente_ubicaciones, ya usadas por Operaciones/Programación),
 * para que el formulario de nueva solicitud pueda ofrecer "elegir una
 * ubicación guardada" además de "Otro destino" con captura manual.
 * Reutiliza listarUbicacionesCliente tal cual — no se duplica lógica.
 * Solo activas (mismo criterio que el selector de Programación).
 */
export async function GET() {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const ubicaciones = await listarUbicacionesCliente(session.empresaId, session.clienteId);
  return NextResponse.json(
    { ubicaciones },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
