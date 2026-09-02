import Link from "next/link";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { SolicitudesClientesBandeja } from "@/components/tms/solicitudes-clientes-bandeja";

type Props = { params: Promise<{ slug: string }> };

/**
 * CLIENTE-PORTAL-3 (alcance 3) — bandeja interna de solicitudes creadas
 * por clientes en el Portal del Cliente, para que Operaciones las
 * revise/rechace/programe. NO vive en el Portal del Cliente. El guard
 * real (requireTenantProgramacionOTms/requireTenantProgramacion) está
 * en los endpoints — esta página server-side solo confirma sesión para
 * evitar renderizar contenido a quien no está autenticado.
 */
export default async function SolicitudesClientesPage({ params }: Props) {
  const { slug } = await params;
  const [session, empresa] = await Promise.all([getSession(), obtenerEmpresaPorSlug(slug)]);
  if (!session || !empresa) {
    return (
      <div className="p-6 text-sm text-[var(--muted)]">
        <Link href={`/e/${slug}`} className="underline">
          Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Operaciones / TMS
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Solicitudes de clientes</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Solicitudes de viaje enviadas por clientes desde el Portal del
          Cliente. Revisa, rechaza o programa cada una.
        </p>
      </div>
      <SolicitudesClientesBandeja slug={slug} />
    </div>
  );
}
