"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Entrevista = {
  id: number;
  candidatoNombre: string;
  candidatoTelefono: string | null;
  candidatoEmail: string | null;
  puesto: string;
  fechaHora: string;
  modalidad: "Presencial" | "Virtual";
  lugarOEnlace: string | null;
  estado: "Programada" | "Realizada" | "Cancelada" | "No asistió";
  resultado: "Pendiente" | "Aprobado" | "Rechazado";
  notas: string | null;
};

const ESTADO_COLOR: Record<Entrevista["estado"], string> = {
  Programada: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  Realizada: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Cancelada: "bg-red-500/20 text-red-300 border-red-500/40",
  "No asistió": "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

function fmtFechaHora(iso: string): string {
  const [fecha, hora] = iso.split("T");
  return `${fecha} · ${hora?.slice(0, 5) ?? ""}`;
}

export default function EntrevistaCard({ entrevista }: { entrevista: Entrevista }) {
  const router = useRouter();
  const [estado, setEstado] = useState(entrevista.estado);
  const [resultado, setResultado] = useState(entrevista.resultado);
  const [notas, setNotas] = useState(entrevista.notas ?? "");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");
  const [abierto, setAbierto] = useState(false);

  async function guardar() {
    setGuardando(true);
    setMsg("");
    const res = await fetch("/api/portal/entrevistas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entrevista.id, estado, resultado, notas }),
    });
    const data = await res.json();
    setGuardando(false);
    setMsg(data.mensaje || data.error || "");
    if (res.ok) {
      router.refresh();
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {entrevista.candidatoNombre} — {entrevista.puesto}
          </p>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {fmtFechaHora(entrevista.fechaHora)} · {entrevista.modalidad}
            {entrevista.lugarOEnlace ? ` · ${entrevista.lugarOEnlace}` : ""}
          </p>
          {entrevista.candidatoTelefono || entrevista.candidatoEmail ? (
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {[entrevista.candidatoTelefono, entrevista.candidatoEmail]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-xs ${ESTADO_COLOR[entrevista.estado]}`}
        >
          {entrevista.estado}
        </span>
      </div>

      {abierto ? (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap gap-2">
            <label className="text-sm text-[var(--muted)]">
              Estado
              <select
                className={`${input} mt-1 block`}
                value={estado}
                onChange={(e) => setEstado(e.target.value as Entrevista["estado"])}
              >
                <option value="Programada">Programada</option>
                <option value="Realizada">Realizada</option>
                <option value="Cancelada">Cancelada</option>
                <option value="No asistió">No asistió</option>
              </select>
            </label>
            <label className="text-sm text-[var(--muted)]">
              Resultado
              <select
                className={`${input} mt-1 block`}
                value={resultado}
                onChange={(e) => setResultado(e.target.value as Entrevista["resultado"])}
              >
                <option value="Pendiente">Pendiente</option>
                <option value="Aprobado">Aprobado</option>
                <option value="Rechazado">Rechazado</option>
              </select>
            </label>
          </div>
          <label className="block text-sm text-[var(--muted)]">
            Notas de la entrevista
            <textarea
              className={`${input} mt-1 block w-full`}
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Impresiones, observaciones, siguiente paso…"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-60"
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded border border-[var(--border)] px-3 py-1 text-sm"
            >
              Cerrar
            </button>
            {msg ? <span className="text-sm text-emerald-300">{msg}</span> : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-3 text-sm text-[var(--accent)] underline"
        >
          Marcar resultado / agregar notas
        </button>
      )}
    </div>
  );
}