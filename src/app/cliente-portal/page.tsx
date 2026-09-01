import { redirect } from "next/navigation";
import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { obtenerNombreCliente } from "@/lib/tms/cliente-portal-datos";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import ClientePortalLogoutButton from "./logout-button";

/**
 * CLIENTE-PORTAL-1 — landing mínima, sin solicitudes todavía (alcance C
 * del ticket): solo confirma que la sesión quedó bien armada (nombre de
 * usuario, nombre del cliente) y ofrece cerrar sesión. El middleware ya
 * bloquea esta ruta sin sesión válida por JWT; el `redirect` de abajo es
 * un respaldo defensivo, no la única barrera.
 *
 * AJUSTE PRE-MERGE PR #167 (punto 4) — esta página SÍ muestra datos del
 * cliente (nombre de usuario, nombre del cliente), así que también pasa
 * por la verificación DEFINITIVA contra base de datos
 * (validarClienteSessionActiva), no solo por la firma del JWT: un token
 * viejo de un usuario o cliente ya desactivado no debe poder ver ni
 * seguir mostrando esos datos hasta que expire.
 */
export default async function ClientePortalHomePage() {
  const session = await getClienteSession();
  if (!session) {
    redirect("/cliente-portal/login");
  }
  const activa = await validarClienteSessionActiva(session!);
  if (!activa) {
    redirect("/cliente-portal/login");
  }

  const nombreCliente = await obtenerNombreCliente(
    session!.empresaId,
    session!.clienteId,
  );

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Grupo SITSA
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Portal del Cliente</h1>
        </div>
        <ClientePortalLogoutButton />
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
        <p className="text-sm text-[var(--muted)]">Sesión activa como</p>
        <p className="mt-1 text-lg font-medium">{session!.nombre ?? "—"}</p>
        <p className="mt-4 text-sm text-[var(--muted)]">Cliente</p>
        <p className="mt-1 text-lg font-medium">{nombreCliente ?? "—"}</p>
      </div>

      <p className="mt-6 text-sm text-[var(--muted)]">
        Las solicitudes de viaje y el seguimiento estarán disponibles en una
        fase posterior.
      </p>
    </main>
  );
}
