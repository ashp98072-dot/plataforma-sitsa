"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EstadoDisponibilidad,
  ResumenDisponibilidad,
  VehiculoDisponibilidad,
} from "@/lib/operaciones/disponibilidad";

type Filtro =
  | "todos"
  | "disponible"
  | "en_taller"
  | "en_ruta"
  | "inactivo"
  | "propios"
  | "compartidos";

const LABEL_ESTADO: Record<EstadoDisponibilidad, string> = {
  disponible: "Disponible",
  en_taller: "En taller",
  en_ruta: "En ruta",
  inactivo: "Inactivo",
};

function badgeClass(estado: EstadoDisponibilidad): string {
  switch (estado) {
    case "disponible":
      return "bg-emerald-900/50 text-emerald-200";
    case "en_taller":
      return "bg-amber-900/50 text-amber-200";
    case "en_ruta":
      return "bg-sky-900/50 text-sky-200";
    case "inactivo":
      return "bg-rose-900/40 text-rose-200";
    default:
      return "bg-[var(--input)] text-[var(--muted)]";
  }
}

type Props = { slug: string };

/**
 * UI liviana de Operaciones: disponibilidad de unidades.
 * Independiente de flota-client (no acopla ni rompe Predios).
 */
export function DisponibilidadClient({ slug }: Props) {
  const [vehiculos, setVehiculos] = useState<VehiculoDisponibilidad[]>([]);
  const [resumen, setResumen] = useState<ResumenDisponibilidad | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/operaciones/disponibilidad`,
      );
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "No se pudo cargar disponibilidad");
        return;
      }
      setVehiculos((data.vehiculos ?? []) as VehiculoDisponibilidad[]);
      setResumen((data.resumen ?? null) as ResumenDisponibilidad | null);
    } catch {
      setErr("Error de conexión al cargar disponibilidad.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/[\s-]/g, "");
    return vehiculos.filter((v) => {
      if (filtro === "disponible" && v.estadoDisponibilidad !== "disponible") {
        return false;
      }
      if (filtro === "en_taller" && v.estadoDisponibilidad !== "en_taller") {
        return false;
      }
      if (filtro === "en_ruta" && v.estadoDisponibilidad !== "en_ruta") {
        return false;
      }
      if (filtro === "inactivo" && v.estadoDisponibilidad !== "inactivo") {
        return false;
      }
      if (filtro === "propios" && !v.esPropio) return false;
      if (filtro === "compartidos" && !v.compartido) return false;
      if (!s) return true;
      const placa = v.placa.toLowerCase().replace(/[\s-]/g, "");
      const extra = `${v.marca ?? ""} ${v.modelo ?? ""} ${v.descripcion ?? ""} ${v.empresaDuenaNombre ?? ""}`.toLowerCase();
      return placa.includes(s) || extra.includes(s);
    });
  }, [vehiculos, q, filtro]);

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Operaciones
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            Disponibilidad de flota
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Unidades propias y compartidas a disposición de esta empresa:
            activas, inactivas, en taller o en ruta. Úsalo para saber qué
            puedes programar en planes / rutas.
          </p>
        </div>
        <button
          type="button"
          className="rounded bg-[#334155] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={loading}
          onClick={() => void cargar()}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {err ? (
        <p className="text-sm text-rose-300">{err}</p>
      ) : null}

      {resumen ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {(
            [
              ["Total", resumen.total, "todos"],
              ["Disponibles", resumen.disponibles, "disponible"],
              ["En taller", resumen.enTaller, "en_taller"],
              ["En ruta", resumen.enRuta, "en_ruta"],
              ["Inactivos", resumen.inactivos, "inactivo"],
              ["Propios", resumen.propios, "propios"],
              ["Compartidos", resumen.compartidos, "compartidos"],
            ] as const
          ).map(([label, n, key]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFiltro(key)}
              className={[
                "rounded-xl border px-3 py-2 text-left transition",
                filtro === key
                  ? "border-[var(--accent)] bg-[var(--card)]"
                  : "border-[var(--border)] bg-[var(--card)]/60 hover:border-[var(--accent)]/60",
              ].join(" ")}
            >
              <p className="text-[11px] text-[var(--muted)]">{label}</p>
              <p className="text-lg font-semibold tabular-nums">{n}</p>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Buscar placa / marca / empresa
          <input
            className={`${input} mt-1 block min-w-[220px]`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej. C-035BXR"
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Filtro
          <select
            className={`${input} mt-1 block`}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
          >
            <option value="todos">Todos</option>
            <option value="disponible">Solo disponibles</option>
            <option value="en_taller">En taller</option>
            <option value="en_ruta">En ruta</option>
            <option value="inactivo">Inactivos</option>
            <option value="propios">Propios de la empresa</option>
            <option value="compartidos">Compartidos</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#334155] text-xs uppercase text-white">
            <tr>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Detalle</th>
              <th className="px-3 py-2">Km</th>
              <th className="px-3 py-2">¿Puede enviarse?</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((v) => (
              <tr
                key={v.id}
                className="border-t border-[var(--border)] bg-[var(--card)]"
              >
                <td className="px-3 py-2">
                  <span className="font-mono font-semibold text-sky-300">
                    {v.placa}
                  </span>
                  {v.compartido ? (
                    <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">
                      compartida
                    </span>
                  ) : null}
                  <p className="text-[11px] text-[var(--muted)]">
                    {[v.marca, v.modelo].filter(Boolean).join(" · ") ||
                      v.descripcion ||
                      "—"}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badgeClass(v.estadoDisponibilidad)}`}
                  >
                    {LABEL_ESTADO[v.estadoDisponibilidad]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--muted)]">
                  {v.esPropio
                    ? "Propia"
                    : v.empresaDuenaNombre ||
                      v.empresaDuenaCodigo ||
                      "Compartida"}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--muted)]">
                  {v.viajeAbierto ? (
                    <>
                      Piloto: {v.viajeAbierto.pilotoNombre}
                      {v.viajeAbierto.destino
                        ? ` · ${v.viajeAbierto.destino}`
                        : ""}
                    </>
                  ) : (
                    v.motivoNoDisponible || "Lista para plan / ruta"
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {v.kmActual.toLocaleString("es-GT")}
                </td>
                <td className="px-3 py-2">
                  {v.puedeEnviar ? (
                    <span className="text-emerald-300">Sí</span>
                  ) : (
                    <span className="text-rose-300">No</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtrados.length && !loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                >
                  Sin unidades con este filtro.
                </td>
              </tr>
            ) : null}
            {loading && !vehiculos.length ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                >
                  Cargando disponibilidad…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
