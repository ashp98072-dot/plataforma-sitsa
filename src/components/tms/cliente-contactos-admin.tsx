"use client";

import { useEffect, useState } from "react";
import { ClienteSearch } from "@/components/tms/cliente-search";

type ClienteOpt = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

type Contacto = {
  id: number;
  clienteId: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
  activo: boolean;
};

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const FORM_VACIO = { nombre: "", cargo: "", telefono: "", email: "", observaciones: "" };

/**
 * VIAT-4 (punto 1) — administración de tms_cliente_contactos: buscar
 * cliente (mismo ClienteSearch ya usado en Ubicaciones), ver sus
 * contactos (activos e inactivos), agregar, editar y activar/desactivar.
 * Nunca elimina filas — "dejar de usarse" es activo=false, para no perder
 * el histórico ni las rutas que ya referencien un contacto.
 */
export default function ClienteContactosAdmin({
  slug,
  clientes,
}: {
  slug: string;
  clientes: ClienteOpt[];
}) {
  const [clienteId, setClienteId] = useState(0);
  const [clienteNombre, setClienteNombre] = useState("");
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!clienteId) {
        setContactos([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/clientes/${clienteId}/contactos?todas=1`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(data.error ?? "No se pudieron cargar los contactos.");
          return;
        }
        setContactos((data.contactos ?? []) as Contacto[]);
      } catch {
        if (!ignore) setError("Error de conexión.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug, clienteId]);

  function abrirNuevo() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setMostrarForm(true);
  }

  function abrirEditar(c: Contacto) {
    setEditandoId(c.id);
    setForm({
      nombre: c.nombre,
      cargo: c.cargo ?? "",
      telefono: c.telefono ?? "",
      email: c.email ?? "",
      observaciones: c.observaciones ?? "",
    });
    setMostrarForm(true);
  }

  async function guardar() {
    if (!clienteId) return;
    const nombre = form.nombre.trim();
    if (!nombre) {
      setError("Indica el nombre del contacto.");
      return;
    }
    setGuardando(true);
    setError("");
    setMsg("");
    try {
      const body = {
        nombre,
        cargo: form.cargo.trim() || undefined,
        telefono: form.telefono.trim() || undefined,
        email: form.email.trim() || undefined,
        observaciones: form.observaciones.trim() || undefined,
      };
      const res = editandoId
        ? await fetch(`/api/empresas/${slug}/tms/contactos/${editandoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/empresas/${slug}/tms/clientes/${clienteId}/contactos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      const guardado = data.contacto as Contacto;
      setContactos((list) => {
        const existe = list.some((c) => c.id === guardado.id);
        const next = existe ? list.map((c) => (c.id === guardado.id ? guardado : c)) : [...list, guardado];
        return next.sort((a, b) => a.nombre.localeCompare(b.nombre));
      });
      setMsg(data.mensaje ?? "Guardado.");
      setMostrarForm(false);
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(c: Contacto) {
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/contactos/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !c.activo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo actualizar.");
        return;
      }
      const actualizado = data.contacto as Contacto;
      setContactos((list) => list.map((x) => (x.id === actualizado.id ? actualizado : x)));
    } catch {
      setError("Error de conexión.");
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-sm font-medium">Contactos de clientes</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Supervisor, encargado de bodega, recepción, administración… un cliente puede tener varios.
        Se usan en Rutas y se muestran en Programación para facilitar la comunicación operativa.
      </p>

      <div className="mt-3 max-w-sm">
        <ClienteSearch
          clientes={clientes}
          valueNombre={clienteNombre}
          valueId={clienteId}
          inputClassName={inputCls}
          onChange={({ clienteId: id, clienteNombre: nombre }) => {
            setClienteId(id);
            setClienteNombre(nombre);
            setMostrarForm(false);
          }}
        />
      </div>

      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      {msg ? <p className="mt-2 text-xs text-emerald-400">{msg}</p> : null}

      {clienteId ? (
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="text-xs text-[var(--muted)]">Cargando…</p>
          ) : (
            <div className="overflow-x-auto rounded border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-black/20 text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-1.5">Nombre</th>
                    <th className="px-2 py-1.5">Cargo</th>
                    <th className="px-2 py-1.5">Teléfono</th>
                    <th className="px-2 py-1.5">Email</th>
                    <th className="px-2 py-1.5">Estado</th>
                    <th className="px-2 py-1.5">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {contactos.map((c) => (
                    <tr key={c.id} className={`border-t border-[var(--border)] ${c.activo ? "" : "opacity-50"}`}>
                      <td className="px-2 py-1.5">{c.nombre}</td>
                      <td className="px-2 py-1.5">{c.cargo || "—"}</td>
                      <td className="px-2 py-1.5">{c.telefono || "—"}</td>
                      <td className="px-2 py-1.5">{c.email || "—"}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            c.activo ? "bg-emerald-900/50 text-emerald-200" : "bg-[var(--input)] text-[var(--muted)]"
                          }`}
                        >
                          {c.activo ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-2">
                          <button type="button" className="text-sky-300 hover:underline" onClick={() => abrirEditar(c)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className={c.activo ? "text-amber-300 hover:underline" : "text-emerald-300 hover:underline"}
                            onClick={() => void toggleActivo(c)}
                          >
                            {c.activo ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!contactos.length ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-3 text-[var(--muted)]">
                        Sin contactos guardados para este cliente todavía.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {!mostrarForm ? (
            <button type="button" className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" onClick={abrirNuevo}>
              + Agregar contacto
            </button>
          ) : (
            <div className="grid gap-2 rounded border border-[var(--border)] p-3 sm:grid-cols-3">
              <label className="text-xs text-[var(--muted)]">
                Nombre
                <input className={`${inputCls} mt-0.5 w-full`} value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Cargo (texto libre)
                <input
                  className={`${inputCls} mt-0.5 w-full`}
                  placeholder="Ej. Supervisor, Encargado de bodega…"
                  value={form.cargo}
                  onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Teléfono
                <input className={`${inputCls} mt-0.5 w-full`} value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Email
                <input className={`${inputCls} mt-0.5 w-full`} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label className="text-xs text-[var(--muted)] sm:col-span-2">
                Observaciones
                <input className={`${inputCls} mt-0.5 w-full`} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} />
              </label>
              <div className="flex gap-2 sm:col-span-3">
                <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
                  {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Agregar"}
                </button>
                <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => setMostrarForm(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">Busca un cliente para ver/administrar sus contactos.</p>
      )}
    </div>
  );
}
