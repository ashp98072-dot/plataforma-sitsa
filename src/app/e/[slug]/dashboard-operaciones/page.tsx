import Link from "next/link";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string }> };

export default async function DashboardOperacionesPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!session || !empresa) return null;

  const cards = [
    {
      href: `/e/${slug}/tms`,
      title: "TMS / Planes de viaje",
      desc: "Rutas, programación, evidencias. Ahí eliges pilotos y auxiliares de la planilla.",
    },
    {
      href: `/e/${slug}/flota`,
      title: "Flota / Predios",
      desc: "Vehículos, km, talleres y servicios.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Dashboard Operaciones
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{empresa.nombre}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Transporte y flota. El alta de personal es solo RRHH; Operaciones
          selecciona pilotos al crear planes en TMS.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--accent)]"
          >
            <h2 className="font-medium">{c.title}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
