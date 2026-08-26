"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TIPOS_DEVENGADO } from "@/lib/rrhh/catalogos-nomina";

type Emp = { id: number; codigo: string; nombre: string };
type Prestacion = {
  id: number;
  id_empleado: number;
  emp_codigo: string;
  emp_nombre: string;
  tipo: string;
  monto: number | string;
  fecha: string;
  notas: string | null;
};

export default function PrestacionesPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Prestacion[]>([]);
  const [editandoId, setEditandoId] = useState<number | null>(null);
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
    let cancelado = false;
    void Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/rrhh/prestaciones`).then((r) => r.json()),
    ]).then(([e, p]) => {
      if (cancelado) return;
      setEmpleados(e.empleados ?? []);
      setRows(p.prestaciones ?? []);
      setAviso(p.aviso ?? "");
      setEmpleadoId((actual) => actual || e.empleados?.[0]?.id || 0);
    });
    return () => {
      cancelado = true;
    };
  }, [slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const tipoFinal = tipo === "Otro" ? tipoOtro.trim() : tipo;
    if (!tipoFinal) {
      setMsg("Escribe el tipo de devengado en 'Otro'.");
      return;
    }
    const res = await fetch(
      editandoId
        ? `/api/empresas/${slug}/rrhh/prestaciones/${editandoId}`
        : `/api/empresas/${slug}/rrhh/prestaciones`,
      {
      method: editandoId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, tipo: tipoFinal, monto, fecha, notas }),
      },
    );
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setMonto(0);
      setNotas("");
      setTipoOtro("");
      setEditandoId(null);
      await cargar();
    }
  }

  function editar(row: Prestacion) {
    const esCatalogo = TIPOS_DEVENGADO.some((item) => item === row.tipo);
    setEditandoId(row.id);
    setEmpleadoId(row.id_empleado);
    setTipo(esCatalogo ? row.tipo : "Otro");
    setTipoOtro(esCatalogo ? "" : row.tipo);
    setMonto(Number(row.monto));
    setFecha(String(row.fecha).slice(0, 10));
    setNotas(row.notas ?? "");
    setMsg("");
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setMonto(0);
    setNotas("");
    setTipoOtro("");
  }

  async function anular(row: Prestacion) {
    const motivo = window.prompt(`Motivo para anular ${row.tipo} de ${row.emp_nombre}:`);
    if (!motivo) return;
    const res = await fetch(`/api/empresas/${slug}/rrhh/prestaciones/${row.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      if (editandoId === row.id) cancelarEdicion();
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
          {editandoId ? "Guardar cambios" : "Guardar"}
        </button>
        {editandoId ? (
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1 text-sm" onClick={cancelarEdicion}>
            Cancelar edición
          </button>
        ) : null}
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li
            key={String(r.id)}
            className="rounded border border-[var(--border)] px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {r.emp_codigo} — {r.emp_nombre} · {r.tipo} · Q{String(r.monto)} ·{" "}
                {String(r.fecha).slice(0, 10)}
              </span>
              {!r.tipo.startsWith("Anulada · ") ? (
                <span className="flex gap-2 text-xs">
                  <button type="button" onClick={() => editar(r)} className="text-[var(--accent)] underline">
                    Editar
                  </button>
                  <button type="button" onClick={() => void anular(r)} className="text-red-300 underline">
                    Anular
                  </button>
                </span>
              ) : (
                <span className="text-xs text-amber-300">Anulada</span>
              )}
            </div>
            {r.notas ? <p className="mt-1 text-xs text-[var(--muted)]">{r.notas}</p> : null}
          </li>
        ))}
        {!rows.length ? (
          <li className="text-[var(--muted)]">Sin prestaciones.</li>
        ) : null}
      </ul>
    </div>
  );
}
