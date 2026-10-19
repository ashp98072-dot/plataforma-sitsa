import { CxcClient } from "@/components/contabilidad/cxc-client";
import { getSession } from "@/lib/session";
import { permisosEfectivos } from "@/lib/permisos";
import { tienePermiso } from "@/lib/permisos-shared";

type Props = { params: Promise<{ slug: string }> };

/** Cuentas por cobrar (Contabilidad). Permisos propios `cxc_cuentas` / `cxc_cobros`; el servidor los vuelve a exigir en cada endpoint. */
export default async function CxcPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return <p>Sin permiso para ver Cuentas por cobrar.</p>;
  const admin = session.rol === "Admin";
  const permisos = admin ? [] : await permisosEfectivos(session.id, session.rol);
  const p = (fila: string, accion: "ver" | "editar") => admin || tienePermiso(permisos, fila, accion);
  const puedeVer = p("cxc_cuentas", "ver");
  if (!puedeVer) return <p>Sin permiso para ver Cuentas por cobrar.</p>;
  return <CxcClient slug={slug} puedeVer={puedeVer} puedeCobrar={p("cxc_cobros", "editar")} />;
}
