import { FacturacionClient } from "@/components/facturacion/facturacion-client";
import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { alcanceFacturacion } from "@/lib/facturacion/alcance";
import { asegurarSchemaFacturacion } from "@/lib/facturacion/schema";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string }> };

export default async function FacturacionPage({ params }: Props) {
  const { slug } = await params;
  const [session, empresa] = await Promise.all([
    getSession(),
    obtenerEmpresaPorSlug(slug),
  ]);
  if (empresa) {
    await asegurarSchemaClientes();
    await asegurarSchemaFacturacion();
    await asegurarModulosClientesFacturacion(empresa.id);
  }
  const alcance = alcanceFacturacion(session?.rol ?? "");

  return (
    <FacturacionClient
      slug={slug}
      verEmpresa={alcance.verEmpresa}
      editarEmpresa={alcance.editarEmpresa}
      verClientes={alcance.verClientes}
      editarClientes={alcance.editarClientes}
    />
  );
}
