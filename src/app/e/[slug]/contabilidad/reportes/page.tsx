import { ReportesContablesClient } from "@/components/contabilidad/reportes-client";
import { getSession } from "@/lib/session";
import { permisosEfectivos } from "@/lib/permisos";
import { tienePermiso } from "@/lib/permisos-shared";

type Props = { params: Promise<{ slug: string }> };

/** Reportes contables (M-4). Cada pestaña exige su propio permiso; el servidor lo vuelve a exigir en cada endpoint. */
export default async function ReportesContablesPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return <p>Sin permiso para ver los reportes contables.</p>;
  const admin = session.rol === "Admin";
  const permisos = admin ? [] : await permisosEfectivos(session.id, session.rol);
  const p = (fila: string) => admin || tienePermiso(permisos, fila, "ver");
  const flags = { puedeDiario: p("contabilidad_diario"), puedeMayor: p("contabilidad_mayor"), puedeBalance: p("contabilidad_balance") };
  if (!flags.puedeDiario && !flags.puedeMayor && !flags.puedeBalance) return <p>Sin permiso para ver los reportes contables.</p>;
  return <ReportesContablesClient slug={slug} {...flags} />;
}
