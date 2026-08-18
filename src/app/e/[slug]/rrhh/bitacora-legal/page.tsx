"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EmpleadoPicker, type EmpOpt } from "@/components/rrhh/empleado-picker";

type TipoBitacoraLegal =
  | "Amonestacion"
  | "Suspension"
  | "Despido"
  | "GestionGeneral"
  | "Otro";

type Entrada = {
  id: number;
  tipo: TipoBitacoraLegal;
  fecha: string;
  descripcion: string;
  empleadoId: number | null;
  empleadoNombre?: string | null;
};

const TIPO_LABEL: Record<TipoBitacoraLegal, string> = {
  Amonestacion: "Amonestación",
  Suspension: "Suspensión",
  Despido: "Despido",
  GestionGeneral: "Gestión general",
  Otro: "Otro",
};

const TIPO_COLOR: Record<TipoBitacoraLegal, string> = {
  Amonestacion: "border-amber-500/40 text-amber-300",
  Suspension: "border-orange-500/40 text-orange-300",
  Despido: "border-red-500/40 text-red-300",
  GestionGeneral: "border-blue-500/40 text-blue-300",
  Otro: "border-[var(--border)]",
};

function vacio() {
  return {
    tipo: "GestionGeneral" as TipoBitacoraLegal,
    fecha: new Date().toISOString().slice(0, 10),
    descripcion: "",
    empleadoId: 0,
  };
}

export default function BitacoraLegalPage() {
  const slug = String(useParams().slug);
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [empleados, setEmpleados] = useState<EmpOpt[]>([]);
  const [form, setForm] = useState(vacio());
  const [filtroTipo, setFiltroTipo] = useState<TipoBitacoraLegal | "">("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const qs = filtroTipo ? `?tipo=${filtroTipo}` : "";
    const [b, e] = await Promise.all([
      fetch(`/api/empresas/${slug}/rrhh/bitacora-legal${qs}`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/empleados?estado=Activo`).then((r) => r.json()),
    ]);
    setEntradas(b.entradas ?? []);
    setEmpleados(e.empleados ?? []);
  }, [slug, filtroTipo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/bitacora-legal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: form.tipo,
        fecha: form.fecha,
        descripcion: form.descripcion,
        empleadoId: form.empleadoId || null,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error || "");
    if (res.ok) {
      setForm(vacio());
      await cargar();
    }
  }

  async function eliminar(id: number) {
    if (!confirm("¿Eliminar este registro de la bitácora legal? Esta acción no se puede deshacer.")) {
      return;
    }
    await fetch(`/api/empresas/${slug}/rrhh/bitacora-legal/${id}`, {
      method: "DELETE",
    });
    await cargar();
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bitácora Legal</h1>
        <p className="text-sm text-[var(--muted)]">
          Registro histórico de amonestaciones, suspensiones, despidos y
          gestiones legales de la empresa.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="text-lg font-medium">Nuevo registro</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select
            className={input}
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoBitacoraLegal })}
          >
            {(Object.keys(TIPO_LABEL) as TipoBitacoraLegal[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_LABEL[t]}
              </option>
            ))}
          </select>
          <input
            type="date"
            className={input}
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
            required
          />
        </div>

        <EmpleadoPicker
          empleados={empleados}
          value={form.empleadoId}
          onChange={(id) => setForm({ ...form, empleadoId: id })}
          label="Empleado relacionado (opcional — vacío = gestión general de la empresa)"
        />

        <textarea
          className={`${input} w-full`}
          placeholder="Descripción del hecho / gestión"
          rows={3}
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          required
        />

        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Registrar
        </button>
        {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      </form>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{entradas.length} registro(s)</h2>
        <select
          className={input}
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as TipoBitacoraLegal | "")}
        >
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_LABEL) as TipoBitacoraLegal[]).map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <ul className="space-y-2 text-sm">
        {entradas.map((e) => (
          <li
            key={e.id}
            className={`flex flex-wrap items-start justify-between gap-2 rounded border px-3 py-2 ${TIPO_COLOR[e.tipo]}`}
          >
            <div>
              <span className="rounded border border-current px-1.5 py-0.5 text-xs">
                {TIPO_LABEL[e.tipo]}
              </span>{" "}
              <span className="text-[var(--muted)]">{e.fecha}</span>
              {e.empleadoNombre ? ` · ${e.empleadoNombre}` : ""}
              <p className="mt-1 text-[var(--foreground)]">{e.descripcion}</p>
            </div>
            <button
              type="button"
              className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
              onClick={() => eliminar(e.id)}
            >
              Eliminar
            </button>
          </li>
        ))}
        {!entradas.length ? (
          <li className="text-[var(--muted)]">Sin registros.</li>
        ) : null}
      </ul>
    </div>
  );
}
