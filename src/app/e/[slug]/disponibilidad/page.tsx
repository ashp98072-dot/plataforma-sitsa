import { DisponibilidadClient } from "@/components/operaciones/disponibilidad-client";

type Props = { params: Promise<{ slug: string }> };

/**
 * Operaciones → Disponibilidad de flota.
 * Página aditiva: no modifica Flota ni TMS; lista unidades listas para planificar.
 */
export default async function DisponibilidadPage({ params }: Props) {
  const { slug } = await params;
  return <DisponibilidadClient slug={slug} />;
}
