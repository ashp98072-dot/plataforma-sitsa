import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalUsuariosPanel } from "@/components/clientes/portal-usuarios-panel";
import { obtenerCliente } from "@/lib/clientes/repository";
import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { puedeEditarModulo, type RolGlobal } from "@/lib/roles";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string; id: string }> };

/**
 * CLIENTE-PORTAL-1C (alcance 2) — "Acceso Portal" de un cliente del
 * catálogo compartido, alcanzable desde /e/[slug]/clientes (botón
 * "Portal" en la fila). Recibe `id` = clientes.id — el mismo id que la
 * pantalla de Clientes ya conoce; jamás tms_clientes.id (la resolución
 * real ocurre en el servidor, ver src/lib/clientes/repository.ts
 * resolverTmsClienteId).
 */
export default async function ClientePortalAccesoPage({ params }: Props) {
  const { slug, id } = await params;
  const clienteId = Number(id);
  if (!Number.isFinite(clienteId) || clienteId <= 0) notFound();

  const [session, empresa] = await Promise.all([
    getSession(),
    obtenerEmpresaPorSlug(slug),
  ]);
  if (!empresa) notFound();

  await asegurarSchemaClientes();
  await asegurarModulosClientesFacturacion(empresa.id);

  const cliente = await obtenerCliente(empresa.id, clienteId);
  if (!cliente) notFound();

  const rol = (session?.rol ?? "Visualizador") as RolGlobal;
  const puedeEditar = session ? puedeEditarModulo(rol, "clientes") : false;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/e/${slug}/clientes`}
          className="text-xs text-[var(--muted)] underline"
        >
          ← Volver a Clientes
        </Link>
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Portal del Cliente
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Acceso Portal — {cliente.nombre}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Cuentas de acceso para que este cliente consulte sus solicitudes y
          viajes en <span className="font-mono">/cliente-portal</span>. La
          primera cuenta siempre se crea desde aquí — el cliente no puede
          auto-registrarse.
        </p>
      </div>

      <PortalUsuariosPanel slug={slug} clienteId={clienteId} puedeEditar={puedeEditar} />
    </div>
  );
}
