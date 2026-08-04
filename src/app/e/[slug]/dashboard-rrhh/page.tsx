"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Stats = {
  totalEmpleados: number;
  presentesHoy: number;
  ausentesHoy: number;
  enVacaciones: number;
};

export default function DashboardRrhhPage() {
  const slug = String(useParams().slug);
  const [stats, setStats] = useState<Stats | null>(null);
  const [empresa, setEmpresa] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/empresas/${slug}/rrhh/dashboard`);
      const data = await res.json();
      if (res.ok) {
        setStats(data.stats);
        setEmpresa(data.empresa ?? "");
      }
    })();
  }, [slug]);

  const cards = [
    {
      href: `/e/${slug}/rrhh/empleados`,
      title: "Empleados",
      desc: "Alta, edición, baja y horarios.",
    },
    {
      href: `/e/${slug}/rrhh/marcajes`,
      title: "Registrar Marcaje",
      desc: "Kiosko por código y marcaje manual.",
    },
    {
      href: `/e/${slug}/rrhh/reportes`,
      title: "Historial / Reportes",
      desc: "Calendario, faltas, Excel.",
    },
    {
      href: `/e/${slug}/rrhh/vacaciones`,
      title: "Vacaciones",
      desc: "Saldo FIFO y días hábiles.",
    },
    {
      href: `/e/${slug}/rrhh/en-ruta`,
      title: "En Ruta",
      desc: "Personal Variable en viaje.",
    },
    {
      href: `/e/${slug}/rrhh/incidencias`,
      title: "Incidencias",
      desc: "Permisos y resumen operativo.",
    },
    {
      href: `/e/${slug}/rrhh/configuracion`,
      title: "Configuración",
      desc: "Tolerancia y feriados.",
    },
    {
      href: `/e/${slug}/rrhh/planillas`,
      title: "Planillas",
      desc: "Periodos de nómina.",
    },
    {
      href: `/e/${slug}/rrhh/descuentos`,
      title: "Descuentos",
      desc: "Descuentos por empleado.",
    },
    {
      href: `/e/${slug}/rrhh/prestaciones`,
      title: "Prestaciones",
      desc: "Bonos y prestaciones.",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Control de Asistencias · RRHH
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {empresa || "Dashboard RRHH"}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Mismos módulos del sistema de escritorio / web KuiqTrans, por empresa.
        </p>
      </div>

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Empleados activos", value: stats.totalEmpleados },
            { label: "Presentes (abiertos)", value: stats.presentesHoy },
            { label: "Sin marcar hoy", value: stats.ausentesHoy },
            { label: "En vacaciones", value: stats.enVacaciones },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <p className="text-xs text-[var(--muted)]">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
      ) : null}

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
