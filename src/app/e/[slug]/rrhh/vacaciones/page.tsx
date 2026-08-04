"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string };
type Periodo = {
  id: number;
  anioLaboral: number;
  periodoInicio: string;
  periodoFin: string;
  diasOtorgados: number;
  diasDisponibles: number;
};

const TIPOS = [
  "Vacaciones",
  "A cuenta de Vacaciones",
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
] as const;

export default function VacacionesPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("Vacaciones");
  const [saldo, setSaldo] = useState<number | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [aviso, setAviso] = useState("");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dias, setDias] = useState("1");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) =>
      r.json(),
    );
    setEmpleados(e.empleados ?? []);
    const id = empleadoId || e.empleados?.[0]?.id || 0;
    if (!empleadoId && id) setEmpleadoId(id);
    const qs = id ? `?empleadoId=${id}` : "";
    const v = await fetch(`/api/empresas/${slug}/rrhh/vacaciones${qs}`).then(
      (r) => r.json(),
    );
    setRows(v.vacaciones ?? []);
    setSaldo(v.saldo ?? null);
    setPeriodos(v.periodos ?? []);
    setAviso(v.aviso ?? "");
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!fechaInicio || !fechaFin) return;
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/vacaciones/dias-habiles?inicio=${fechaInicio}&fin=${fechaFin}`,
      );
      const data = await res.json();
      if (res.ok && typeof data.dias === "number") setDias(String(data.dias));
    }, 300);
    return () => clearTimeout(t);
  }, [slug, fechaInicio, fechaFin]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMsg("");
    const diasNum = Number(dias);
    if (!Number.isFinite(diasNum) || diasNum <= 0) {
      setError("Días hábiles inválidos.");
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        fechaInicio,
        fechaFin,
        diasHabiles: diasNum,
        tipo,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(
      `${data.mensaje} · ${data.diasHabiles} día(s)` +
        (data.desglose?.length
          ? ` · FIFO: ${data.desglose.map((d: { diasTomados: number; periodoInicio: string }) => `${d.diasTomados}d ${d.periodoInicio}`).join(", ")}`
          : ""),
    );
    await cargar();
  }

  const usaSaldo =
    tipo === "Vacaciones" || tipo === "A cuenta de Vacaciones";
  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vacaciones / En Ruta</h1>
          <p className="text-sm text-[var(--muted)]">
            Misma lógica que Control de Asistencias: 15 días/periodo, FIFO,
            domingos y feriados no cuentan.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
            Vacaciones
          </span>
          <Link
            href={`/e/${slug}/rrhh/en-ruta`}
            className="rounded bg-[#334155] px-3 py-1.5 text-sm"
          >
            En Ruta →
          </Link>
        </div>
      </div>

      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}

      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="text-sm text-[var(--muted)]">
          Empleado
          <select
            className={`${input} mt-1 w-full`}
            value={empleadoId}
            onChange={(e) => setEmpleadoId(Number(e.target.value))}
          >
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} — {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Tipo
          <select
            className={`${input} mt-1 w-full`}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as (typeof TIPOS)[number])}
          >
            {TIPOS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Días hábiles
          <input
            className={`${input} mt-1 w-full`}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Desde
          <input
            type="date"
            className={`${input} mt-1 w-full`}
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Hasta
          <input
            type="date"
            className={`${input} mt-1 w-full`}
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
          />
        </label>
        <div className="flex items-end">
          <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white">
            {usaSaldo ? "Registrar (descuenta saldo)" : "Registrar permiso"}
          </button>
        </div>
      </form>

      {usaSaldo && saldo != null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <p>
            Saldo disponible:{" "}
            <span className="font-semibold text-emerald-300">{saldo}</span>{" "}
            día(s)
          </p>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            {periodos.map((p) => (
              <li key={p.id}>
                Año laboral {p.anioLaboral}: {p.diasDisponibles}/
                {p.diasOtorgados} · {p.periodoInicio} → {p.periodoFin}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li
            key={String(r.id)}
            className="rounded border border-[var(--border)] px-3 py-2"
          >
            {String(r.emp_codigo)} — {String(r.fecha_inicio).slice(0, 10)} →{" "}
            {String(r.fecha_fin).slice(0, 10)} ({String(r.dias_habiles)} d) ·{" "}
            {String(r.estado)}
          </li>
        ))}
      </ul>
    </div>
  );
}
