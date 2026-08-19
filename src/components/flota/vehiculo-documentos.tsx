"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
  slug: string;
  vehiculoId: number;
  can: (
    sub: string,
    accion?: "ver" | "crear" | "editar" | "eliminar",
  ) => boolean;
};

type TipoDocumento =
  | "TarjetaCirculacion"
  | "PolizaSeguro"
  | "TituloPropiedad"
  | "PermisoLinea"
  | "Otro";

type Documento = {
  id: number;
  tipo: TipoDocumento;
  titulo: string | null;
  estado: "Vigente" | "Inactivo";
  fechaVencimiento: string | null;
  notas: string | null;
  archivo: { nombreOriginal: string; mime: string | null; tamano: number } | null;
  url: string | null;
  subidoPor: string | null;
  creadoAt: string;
};

const TIPO_LABEL: Record<TipoDocumento, string> = {
  TarjetaCirculacion: "Tarjeta de circulación",
  PolizaSeguro: "Póliza de seguro",
  TituloPropiedad: "Título de propiedad / factura",
  PermisoLinea: "Permiso de línea / operación",
  Otro: "Otro",
};

const input =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

function emptyForm() {
  return {
    tipo: "TarjetaCirculacion" as TipoDocumento,
    titulo: "",
    estado: "Vigente" as "Vigente" | "Inactivo",
    fechaVencimiento: "",
    notas: "",
  };
}

function vencePronto(fechaVencimiento: string | null): "vencido" | "pronto" | null {
  if (!fechaVencimiento) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  const dias = Math.round(
    (new Date(`${fechaVencimiento}T12:00:00Z`).getTime() -
      new Date(`${hoy}T12:00:00Z`).getTime()) /
      86400000,
  );
  if (dias < 0) return "vencido";
  if (dias <= 30) return "pronto";
  return null;
}

export function VehiculoDocumentos({ slug, vehiculoId, can }: Props) {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);

  const base = `/api/empresas/${slug}/flota/vehiculos/${vehiculoId}/documentos`;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar la papelería.");
      setDocs(data.documentos ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir() {
    if (!can("flota_vehiculos", "crear")) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const fd = new FormData();
      fd.append("tipo", form.tipo);
      if (form.tipo === "Otro" && form.titulo.trim()) {
        fd.append("titulo", form.titulo.trim());
      }
      fd.append("estado", form.estado);
      if (form.fechaVencimiento) fd.append("fechaVencimiento", form.fechaVencimiento);
      if (form.notas.trim()) fd.append("notas", form.notas.trim());
      if (file) fd.append("file", file);

      const res = await fetch(base, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar.");
      setMsg(data.mensaje ?? "Guardado.");
      setForm(emptyForm());
      setFile(null);
      setFileKey((k) => k + 1);
      setMostrarForm(false);
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function cambiarEstado(d: Documento) {
    if (!can("flota_vehiculos", "editar")) return;
    const nuevo = d.estado === "Vigente" ? "Inactivo" : "Vigente";
    const res = await fetch(`${base}/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "No se pudo actualizar.");
      return;
    }
    await cargar();
  }

  async function eliminar(d: Documento) {
    if (!can("flota_vehiculos", "eliminar")) return;
    if (!confirm(`¿Eliminar "${TIPO_LABEL[d.tipo]}"? Esto no se puede deshacer.`)) {
      return;
    }
    const res = await fetch(`${base}/${d.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? "No se pudo eliminar.");
      return;
    }
    setMsg(data.mensaje ?? "Eliminado.");
    await cargar();
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Papelería del vehículo</h3>
        {can("flota_vehiculos", "crear") ? (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? "Cancelar" : "+ Agregar documento"}
          </button>
        ) : null}
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      {mostrarForm ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-[var(--muted)]">
              Tipo de documento
              <select
                className={`${input} mt-1 block w-full`}
                value={form.tipo}
                onChange={(e) =>
                  setForm({ ...form, tipo: e.target.value as TipoDocumento })
                }
              >
                {Object.entries(TIPO_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {form.tipo === "Otro" ? (
              <label className="text-xs text-[var(--muted)]">
                Título (para "Otro")
                <input
                  className={`${input} mt-1 block w-full`}
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ej. Permiso municipal"
                />
              </label>
            ) : null}
            <label className="text-xs text-[var(--muted)]">
              Estado
              <select
                className={`${input} mt-1 block w-full`}
                value={form.estado}
                onChange={(e) =>
                  setForm({
                    ...form,
                    estado: e.target.value as "Vigente" | "Inactivo",
                  })
                }
              >
                <option value="Vigente">Vigente</option>
                <option value="Inactivo">Inactivo</option>
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Fecha de vencimiento (opcional)
              <input
                type="date"
                className={`${input} mt-1 block w-full`}
                value={form.fechaVencimiento}
                onChange={(e) =>
                  setForm({ ...form, fechaVencimiento: e.target.value })
                }
              />
            </label>
          </div>
          <label className="block text-xs text-[var(--muted)]">
            Archivo (opcional — puedes dejar solo un comentario sin subir nada)
            <input
              key={fileKey}
              type="file"
              accept="image/*,application/pdf"
              className={`${input} mt-1 block w-full`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Notas (ej. motivo de inactivación)
            <textarea
              className={`${input} mt-1 block w-full`}
              rows={2}
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              placeholder="Ej. Se desactivó la póliza porque…"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void subir()}
          >
            {saving ? "Guardando…" : "Guardar documento"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Sin documentos registrados todavía.
        </p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => {
            const alerta = vencePronto(d.fechaVencimiento);
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {d.tipo === "Otro" && d.titulo ? d.titulo : TIPO_LABEL[d.tipo]}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        d.estado === "Vigente"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-zinc-500/20 text-zinc-300"
                      }`}
                    >
                      {d.estado}
                    </span>
                    {alerta === "vencido" ? (
                      <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-300">
                        Vencido
                      </span>
                    ) : alerta === "pronto" ? (
                      <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                        Vence pronto
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {d.fechaVencimiento ? `Vence: ${d.fechaVencimiento}` : "Sin fecha de vencimiento"}
                    {d.archivo ? ` · ${d.archivo.nombreOriginal}` : " · Sin archivo adjunto"}
                  </p>
                  {d.notas ? (
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {d.notas}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.url ? (
         <a           
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--accent)] underline"
                    >
                      Ver archivo
                    </a>
                  ) : null}
                  {can("flota_vehiculos", "editar") ? (
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => void cambiarEstado(d)}
                    >
                      Marcar {d.estado === "Vigente" ? "Inactivo" : "Vigente"}
                    </button>
                  ) : null}
                  {can("flota_vehiculos", "eliminar") ? (
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:underline"
                      onClick={() => void eliminar(d)}
                    >
                      Eliminar
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}