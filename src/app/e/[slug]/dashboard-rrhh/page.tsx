import Link from "next/link";
import { obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string }> };

export default async function DashboardRrhhPage({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const empresa = await obtenerEmpresaPorSlug(slug);
  if (!session || !empresa) return null;

  const cards = [
    {
      href: `/e/${slug}/rrhh/empleados`,
      title: "Control de empleados",
      desc: "Altas, puestos y estado del personal.",
    },
    {
      href: `/e/${slug}/rrhh/vacaciones`,
      title: "Vacaciones",
      desc: "Control de vacaciones y días hábiles.",
    },
    {
      href: `/e/${slug}/rrhh/marcajes`,
      title: "Marcajes / asistencias",
      desc: "Entradas y salidas del personal.",
    },
    {
      href: `/e/${slug}/rrhh/incidencias`,
      title: "Incidencias",
      desc: "Permisos, faltas y suspensiones.",
    },
    {
      href: `/e/${slug}/rrhh/reportes`,
      title: "Reportes / planillas base",
      desc: "Consultas y Excel de asistencia.",
    },
    {
      href: `/e/${slug}/rrhh/inventario`,
      title: "EPP / útiles",
      desc: "Inventario de RRHH.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Dashboard RRHH
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{empresa.nombre}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Personal, vacaciones y asistencia de esta empresa. Usuario:{" "}
          {session.username}
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
      <p className="text-xs text-[var(--muted)]">
        Próximamente en este mismo panel: planillas, descuentos y prestaciones.
      </p>
    </div>
  );
}
