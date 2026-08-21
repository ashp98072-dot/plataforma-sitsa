"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/**
 * Fase H1 — bandeja RRHH de horas extra. El registro sigue viviendo en
 * /portal/horas-extra (supervisor); aquí solo se aprueba/rechaza.
 */

const FILTROS = [
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "APROBADA", label: "Aprobadas" },
  { value: "RECHAZADA", label: "Rechazadas" },
  { value: "APLICADA_EN_PLANILLA", label: "Aplicadas" },
  { value: "TODOS", label: "Todos" },
] as const;
type Filtro = (typeof FILTROS)[number]["value"];

type Registro = {
  id: number;
  empleadoNombre: string;
  fecha: string;
  horas: number;
  tarifaHora: number;
  monto: number;
  motivo: string | null;
  registradoPorNombre: string;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "APLICADA_EN_PLANILLA" | null;
  autorizadoPor: string | null;
  autorizadoEn: string | null;
  motivoRechazo: string | null;
};

function q(n: number) {
  return n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE: "Pendiente",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  APLICADA_EN_PLANILLA: "Aplicada",
};
const COLOR_ESTADO: Record<string, string> = {
  PENDIENTE: "text-amber-300",
  APROBADA: "text-emerald-400",
  RECHAZADA: "text-red-400",
  APLICADA_EN_PLANILLA: "text-sky-400",
};

async function obtenerRegistros(
  slug: string,
  filtro: Filtro,
): Promise<{ ok: true; registros: Registro[]; aviso?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/empresas/${slug}/rrhh/horas-extra?estado=${filtro}`);
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "No se pudo cargar." };
    }
    return { ok: true, registros: data.registros ?? [], aviso: data.aviso };
  } catch {
    return { ok: false, error: "Error de conexión." };
  }
}

export default function HorasExtraAdminPage() {
  const slug = String(useParams().slug);
  const [filtro, setFiltro] = useState<Filtro>("PENDIENTE");
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  // Carga inicial + recarga al cambiar filtro — función local dentro del
  // efecto, con bandera `ignore` (mismo patrón que Programación/Descuentos).
  useEffect(() => {
    let ignore = false;
    (async () => {
      const r = await obtenerRegistros(slug, filtro);
      if (ignore) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRegistros(r.registros);
      setAviso(r.aviso ?? "");
    })();
    return () => {
      ignore = true;
    };
  }, [slug, filtro]);

  async function recargar() {
    const r = await obtenerRegistros(slug, filtro);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRegistros(r.registros);
    setAviso(r.aviso ?? "");
  }

  async function aprobar(id: number) {
    setBusyId(id);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/horas-extra/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "aprobar" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      setMsg(data.mensaje);
      await recargar();
    } finally {
      setBusyId(null);
    }
  }

  async function rechazar(id: number) {
    const motivo = window.prompt("Motivo del rechazo (obligatorio):");
    if (motivo == null) return;
    if (!motivo.trim()) {
      setError("Debes indicar un motivo para rechazar.");
      return;
    }
    setBusyId(id);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/horas-extra/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "rechazar", motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      setMsg(data.mensaje);
      await recargar();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Horas Extra</h1>
        <p className="text-sm text-[var(--muted)]">
          Aprobación de horas extra registradas por supervisores en el Portal.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>

      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFiltro(f.value)}
            className={[
              "rounded px-3 py-1 text-sm",
              filtro === f.value
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] hover:bg-white/5",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--card)] text-[var(--muted)]">
            <tr>
              <th className="px-2 py-2">Fecha</th>
              <th className="px-2 py-2">Empleado</th>
              <th className="px-2 py-2">Supervisor</th>
              <th className="px-2 py-2">Horas</th>
              <th className="px-2 py-2">Tarifa</th>
              <th className="px-2 py-2">Monto</th>
              <th className="px-2 py-2">Motivo</th>
              <th className="px-2 py-2">Estado</th>
              <th className="px-2 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="px-2 py-2">{r.fecha}</td>
                <td className="px-2 py-2">{r.empleadoNombre}</td>
                <td className="px-2 py-2">{r.registradoPorNombre}</td>
                <td className="px-2 py-2">{r.horas}</td>
                <td className="px-2 py-2">Q{q(r.tarifaHora)}</td>
                <td className="px-2 py-2 font-medium">Q{q(r.monto)}</td>
                <td className="px-2 py-2 text-xs">
                  {r.motivo || "—"}
                  {r.estado === "RECHAZADA" && r.motivoRechazo ? (
                    <div className="text-red-300">Rechazo: {r.motivoRechazo}</div>
                  ) : null}
                </td>
                <td
                  className={`px-2 py-2 text-xs font-medium ${
                    r.estado ? COLOR_ESTADO[r.estado] : "text-[var(--muted)]"
                  }`}
                >
                  {r.estado ? ETIQUETA_ESTADO[r.estado] : "Histórico"}
                </td>
                <td className="px-2 py-2">
                  {r.estado === "PENDIENTE" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void aprobar(r.id)}
                        className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Aprobar
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void rechazar(r.id)}
                        className="rounded bg-red-900/60 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        Rechazar
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!registros.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-[var(--muted)]">
                  Sin registros con este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
