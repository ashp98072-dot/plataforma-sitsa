"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string };

/** Corrección RRHH (no kiosko). El personal usa /marcajes. */
export default function MarcajeManualPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) =>
      r.json(),
    );
    setEmpleados(e.empleados ?? []);
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function manual(tipo: "entrada" | "salida") {
    setError("");
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, fechaJornada: fecha, tipo }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Corrección manual RRHH</h1>
        <p className="text-sm text-[var(--muted)]">
          Para ajustar entradas/salidas. El marcaje diario del personal es el{" "}
          <Link
            href={`/e/${slug}/rrhh/marcajes`}
            className="text-[var(--accent)] underline"
          >
            kiosko
          </Link>
          .
        </p>
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <select
          className={input}
          value={empleadoId}
          onChange={(e) => setEmpleadoId(Number(e.target.value))}
        >
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.codigo} — {e.nombre}
            </option>
          ))}
        </select>
        <input
          type="date"
          className={input}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white"
          onClick={() => void manual("entrada")}
        >
          Entrada
        </button>
        <button
          type="button"
          className="rounded bg-[#334155] px-3 py-1 text-sm"
          onClick={() => void manual("salida")}
        >
          Salida
        </button>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
    </div>
  );
}
