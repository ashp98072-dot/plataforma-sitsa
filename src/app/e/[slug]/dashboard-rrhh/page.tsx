"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEmpresaSession } from "@/lib/empresa-session";

type Stats = {
  totalEmpleados: number;
  presentesHoy: number;
  ausentesHoy: number;
  enVacaciones: number;
};

type ResumenMensual = {
  mes: string;
  altas: number;
  bajas: number;
  costoNomina: number;
};

function fmtMes(iso: string): string {
  const [y, m] = iso.split("-");
  const nombres = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  const idx = Number(m) - 1;
  return `${nombres[idx] ?? m} ${y}`;
}

function fmtQ(monto: number): string {
  return `Q${monto.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DashboardRrhhPage() {
  const slug = String(useParams().slug);
  const { empresaNombre } = useEmpresaSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [resumenGerencial, setResumenGerencial] = useState<ResumenMensual[]>(
    [],
  );
  const [empresa, setEmpresa] = useState(empresaNombre);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/empresas/${slug}/rrhh/dashboard`);
      const data = await res.json();
      if (!res.ok || cancelled) return;
      setStats(data.stats);
      setResumenGerencial(data.resumenGerencial ?? []);
      if (data.empresa) setEmpresa(String(data.empresa));
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const mesActual = resumenGerencial[resumenGerencial.length - 1] ?? null;
  const mesAnterior = resumenGerencial[resumenGerencial.length - 2] ?? null;
  const variacionCosto =
    mesActual && mesAnterior && mesAnterior.costoNomina > 0
      ? ((mesActual.costoNomina - mesAnterior.costoNomina) /
          mesAnterior.costoNomina) *
        100
      : null;

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
      desc: "Nómina, pagos y cuadres (efectivo/cheque/transfer).",
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

      {mesActual ? (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Dashboard gerencial · {fmtMes(mesActual.mes)}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">Altas este mes</p>
              <p className="mt-1 text-2xl font-semibold text-[#8fd4a0]">
                +{mesActual.altas}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">Bajas este mes</p>
              <p className="mt-1 text-2xl font-semibold text-[#e08a8a]">
                -{mesActual.bajas}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">Costo de nómina</p>
              <p className="mt-1 text-2xl font-semibold">
                {fmtQ(mesActual.costoNomina)}
              </p>
              {variacionCosto !== null ? (
                <p
                  className={`mt-1 text-xs ${variacionCosto > 0 ? "text-[#e8c468]" : "text-[#8fd4a0]"}`}
                >
                  {variacionCosto > 0 ? "▲" : "▼"} {Math.abs(variacionCosto).toFixed(1)}%
                  {" "}vs. {fmtMes(mesAnterior!.mes)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Sin dato del mes anterior para comparar.
                </p>
              )}
            </div>
          </div>

          <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Últimos {resumenGerencial.length} meses
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                    <th className="pb-2 pr-4">Mes</th>
                    <th className="pb-2 pr-4">Altas</th>
                    <th className="pb-2 pr-4">Bajas</th>
                    <th className="pb-2">Costo nómina</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenGerencial.map((r) => (
                    <tr key={r.mes} className="border-b border-[var(--border)]/50">
                      <td className="py-1.5 pr-4">{fmtMes(r.mes)}</td>
                      <td className="py-1.5 pr-4 text-[#8fd4a0]">+{r.altas}</td>
                      <td className="py-1.5 pr-4 text-[#e08a8a]">-{r.bajas}</td>
                      <td className="py-1.5">{fmtQ(r.costoNomina)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            prefetch={false}
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
