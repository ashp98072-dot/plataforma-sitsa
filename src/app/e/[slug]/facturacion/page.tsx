import { FacturacionClient } from "@/components/facturacion/facturacion-client";
import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";
import { capacidadesFacturacion } from "@/lib/facturacion/capacidades";
import { asegurarSchemaFacturacion } from "@/lib/facturacion/schema";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { permisosEfectivos } from "@/lib/permisos";
import { tienePermisoBase } from "@/lib/permisos-catalogo";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ vista?: string }>;
};

export default async function FacturacionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const [session, empresa] = await Promise.all([
    getSession(),
    obtenerEmpresaPorSlug(slug),
  ]);
  if (!session || !empresa) return <p>Sin permiso para ver Facturación.</p>;
  const permisos = await permisosEfectivos(session.id, session.rol);
  if (session.rol !== "Admin" && !tienePermisoBase(permisos, "facturacion")) {
    return <p>Sin permiso para ver Facturación.</p>;
  }
  if (empresa) {
    await asegurarSchemaClientes();
    await asegurarSchemaFacturacion();
    await asegurarModulosClientesFacturacion(empresa.id);
  }
  // Capacidades de Configuración empresa / Requisitos clientes: PERMISOS asignables (catálogo granular), no el rol.
  const alcance = capacidadesFacturacion(permisos, session.rol);
  const vistaRaw = (sp.vista ?? "").toLowerCase();
  const VISTAS_VALIDAS = ["facturas", "viajes-pendientes", "clientes", "empresa", "ayuda"] as const;
  const vistaInicial = (VISTAS_VALIDAS as readonly string[]).includes(vistaRaw)
    ? (vistaRaw as (typeof VISTAS_VALIDAS)[number])
    : null;

  return (
    <FacturacionClient
      slug={slug}
      verEmpresa={alcance.verEmpresa}
      editarEmpresa={alcance.editarEmpresa}
      verClientes={alcance.verClientes}
      editarClientes={alcance.editarClientes}
      vistaInicial={vistaInicial}
    />
  );
}
