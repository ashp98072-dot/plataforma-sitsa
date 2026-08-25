"use client";

import { useEffect, useState } from "react";

type Solicitud = {
  id: number;
  codigo: string;
  nombre: string;
  dpi: string | null;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
};

type Saldo = {
  empleadoId: number;
  codigo: string;
  nombre: string;
  dpi: string | null;
  diasDisponibles: number;
};

type Alertas = {
  solicitudesPendientes: Solicitud[];
  colaboradoresConQuinceDias: Saldo[];
};

const VACIO: Alertas = {
  solicitudesPendientes: [],
  colaboradoresConQuinceDias: [],
};

function fecha(value: string) {
  const [anio, mes, dia] = value.slice(0, 10).split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : value;
}

export function VacacionesAlertasPanel({ slug }: { slug: string }) {
  const [data, setData] = useState<Alertas>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let activo = true;

    async function cargar() {
      try {
        const res = await fetch(
          `/api/empresas/${slug}/rrhh/vacaciones/alertas`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar las alertas.");
        if (activo) {
          setData({
            solicitudesPendientes: body.solicitudesPendientes ?? [],
            colaboradoresConQuinceDias:
              body.colaboradoresConQuinceDias ?? [],
          });
          setError("");
        }
      } catch (e) {
        if (activo) setError(e instanceof Error ? e.message : "Error al cargar.");
      } finally {
        if (activo) setCargando(false);
      }
    }

    const inicio = window.setTimeout(() => void cargar(), 0);
    const intervalo = window.setInterval(() => void cargar(), 150_000);
    return () => {
      activo = false;
      window.clearTimeout(inicio);
      window.clearInterval(intervalo);
    };
  }, [slug]);

  return (
    <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div>
        <h2 className="text-lg font-semibold">Pendientes de vacaciones</h2>
        <p className="text-sm text-[var(--muted)]">
          Solicitudes sin resolver y colaboradores activos con 15 días o más
          acumulados.
        </p>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {cargando ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}

      {!cargando ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <div className="flex items-center justify-between bg-[var(--input)] px-3 py-2">
              <h3 className="font-medium">Solicitudes pendientes</h3>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-sm text-amber-200">
                {data.solicitudesPendientes.length}
              </span>
            </div>
            {data.solicitudesPendientes.length ? (
              <div className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto">
                {data.solicitudesPendientes.map((s) => (
                  <div key={s.id} className="px-3 py-2 text-sm">
                    <p className="font-medium">{s.nombre}</p>
                    <p className="text-[var(--muted)]">
                      {s.codigo}{s.dpi ? ` · DPI ${s.dpi}` : ""}
                    </p>
                    <p>
                      {s.tipo} · {s.diasHabiles} día(s) · {fecha(s.fechaInicio)} al {fecha(s.fechaFin)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-4 text-sm text-[var(--muted)]">
                No hay solicitudes pendientes.
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <div className="flex items-center justify-between bg-[var(--input)] px-3 py-2">
              <h3 className="font-medium">15 días o más acumulados</h3>
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-sm text-red-200">
                {data.colaboradoresConQuinceDias.length}
              </span>
            </div>
            {data.colaboradoresConQuinceDias.length ? (
              <div className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto">
                {data.colaboradoresConQuinceDias.map((s) => (
                  <div key={s.empleadoId} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{s.nombre}</p>
                      <p className="text-[var(--muted)]">
                        {s.codigo}{s.dpi ? ` · DPI ${s.dpi}` : ""}
                      </p>
                    </div>
                    <strong className="whitespace-nowrap text-red-200">
                      {s.diasDisponibles.toLocaleString("es-GT", { maximumFractionDigits: 2 })} días
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-4 text-sm text-[var(--muted)]">
                Ningún colaborador activo tiene 15 días acumulados.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
