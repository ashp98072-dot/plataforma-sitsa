import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * ATRACCION-TALENTO-1 — "Entrevistas" se movió de Gestión de Talento
 * Humano a su propio grupo "Atracción de Talento Humano"
 * (/e/[slug]/atraccion-talento/entrevistas). Esta ruta histórica se
 * conserva como redirección permanente (mismo criterio ya usado para
 * /tms/reportes -> /planes) para no romper bookmarks/enlaces guardados —
 * preserva la query string (p. ej. un futuro deep-link ?entrevista=ID).
 * No se eliminó ningún permiso, API ni dato.
 */
export default async function EntrevistasRedirect({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, item);
    } else {
      qs.set(k, v);
    }
  }
  const suffix = qs.toString();
  redirect(`/e/${slug}/atraccion-talento/entrevistas${suffix ? `?${suffix}` : ""}`);
}
