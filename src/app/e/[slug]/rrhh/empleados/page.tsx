"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useEmpresaActiva } from "@/lib/use-empresa-activa";

type Emp = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
  categoriaOps: string;
  tipoHorario: string;
  estado: string;
};

export default function EmpleadosPage() {
  const { slug, nombre: empresaNombre } = useEmpresaActiva();
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [puesto, setPuesto] = useState("");
  const [categoriaOps, setCategoriaOps] = useState("");
  const [tipoHorario, setTipoHorario] = useState<"Fijo" | "Variable">("Fijo");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/empleados`);
    const data = await res.json();
    if (res.ok) setEmpleados(data.empleados ?? []);
    else setError(data.error ?? "Error");
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMensaje("");
    const res = await fetch(`/api/empresas/${slug}/empleados`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, nombre, puesto, categoriaOps, tipoHorario }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMensaje(data.mensaje);
    setCodigo("");
    setNombre("");
    setPuesto("");
    setCategoriaOps("");
    await cargar();
  }

  const input =
    "mt-1 w-full rounded-md border border-[var(--border)] bg-[#0b1217] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Personal · {empresaNombre}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Alta y control de empleados de esta empresa. Los marcajes y vacaciones
          usan esta misma lista.{" "}
          <Link href="/select-empresa" className="text-[var(--accent)] underline">
            Cambiar empresa
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href={`/e/${slug}/rrhh/marcajes`}
          className="rounded-lg border border-[var(--border)] px-3 py-2 hover:border-[var(--accent)]"
        >
          Ir a marcajes →
        </Link>
        <Link
          href={`/e/${slug}/rrhh/vacaciones`}
          className="rounded-lg border border-[var(--border)] px-3 py-2 hover:border-[var(--accent)]"
        >
          Ir a vacaciones →
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <h2 className="font-medium">Alta de empleado</h2>
          <label className="mt-3 block text-sm text-[var(--muted)]">
            Código
            <input className={input} value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
          </label>
          <label className="mt-2 block text-sm text-[var(--muted)]">
            Nombre
            <input className={input} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <label className="mt-2 block text-sm text-[var(--muted)]">
            Puesto
            <input className={input} value={puesto} onChange={(e) => setPuesto(e.target.value)} />
          </label>
          <label className="mt-2 block text-sm text-[var(--muted)]">
            Categoría operativa (para TMS)
            <select
              className={input}
              value={categoriaOps}
              onChange={(e) => setCategoriaOps(e.target.value)}
            >
              <option value="">—</option>
              <option value="Piloto">Piloto</option>
              <option value="Auxiliar">Auxiliar</option>
              <option value="Bodega">Bodega</option>
              <option value="Administrativo">Administrativo</option>
              <option value="Otro">Otro</option>
            </select>
          </label>
          <label className="mt-2 block text-sm text-[var(--muted)]">
            Horario
            <select
              className={input}
              value={tipoHorario}
              onChange={(e) => setTipoHorario(e.target.value as "Fijo" | "Variable")}
            >
              <option value="Fijo">Fijo</option>
              <option value="Variable">Variable</option>
            </select>
          </label>
          {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
          {mensaje ? <p className="mt-2 text-sm text-emerald-300">{mensaje}</p> : null}
          <button type="submit" className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white">
            Guardar
          </button>
        </form>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium">Empleados ({empleados.length})</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-1 pr-3">Código</th>
                  <th className="py-1 pr-3">Nombre</th>
                  <th className="py-1 pr-3">Puesto</th>
                  <th className="py-1 pr-3">Cat. ops</th>
                  <th className="py-1 pr-3">Horario</th>
                  <th className="py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {empleados.map((e) => (
                  <tr key={e.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3">{e.codigo}</td>
                    <td className="py-2 pr-3">{e.nombre}</td>
                    <td className="py-2 pr-3">{e.puesto || "—"}</td>
                    <td className="py-2 pr-3">{e.categoriaOps || "—"}</td>
                    <td className="py-2 pr-3">{e.tipoHorario}</td>
                    <td className="py-2">{e.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
