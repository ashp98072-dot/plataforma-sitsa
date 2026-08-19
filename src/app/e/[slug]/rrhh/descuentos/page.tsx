"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CONCEPTOS_DESCUENTO } from "@/lib/rrhh/catalogos-nomina";

type Emp = { id: number; codigo: string; nombre: string };

export default function DescuentosPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [aviso, setAviso] = useState("");
  const [empleadoId, setEmpleadoId] = useState(0);
  const [concepto, setConcepto] = useState(CONCEPTOS_DESCUENTO[0] as string);
  const [conceptoOtro, setConceptoOtro] = useState("");
  const [monto, setMonto] = useState(0);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [e, d] = await Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/rrhh/descuentos`).then((r) => r.json()),
    ]);
    setEmpleados(e.empleados ?? []);
    setRows(d.descuentos ?? []);
    setAviso(d.aviso ?? "");
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const conceptoFinal =
      concepto === "Otro" ? conceptoOtro.trim() : concepto;
    if (!conceptoFinal) {
      setMsg("Escribe el concepto en 'Otro'.");
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/rrhh/descuentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        concepto: conceptoFinal,
        monto,
        fecha,
        notas,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setConcepto(CONCEPTOS_DESCUENTO[0] as string);
      setConceptoOtro("");
      setMonto(0);
      setNotas("");
      await cargar();
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Descuentos</h1>
        <p className="text-sm text-[var(--muted)]">
          Descuentos por empleado.{" "}
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
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
        >
          {CONCEPTOS_DESCUENTO.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {concepto === "Otro" ? (
          <input
            className={input}
            placeholder="Especifica el concepto"
            value={conceptoOtro}
            onChange={(e) => setConceptoOtro(e.target.value)}
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
            {String(r.emp_codigo)} — {String(r.concepto)} · Q{String(r.monto)} ·{" "}
            {String(r.fecha).slice(0, 10)}
          </li>
        ))}
        {!rows.length ? (
          <li className="text-[var(--muted)]">Sin descuentos.</li>
        ) : null}
      </ul>
    </div>
  );
}
