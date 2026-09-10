import { redirect } from "next/navigation";

type Props = { params: Promise<{ slug: string }> };

/**
 * OPERACIONES-UX-PLANES-SIMPLIFICADO-1 — "Reportes de viajes" se movió a
 * Operaciones → Planes / Viajes (/e/[slug]/planes). Esta ruta histórica se
 * conserva como redirección permanente para no romper enlaces guardados
 * (p. ej. el enlace interno en Operaciones → TMS / Logística). No se
 * eliminó ninguna ruta ni endpoint de TMS.
 */
export default async function ReportesViajesRedirect({ params }: Props) {
  const { slug } = await params;
  redirect(`/e/${slug}/planes`);
}
