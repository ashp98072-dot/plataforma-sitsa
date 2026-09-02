import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { SolicitudClienteDetalleInterno } from "@/components/tms/solicitud-cliente-detalle-interno";

type Props = { params: Promise<{ slug: string; id: string }> };

export default async function SolicitudClienteDetallePage({ params }: Props) {
  const { slug, id } = await params;
  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) notFound();

  const [session, empresa] = await Promise.all([getSession(), obtenerEmpresaPorSlug(slug)]);
  if (!session || !empresa) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <Link
        href={`/e/${slug}/tms/solicitudes-clientes`}
        className="text-xs text-[var(--muted)] underline"
      >
        ← Solicitudes de clientes
      </Link>
      <SolicitudClienteDetalleInterno slug={slug} solicitudId={solicitudId} />
    </div>
  );
}
