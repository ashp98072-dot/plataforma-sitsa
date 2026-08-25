import { PortalesProveedoresClient } from "@/components/proveedores/portales-proveedores-client";

type Props = { params: Promise<{ slug: string }> };

export default async function PortalesProveedoresPage({ params }: Props) {
  const { slug } = await params;
  return <PortalesProveedoresClient slug={slug} />;
}
