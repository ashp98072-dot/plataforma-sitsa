import Link from "next/link";
import { redirect } from "next/navigation";
import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { NuevaSolicitudForm } from "./nueva-solicitud-form";

export default async function NuevaSolicitudPage() {
  const session = await getClienteSession();
  if (!session) redirect("/cliente-portal/login");
  const activa = await validarClienteSessionActiva(session!);
  if (!activa) redirect("/cliente-portal/login");

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <Link href="/cliente-portal" className="text-xs text-[var(--muted)] underline">
        ← Portal del Cliente
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Nueva solicitud de viaje</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Define origen, entregas y destino final. Operaciones revisará tu
          solicitud antes de programar el viaje.
        </p>
      </div>
      <NuevaSolicitudForm />
    </main>
  );
}
