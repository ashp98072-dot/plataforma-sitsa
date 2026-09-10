"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1) — gestión del catálogo
 * de OPCIONES de tarifa de una ruta: crear, editar, activar/desactivar y
 * marcar predeterminada. Consume /tms/rutas/[id]/tarifas-opciones (no
 * duplica lógica: todo el trabajo real ocurre en ruta-tarifas.ts).
 *
 * Distinto del "Historial de tarifas" (append-only, solo lectura) que
 * sigue viviendo en su propio panel.
 */
export type RutaTarifaRow = {
  id: number;
  nombre: string;
  descripcion: string | null;
  monto: number;
  moneda: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
  predeterminada: boolean;
  observacion: string | null;
  actualizadoPorNombre: string | null;
  actualizadoEn: string;
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs";

function moneda(v: number, m: string): string {
  return `${m} ${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function RutaTarifasPanel({
  slug,
  rutaId,
  rutaCodigo,
  onCambio,
}: {
  slug: string;
  rutaId: number;
  rutaCodigo: string;
  /** Se llama tras cualquier cambio para que el listado de rutas recargue (tarifa_referencia puede haberse re-sincronizado). */
  onCambio?: () => void;
}) {
  const [tarifas, setTarifas] = useState<RutaTarifaRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [nueva, setNueva] = useState({ nombre: "", monto: "", vigenteDesde: "", vigenteHasta: "", descripcion: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ nombre: "", monto: "", vigenteDesde: "", vigenteHasta: "", descripcion: "", observacion: "" });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/rutas/${rutaId}/tarifas-opciones`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron cargar las tarifas.");
        return;
      }
      setTarifas((data.tarifas ?? []) as RutaTarifaRow[]);
    } catch {
      setError("Error de conexión.");
    } finally {
      setCargando(false);
    }
  }, [slug, rutaId]);

  useEffect(() => {
    // Carga remota inicial del catálogo de tarifas de la ruta — mismo
    // criterio que otros selectores/paneles del módulo (ruta-select.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function aplicar(fn: () => Promise<Response>) {
    setGuardando(true);
    setError("");
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar la acción.");
        return false;
      }
      setTarifas((data.tarifas ?? []) as RutaTarifaRow[]);
      onCambio?.();
      return true;
    } catch {
      setError("Error de conexión.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function crear() {
    const monto = Number(nueva.monto);
    if (!nueva.nombre.trim() || !Number.isFinite(monto) || monto < 0) {
      setError("Indica un nombre y un monto válido para la nueva tarifa.");
      return;
    }
    const ok = await aplicar(() =>
      fetch(`/api/empresas/${slug}/tms/rutas/${rutaId}/tarifas-opciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nueva.nombre.trim(),
          monto,
          descripcion: nueva.descripcion.trim() || undefined,
          vigenteDesde: nueva.vigenteDesde || undefined,
          vigenteHasta: nueva.vigenteHasta || undefined,
        }),
      }),
    );
    if (ok) setNueva({ nombre: "", monto: "", vigenteDesde: "", vigenteHasta: "", descripcion: "" });
  }

  function abrirEdicion(t: RutaTarifaRow) {
    setEditId(t.id);
    setEditForm({
      nombre: t.nombre,
      monto: String(t.monto),
      vigenteDesde: t.vigenteDesde,
      vigenteHasta: t.vigenteHasta ?? "",
      descripcion: t.descripcion ?? "",
      observacion: t.observacion ?? "",
    });
  }

  async function guardarEdicion() {
    const monto = Number(editForm.monto);
    if (!editForm.nombre.trim() || !Number.isFinite(monto) || monto < 0) {
      setError("Nombre o monto inválido.");
      return;
    }
    const ok = await aplicar(() =>
      fetch(`/api/empresas/${slug}/tms/rutas/${rutaId}/tarifas-opciones/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "editar",
          nombre: editForm.nombre.trim(),
          monto,
          descripcion: editForm.descripcion.trim() || null,
          observacion: editForm.observacion.trim() || null,
          vigenteDesde: editForm.vigenteDesde || undefined,
          vigenteHasta: editForm.vigenteHasta || null,
        }),
      }),
    );
    if (ok) setEditId(null);
  }

  function accion(id: number, accion: "activar" | "desactivar" | "predeterminada") {
    void aplicar(() =>
      fetch(`/api/empresas/${slug}/tms/rutas/${rutaId}/tarifas-opciones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      }),
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Tarifas de la ruta — {rutaCodigo}</p>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      {cargando ? (
        <p className="text-xs text-[var(--muted)]">Cargando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="pr-3">Nombre</th>
                <th className="pr-3">Monto</th>
                <th className="pr-3">Vigencia</th>
                <th className="pr-3">Estado</th>
                <th className="pr-3">Últ. cambio</th>
                <th className="pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tarifas.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]/40 align-top">
                  {editId === t.id ? (
                    <td colSpan={6} className="py-2">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[10px] text-[var(--muted)]">Nombre
                          <input className={`${inputCls} mt-0.5 block`} value={editForm.nombre} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} />
                        </label>
                        <label className="text-[10px] text-[var(--muted)]">Monto
                          <input type="number" min="0" step="0.01" className={`${inputCls} mt-0.5 block w-28`} value={editForm.monto} onChange={(e) => setEditForm((f) => ({ ...f, monto: e.target.value }))} />
                        </label>
                        <label className="text-[10px] text-[var(--muted)]">Vigente desde
                          <input type="date" className={`${inputCls} mt-0.5 block`} value={editForm.vigenteDesde} onChange={(e) => setEditForm((f) => ({ ...f, vigenteDesde: e.target.value }))} />
                        </label>
                        <label className="text-[10px] text-[var(--muted)]">Vigente hasta
                          <input type="date" className={`${inputCls} mt-0.5 block`} value={editForm.vigenteHasta} onChange={(e) => setEditForm((f) => ({ ...f, vigenteHasta: e.target.value }))} />
                        </label>
                        <label className="text-[10px] text-[var(--muted)]">Descripción
                          <input className={`${inputCls} mt-0.5 block`} value={editForm.descripcion} onChange={(e) => setEditForm((f) => ({ ...f, descripcion: e.target.value }))} />
                        </label>
                        <button type="button" disabled={guardando} className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] text-white" onClick={() => void guardarEdicion()}>Guardar</button>
                        <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-[11px]" onClick={() => setEditId(null)}>Cancelar</button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="py-1 pr-3">
                        {t.nombre}
                        {t.descripcion ? <span className="block text-[10px] text-[var(--muted)]">{t.descripcion}</span> : null}
                      </td>
                      <td className="py-1 pr-3">{moneda(t.monto, t.moneda)}</td>
                      <td className="py-1 pr-3">
                        {t.vigenteDesde.split("-").reverse().join("/")}
                        {t.vigenteHasta ? ` → ${t.vigenteHasta.split("-").reverse().join("/")}` : ""}
                      </td>
                      <td className="py-1 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${t.activa ? "bg-emerald-600" : "bg-slate-500"}`}>
                          {t.activa ? "Activa" : "Inactiva"}
                        </span>
                        {t.predeterminada ? <span className="ml-1 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white">Predeterminada</span> : null}
                      </td>
                      <td className="py-1 pr-3 text-[10px] text-[var(--muted)]">
                        {t.actualizadoEn}
                        {t.actualizadoPorNombre ? ` · ${t.actualizadoPorNombre}` : ""}
                      </td>
                      <td className="py-1 pr-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={guardando} className="text-sky-300 hover:underline" onClick={() => abrirEdicion(t)}>Editar</button>
                          {t.activa ? (
                            <button type="button" disabled={guardando} className="text-amber-300 hover:underline" onClick={() => accion(t.id, "desactivar")}>Desactivar</button>
                          ) : (
                            <button type="button" disabled={guardando} className="text-emerald-300 hover:underline" onClick={() => accion(t.id, "activar")}>Activar</button>
                          )}
                          {t.activa && !t.predeterminada ? (
                            <button type="button" disabled={guardando} className="text-slate-200 hover:underline" onClick={() => accion(t.id, "predeterminada")}>Hacer predeterminada</button>
                          ) : null}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {!tarifas.length ? (
                <tr><td colSpan={6} className="py-2 text-[var(--muted)]">Esta ruta aún no tiene tarifas en el catálogo.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)]/40 pt-2">
        <label className="text-[10px] text-[var(--muted)]">Nombre
          <input className={`${inputCls} mt-0.5 block`} placeholder="Ej. Tarifa normal" value={nueva.nombre} onChange={(e) => setNueva((f) => ({ ...f, nombre: e.target.value }))} />
        </label>
        <label className="text-[10px] text-[var(--muted)]">Monto (GTQ)
          <input type="number" min="0" step="0.01" className={`${inputCls} mt-0.5 block w-28`} value={nueva.monto} onChange={(e) => setNueva((f) => ({ ...f, monto: e.target.value }))} />
        </label>
        <label className="text-[10px] text-[var(--muted)]">Vigente desde
          <input type="date" className={`${inputCls} mt-0.5 block`} value={nueva.vigenteDesde} onChange={(e) => setNueva((f) => ({ ...f, vigenteDesde: e.target.value }))} />
        </label>
        <label className="text-[10px] text-[var(--muted)]">Vigente hasta
          <input type="date" className={`${inputCls} mt-0.5 block`} value={nueva.vigenteHasta} onChange={(e) => setNueva((f) => ({ ...f, vigenteHasta: e.target.value }))} />
        </label>
        <label className="text-[10px] text-[var(--muted)]">Descripción
          <input className={`${inputCls} mt-0.5 block`} value={nueva.descripcion} onChange={(e) => setNueva((f) => ({ ...f, descripcion: e.target.value }))} />
        </label>
        <button type="button" disabled={guardando} className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] text-white hover:bg-emerald-600" onClick={() => void crear()}>
          + Agregar tarifa
        </button>
      </div>
      <p className="text-[10px] text-[var(--muted)]">
        La primera tarifa activa de la ruta queda como predeterminada. La tarifa de referencia de la ruta se sincroniza con la predeterminada activa.
      </p>
    </div>
  );
}
