import { FacturacionClient } from "@/components/facturacion/facturacion-client";
import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { asegurarSchemaFacturacion } from "@/lib/facturacion/schema";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { puedeEditarModulo, type RolGlobal } from "@/lib/roles";
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
  const rol = (session?.rol ?? "Visualizador") as RolGlobal;
  const puedeEditar = session
    ? puedeEditarModulo(rol, "facturacion")
    : false;

  return <FacturacionClient slug={slug} puedeEditar={puedeEditar} />;
}
