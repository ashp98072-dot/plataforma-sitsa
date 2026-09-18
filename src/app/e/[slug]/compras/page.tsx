import { redirect } from "next/navigation";

/** Compatibilidad con enlaces históricos; el destino conserva su guard de acceso. */
export default async function ComprasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/e/${slug}/compras/requerimientos`);
}
