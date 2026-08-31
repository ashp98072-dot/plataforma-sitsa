"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEmpresaSession } from "@/lib/empresa-session";
import type { ResumenMensual } from "@/lib/rrhh/dashboard";

type Stats = {
  totalEmpleados: number;
  presentesHoy: number;
  ausentesHoy: number;
  enVacaciones: number;
  otrasIncidenciasHoy: number;
};

type SituacionHoy = {
  idEmpleado: number;
  codigo: string;
  nombre: string;
  situacion: "Sin marcaje" | "Vacaciones" | "Otra incidencia";
  detalle: string;
};


function fmtMes(iso: string): string {
  const [y, m] = iso.split("-");
  const nombres = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const idx = Number(m) - 1;
  return `${nombres[idx] ?? m} ${y}`;
}

function fmtQ(monto: number): string {
  return `Q${monto.toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function DashboardRrhhPage() {
  const slug = String(useParams().slug);
  return <DashboardRrhh key={slug} slug={slug} />;
}
function DashboardRrhh({ slug }: { slug: string }) {
  const { empresaNombre } = useEmpresaSession();

  const [stats, setStats] = useState<Stats | null>(null);
  const [resumenGerencial, setResumenGerencial] = useState<
    ResumenMensual[]
  >([]);
  const [situacionHoy, setSituacionHoy] = useState<SituacionHoy[] | null>(null);
  const [empresa, setEmpresa] = useState(empresaNombre);
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);
  const [mesSeleccionado, setMesSeleccionado] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/rrhh/dashboard`, { cache: "no-store", signal: controller.signal });
        const data = await res.json().catch(() => { throw new Error("Respuesta inválida del servidor al consultar indicadores."); });
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar los indicadores.");
        if (controller.signal.aborted) return;
        setStats(data.stats);
        setResumenGerencial(data.resumenGerencial ?? []);
        setSituacionHoy(data.situacionHoy ?? null);
        setAvisos(data.avisos ?? []);
        if (data.empresa) setEmpresa(String(data.empresa));
      } catch (e) {
        if (!controller.signal.aborted) {
          setStats(null); setResumenGerencial([]); setSituacionHoy(null); setAvisos([]);
          setError(e instanceof Error ? e.message : "Error de conexión.");
        }
      } finally {
        if (!controller.signal.aborted) setCargando(false);
      }
    })();
    return () => controller.abort();
  }, [slug, intento]);

  const mesActual =
    resumenGerencial.find((r) => r.mes === mesSeleccionado) ?? resumenGerencial[resumenGerencial.length - 1] ?? null;

  const mesAnterior =
    mesActual ? resumenGerencial[resumenGerencial.indexOf(mesActual) - 1] ?? null : null;

  const variacionCosto =
    mesActual?.netoNomina != null && mesAnterior?.netoNomina != null && mesAnterior.netoNomina > 0
      ? ((mesActual.netoNomina - mesAnterior.netoNomina) /
          mesAnterior.netoNomina) *
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
      href: `/e/${slug}/rrhh/entrevistas`,
      title: "Entrevistas",
      desc: "Calendario de entrevistas a candidatos.",
    },
    {
      href: `/e/${slug}/rrhh/recordatorios`,
      title: "Recordatorios",
      desc: "Vencimientos de contratos, licencias, obligaciones legales.",
    },
    {
      href: `/e/${slug}/rrhh/bitacora-legal`,
      title: "Bitácora Legal",
      desc: "Amonestaciones, suspensiones, despidos y gestiones.",
    },
    {
      href: `/e/${slug}/rrhh/configuracion`,
      title: "Configuración",
      desc: "Tolerancia y feriados.",
    },
    {
      href: `/e/${slug}/rrhh/ubicaciones-marcaje`,
      title: "Ubicaciones de marcaje",
      desc: "Predios y geocercas autorizadas para marcaje GPS.",
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
          Indicadores mensuales y situación del personal de esta empresa.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={cargando} onClick={() => { setCargando(true); setError(""); setIntento((i) => i + 1); }} className="rounded border border-[var(--border)] px-3 py-2">
          {cargando ? "Cargando indicadores…" : "Actualizar indicadores"}
        </button>
        {resumenGerencial.length > 0 && <label>Mes a consultar <select aria-label="Mes a consultar" className="rounded border border-[var(--border)] bg-[var(--input)] p-2" value={mesActual?.mes ?? ""} onChange={(e) => setMesSeleccionado(e.target.value)}>
          {resumenGerencial.map((r) => <option key={r.mes} value={r.mes}>{fmtMes(r.mes)}</option>)}
        </select></label>}
      </div>
      {error && <p role="alert">Indicadores no disponibles: {error} Los accesos a módulos siguen disponibles.</p>}
      {avisos.map((aviso) => <p key={aviso} role="alert">{aviso}</p>)}
      {!cargando && !error && !resumenGerencial.length && <p>Resumen mensual no disponible.</p>}

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Empleados activos", value: stats.totalEmpleados },
            { label: "Presentes (abiertos)", value: stats.presentesHoy },
            { label: "Sin marcar hoy", value: stats.ausentesHoy },
            { label: "En vacaciones", value: stats.enVacaciones },
            { label: "Otras incidencias", value: stats.otrasIncidenciasHoy },
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

      {situacionHoy !== null ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Situación del personal hoy</h2>
              <p className="text-xs text-[var(--muted)]">
                Personal sin marcaje y ausencias justificadas vigentes.
              </p>
            </div>
            <div className="flex gap-3 text-xs">
              <Link href={`/e/${slug}/rrhh/marcajes`} className="text-[var(--accent)] underline">
                Revisar marcajes
              </Link>
              <Link href={`/e/${slug}/rrhh/incidencias`} className="text-[var(--accent)] underline">
                Gestionar incidencias
              </Link>
            </div>
          </div>

          {situacionHoy.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                    <th className="pb-2 pr-4">Código</th>
                    <th className="pb-2 pr-4">Empleado</th>
                    <th className="pb-2 pr-4">Situación</th>
                    <th className="pb-2">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {situacionHoy.map((persona) => (
                    <tr key={persona.idEmpleado} className="border-b border-[var(--border)]/50">
                      <td className="py-2 pr-4 text-[var(--muted)]">{persona.codigo}</td>
                      <td className="py-2 pr-4">{persona.nombre}</td>
                      <td className="py-2 pr-4">
                        <span className={persona.situacion === "Sin marcaje" ? "text-[#e08a8a]" : "text-[#e8c468]"}>
                          {persona.situacion}
                        </span>
                      </td>
                      <td className="py-2">{persona.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#8fd4a0]">
              Todo el personal activo tiene marcaje y no hay ausencias vigentes.
            </p>
          )}
        </section>
      ) : null}

      {mesActual ? (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Dashboard gerencial · {fmtMes(mesActual.mes)}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">
                Contrataciones del mes seleccionado
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#8fd4a0]">
                {mesActual.altas == null ? "No disponible" : `+${mesActual.altas}`}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">
                Bajas del mes seleccionado
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#e08a8a]">
                {mesActual.bajas == null ? "No disponible" : `-${mesActual.bajas}`}
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs text-[var(--muted)]">
                Neto a pagar · planillas cerradas/pagadas
              </p>

              <p className="mt-1 text-2xl font-semibold">
                {mesActual.netoNomina == null ? "No disponible" : fmtQ(mesActual.netoNomina)}
              </p>

              {variacionCosto !== null ? (
                <p
                  className={`mt-1 text-xs ${
                    variacionCosto > 0
                      ? "text-[#e8c468]"
                      : "text-[#8fd4a0]"
                  }`}
                >
                  {variacionCosto > 0 ? "▲" : "▼"}{" "}
                  {Math.abs(variacionCosto).toFixed(1)}% vs.{" "}
                  {fmtMes(mesAnterior!.mes)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Sin dato del mes anterior para comparar.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm font-medium">Costo registrado en planilla</p>
            <p className="mt-1 text-2xl font-semibold">
              {mesActual.costoRegistrado == null ? "No disponible" : fmtQ(mesActual.costoRegistrado)}
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Ingresos antes de descuentos más IGSS patronal registrado. No es el costo empresarial total:
              excluye provisiones y gastos externos a planilla. Solo períodos Cerrados o Pagados,
              agrupados por su fecha de inicio. Neto a pagar no significa dinero ya entregado.
              El mes actual puede estar incompleto; la comparación es contra el mes anterior completo.
            </p>
          </div>

          <details open className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
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
                    <th className="pb-2 pr-4">Neto a pagar</th>
                    <th className="pb-2 pr-4">Costo registrado</th>
                    <th className="pb-2 pr-4">Amonest.</th>
                    <th className="pb-2 pr-4">Suspens.</th>
                    <th className="pb-2">Despidos</th>
                  </tr>
                </thead>

                <tbody>
                  {resumenGerencial.map((r) => (
                    <tr
                      key={r.mes}
                      className="border-b border-[var(--border)]/50"
                    >
                      <td className="py-1.5 pr-4">
                        {fmtMes(r.mes)}
                      </td>
                      <td className="py-1.5 pr-4 text-[#8fd4a0]">
                        {r.altas == null ? "No disponible" : `+${r.altas}`}
                      </td>
                      <td className="py-1.5 pr-4 text-[#e08a8a]">
                        {r.bajas == null ? "No disponible" : `-${r.bajas}`}
                      </td>
                      <td className="py-1.5 pr-4">
                        {r.netoNomina == null ? "No disponible" : fmtQ(r.netoNomina)}
                      </td>
                      <td className="py-1.5 pr-4">
                        {r.costoRegistrado == null ? "No disponible" : fmtQ(r.costoRegistrado)}
                      </td>
                      <td className="py-1.5 pr-4">
                        {r.amonestaciones ?? "No disponible"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {r.suspensiones ?? "No disponible"}
                      </td>
                      <td className="py-1.5">
                        {r.despidos ?? "No disponible"}
                      </td>
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
