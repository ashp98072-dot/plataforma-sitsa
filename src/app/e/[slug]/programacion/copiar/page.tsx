"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import { hoyLocal } from "@/lib/rrhh/dates";
import type { CatalogosCopia, OrigenFila } from "@/lib/tms/programacion-copia";
import type { BorradorLote, ResultadoFilaLote } from "@/lib/tms/programacion-lote";
import {
  aplicarErroresConfirmacion,
  aplicarValidacion,
  alternarSeleccion,
  filaDesdeCarga,
  limpiarSeleccion,
  seleccionarTodos,
  cuerpoLote,
  editarFila,
  fechaVisible,
  filasIncluidas,
  MAX_AUXILIARES_UI,
  puedeConfirmar,
  resumenFilas,
  sumarDias,
  type CambiosFila,
  type FilaEditable,
} from "./copiar-helpers";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — Programación > Copiar programación. Vista previa EDITABLE tipo tabla (sin abrir
 * un formulario por viaje). Nada se guarda hasta "Confirmar copia": el servidor revalida todo bajo el candado por
 * empresa y crea el lote completo o nada. Cambiar unidad/TC/piloto/auxiliares/hora/tarifa NO modifica el viaje origen.
 */
type RespuestaCarga = {
  filas: { borrador: BorradorLote; origen: OrigenFila; advertencias: string[]; validacion: ResultadoFilaLote }[];
  catalogos: CatalogosCopia;
};
type ErrorFila = { fila: number; errores: string[] };

const celda = "rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-xs";

