import { NextResponse } from "next/server";
import {
  getClienteSession,
  type ClientePortalSessionPayload,
} from "@/lib/tms/cliente-portal-session";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";

/**
 * CLIENTE-PORTAL-1 (alcance E) — guard de aislamiento del Portal del
 * Cliente. Deliberadamente NO reutiliza requireTenant*() de
 * src/lib/tenant.ts: esas funciones leen la cookie/sesión de STAFF
 * (getSession(), roles/permisos internos) y no tienen ningún sentido
 * para un cliente externo.
 *
 * Toda ruta del Portal del Cliente debe obtener empresaId/clienteId/
 * usuarioClienteId EXCLUSIVAMENTE a través de este helper — nunca de un
 * body/query/param enviado por el navegador. Cualquier `viajeId`/
 * `solicitudId`/etc. que llegue del cliente se valida después contra
 * estos 3 valores de sesión, nunca al revés.
 *
 * AJUSTE PRE-MERGE PR #167 (punto 4) — separación deliberada entre dos
 * capas de verificación:
 *  - middleware.ts (Edge runtime): solo valida la FIRMA del JWT por
 *    cookie, sin tocar la base de datos — es la protección rápida para
 *    UX (redirigir a /cliente-portal/login sin que cada navegación
 *    dependa de una consulta a MySQL). Un JWT válido ahí solo demuestra
 *    que el login fue exitoso EN ALGÚN MOMENTO dentro de las 12h de
 *    vigencia del token.
 *  - requireClienteSession() (Node runtime, aquí): es la verificación
 *    DEFINITIVA — además de la firma, confirma contra la base de datos,
 *    en el momento de la petición, que el usuario sigue activo y que el
 *    cliente al que pertenece sigue 'Activo' (validarClienteSessionActiva).
 *    Si alguien desactivó la cuenta o el cliente DESPUÉS de emitido el
 *    token, esta llamada lo detecta y responde 401 aunque el JWT en sí
 *    siga siendo válido y no haya expirado — el token viejo deja de
 *    servir para ejecutar operaciones sensibles de inmediato, sin
 *    esperar a que expiren las 12h.
 *
 * Todo endpoint sensible del Portal del Cliente (cambiar contraseña,
 * futuras APIs de solicitudes/seguimiento) DEBE pasar por esta función
 * — nunca aceptar la sola presencia de un JWT válido como autorización
 * suficiente.
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
  const activa = await validarClienteSessionActiva(session);
  if (!activa) {
    return {
      error: NextResponse.json({ error: "Sesión inválida." }, { status: 401 }),
    };
  }
  return { session };
}
