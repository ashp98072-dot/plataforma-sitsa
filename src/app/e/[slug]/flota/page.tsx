import { redirect } from "next/navigation";
import FlotaPageClient from "./flota-page-client";
/**
 * Compatibilidad server-side. El resto conserva la carga cliente de Flota.
 */
export default async function FlotaPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  if (search.tab === "combustible") redirect(`/e/${slug}/combustibles`);
  return <FlotaPageClient />;
}
