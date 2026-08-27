"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/**
 * MULTAS-3.2 (sección 28) — bandeja RRHH: multas resueltas a cargo del
 * colaborador (COLABORADOR/COMPARTIDO) que todavía no tienen un descuento
 * real de planilla. RRHH configura periodicidad/cuotas/fecha y, en un solo
 * paso, se crea + autoriza + vincula el descuento (mismo motor de
 * src/lib/rrhh/descuentos.ts, sin duplicar lógica). Protegida por
 * rrhh:descuentos:crear en el backend — esta pantalla vive dentro de la
 * navegación existente de RRHH > Descuentos, no es una UI paralela.
 */

const PERIODICIDADES = [
  { value: "UNA_VEZ", label: "Una vez" },
  { value: "CADA_QUINCENA", label: "Cada quincena" },
  { value: "SOLO_QUINCENA_1", label: "Solo primera quincena de cada mes" },
  { value: "SOLO_QUINCENA_2", label: "Solo segunda quincena de cada mes" },
  { value: "CADA_N_QUINCENAS", label: "Cada N quincenas" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "MANUAL", label: "Manual (sin calendario automático)" },
] as const;

type Periodicidad = (typeof PERIODICIDADES)[number]["value"];

type MultaPendiente = {
  id: number;
  fecha_infraccion: string;
  placa_historica: string;
  tipo_multa: string;
  descripcion: string;
  empleado_responsable_id: number | null;
  empleado_responsable_nombre: string | null;
  monto_total: string;
  monto_colaborador: string;
  referencia_boleta: string | null;
  creado_en: string;
};

function formatQ(valor: string | number): string {
  return `Q${Number(valor).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const hoy = () => new Date().toISOString().slice(0, 10);

export default function MultasPendientesDescuentoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [multas, setMultas] = useState<MultaPendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState<{ periodicidad: Periodicidad; numeroCuotas: number; fechaInicio: string; cadaNQuincenas: string }>({
    periodicidad: "CADA_QUINCENA", numeroCuotas: 1, fechaInicio: hoy(), cadaNQuincenas: "1",
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/multas-pendientes`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar la bandeja.");
      setMultas(data.multas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la bandeja.");
    } finally {
      setCargando(false);
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function abrirConfiguracion(id: number) {
    setAbierta(id);
    setMsg("");
    setError("");
    setForm({ periodicidad: "CADA_QUINCENA", numeroCuotas: 1, fechaInicio: hoy(), cadaNQuincenas: "1" });
  }

  async function generarDescuento(id: number) {
    setGuardando(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        periodicidad: form.periodicidad,
        numeroCuotas: form.numeroCuotas,
        fechaInicio: form.fechaInicio,
      };
      if (form.periodicidad === "CADA_N_QUINCENAS") body.cadaNQuincenas = Number(form.cadaNQuincenas) || 1;
      const res = await fetch(`/api/empresas/${slug}/rrhh/multas-pendientes/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo generar el descuento.");
      setMsg(`Descuento ${data.codigo} creado y vinculado (${data.cuotasGeneradas} cuota(s)).`);
      setAbierta(null);
      setMultas((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el descuento.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Multas pendientes de descuento</h1>
        <p className="text-sm text-[var(--muted)]">
          Multas resueltas por Operaciones con monto a cargo del colaborador, todavía sin descuento real de planilla.{" "}
          <Link href={`/e/${slug}/rrhh/descuentos`} className="text-[var(--accent)] underline">
            Volver a Descuentos
          </Link>
        </p>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        {cargando ? (
          <p className="text-sm text-[var(--muted)]">Cargando…</p>
        ) : !multas.length ? (
          <p className="text-sm text-[var(--muted)]">No hay multas pendientes de generar descuento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Unidad</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Responsable</th>
                  <th className="py-2 pr-3">Monto total</th>
                  <th className="py-2 pr-3">A cargo del colaborador</th>
                  <th className="py-2 pr-3">Boleta</th>
                  <th className="py-2 pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {multas.map((m) => (
                  <>
                    <tr key={m.id} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-3">{m.fecha_infraccion}</td>
                      <td className="py-2 pr-3">{m.placa_historica}</td>
                      <td className="py-2 pr-3">{m.tipo_multa}</td>
                      <td className="py-2 pr-3">{m.empleado_responsable_nombre ?? "—"}</td>
                      <td className="py-2 pr-3">{formatQ(m.monto_total)}</td>
                      <td className="py-2 pr-3 font-medium">{formatQ(m.monto_colaborador)}</td>
                      <td className="py-2 pr-3">{m.referencia_boleta ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white"
                          onClick={() => (abierta === m.id ? setAbierta(null) : abrirConfiguracion(m.id))}
                        >
                          {abierta === m.id ? "Cerrar" : "Configurar descuento"}
                        </button>
                      </td>
                    </tr>
                    {abierta === m.id ? (
                      <tr key={`${m.id}-form`} className="border-t border-[var(--border)] bg-[var(--input)]/30">
                        <td colSpan={8} className="py-3 pr-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="text-xs text-[var(--muted)]">
                              Periodicidad
                              <select
                                className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                                value={form.periodicidad}
                                onChange={(e) => setForm((f) => ({ ...f, periodicidad: e.target.value as Periodicidad }))}
                              >
                                {PERIODICIDADES.map((p) => (
                                  <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                              </select>
                            </label>
                            {form.periodicidad !== "UNA_VEZ" && form.periodicidad !== "MANUAL" ? (
                              <label className="text-xs text-[var(--muted)]">
                                Número de cuotas
                                <input
                                  type="number" min={1} max={60}
                                  className="mt-0.5 block w-24 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                                  value={form.numeroCuotas}
                                  onChange={(e) => setForm((f) => ({ ...f, numeroCuotas: Number(e.target.value) || 1 }))}
                                />
                              </label>
                            ) : null}
                            {form.periodicidad === "CADA_N_QUINCENAS" ? (
                              <label className="text-xs text-[var(--muted)]">
                                Cada cuántas quincenas
                                <input
                                  type="number" min={1}
                                  className="mt-0.5 block w-24 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                                  value={form.cadaNQuincenas}
                                  onChange={(e) => setForm((f) => ({ ...f, cadaNQuincenas: e.target.value }))}
                                />
                              </label>
                            ) : null}
                            <label className="text-xs text-[var(--muted)]">
                              Fecha de inicio
                              <input
                                type="date"
                                className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                                value={form.fechaInicio}
                                onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={guardando}
                              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                              onClick={() => void generarDescuento(m.id)}
                            >
                              {guardando ? "Generando…" : "Crear y autorizar descuento"}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            Concepto: “Multa de tránsito” · Monto: {formatQ(m.monto_colaborador)} · Responsable: {m.empleado_responsable_nombre ?? "—"}
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
