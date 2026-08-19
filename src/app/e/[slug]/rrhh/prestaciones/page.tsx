"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TIPOS_DEVENGADO } from "@/lib/rrhh/catalogos-nomina";

type Emp = { id: number; codigo: string; nombre: string };

export default function PrestacionesPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [aviso, setAviso] = useState("");
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState("Bono");
  const [tipoOtro, setTipoOtro] = useState("");
  const [monto, setMonto] = useState(0);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [e, p] = await Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/rrhh/prestaciones`).then((r) => r.json()),
    ]);
    setEmpleados(e.empleados ?? []);
    setRows(p.prestaciones ?? []);
    setAviso(p.aviso ?? "");
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const tipoFinal = tipo === "Otro" ? tipoOtro.trim() : tipo;
    if (!tipoFinal) {
      setMsg("Escribe el tipo de devengado en 'Otro'.");
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/rrhh/prestaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, tipo: tipoFinal, monto, fecha, notas }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setMonto(0);
      setNotas("");
      setTipoOtro("");
      await cargar();
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Prestaciones</h1>
        <p className="text-sm text-[var(--muted)]">
          Bonos y prestaciones por empleado.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>
      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
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
        <select
          className={input}
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          {TIPOS_DEVENGADO.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {tipo === "Otro" ? (
          <input
            className={input}
            placeholder="Especifica el tipo"
            value={tipoOtro}
            onChange={(e) => setTipoOtro(e.target.value)}
            required
          />
        ) : null}
        <input
          type="number"
          step="0.01"
          min={0}
          className={`${input} w-28`}
          value={monto}
          onChange={(e) => setMonto(Number(e.target.value))}
        />
        <input
          type="date"
          className={input}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <input
          className={input}
          placeholder="Notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Guardar
        </button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li
            key={String(r.id)}
            className="rounded border border-[var(--border)] px-3 py-2"
          >
            {String(r.emp_codigo)} — {String(r.tipo)} · Q{String(r.monto)} ·{" "}
            {String(r.fecha).slice(0, 10)}
          </li>
        ))}
        {!rows.length ? (
          <li className="text-[var(--muted)]">Sin prestaciones.</li>
        ) : null}
      </ul>
    </div>
  );
}
