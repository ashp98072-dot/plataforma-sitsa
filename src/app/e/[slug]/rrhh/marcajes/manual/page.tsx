"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { horaAhora } from "@/lib/rrhh/dates";

type Emp = { id: number; codigo: string; nombre: string };

/** Corrección RRHH como Control de Asistencias: fecha + hora + guardar. */
export default function MarcajeManualPage() {
  const slug = String(useParams().slug);
  const router = useRouter();
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [buscar, setBuscar] = useState("");
  const [empleadoId, setEmpleadoId] = useState(0);
  const [codigo, setCodigo] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [hora, setHora] = useState(horaAhora());
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [correccion, setCorreccion] = useState<{
    entradaActual?: string;
    salidaActual?: string;
  } | null>(null);
  const [registros, setRegistros] = useState<Record<string, unknown>[]>([]);
  const [fechaFiltro, setFechaFiltro] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [allowed, setAllowed] = useState(false);

  const cargar = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.user?.rol === "Marcaje") {
      router.replace(`/e/${slug}/rrhh/marcajes`);
      return;
    }
    setAllowed(true);
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) =>
      r.json(),
    );
    setEmpleados(e.empleados ?? []);
  }, [slug, router]);

  const cargarRegistros = useCallback(async () => {
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/marcajes?desde=${fechaFiltro}&hasta=${fechaFiltro}`,
    );
    const data = await res.json();
    setRegistros(data.marcajes ?? []);
  }, [slug, fechaFiltro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void cargarRegistros();
  }, [cargarRegistros]);

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return empleados.slice(0, 80);
    return empleados
      .filter(
        (e) =>
          e.nombre.toLowerCase().includes(q) ||
          e.codigo.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [empleados, buscar]);

  useEffect(() => {
    if (empleadoId) {
      const e = empleados.find((x) => x.id === empleadoId);
      if (e) setCodigo(e.codigo);
    }
  }, [empleadoId, empleados]);

  async function enviar(correccionTipo?: "entrada" | "salida") {
    setError("");
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId: empleadoId || undefined,
        codigo: codigo || undefined,
        fechaJornada: fecha,
        hora,
        correccion: correccionTipo ?? null,
      }),
    });
    const data = await res.json();
    if (res.status === 409 && data.code === "NEEDS_CORRECTION") {
      setCorreccion({
        entradaActual: data.entradaActual,
        salidaActual: data.salidaActual,
      });
      setError(data.error);
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    setCorreccion(null);
    setFechaFiltro(fecha);
    await cargarRegistros();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await enviar();
  }

  const input =
    "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm";

  if (!allowed) {
    return (
      <p className="text-sm text-[var(--muted)]">Cargando…</p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Control de Asistencias Diarias (Modo Manual RRHH)
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Como el sistema original: fecha + hora del registro. El personal usa el{" "}
          <Link
            href={`/e/${slug}/rrhh/marcajes`}
            className="text-[var(--accent)] underline"
          >
            kiosko
          </Link>
          .
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="font-medium">Registrar / forzar marcaje manual</h2>

        <label className="block text-sm text-[var(--muted)]">
          Buscar por nombre
          <div className="mt-1 flex gap-2">
            <input
              className={`${input} mt-0`}
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Escribe parte del nombre…"
            />
          </div>
        </label>

        <label className="block text-sm text-[var(--muted)]">
          Seleccionar empleado
          <select
            className={input}
            value={empleadoId}
            onChange={(e) => setEmpleadoId(Number(e.target.value))}
          >
            <option value={0}>[ Realice una búsqueda ]</option>
            {filtrados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} ({e.codigo})
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-[var(--muted)]">
            Código interno
            <input
              className={input}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            Fecha del registro
            <input
              type="date"
              className={input}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            Hora del registro
            <input
              type="time"
              step={1}
              className={input}
              value={hora.length === 8 ? hora.slice(0, 8) : hora}
              onChange={(e) => {
                const v = e.target.value;
                setHora(v.length === 5 ? `${v}:00` : v);
              }}
              required
            />
          </label>
        </div>

        <p className="text-sm text-[var(--muted)]">
          Se registrará con fecha {fecha} a las {hora || "—"}
          {codigo ? ` · código ${codigo}` : " (ingresa un código)"}.
        </p>

        {correccion ? (
          <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 p-4 text-sm">
            <p>
              Ya existe un registro completo ese día.
              <br />
              Entrada: {correccion.entradaActual ?? "—"}
              <br />
              Salida: {correccion.salidaActual ?? "—"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-[var(--accent)] px-3 py-2 text-white"
                onClick={() => void enviar("entrada")}
              >
                Corregir entrada
              </button>
              <button
                type="button"
                className="rounded bg-[#6b3d8a] px-3 py-2 text-white"
                onClick={() => void enviar("salida")}
              >
                Corregir salida
              </button>
              <button
                type="button"
                className="rounded bg-[#37474F] px-3 py-2 text-white"
                onClick={() => setCorreccion(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

        <button
          type="submit"
          className="rounded bg-[#1B5E20] px-4 py-2 text-sm font-medium text-white"
        >
          Guardar Marcaje Manual
        </button>
      </form>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm text-[var(--muted)]">
            Filtrar por fecha jornada
            <input
              type="date"
              className={input}
              value={fechaFiltro}
              onChange={(e) => setFechaFiltro(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
            onClick={() => void cargarRegistros()}
          >
            Cargar registros
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2">Código</th>
                <th className="px-2 py-2">Empleado</th>
                <th className="px-2 py-2">Entrada</th>
                <th className="px-2 py-2">Salida</th>
                <th className="px-2 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {registros.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-[var(--muted)]">
                    Sin registros ese día.
                  </td>
                </tr>
              ) : (
                registros.map((r) => (
                  <tr
                    key={String(r.id)}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-2 py-1.5">{String(r.codigo ?? "")}</td>
                    <td className="px-2 py-1.5">{String(r.nombre ?? "")}</td>
                    <td className="px-2 py-1.5">
                      {String(r.entrada ?? "—")}
                    </td>
                    <td className="px-2 py-1.5">
                      {String(r.salida ?? "—")}
                    </td>
                    <td className="px-2 py-1.5">
                      {String(r.incidencia ?? r.estado ?? "")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
