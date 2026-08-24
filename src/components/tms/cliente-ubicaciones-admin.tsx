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

type TipoUbicacion = "CARGA" | "ENTREGA" | "AMBOS";

type Ubicacion = {
  id: number;
  clienteId: number;
  nombre: string;
  direccion: string | null;
  municipio: string | null;
  departamento: string | null;
  referencia: string | null;
  tipo: TipoUbicacion;
  activo: boolean;
};

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const FORM_VACIO = {
  nombre: "",
  direccion: "",
  municipio: "",
  departamento: "",
  referencia: "",
  tipo: "AMBOS" as TipoUbicacion,
};

/**
 * VIAT-1b (punto 2) — administración de tms_cliente_ubicaciones: buscar
 * cliente (código/nombre/NIT, vía ClienteSearch ya existente), ver sus
 * ubicaciones (activas e inactivas), agregar, editar y activar/desactivar.
 * Nunca elimina filas — "dejar de usarse" es activo=false, para no perder
 * el histórico ni las paradas de viajes ya registrados que la referencian.
 */
export default function ClienteUbicacionesAdmin({
  slug,
  clientes,
}: {
  slug: string;
  clientes: ClienteOpt[];
}) {
  const [clienteId, setClienteId] = useState(0);
  const [clienteNombre, setClienteNombre] = useState("");
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
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
        setUbicaciones([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/clientes/${clienteId}/ubicaciones?todas=1`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(data.error ?? "No se pudieron cargar las ubicaciones.");
          return;
        }
        setUbicaciones((data.ubicaciones ?? []) as Ubicacion[]);
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

  function abrirNueva() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setMostrarForm(true);
  }

  function abrirEditar(u: Ubicacion) {
    setEditandoId(u.id);
    setForm({
      nombre: u.nombre,
      direccion: u.direccion ?? "",
      municipio: u.municipio ?? "",
      departamento: u.departamento ?? "",
      referencia: u.referencia ?? "",
      tipo: u.tipo,
    });
    setMostrarForm(true);
  }

  async function guardar() {
    if (!clienteId) return;
    const nombre = form.nombre.trim();
    if (!nombre) {
      setError("Indica un nombre/alias.");
      return;
    }
    setGuardando(true);
    setError("");
    setMsg("");
    try {
      const body = {
        nombre,
        direccion: form.direccion.trim() || undefined,
        municipio: form.municipio.trim() || undefined,
        departamento: form.departamento.trim() || undefined,
        referencia: form.referencia.trim() || undefined,
        tipo: form.tipo,
      };
      const res = editandoId
        ? await fetch(`/api/empresas/${slug}/tms/ubicaciones/${editandoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/empresas/${slug}/tms/clientes/${clienteId}/ubicaciones`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      const guardada = data.ubicacion as Ubicacion;
      setUbicaciones((list) => {
        const existe = list.some((u) => u.id === guardada.id);
        const next = existe ? list.map((u) => (u.id === guardada.id ? guardada : u)) : [...list, guardada];
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

  async function toggleActivo(u: Ubicacion) {
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/ubicaciones/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !u.activo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo actualizar.");
        return;
      }
      const actualizada = data.ubicacion as Ubicacion;
      setUbicaciones((list) => list.map((x) => (x.id === actualizada.id ? actualizada : x)));
    } catch {
      setError("Error de conexión.");
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-sm font-medium">Ubicaciones de clientes</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        Direcciones/sucursales guardadas por cliente, para armar paradas rápido en Programación.
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
                    <th className="px-2 py-1.5">Nombre/alias</th>
                    <th className="px-2 py-1.5">Dirección</th>
                    <th className="px-2 py-1.5">Municipio</th>
                    <th className="px-2 py-1.5">Departamento</th>
                    <th className="px-2 py-1.5">Tipo</th>
                    <th className="px-2 py-1.5">Estado</th>
                    <th className="px-2 py-1.5">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {ubicaciones.map((u) => (
                    <tr key={u.id} className={`border-t border-[var(--border)] ${u.activo ? "" : "opacity-50"}`}>
                      <td className="px-2 py-1.5">{u.nombre}</td>
                      <td className="px-2 py-1.5">{u.direccion || "—"}</td>
                      <td className="px-2 py-1.5">{u.municipio || "—"}</td>
                      <td className="px-2 py-1.5">{u.departamento || "—"}</td>
                      <td className="px-2 py-1.5">{u.tipo}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            u.activo ? "bg-emerald-900/50 text-emerald-200" : "bg-[var(--input)] text-[var(--muted)]"
                          }`}
                        >
                          {u.activo ? "Activa" : "Inactiva"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-2">
                          <button type="button" className="text-sky-300 hover:underline" onClick={() => abrirEditar(u)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className={u.activo ? "text-amber-300 hover:underline" : "text-emerald-300 hover:underline"}
                            onClick={() => void toggleActivo(u)}
                          >
                            {u.activo ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!ubicaciones.length ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-[var(--muted)]">
                        Sin ubicaciones guardadas para este cliente todavía.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          {!mostrarForm ? (
            <button type="button" className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" onClick={abrirNueva}>
              + Agregar ubicación
            </button>
          ) : (
            <div className="grid gap-2 rounded border border-[var(--border)] p-3 sm:grid-cols-3">
              <label className="text-xs text-[var(--muted)]">
                Nombre/alias
                <input
                  className={`${inputCls} mt-0.5 w-full`}
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[var(--muted)] sm:col-span-2">
                Dirección
                <input
                  className={`${inputCls} mt-0.5 w-full`}
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Municipio
                <input
                  className={`${inputCls} mt-0.5 w-full`}
                  value={form.municipio}
                  onChange={(e) => setForm((f) => ({ ...f, municipio: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Departamento
                <input
                  className={`${inputCls} mt-0.5 w-full`}
                  value={form.departamento}
                  onChange={(e) => setForm((f) => ({ ...f, departamento: e.target.value }))}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Tipo
                <select
                  className={`${inputCls} mt-0.5 w-full`}
                  value={form.tipo}
                  onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoUbicacion }))}
                >
                  <option value="AMBOS">Ambos</option>
                  <option value="CARGA">Carga</option>
                  <option value="ENTREGA">Entrega</option>
                </select>
              </label>
              <label className="text-xs text-[var(--muted)] sm:col-span-3">
                Referencia
                <input
                  className={`${inputCls} mt-0.5 w-full`}
                  value={form.referencia}
                  onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
                />
              </label>
              <div className="flex gap-2 sm:col-span-3">
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void guardar()}
                  className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Agregar"}
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--border)] px-3 py-1.5 text-xs"
                  onClick={() => setMostrarForm(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">Busca un cliente para ver/administrar sus ubicaciones.</p>
      )}
    </div>
  );
}