export default function CopiarProgramacionPage() {
  const slug = String(useParams().slug);
  const { permisos } = useEmpresaSession();
  const puedeCrear = tienePermiso(permisos, "programacion", "crear");
  const hoy = hoyLocal();
  const [fechaOrigen, setFechaOrigen] = useState(hoy);
  const [fechaDestino, setFechaDestino] = useState(sumarDias(hoy, 1));
  const [filas, setFilas] = useState<FilaEditable[]>([]);
  const [catalogos, setCatalogos] = useState<CatalogosCopia | null>(null);
  const [cargado, setCargado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [validando, setValidando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState("");
  const [creado, setCreado] = useState<{ creados: number; codigos: string[] } | null>(null);
  const version = useRef(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    setCreado(null);
    try {
      const p = new URLSearchParams({ fechaOrigen, fechaDestino });
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/copiar?${p.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as Partial<RespuestaCarga> & { error?: string };
      if (!res.ok || !data.filas) { setError(data.error ?? "No se pudo cargar la programación."); return; }
      setFilas(data.filas.map(filaDesdeCarga)); // todas DESMARCADAS: el usuario marca lo que quiere copiar
      setCatalogos(data.catalogos ?? null);
      setCargado(true);
    } catch {
      setError("Error de conexión.");
    } finally {
      setCargando(false);
    }
  }, [slug, fechaOrigen, fechaDestino]);

  const validar = useCallback(async (actuales: FilaEditable[]) => {
    if (!filasIncluidas(actuales).length) return;
    const mia = ++version.current;
    setValidando(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/copiar/validar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoLote(fechaOrigen, fechaDestino, actuales)),
      });
      const data = (await res.json().catch(() => ({}))) as { validacion?: ResultadoFilaLote[]; error?: string };
      if (mia !== version.current) return; // llegó una respuesta más nueva
      if (!res.ok || !data.validacion) { setError(data.error ?? "No se pudo revalidar."); return; }
      setError("");
      setFilas((f) => aplicarValidacion(f, data.validacion!));
    } catch {
      if (mia === version.current) setError("Error de conexión al revalidar.");
    } finally {
      if (mia === version.current) setValidando(false);
    }
  }, [slug, fechaOrigen, fechaDestino]);

  // Tras editar, revalida solo (debounce): el servidor calcula disponibilidad, choques dentro del lote y tarifa.
  const hayPendientes = useMemo(() => filas.some((f) => f.incluida && f.sucia), [filas]);
  useEffect(() => {
    if (!hayPendientes) return;
    const t = setTimeout(() => void validar(filas), 700);
    return () => clearTimeout(t);
  }, [hayPendientes, filas, validar]);

  function cambiar(indice: number, cambios: CambiosFila) {
    setFilas((f) => f.map((x, i) => (i === indice ? editarFila(x, cambios) : x)));
  }
  function alternar(indice: number) {
    setFilas((f) => alternarSeleccion(f, indice));
  }

  async function confirmar() {
    if (!puedeConfirmar(filas, validando || confirmando)) return;
    setConfirmando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/copiar/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoLote(fechaOrigen, fechaDestino, filas)),
      });
      const data = (await res.json().catch(() => ({}))) as { creados?: number; codigos?: string[]; error?: string; erroresPorFila?: ErrorFila[] };
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear el lote. No se guardó ningún cambio.");
        setFilas((f) => aplicarErroresConfirmacion(f, data.erroresPorFila));
        return;
      }
      setCreado({ creados: data.creados ?? 0, codigos: data.codigos ?? [] });
      setFilas([]);
      setCargado(false);
    } catch {
      setError("Error de conexión.");
    } finally {
      setConfirmando(false);
    }
  }

  const r = resumenFilas(filas);

  if (!puedeCrear) {
    return <p role="alert" className="p-6 text-sm">No tienes permiso para copiar programación (programacion:crear).</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Copiar programación</h1>
          <p className="text-sm text-[var(--muted)]">Carga los viajes de otra fecha como base, ajústalos y créalos de una vez. Nada se guarda hasta confirmar.</p>
        </div>
        <Link href={`/e/${slug}/programacion`} className="text-sm underline">← Programación</Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)]">Fecha origen
          <input type="date" className={`${celda} mt-1 block`} value={fechaOrigen} onChange={(e) => { setFechaOrigen(e.target.value); setCargado(false); }} />
        </label>
        <label className="text-xs text-[var(--muted)]">Fecha destino
          <input type="date" className={`${celda} mt-1 block`} value={fechaDestino} onChange={(e) => { setFechaDestino(e.target.value); setCargado(false); }} />
        </label>
        <button type="button" disabled={cargando || !fechaOrigen || !fechaDestino} onClick={() => void cargar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {cargando ? "Cargando…" : "Cargar programación"}
        </button>
        {cargado ? (
          <button type="button" disabled={validando || !r.incluidas} onClick={() => void validar(filas)} className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40">
            {validando ? "Revalidando…" : "Revalidar"}
          </button>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-rose-400">{error}</p> : null}
      {creado ? (
        <section aria-label="Resultado de la copia" className="rounded-lg border border-emerald-700/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
          <p>Copia creada: {creado.creados} viaje(s) para el {fechaVisible(fechaDestino)}.</p>
          {creado.codigos.length ? <p className="text-xs">{creado.codigos.join(", ")}</p> : null}
          <Link href={`/e/${slug}/programacion`} className="text-xs underline">Ir a Programación</Link>
        </section>
      ) : null}

      {cargado ? (
        <>
          <p className="text-sm" aria-live="polite">
            {r.total} viaje(s) en {fechaVisible(fechaOrigen)} · Seleccionados: <strong>{r.incluidas}</strong> de <strong>{r.total}</strong> · OK: <strong>{r.ok}</strong> · Con error: <strong>{r.conError}</strong> · Pendientes de validar: <strong>{r.pendientes}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!r.total || r.incluidas === r.total} onClick={() => setFilas((f) => seleccionarTodos(f))} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-40">Seleccionar todos</button>
            <button type="button" disabled={!r.incluidas} onClick={() => setFilas((f) => limpiarSeleccion(f))} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-40">Limpiar selección</button>
          </div>
          {!filas.length ? <p className="text-sm text-[var(--muted)]">No hay viajes (no cancelados) en la fecha origen.</p> : null}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[1200px] text-left text-xs">
              <thead className="bg-[var(--thead)] text-[var(--muted)]">
                <tr>
                  {["✓", "Origen", "Cliente", "Ruta", "Unidad", "TC", "Piloto", "Auxiliares", "Hora", "Tarifa", "Estado / disponibilidad"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const b = f.borrador;
                  const terc = b.tipoViaje === "Tercerizado";
                  const tarifas = b.rutaId != null ? catalogos?.tarifasPorRuta[b.rutaId] ?? [] : [];
                  const efectiva = f.validacion?.tarifa?.id ?? b.tarifaId ?? tarifas.find((t) => t.predeterminada)?.id ?? tarifas[0]?.id ?? "";
                  return (
                    <tr key={b.fila} className={`border-t border-[var(--border)] align-top ${f.incluida ? "" : "opacity-40"}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Seleccionar fila ${b.fila}`} checked={f.incluida} onChange={() => alternar(i)} /></td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono">{f.origen.codigo}</span>
                        <span className="block text-[10px] text-[var(--muted)]">{f.origen.estado}{terc ? " · Tercerizado" : ""}</span>
                      </td>
                      <td className="px-2 py-1.5">{f.origen.clienteNombre ?? "—"}</td>
                      <td className="px-2 py-1.5">{f.origen.rutaCodigo ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {terc ? <span>{b.externo?.unidadExternaPlaca || "—"}</span> : (
                          <select className={celda} disabled={!f.incluida} value={b.unidadPlaca ?? ""} onChange={(e) => cambiar(i, { unidadPlaca: e.target.value || null })}>
                            <option value="">—</option>
                            {b.unidadPlaca && !catalogos?.unidades.some((u) => u.placa === b.unidadPlaca) ? <option value={b.unidadPlaca}>{b.unidadPlaca}</option> : null}
                            {catalogos?.unidades.map((u) => <option key={u.placa} value={u.placa}>{u.placa}{u.disponible ? "" : " (no disponible)"}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {terc ? <span>{b.externo?.tcExternoPlaca || "—"}</span> : (
                          <select className={celda} disabled={!f.incluida} value={b.tcVehiculoId ?? ""} onChange={(e) => cambiar(i, { tcVehiculoId: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">—</option>
                            {catalogos?.tcs.map((t) => <option key={t.id} value={t.id}>{t.placa}{t.disponible ? "" : " (no disponible)"}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {terc ? <span>{b.externo?.pilotoExternoNombre || "—"}</span> : (
                          <select className={celda} disabled={!f.incluida} value={b.pilotoEmpleadoId ?? ""} onChange={(e) => cambiar(i, { pilotoEmpleadoId: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">—</option>
                            {catalogos?.empleados.map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {terc ? <span>{b.externo?.auxiliaresExternos.join(", ") || "—"}</span> : (
                          <div className="flex flex-wrap items-center gap-1">
                            {b.auxiliarEmpleadoIds.map((id) => (
                              <span key={id} className="rounded-full bg-[var(--card)] px-2 py-0.5">
                                {catalogos?.empleados.find((e) => e.id === id)?.nombre ?? `#${id}`}
                                <button type="button" aria-label="Quitar auxiliar" disabled={!f.incluida} className="ml-1" onClick={() => cambiar(i, { auxiliarEmpleadoIds: b.auxiliarEmpleadoIds.filter((x) => x !== id) })}>×</button>
                              </span>
                            ))}
                            {b.auxiliarEmpleadoIds.length < MAX_AUXILIARES_UI ? (
                              <select className={celda} disabled={!f.incluida} value="" aria-label="Agregar auxiliar" onChange={(e) => e.target.value && cambiar(i, { auxiliarEmpleadoIds: [...b.auxiliarEmpleadoIds, Number(e.target.value)] })}>
                                <option value="">+ auxiliar</option>
                                {catalogos?.empleados.filter((e) => !b.auxiliarEmpleadoIds.includes(e.id) && e.id !== b.pilotoEmpleadoId).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                              </select>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5"><input type="time" className={celda} disabled={!f.incluida} value={b.horaCarga ?? ""} onChange={(e) => cambiar(i, { horaCarga: e.target.value || null })} /></td>
                      <td className="px-2 py-1.5">
                        {tarifas.length ? (
                          <select className={celda} disabled={!f.incluida} value={efectiva} onChange={(e) => cambiar(i, { tarifaId: Number(e.target.value) })}>
                            {tarifas.map((t) => <option key={t.id} value={t.id}>{t.nombre} · {t.moneda} {t.monto.toLocaleString("es-GT", { minimumFractionDigits: 2 })}</option>)}
                          </select>
                        ) : <span className="text-[var(--muted)]" title="Sin tarifa vigente: el viaje se copia sin tarifa">Sin tarifa</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {!f.incluida ? (
                          <div className="text-[var(--muted)]">
                            <span>No seleccionada</span>
                            {/* información ya calculada: se muestra, pero NO bloquea la confirmación de las seleccionadas */}
                            {f.validacion?.estado === "error" ? <ul className="mt-0.5 space-y-0.5">{f.validacion.errores.map((e, k) => <li key={k}>Fila {b.fila}: {e}</li>)}</ul> : null}
                          </div>
                        )
                          : f.sucia || !f.validacion ? <span className="text-[var(--muted)]">Validando…</span>
                          : f.validacion.estado === "ok" ? <span className="text-emerald-400">Disponible</span>
                          : <ul className="space-y-0.5 text-rose-400">{f.validacion.errores.map((e, k) => <li key={k}>Fila {b.fila}: {e}</li>)}</ul>}
                        {f.incluida && f.validacion?.estado === "ok" && !f.validacion.tarifa ? <p className="text-amber-300">Sin tarifa — podrás asignarla después</p> : null}
                        {f.advertencias.map((a, k) => <p key={k} className="text-amber-300">⚠ {a}</p>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!puedeConfirmar(filas, validando || confirmando)} onClick={() => void confirmar()} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {confirmando ? "Creando…" : `Confirmar copia (${r.incluidas} viaje${r.incluidas === 1 ? "" : "s"})`}
            </button>
            <span className="text-xs text-[var(--muted)]">Se crean todos o ninguno; los viajes nuevos nacen Programados con tarifa y viáticos vigentes.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
