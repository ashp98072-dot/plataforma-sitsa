import { PERMISOS_ENTREGA, tienePermiso, type PermisoModulo } from "@/lib/permisos-shared";
import type { ActorEntrega } from "./reglas";

/**
 * Identidad del actor de una entrega, SIEMPRE tomada de la sesión del servidor (jamás del cuerpo de la petición). El nombre
 * cae al `username` cuando el usuario no tiene nombre (igual que las demás firmas del sistema).
 */
export function actorDesdeSesion(
  session: { id: number; username: string; nombre?: string | null; rol: string },
  permisos: PermisoModulo[],
): ActorEntrega {
  return {
    usuarioId: session.id,
    username: session.username,
    nombre: (session.nombre ?? "").trim() || session.username,
    rol: session.rol,
    esAdmin: session.rol === "Admin",
    permisos,
  };
}

/**
 * ¿Tiene ALGUNA razón para usar el control de entrega? (alguna fila de entrega o, si se acepta, ver Solicitudes de fondo).
 * Es solo la puerta de entrada de los endpoints; qué puede hacer en cada área lo decide el servicio con `reglas.ts`.
 */
export function puedeUsarEntregas(permisos: PermisoModulo[], esAdmin: boolean, opciones: { aceptaGastosVer?: boolean } = {}): boolean {
  if (esAdmin) return true;
  if (tienePermiso(permisos, "documentos_entregas", "ver")) return true;
  if (PERMISOS_ENTREGA.some((fila) => tienePermiso(permisos, fila, "editar"))) return true;
  return Boolean(opciones.aceptaGastosVer) && tienePermiso(permisos, "gastos", "ver");
}
