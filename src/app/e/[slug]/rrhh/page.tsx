"use client";

import Link from "next/link";
import { useEmpresaActiva } from "@/lib/use-empresa-activa";

export default function RrhhHubPage() {
  const { slug, nombre: empresaNombre } = useEmpresaActiva();

  const cards = [
    {
      href: `/e/${slug}/rrhh/empleados`,
      title: "Personal / Empleados",
      desc: "Alta y control de personal. Base para marcajes y vacaciones.",
    },
    {
      href: `/e/${slug}/rrhh/marcajes`,
      title: "Marcajes / Asistencias",
      desc: "Entradas y salidas del personal de esta empresa.",
    },
    {
      href: `/e/${slug}/rrhh/vacaciones`,
      title: "Vacaciones",
      desc: "Solicitudes y control de vacaciones.",
    },
    {
      href: `/e/${slug}/rrhh/incidencias`,
      title: "Incidencias",
      desc: "Permisos, faltas y otras incidencias.",
    },
    {
      href: `/e/${slug}/rrhh/reportes`,
      title: "Reportes",
      desc: "Consultas y export Excel.",
    },
    {
      href: `/e/${slug}/rrhh/inventario`,
      title: "Inventario EPP",
      desc: "Útiles y equipo de RRHH (no logística).",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          RRHH · {empresaNombre}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Primero registra empleados en Personal; luego usa marcajes y vacaciones
          sobre esa misma base.{" "}
          <Link href="/rrhh" className="text-[var(--accent)] underline">
            Ver todas las empresas →
          </Link>
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
