"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CLIENTE_TIPOS,
  type Cliente,
  type ClienteEstado,
  type ClienteTipo,
} from "@/lib/clientes/tipos";
import { ClientesImportador } from "@/components/clientes/clientes-importador";

type Props = { slug: string; puedeEditar: boolean };

type FormState = {
  codigo: string;
  nombre: string;
  razonSocial: string;
  nit: string;
  rtu: string;
  telefono: string;
  email: string;
  direccion: string;
  contactoNombre: string;
  contactoTelefono: string;
  tipo: ClienteTipo;
  estado: ClienteEstado;
  notas: string;
};

const vacio: FormState = {
  codigo: "",
  nombre: "",
  razonSocial: "",
  nit: "",
  rtu: "",
  telefono: "",
  email: "",
  direccion: "",
  contactoNombre: "",
  contactoTelefono: "",
  tipo: "comercial",
  estado: "Activo",
  notas: "",
};

export function ClientesClient({ slug, puedeEditar }: Props) {
  const [vista, setVista] = useState<"listado" | "nuevo" | "importar">("listado");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [estado, setEstado] = useState("Activo");
  const [form, setForm] = useState<FormState>(vacio);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (qDebounced.trim()) params.set("q", qDebounced.trim());
      if (estado) params.set("estado", estado);
      const res = await fetch(
        `/api/empresas/${slug}/clientes?${params.toString()}`,
      );
      const data = await res.json();
      if (res.ok) setClientes(data.clientes ?? []);
      else setMsg(data.error || "No se pudo cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, qDebounced, estado]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function editar(c: Cliente) {
    setEditId(c.id);
    setForm({
      codigo: c.codigo ?? "",
      nombre: c.nombre,
      razonSocial: c.razonSocial ?? "",
      nit: c.nit ?? "",
      rtu: c.rtu ?? "",
      telefono: c.telefono ?? "",
      email: c.email ?? "",
      direccion: c.direccion ?? "",
      contactoNombre: c.contactoNombre ?? "",
      contactoTelefono: c.contactoTelefono ?? "",
      tipo: c.tipo,
      estado: c.estado,
      notas: c.notas ?? "",
    });
    setVista("nuevo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!puedeEditar || saving) return;
    setSaving(true);
    setMsg("");
    try {
      const payload = {
        codigo: form.codigo || null,
        nombre: form.nombre,
        razonSocial: form.razonSocial || null,
        nit: form.nit || null,
        rtu: form.rtu || null,
        telefono: form.telefono || null,
        email: form.email || null,
        direccion: form.direccion || null,
        contactoNombre: form.contactoNombre || null,
        contactoTelefono: form.contactoTelefono || null,
        tipo: form.tipo,
        estado: form.estado,
        notas: form.notas || null,
      };
      const res = await fetch(
        editId
          ? `/api/empresas/${slug}/clientes/${editId}`
          : `/api/empresas/${slug}/clientes`,
        {
          method: editId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      setMsg(data.mensaje || data.error || "");
      if (res.ok) {
        setForm(vacio);
        setEditId(null);
        await cargar();
        setVista("listado");
      }
    } finally {
      setSaving(false);
    }
  }

  function exportHref(formato: "xlsx" | "pdf") {
    const params = new URLSearchParams({ formato, estado });
    if (q.trim()) params.set("q", q.trim());
    return `/api/empresas/${slug}/clientes/export?${params.toString()}`;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Catálogo compartido
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Clientes</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Misma fuente para Operaciones (KT / Mónaco), Facturación y Contabilidad.
          Los clientes se sincronizan automáticamente con TMS para planes de viaje.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        <button
          type="button"
          onClick={() => setVista("listado")}
          className={`rounded-lg px-3 py-2 text-sm ${vista === "listado" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
        >
          Ver clientes
        </button>
        {puedeEditar ? (
          <>
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                setForm(vacio);
                setVista("nuevo");
              }}
              className={`rounded-lg px-3 py-2 text-sm ${vista === "nuevo" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
            >
              Crear cliente
            </button>
            <button
              type="button"
              onClick={() => setVista("importar")}
              className={`rounded-lg px-3 py-2 text-sm ${vista === "importar" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
            >
              Importar Excel
            </button>
          </>
        ) : null}
      </div>

      {puedeEditar && vista === "nuevo" ? (
        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              {editId ? "Editar cliente" : "Nuevo cliente"}
            </h2>
            {editId ? (
              <button
                type="button"
                className="text-xs text-[var(--muted)] underline"
                onClick={() => {
                  setEditId(null);
                  setForm(vacio);
                }}
              >
                Cancelar edición
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Código interno (automático si se deja vacío)"
              value={form.codigo}
              onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm sm:col-span-2"
              placeholder="Nombre *"
              required
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm sm:col-span-2"
              placeholder="Razón social"
              value={form.razonSocial}
              onChange={(e) =>
                setForm({ ...form, razonSocial: e.target.value })
              }
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="NIT"
              value={form.nit}
              onChange={(e) => setForm({ ...form, nit: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Número de RTU"
              value={form.rtu}
              onChange={(e) => setForm({ ...form, rtu: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Teléfono"
              value={form.telefono}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm sm:col-span-2 lg:col-span-3"
              placeholder="Dirección"
              value={form.direccion}
              onChange={(e) => setForm({ ...form, direccion: e.target.value })}
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Contacto"
              value={form.contactoNombre}
              onChange={(e) =>
                setForm({ ...form, contactoNombre: e.target.value })
              }
            />
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Tel. contacto"
              value={form.contactoTelefono}
              onChange={(e) =>
                setForm({ ...form, contactoTelefono: e.target.value })
              }
            />
            <select
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              value={form.tipo}
              onChange={(e) =>
                setForm({
                  ...form,
                  tipo: e.target.value as ClienteTipo,
                })
              }
            >
              {CLIENTE_TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              value={form.estado}
              onChange={(e) =>
                setForm({
                  ...form,
                  estado: e.target.value as ClienteEstado,
                })
              }
            >
              <option value="Activo">Activo</option>
              <option value="Inactivo">Inactivo</option>
            </select>
            <textarea
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm sm:col-span-2 lg:col-span-3"
              rows={2}
              placeholder="Notas"
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
            >
              {saving ? "Guardando…" : editId ? "Actualizar" : "Crear cliente"}
            </button>
          </div>
        </form>
      ) : null}

      {puedeEditar && vista === "importar" ? (
        <ClientesImportador
          slug={slug}
          onImported={async () => {
            await cargar();
            setVista("listado");
          }}
        />
      ) : null}

      {msg ? <p className="text-sm text-emerald-600 dark:text-emerald-300">{msg}</p> : null}

      {vista === "listado" ? (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">Listado de clientes</h2>
              <p className="text-xs text-[var(--muted)]">Consulta, filtra, edita o exporta el catálogo actual.</p>
            </div>
            <div className="flex gap-2">
              <a href={exportHref("xlsx")} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs">Exportar Excel</a>
              <a href={exportHref("pdf")} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs">Exportar PDF</a>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[200px] flex-1 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Buscar nombre, NIT, RTU o código…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            >
              <option value="Activo">Activos</option>
              <option value="Inactivo">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
          </div>

          {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando clientes…</p>
      ) : (
        <div className="table-scroll rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">NIT / RTU</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Contacto</th>
                {puedeEditar ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-mono text-xs">{c.codigo || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.nombre}</div>
                    {c.razonSocial ? (
                      <div className="text-xs text-[var(--muted)]">
                        {c.razonSocial}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{c.nit ? `NIT: ${c.nit}` : "NIT: —"}</div>
                    <div className="text-[var(--muted)]">{c.rtu ? `RTU: ${c.rtu}` : "RTU: —"}</div>
                  </td>
                  <td className="px-3 py-2">{c.tipo}</td>
                  <td className="px-3 py-2 text-xs">
                    {c.telefono || c.email || "—"}
                  </td>
                  {puedeEditar ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-xs text-[var(--accent)] underline"
                        onClick={() => editar(c)}
                      >
                        Editar
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!clientes.length ? (
                <tr>
                  <td
                    colSpan={puedeEditar ? 6 : 5}
                    className="px-3 py-6 text-center text-[var(--muted)]"
                  >
                    No hay clientes con este filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
