"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EstadoBadge from "./estado-badge";

type RegistroEquipo = {
  id: number;
  empleadoNombre: string;
  fecha: string;
  horas: number;
  monto: number;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "APLICADA_EN_PLANILLA" | null;
  pagada: boolean;
};

function formatQ(valor: number): string {
  return `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Fase H4 — lista de "Registros de mi equipo" con acciones Aprobar/Rechazar
 * para los que están PENDIENTE. El backend (PATCH /api/portal/horas-extra/
 * [id]) vuelve a verificar la subordinación real vía empleado_supervisores
 * antes de aplicar cualquier cambio — estos botones son solo la UI, nunca
 * la única barrera.
 */
export default function EquipoRegistros({ registros }: { registros: RegistroEquipo[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function decidir(id: number, accion: "aprobar" | "rechazar") {
    let motivo: string | undefined;
    if (accion === "rechazar") {
      const m = window.prompt("Motivo del rechazo (obligatorio):");
      if (m == null) return;
      if (!m.trim()) {
        setError("Debes indicar un motivo para rechazar.");
        return;
      }
      motivo = m.trim();
    }
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/portal/horas-extra/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, motivo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo procesar la acción.");
        return;
      }
      router.refresh();
    } catch {
      setError("Error de conexión.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {registros.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <div>
            <p className="font-medium">{r.empleadoNombre}</p>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {r.fecha} · {r.horas} hora(s)
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">{formatQ(r.monto)}</p>
            <div className="mt-1">
              <EstadoBadge estado={r.estado} pagada={r.pagada} />
            </div>
            {r.estado === "PENDIENTE" ? (
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decidir(r.id, "aprobar")}
                  className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Aprobar
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void decidir(r.id, "rechazar")}
                  className="rounded bg-red-900/60 px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  Rechazar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
