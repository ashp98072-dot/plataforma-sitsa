import { notFound } from "next/navigation";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function PublicSitePage({ params }: Props) {
  const { slug } = await params;
  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!empresa) notFound();

  const secciones = await query<RowDataPacket[]>(
    `SELECT clave, titulo, contenido, imagen_url
     FROM cms_secciones
     WHERE empresa_id = ? AND publicada = 1
     ORDER BY orden, id`,
    [empresa.id],
  );

  const hero =
    secciones.find((s) => s.clave === "inicio") ?? secciones[0] ?? null;

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--border)] px-6 py-4">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          {empresa.codigo}
        </p>
        <h1 className="text-2xl font-semibold">{empresa.nombre}</h1>
      </header>

      {hero ? (
        <section className="relative overflow-hidden px-6 py-16">
          {hero.imagen_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(hero.imagen_url)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-30"
            />
          ) : null}
          <div className="relative mx-auto max-w-3xl">
            <h2 className="text-4xl font-semibold">
              {String(hero.titulo ?? empresa.nombre)}
            </h2>
            <p className="mt-4 whitespace-pre-wrap text-[var(--muted)]">
              {String(hero.contenido ?? "")}
            </p>
          </div>
        </section>
      ) : (
        <section className="px-6 py-16">
          <p className="text-[var(--muted)]">
            Sitio sin secciones publicadas. Edítalas en CMS de la plataforma.
          </p>
        </section>
      )}

      <section className="mx-auto grid max-w-4xl gap-4 px-6 pb-16">
        {secciones
          .filter((s) => s.clave !== (hero?.clave ?? ""))
          .map((s) => (
            <article
              key={String(s.clave)}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
            >
              <h3 className="text-xl font-medium">
                {String(s.titulo ?? s.clave)}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted)]">
                {String(s.contenido ?? "")}
              </p>
            </article>
          ))}
      </section>
    </main>
  );
}
