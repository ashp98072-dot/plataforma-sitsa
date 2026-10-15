"use client";
import { useRouter } from "next/navigation";
import { CombustibleRegistro } from "./combustible-registro";

export function CombustibleNuevoClient({ slug }: { slug: string }) {
  const router = useRouter();
  const volver = () => router.push(`/e/${slug}/combustibles`);
  return <section className="p-4"><CombustibleRegistro slug={slug} onSaved={volver} onCancel={volver} /></section>;
}
