import Link from "next/link";
import type { ReactNode } from "react";

export default async function ContabilidadLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <>
    <nav aria-label="Contabilidad" className="flex flex-wrap gap-4 border-b border-[var(--border)] p-4 text-sm">
      <Link href={`/e/${slug}/contabilidad`}>Cuentas y asientos</Link>
      <Link href={`/e/${slug}/contabilidad/entidades`} className="underline">Configurar entidades contables</Link>
    </nav>
    {children}
  </>;
}
