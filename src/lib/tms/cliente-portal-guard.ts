import { NextResponse } from "next/server";
import {
  getClienteSession,
  type ClientePortalSessionPayload,
} from "@/lib/tms/cliente-portal-session";

/**
 * CLIENTE-PORTAL-1 (alcance E) — guard de aislamiento del Portal del
 * Cliente. Deliberadamente NO reutiliza requireTenant*() de
 * src/lib/tenant.ts: esas funciones leen la cookie/sesión de STAFF
 * (getSession(), roles/permisos internos) y no tienen ningún sentido
 * para un cliente externo.
 *
 * Toda ruta del Portal del Cliente debe obtener empresaId/clienteId/
 * usuarioClienteId EXCLUSIVAMENTE a través de este helper (o de
 * getClienteSession() directamente) — nunca de un body/query/param
 * enviado por el navegador. Cualquier `viajeId`/`solicitudId`/etc. que
 * llegue del cliente se valida después contra estos 3 valores de sesión,
 * nunca al revés.
 */
export async function requireClienteSession(): Promise<
  | { session: ClientePortalSessionPayload; error?: undefined }
  | { session?: undefined; error: NextResponse }
> {
  const session = await getClienteSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "No autenticado." }, { status: 401 }),
    };
  }
  return { session };
}
