import Link from "next/link";
import { redirect } from "next/navigation";
import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { MisSolicitudes } from "./mis-solicitudes";

/**
 * CLIENTE-PORTAL-2 (sección 10) — "Mis solicitudes". Solo un guard de
 * entrada (server component); el listado/filtrado real vive en el
 * cliente y llama a GET /api/cliente-portal/solicitudes, que ya exige
 * requireClienteSession() y filtra por empresaId+clienteId de sesión.
 */
export default async function MisSolicitudesPage() {
  const session = await getClienteSession();
  if (!session) redirect("/cliente-portal/login");
  const activa = await validarClienteSessionActiva(session!);
  if (!activa) redirect("/cliente-portal/login");

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/cliente-portal" className="text-xs text-[var(--muted)] underline">
            ← Portal del Cliente
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Mis solicitudes</h1>
        </div>
        <Link
          href="/cliente-portal/solicitudes/nueva"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          + Nueva solicitud
        </Link>
      </div>
      <MisSolicitudes />
    </main>
  );
}
