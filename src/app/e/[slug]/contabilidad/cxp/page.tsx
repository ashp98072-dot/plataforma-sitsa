import { CxpClient } from "@/components/contabilidad/cxp-client";
import { getSession } from "@/lib/session";
import { permisosEfectivos } from "@/lib/permisos";
import { tienePermiso } from "@/lib/permisos-shared";

type Props = { params: Promise<{ slug: string }> };

/** Cuentas por pagar (M-3A). Los permisos vienen de las filas propias de CxP; el servidor los vuelve a exigir en cada endpoint. */
export default async function CxpPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return <p>Sin permiso para ver Cuentas por pagar.</p>;
  const admin = session.rol === "Admin";
  const permisos = admin ? [] : await permisosEfectivos(session.id, session.rol);
  const p = (fila: string, accion: "ver" | "editar") => admin || tienePermiso(permisos, fila, accion);
  const flags = {
    puedeVer: p("cxp_facturas", "ver"), puedeRegistrar: p("cxp_facturas", "editar"), puedeAnular: p("cxp_anular", "editar"),
    puedeVerFiscal: p("cxp_proveedor_fiscal", "ver"), puedeEditarFiscal: p("cxp_proveedor_fiscal", "editar"),
  };
  if (!flags.puedeVer && !flags.puedeVerFiscal) return <p>Sin permiso para ver Cuentas por pagar.</p>;
  return <CxpClient slug={slug} {...flags} />;
}
