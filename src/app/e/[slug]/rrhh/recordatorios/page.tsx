"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EmpleadoPicker, type EmpOpt } from "@/components/rrhh/empleado-picker";

type TipoRecordatorio =
  | "Contrato"
  | "ObligacionLegal"
  | "ExamenMedico"
  | "CitaLegal"
  | "Licencia"
  | "DocumentoVehiculo"
  | "Otro";

type Recordatorio = {
  id: number | null;
  tipo: TipoRecordatorio;
  titulo: string;
  fecha: string;
  recurrente: boolean;
  diasAvisoPrevio: number;
  empleadoId: number | null;
  empleadoNombre?: string | null;
  notas: string | null;
  atendido: boolean;
  diasRestantes: number;
};

const TIPO_LABEL: Record<TipoRecordatorio, string> = {
  Contrato: "Contrato",
  ObligacionLegal: "Obligación legal",
  ExamenMedico: "Examen médico",
  CitaLegal: "Cita legal / demanda",
  Licencia: "Licencia de conducir",
  DocumentoVehiculo: "Documento de vehículo",
  Otro: "Otro",
};

const TIPOS_CAPTURABLES: TipoRecordatorio[] = [
  "Contrato",
  "ObligacionLegal",
  "ExamenMedico",
  "CitaLegal",
  "Otro",
];

function vacio() {
  return {
    tipo: "Contrato" as TipoRecordatorio,
    titulo: "",
    fecha: new Date().toISOString().slice(0, 10),
    recurrente: false,
    diasAvisoPrevio: 7,
    empleadoId: 0,
    notas: "",
  };
}

function colorEstado(r: Recordatorio): string {
  if (r.atendido) return "border-[var(--border)] text-[var(--muted)]";
  if (r.diasRestantes < 0) return "border-red-500/40 text-red-300";
  if (r.diasRestantes <= r.diasAvisoPrevio) return "border-amber-500/40 text-amber-300";
  return "border-[var(--border)]";
}

function etiquetaDias(r: Recordatorio): string {
  if (r.diasRestantes === 0) return "Hoy";
  if (r.diasRestantes < 0) return `Vencido hace ${Math.abs(r.diasRestantes)} día(s)`;
  return `En ${r.diasRestantes} día(s)`;
}

export default function RecordatoriosPage() {
  const slug = String(useParams().slug);
  const [recordatorios, setRecordatorios] = useState<Recordatorio[]>([]);
  const [empleados, setEmpleados] = useState<EmpOpt[]>([]);
  const [form, setForm] = useState(vacio());
  const [msg, setMsg] = useState("");
  const [verAtendidos, setVerAtendidos] = useState(false);

  const cargar = useCallback(async () => {
    const [r, e] = await Promise.all([
      fetch(`/api/empresas/${slug}/rrhh/recordatorios`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/empleados?estado=Activo`).then((r) => r.json()),
    ]);
    setRecordatorios(r.recordatorios ?? []);
    setEmpleados(e.empleados ?? []);
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/recordatorios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: form.tipo,
        titulo: form.titulo,
        fecha: form.fecha,
        recurrente: form.recurrente,
        diasAvisoPrevio: form.diasAvisoPrevio,
        empleadoId: form.empleadoId || null,
        notas: form.notas || null,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error || "");
    if (res.ok) {
      setForm(vacio());
      await cargar();
    }
  }

  async function marcarAtendido(id: number) {
    await fetch(`/api/empresas/${slug}/rrhh/recordatorios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "marcarAtendido" }),
    });
    await cargar();
  }

  async function eliminar(id: number) {
    await fetch(`/api/empresas/${slug}/rrhh/recordatorios/${id}`, {
      method: "DELETE",
    });
    await cargar();
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  const visibles = recordatorios.filter((r) => verAtendidos || !r.atendido);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Recordatorios</h1>
        <p className="text-sm text-[var(--muted)]">
          Vencimientos y obligaciones con fecha. Las licencias de conducir se
          detectan automáticamente desde la ficha del empleado.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="text-lg font-medium">Nuevo recordatorio</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select
            className={input}
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoRecordatorio })}
          >
            {TIPOS_CAPTURABLES.map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </select>
          <input
            className={`${input} sm:col-span-2`}
            placeholder="Título (ej. Aguinaldo, Vence contrato de prueba…)"
            value={form.titulo}
            onChange={(e) => setForm({ ...form, titulo: e.target.value })}
            required
          />
          <input
            type="date"
            className={input}
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
            required
          />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={form.recurrente}
              onChange={(e) => setForm({ ...form, recurrente: e.target.checked })}
            />
            Se repite cada año en esta misma fecha
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Avisar con
            <input
              type="number"
              min={0}
              max={365}
              className={`${input} w-16`}
              value={form.diasAvisoPrevio}
              onChange={(e) =>
                setForm({ ...form, diasAvisoPrevio: Number(e.target.value) })
              }
            />
            día(s) de anticipación
          </label>
        </div>

        <EmpleadoPicker
          empleados={empleados}
          value={form.empleadoId}
          onChange={(id) => setForm({ ...form, empleadoId: id })}
          label="Empleado relacionado (opcional — vacío = recordatorio general de la empresa)"
        />

        <textarea
          className={`${input} w-full`}
          placeholder="Notas (opcional)"
          rows={2}
          value={form.notas}
          onChange={(e) => setForm({ ...form, notas: e.target.value })}
        />

        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Guardar
        </button>
        {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      </form>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          {visibles.length} recordatorio(s)
        </h2>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={verAtendidos}
            onChange={(e) => setVerAtendidos(e.target.checked)}
          />
          Ver también los atendidos
        </label>
      </div>

      <ul className="space-y-2 text-sm">
        {visibles.map((r) => (
          <li
            key={r.id ?? `licencia-${r.empleadoId}`}
            className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 ${colorEstado(r)}`}
          >
            <div>
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs">
                {TIPO_LABEL[r.tipo]}
              </span>{" "}
              <span className="font-medium">{r.titulo}</span>
              {r.empleadoNombre ? ` — ${r.empleadoNombre}` : ""}
              {r.recurrente ? " · anual" : ""}
              <div className="text-xs">
                {r.fecha} · {etiquetaDias(r)}
                {r.atendido ? " · Atendido" : ""}
                {r.notas ? ` · ${r.notas}` : ""}
              </div>
            </div>
            {r.id != null ? (
              <div className="flex gap-1">
                {!r.atendido ? (
                  <button
                    type="button"
                    className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300"
                    onClick={() => marcarAtendido(r.id!)}
                  >
                    Marcar atendido
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
                  onClick={() => eliminar(r.id!)}
                >
                  Eliminar
                </button>
              </div>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                Editar en la ficha del empleado
              </span>
            )}
          </li>
        ))}
        {!visibles.length ? (
          <li className="text-[var(--muted)]">Sin recordatorios pendientes.</li>
        ) : null}
      </ul>
    </div>
  );
}
