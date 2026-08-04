"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
  categoriaOps: string;
  tipoHorario: string;
  fechaAlta: string;
  fechaInicioLaboral: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: string;
};

const emptyForm = {
  codigo: "",
  nombre: "",
  puesto: "",
  categoriaOps: "",
  tipoHorario: "Fijo" as "Fijo" | "Variable",
  fechaAlta: new Date().toISOString().slice(0, 10),
  fechaInicioLaboral: "",
  horaEntradaTeorica: "08:00",
  horaSalidaTeorica: "17:00",
  estado: "Activo" as "Activo" | "Baja",
};

export default function EmpleadosPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(
      `/api/empresas/${slug}/empleados?q=${encodeURIComponent(q)}`,
    );
    const data = await res.json();
    if (res.ok) setEmpleados(data.empleados ?? []);
  }, [slug, q]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function empezarEdicion(e: Emp) {
    setEditId(e.id);
    setForm({
      codigo: e.codigo,
      nombre: e.nombre,
      puesto: e.puesto,
      categoriaOps: e.categoriaOps,
      tipoHorario: e.tipoHorario === "Variable" ? "Variable" : "Fijo",
      fechaAlta: e.fechaAlta || new Date().toISOString().slice(0, 10),
      fechaInicioLaboral: e.fechaInicioLaboral || "",
      horaEntradaTeorica: (e.horaEntradaTeorica || "08:00:00").slice(0, 5),
      horaSalidaTeorica: (e.horaSalidaTeorica || "17:00:00").slice(0, 5),
      estado: e.estado === "Baja" ? "Baja" : "Activo",
    });
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMensaje("");
    const url = editId
      ? `/api/empresas/${slug}/empleados/${editId}`
      : `/api/empresas/${slug}/empleados`;
    const res = await fetch(url, {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        fechaInicioLaboral: form.fechaInicioLaboral || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMensaje(data.mensaje);
    setForm(emptyForm);
    setEditId(null);
    await cargar();
  }

  async function borrar(id: number) {
    if (!confirm("¿Eliminar empleado y su historial?")) return;
    const res = await fetch(`/api/empresas/${slug}/empleados/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    setMensaje(data.mensaje || data.error);
    await cargar();
  }

  const input =
    "mt-1 w-full rounded-lg border border-[var(--border)] bg-[#0b1217] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Personal / Empleados</h1>
        <p className="text-sm text-[var(--muted)]">
          Alta, edición y baja. Las vacaciones se calculan con la{" "}
          <strong className="font-medium text-white">fecha de contratación</strong>
          , no con la de entrada laboral.{" "}
          <Link
            href={`/e/${slug}/dashboard-rrhh`}
            className="text-[var(--accent)] underline"
          >
            Dashboard RRHH
          </Link>
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <p className="sm:col-span-2 lg:col-span-3 text-sm font-medium">
          {editId ? `Editando #${editId}` : "Nuevo empleado"}
        </p>
        <label className="text-sm text-[var(--muted)]">
          Código
          <input
            className={input}
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Nombre
          <input
            className={input}
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Puesto
          <input
            className={input}
            value={form.puesto}
            onChange={(e) => setForm({ ...form, puesto: e.target.value })}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Categoría ops
          <select
            className={input}
            value={form.categoriaOps}
            onChange={(e) => setForm({ ...form, categoriaOps: e.target.value })}
          >
            <option value="">—</option>
            <option value="Piloto">Piloto</option>
            <option value="Auxiliar">Auxiliar</option>
            <option value="Bodega">Bodega</option>
            <option value="Administrativo">Administrativo</option>
            <option value="Otro">Otro</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha entrada laboral
          <span className="mt-0.5 block text-[10px] opacity-80">
            Cuando empieza a trabajar (opcional)
          </span>
          <input
            type="date"
            className={input}
            value={form.fechaInicioLaboral}
            onChange={(e) =>
              setForm({ ...form, fechaInicioLaboral: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha contratación / alta
          <span className="mt-0.5 block text-[10px] text-emerald-400/80">
            Contrato — base para vacaciones
          </span>
          <input
            type="date"
            className={input}
            value={form.fechaAlta}
            onChange={(e) => setForm({ ...form, fechaAlta: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Horario
          <select
            className={input}
            value={form.tipoHorario}
            onChange={(e) =>
              setForm({
                ...form,
                tipoHorario: e.target.value as "Fijo" | "Variable",
              })
            }
          >
            <option value="Fijo">Fijo</option>
            <option value="Variable">Variable</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Entrada teórica
          <input
            type="time"
            className={input}
            value={form.horaEntradaTeorica}
            onChange={(e) =>
              setForm({ ...form, horaEntradaTeorica: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Salida teórica
          <input
            type="time"
            className={input}
            value={form.horaSalidaTeorica}
            onChange={(e) =>
              setForm({ ...form, horaSalidaTeorica: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Estado
          <select
            className={input}
            value={form.estado}
            onChange={(e) =>
              setForm({
                ...form,
                estado: e.target.value as "Activo" | "Baja",
              })
            }
          >
            <option value="Activo">Activo</option>
            <option value="Baja">Baja</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
          >
            {editId ? "Guardar cambios" : "Crear"}
          </button>
          {editId ? (
            <button
              type="button"
              className="rounded-lg bg-[#334155] px-4 py-2 text-sm"
              onClick={() => {
                setEditId(null);
                setForm(emptyForm);
              }}
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {mensaje ? <p className="text-sm text-emerald-300">{mensaje}</p> : null}

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-[var(--border)] bg-[#0b1217] px-3 py-2 text-sm"
          placeholder="Buscar por nombre o código…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0d1522] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2">Cat.</th>
              <th className="px-3 py-2">Entrada lab.</th>
              <th className="px-3 py-2">Contratación</th>
              <th className="px-3 py-2">Horario</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {empleados.map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{e.codigo}</td>
                <td className="px-3 py-2">{e.nombre}</td>
                <td className="px-3 py-2">{e.puesto || "—"}</td>
                <td className="px-3 py-2">{e.categoriaOps || "—"}</td>
                <td className="px-3 py-2">{e.fechaInicioLaboral || "—"}</td>
                <td className="px-3 py-2">{e.fechaAlta || "—"}</td>
                <td className="px-3 py-2">
                  {e.tipoHorario} {e.horaEntradaTeorica?.slice(0, 5)}
                </td>
                <td className="px-3 py-2">{e.estado}</td>
                <td className="px-3 py-2 space-x-2 whitespace-nowrap">
                  <button
                    type="button"
                    className="text-[var(--accent-2)] underline"
                    onClick={() => empezarEdicion(e)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="text-red-300 underline"
                    onClick={() => void borrar(e.id)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
