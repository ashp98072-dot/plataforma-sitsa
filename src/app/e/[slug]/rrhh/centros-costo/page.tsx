"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type CentroCosto = {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  empleadosActivos: number;
};

export default function CentrosCostoPage() {
  const slug = String(useParams().slug);
  const [rows, setRows] = useState<CentroCosto[]>([]);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editCodigo, setEditCodigo] = useState("");
  const [editNombre, setEditNombre] = useState("");

  const cargar = useCallback(async () => {
    const params = incluirInactivos ? "?incluirInactivos=1" : "";
    const res = await fetch(`/api/empresas/${slug}/rrhh/centros-costo${params}`);
    const data = await res.json();
    setRows(data.centrosCosto ?? []);
  }, [slug, incluirInactivos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/centros-costo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, nombre }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setCodigo("");
      setNombre("");
      await cargar();
    }
  }

  function startEdit(c: CentroCosto) {
    setEditId(c.id);
    setEditCodigo(c.codigo);
    setEditNombre(c.nombre);
  }

  async function saveEdit(id: number) {
    const res = await fetch(`/api/empresas/${slug}/rrhh/centros-costo/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: editCodigo, nombre: editNombre }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setEditId(null);
      await cargar();
    }
  }

  async function toggleActivo(c: CentroCosto) {
    if (c.activo) {
      const res = await fetch(`/api/empresas/${slug}/rrhh/centros-costo/${c.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      setMsg(data.mensaje || data.error);
    } else {
      const res = await fetch(`/api/empresas/${slug}/rrhh/centros-costo/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: true }),
      });
      const data = await res.json();
      setMsg(data.mensaje || data.error);
    }
    await cargar();
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Centros de Costo</h1>
        <p className="text-sm text-[var(--muted)]">
          Administra los centros de costo de la empresa.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <input
          className={input}
          placeholder="Código"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          required
        />
        <input
          className={`${input} flex-1 min-w-[160px]`}
          placeholder="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Crear
        </button>
      </form>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <input
          type="checkbox"
          checked={incluirInactivos}
          onChange={(e) => setIncluirInactivos(e.target.checked)}
        />
        Incluir inactivos
      </label>

      <ul className="space-y-1 text-sm">
        {rows.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-3 py-2"
          >
            {editId === c.id ? (
              <div className="flex flex-1 flex-wrap gap-2">
                <input
                  className={input}
                  value={editCodigo}
                  onChange={(e) => setEditCodigo(e.target.value)}
                />
                <input
                  className={`${input} flex-1 min-w-[160px]`}
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.target.value)}
                />
                <button
                  onClick={() => saveEdit(c.id)}
                  className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white"
                >
                  Guardar
                </button>
                <button
                  onClick={() => setEditId(null)}
                  className="rounded border border-[var(--border)] px-3 py-1 text-xs"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <span className={c.activo ? "" : "text-[var(--muted)] line-through"}>
                  {c.codigo} — {c.nombre} · {c.empleadosActivos} empleado(s)
                  {!c.activo ? " (inactivo)" : ""}
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => startEdit(c)}
                    className="rounded border border-[var(--border)] px-3 py-1 text-xs"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActivo(c)}
                    className="rounded border border-[var(--border)] px-3 py-1 text-xs"
                  >
                    {c.activo ? "Desactivar" : "Activar"}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {!rows.length ? (
          <li className="text-[var(--muted)]">Sin centros de costo.</li>
        ) : null}
      </ul>
    </div>
  );
}