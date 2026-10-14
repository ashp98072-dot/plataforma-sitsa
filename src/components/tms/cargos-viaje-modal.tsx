"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";
import type { CargoAdicional } from "@/lib/tms/cargos-adicionales-shared";
import { SUGERENCIAS_CONCEPTO_CARGO } from "@/lib/tms/cargos-adicionales-shared";
import type { VistaCargosPlan } from "@/lib/tms/cargos-adicionales";

/**
 * LIQUIDACIÓN DE VIAJES, FASE 4 — panel de cargos adicionales FACTURABLES de un viaje (se abre desde Ajustes rápidos).
 * Solo presentación: las reglas (estado del viaje/liquidación, versión, tenant, permiso) las decide el servidor. Mantiene
 * separados tarifa base, cargos adicionales facturables y costos internos (estos últimos NO aparecen aquí). No muestra ni
 * decide IVA: el tratamiento fiscal está pendiente de definición de negocio/fiscal. No factura, no cierra, no liquida.
 */

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const dinero = (v: string | null, moneda: string) =>
  v == null ? "Sin tarifa" : `${moneda === "GTQ" ? "Q" : `${moneda} `}${Number(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ModalCargosViaje({
  slug, planId, codigo, puedeEditar, onClose, onCambio,
}: {
  slug: string;
  planId: number;
  codigo: string;
  /** Permiso `viajes_cargos_adicionales:editar` (solo habilita los controles; el servidor lo vuelve a exigir). */
  puedeEditar: boolean;
  onClose: () => void;
  /** Avisa que los cargos cambiaron (para refrescar el resumen de la fila). */
  onCambio: () => void;
}) {
  const [vista, setVista] = useState<VistaCargosPlan | null>(null);
  const [errorLectura, setErrorLectura] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ocupadoRef = useRef(false);

  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [observacion, setObservacion] = useState("");
  const claveRef = useRef(nuevaClaveEnvio());

  const [editando, setEditando] = useState<CargoAdicional | null>(null);
  const [anulando, setAnulando] = useState<CargoAdicional | null>(null);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/cargos`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErrorLectura(data.error ?? "No se pudieron leer los cargos.");
      else {
        setErrorLectura("");
        setVista(data as VistaCargosPlan);
      }
    } catch {
      setErrorLectura("Error de conexión.");
    }
  }, [slug, planId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del panel
    void cargar();
  }, [cargar]);

  async function enviar(url: string, metodo: "POST" | "PATCH", cuerpo: unknown): Promise<boolean> {
    if (ocupadoRef.current) return false;
    ocupadoRef.current = true;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar la operación.");
        if (res.status === 409) await cargar(); // otro usuario cambió el cargo o el viaje se liquidó: se muestra el estado real
        return false;
      }
      await cargar();
      onCambio();
      return true;
    } catch {
      setError("Error de conexión.");
      return false;
    } finally {
      ocupadoRef.current = false;
      setEnviando(false);
    }
  }

  const base = `/api/empresas/${slug}/tms/planes/${planId}/cargos`;
  const editable = puedeEditar && vista?.edicion.editable === true;

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    const ok = await enviar(base, "POST", { concepto, monto, observacion: observacion.trim() || null, claveEnvio: claveRef.current });
    if (ok) {
      setConcepto("");
      setMonto("");
      setObservacion("");
      claveRef.current = nuevaClaveEnvio();
    }
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const ok = await enviar(`${base}/${editando.id}`, "PATCH", {
      expectedVersion: editando.version,
      concepto,
      monto,
      observacion: observacion.trim() || null,
    });
    if (ok) cancelarEdicion();
  }

  function empezarEdicion(c: CargoAdicional) {
    setEditando(c);
    setAnulando(null);
    setConcepto(c.concepto);
    setMonto(c.monto);
    setObservacion(c.observacion ?? "");
    setError("");
  }
  function cancelarEdicion() {
    setEditando(null);
    setConcepto("");
    setMonto("");
    setObservacion("");
  }

  async function confirmarAnulacion() {
    if (!anulando) return;
    const ok = await enviar(`${base}/${anulando.id}/anular`, "POST", { expectedVersion: anulando.version, motivo });
    if (ok) {
      setAnulando(null);
      setMotivo("");
    }
  }

  async function reactivar(c: CargoAdicional) {
    await enviar(`${base}/${c.id}/reactivar`, "POST", { expectedVersion: c.version });
  }

  const moneda = vista?.plan.moneda ?? "GTQ";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Cargos adicionales de ${codigo}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Cargos adicionales facturables</h2>
            <p className="text-xs text-[var(--muted)]">
              Viaje <span className="font-mono">{codigo}</span>
              {vista ? <> · Estado: {vista.plan.estado}{vista.liquidacion ? ` · Liquidación: ${vista.liquidacion.estado}` : ""}</> : null}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-[var(--border)] px-2 py-1 text-xs">Cerrar</button>
        </div>

        {!vista && !errorLectura ? <p className="text-xs text-[var(--muted)]">Cargando cargos…</p> : null}
        {errorLectura ? <p role="alert" className="text-xs text-rose-500">{errorLectura}</p> : null}
        {error ? <p role="alert" className="text-xs text-rose-500">{error}</p> : null}

        {vista ? (
          <>
            <p className="rounded border border-[var(--border)] bg-[var(--panel)] p-2 text-xs text-[var(--muted)]">
              Los cargos son importes facturables al cliente por servicios extra; no son gastos, viáticos ni fondos. El tratamiento de
              IVA de los cargos está pendiente de definición de negocio/fiscal: aquí no se suma ni se excluye IVA.
            </p>

            <ul className="space-y-0.5 text-xs">
              <li className="flex justify-between"><span className="text-[var(--muted)]">Tarifa base</span><span>{dinero(vista.totales.tarifaBase, moneda)}</span></li>
              <li className="flex justify-between"><span className="text-[var(--muted)]">Cargos adicionales ({vista.totales.cantidadActivos} vigentes)</span><span>{dinero(vista.totales.cargosActivos, moneda)}</span></li>
              <li className="flex justify-between border-t border-[var(--border)] pt-0.5 font-semibold">
                <span>Total comercial preliminar</span>
                <span>{dinero(vista.totales.totalComercial, moneda)}</span>
              </li>
            </ul>
            <p className="text-[10px] text-[var(--muted)]">Preliminar: tarifa base + cargos vigentes. No es el total de la factura (sin IVA ni tratamiento fiscal).</p>

            {!vista.edicion.editable ? (
              <p className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1 text-xs text-amber-300">{vista.edicion.motivo}</p>
            ) : !puedeEditar ? (
              <p className="text-xs text-[var(--muted)]">Solo lectura: no tienes permiso para modificar cargos.</p>
            ) : null}

            {vista.cargos.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">Este viaje no tiene cargos adicionales.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Concepto</th>
                      <th className="py-1 pr-2 text-right font-medium">Monto</th>
                      <th className="py-1 pr-2 font-medium">Detalle</th>
                      <th className="py-1 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vista.cargos.map((c) => (
                      <tr key={c.id} className={`border-t border-[var(--border)] align-top ${c.activo ? "" : "opacity-60"}`}>
                        <td className="py-1 pr-2">
                          <span className={c.activo ? "" : "line-through"}>{c.concepto}</span>
                          {!c.activo ? <span className="ml-1 rounded bg-[var(--input)] px-1 text-[10px]">Anulado</span> : null}
                          {c.observacion ? <span className="block text-[10px] text-[var(--muted)]">{c.observacion}</span> : null}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-2 text-right">{dinero(c.monto, moneda)}</td>
                        <td className="py-1 pr-2 text-[10px] text-[var(--muted)]">
                          Creó: {c.creadoPorNombre ?? `#${c.creadoPor}`} · {c.creadoEn}
                          {c.actualizadoPor != null ? <><br />Actualizó: {c.actualizadoPorNombre ?? `#${c.actualizadoPor}`} · {c.actualizadoEn ?? "—"}</> : null}
                          {!c.activo ? <><br />Anuló: {c.anuladoPorNombre ?? `#${c.anuladoPor}`} · {c.anuladoEn ?? "—"}<br />Motivo: {c.motivoAnulacion}</> : null}
                        </td>
                        <td className="whitespace-nowrap py-1">
                          {editable ? (
                            c.activo ? (
                              <>
                                <button type="button" disabled={enviando} onClick={() => empezarEdicion(c)} className="mr-1 rounded border border-[var(--border)] px-1.5 py-0.5 disabled:opacity-40">Editar</button>
                                <button type="button" disabled={enviando} onClick={() => { setAnulando(c); setEditando(null); setMotivo(""); setError(""); }} className="rounded border border-rose-700/60 px-1.5 py-0.5 text-rose-300 disabled:opacity-40">Anular</button>
                              </>
                            ) : (
                              <button type="button" disabled={enviando} onClick={() => void reactivar(c)} className="rounded border border-[var(--border)] px-1.5 py-0.5 disabled:opacity-40">Reactivar</button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {anulando ? (
              <div className="space-y-1 rounded border border-rose-700/60 p-2">
                <p className="text-xs">Anular «{anulando.concepto}» ({dinero(anulando.monto, moneda)}). No se borra: queda en el historial.</p>
                <textarea className={`${inputCls} w-full`} rows={2} maxLength={500} placeholder="Motivo (mínimo 5 caracteres)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" disabled={enviando || motivo.trim().length < 5} onClick={() => void confirmarAnulacion()} className="rounded bg-rose-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">Confirmar anulación</button>
                  <button type="button" disabled={enviando} onClick={() => setAnulando(null)} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs">Cancelar</button>
                </div>
              </div>
            ) : null}

            {editable ? (
              <form onSubmit={editando ? guardarEdicion : agregar} className="space-y-2 rounded border border-[var(--border)] p-2">
                <p className="text-xs font-medium">{editando ? `Editar cargo #${editando.id}` : "Agregar cargo"}</p>
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                  <label className="flex flex-col gap-0.5 text-xs">
                    Concepto
                    <input className={inputCls} list="sugerencias-cargo" maxLength={120} required value={concepto} onChange={(e) => setConcepto(e.target.value)} />
                    <datalist id="sugerencias-cargo">
                      {SUGERENCIAS_CONCEPTO_CARGO.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </label>
                  <label className="flex flex-col gap-0.5 text-xs">
                    Monto ({moneda})
                    <input className={inputCls} inputMode="decimal" required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
                  </label>
                </div>
                <label className="flex flex-col gap-0.5 text-xs">
                  Observación (opcional)
                  <input className={inputCls} maxLength={500} value={observacion} onChange={(e) => setObservacion(e.target.value)} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={enviando} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
                    {enviando ? "Guardando…" : editando ? "Guardar cambios" : "Agregar cargo"}
                  </button>
                  {editando ? <button type="button" disabled={enviando} onClick={cancelarEdicion} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs">Cancelar edición</button> : null}
                </div>
              </form>
            ) : null}

            {vista.eventos.length ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--muted)]">Historial de cambios ({vista.eventos.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {vista.eventos.map((ev) => (
                    <li key={ev.id} className="text-[var(--muted)]">
                      {ev.creadoEn} · {ev.tipo.toLowerCase()} · cargo #{ev.cargoId} v{ev.version}: {ev.despues.concepto} · {dinero(ev.despues.monto, moneda)}
                      {ev.motivo ? ` · ${ev.motivo}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
