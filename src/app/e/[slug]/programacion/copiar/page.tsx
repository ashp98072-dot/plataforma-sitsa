"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import { hoyLocal } from "@/lib/rrhh/dates";
import type { CatalogosCopia, OrigenFila } from "@/lib/tms/programacion-copia";
import { regresoTrasladado } from "@/lib/tms/programacion-copia-ventana";
import { comparacionRequiereAviso, ETIQUETA_AVISO, ETIQUETA_MOTIVO, MOTIVOS_BLOQUEO, sugerenciaDeDiagnostico, type TipoAviso } from "@/lib/tms/programacion-copia-diagnostico";
import type { BorradorLote, ResultadoFilaLote } from "@/lib/tms/programacion-lote";
import { PLAZO_CLIENTE_COPIAR_MS } from "@/lib/tms/plazos-copia";
import { clasificarFalloSolicitud, crearGestorSolicitudes, esRespuestaReintentable } from "./solicitud-cancelable";
import {
  aplicarErroresConfirmacion,
  aplicarValidacion,
  alternarSeleccion,
  filaDesdeCarga,
  limpiarSeleccion,
  seleccionarTodos,
  claveAvisoTarifas,
  comparacionesDeTarifa,
  cuerpoLote,
  diagnosticoDeFilas,
  editarFila,
  fechaVisible,
  filasIncluidas,
  MAX_AUXILIARES_UI,
  puedeConfirmarCopia,
  claveAvisosCopia,
  filasConAvisos,
  resumenFilas,
  tarifasEsperadas,
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
  // Clave de las diferencias de tarifa (origen → destino) que el usuario aceptó expresamente antes de confirmar.
  const [tarifasAceptadas, setTarifasAceptadas] = useState("");
  // Clave de los avisos de la copia (recurso compartido sin hora/regreso, destino ya ocupado) que el usuario aceptó expresamente.
  const [avisosAceptados, setAvisosAceptados] = useState("");
  // Qué se puede reintentar tras un fallo recuperable (plazo vencido, 503, red): la carga completa o solo la revalidación.
  const [reintentable, setReintentable] = useState<"cargar" | "validar" | null>(null);
  // Solicitudes cancelables: una nueva cancela la anterior, ninguna respuesta vieja sobrescribe a una nueva y ninguna espera más que el plazo del cliente.
  const cargas = useRef(crearGestorSolicitudes(PLAZO_CLIENTE_COPIAR_MS));
  const validaciones = useRef(crearGestorSolicitudes(PLAZO_CLIENTE_COPIAR_MS));
  useEffect(() => { const c = cargas.current, v = validaciones.current; return () => { c.cancelar(); v.cancelar(); }; }, []);

  const cargar = useCallback(async () => {
    const sol = cargas.current.iniciar();   // cancela la carga anterior, si la hay
    setCargando(true);
    setError("");
    setReintentable(null);
    setCreado(null);
    try {
      const p = new URLSearchParams({ fechaOrigen, fechaDestino });
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/copiar?${p.toString()}`, { cache: "no-store", signal: sol.signal });
      const data = (await res.json().catch(() => ({}))) as Partial<RespuestaCarga> & { error?: string };
      if (!sol.esVigente()) return;   // llegó tarde: ya hay una carga más nueva (o esta se canceló)
      if (!res.ok || !data.filas) { setError(data.error ?? "No se pudo cargar la programación."); setReintentable(esRespuestaReintentable(res.status) ? "cargar" : null); return; }
      setFilas(data.filas.map(filaDesdeCarga)); // todas DESMARCADAS: el usuario marca lo que quiere copiar
      setCatalogos(data.catalogos ?? null);
      setCargado(true);
    } catch (e) {
      const f = clasificarFalloSolicitud(e, sol);
      if (f.ignorar) return;   // cancelada por reemplazo o al salir de la pantalla: no es un error
      setError(f.mensaje); setReintentable(f.reintentable ? "cargar" : null);
    } finally {
      sol.terminar();
      if (sol.esVigente() || sol.vencio()) setCargando(false);   // solo la solicitud vigente (o la vencida) apaga el indicador; una reemplazada deja el de la nueva
    }
  }, [slug, fechaOrigen, fechaDestino]);

  const validar = useCallback(async (actuales: FilaEditable[]) => {
    if (!filasIncluidas(actuales).length) return;
    const mia = ++version.current;
    const sol = validaciones.current.iniciar();   // cancela la revalidación anterior, si la hay
    setValidando(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/copiar/validar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoLote(fechaOrigen, fechaDestino, actuales)), signal: sol.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { validacion?: ResultadoFilaLote[]; error?: string };
      if (mia !== version.current || !sol.esVigente()) return; // llegó una respuesta más nueva
      if (!res.ok || !data.validacion) { setError(data.error ?? "No se pudo revalidar."); setReintentable(esRespuestaReintentable(res.status) ? "validar" : null); return; }
      setError(""); setReintentable(null);
      setFilas((f) => aplicarValidacion(f, data.validacion!));
    } catch (e) {
      const f = clasificarFalloSolicitud(e, sol);
      if (!f.ignorar && mia === version.current) { setError(f.mensaje); setReintentable(f.reintentable ? "validar" : null); }
    } finally {
      sol.terminar();
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

  function invalidarSolicitud() {
    version.current++;
    validaciones.current.cancelar();
    setValidando(false);
  }
  function cambiar(indice: number, cambios: CambiosFila) {
    invalidarSolicitud();
    setFilas((f) => f.map((x, i) => (i === indice ? editarFila(x, cambios) : x)));
  }
  function alternar(indice: number) {
    invalidarSolicitud();
    setFilas((f) => alternarSeleccion(f, indice));
  }

  async function confirmar() {
    if (!puedeConfirmarCopia(filas, validando || confirmando, tarifasAceptadas, avisosAceptados)) return;
    setConfirmando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/copiar/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...cuerpoLote(fechaOrigen, fechaDestino, filas), tarifasEsperadas: tarifasEsperadas(filas) }),
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
  const diag = diagnosticoDeFilas(filas);
  const sugerencia = sugerenciaDeDiagnostico(diag);
  const comparaciones = comparacionesDeTarifa(filas);
  const claveTarifas = claveAvisoTarifas(comparaciones);
  const claveAvisos = claveAvisosCopia(filas);
  const nConAvisos = filasConAvisos(filas).length;
  const conAvisoTarifa = comparaciones.filter((c) => comparacionRequiereAviso(c.comparacion)).length;
  const irAFila = (fila: number) => { const el = document.getElementById(`regreso-${fila}`); el?.scrollIntoView({ block: "center" }); el?.focus(); };
  const comparacion = (f: FilaEditable) => {
    const origen = f.origen.tarifaOriginal;
    const destino = f.validacion?.estado === "ok" && !f.sucia ? f.validacion.tarifa : undefined;
    const mostrar = (t: { monto: number | null; moneda: string | null } | null | undefined) => t === undefined ? "Pendiente de validar" : t === null || t.monto === null ? "Sin tarifa" : `${t.moneda ?? "Moneda no registrada"} ${t.monto.toFixed(2)}`;
    const diferente = origen && destino !== undefined && (origen.monto !== (destino?.monto ?? null) || (origen.moneda && destino?.moneda && origen.moneda.toUpperCase() !== destino.moneda.toUpperCase()));
    return { origen: mostrar(origen), destino: mostrar(destino), diferente: Boolean(diferente), monedaDesconocida: Boolean(origen?.monto != null && !origen.moneda) };
  };

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

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-400">
          <p>{error}</p>
          {reintentable ? (
            <button type="button" disabled={cargando || validando} onClick={() => (reintentable === "cargar" ? void cargar() : void validar(filas))} className="rounded border border-[var(--border)] px-3 py-1 disabled:opacity-40">
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}
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
          {diag.bloqueadas > 0 ? (
            <section aria-label="Diagnóstico de bloqueos" className="space-y-2 rounded-lg border border-rose-700/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">
              <p className="font-medium">{diag.bloqueadas} de {diag.total} fila(s) no se pueden copiar. Motivos:</p>
              <ul className="list-inside list-disc">
                {MOTIVOS_BLOQUEO.filter((m) => diag.porMotivo[m] > 0).map((m) => <li key={m}>{ETIQUETA_MOTIVO[m]}: {diag.porMotivo[m]} fila(s)</li>)}
              </ul>
              <p className="text-rose-300/80">Los solapes reales de horario (con horas conocidas) siguen bloqueando.</p>
            </section>
          ) : null}
          {nConAvisos > 0 ? (
            <section aria-label="Avisos de la copia" className="space-y-2 rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
              <p className="font-medium">⚠ {nConAvisos} fila(s) se copiarán igual que el origen, con avisos:</p>
              <ul className="list-inside list-disc">
                {(Object.keys(ETIQUETA_AVISO) as TipoAviso[]).filter((t) => diag.avisosPorTipo[t] > 0).map((t) => <li key={t}>{ETIQUETA_AVISO[t]}: {diag.avisosPorTipo[t]} fila(s)</li>)}
              </ul>
              {sugerencia ? <p>{sugerencia}</p> : null}
              {diag.origenes.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Si prefieres evitar el aviso, da un regreso a:</span>
                  {diag.origenes.slice(0, 5).map((o) => (
                    <button key={o.fila} type="button" onClick={() => irAFila(o.fila)} className="rounded border border-amber-700/60 px-2 py-1 underline">
                      Fila {o.fila} ({o.falta === "hora" ? "sin hora" : o.falta === "regreso" ? "sin regreso" : "sin hora ni regreso"}) · comparte con {o.afecta}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={avisosAceptados === claveAvisos} onChange={(e) => setAvisosAceptados(e.target.checked ? claveAvisos : "")} />
                Entiendo los avisos y acepto copiar estos viajes tal como están en el origen
              </label>
            </section>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!r.total || r.incluidas === r.total} onClick={() => { invalidarSolicitud(); setFilas((f) => seleccionarTodos(f)); }} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-40">Seleccionar todos</button>
            <button type="button" disabled={!r.incluidas} onClick={() => { invalidarSolicitud(); setFilas((f) => limpiarSeleccion(f)); }} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-40">Limpiar selección</button>
          </div>
          {!filas.length ? <p className="text-sm text-[var(--muted)]">No hay viajes (no cancelados) en la fecha origen.</p> : null}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[1200px] text-left text-xs">
              <thead className="bg-[var(--thead)] text-[var(--muted)]">
                <tr>
                  {["✓", "Origen", "Cliente", "Ruta", "Unidad", "TC", "Piloto", "Auxiliares", "Hora", "Regreso estimado", "Tarifa", "Estado / disponibilidad"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const b = f.borrador;
                  const terc = b.tipoViaje === "Tercerizado";
                  const precio = comparacion(f);
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
                        {!terc && f.origen.pilotoExtraNombre ? (
                          <span className="mt-0.5 block text-[10px] text-[var(--muted)]" title="Se copia con la misma regla de disponibilidad que el piloto principal">
                            + Piloto extra: {f.origen.pilotoExtraNombre}
                          </span>
                        ) : null}
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
                      <td className="px-2 py-1.5"><input type="datetime-local" id={`regreso-${b.fila}`} aria-label={`Regreso estimado fila ${b.fila}`} className={celda} disabled={!f.incluida} value={b.regresoEditado !== undefined ? b.regresoEditado ?? "" : b.regresoOffsetDias != null && b.regresoHora ? regresoTrasladado(fechaDestino, { offsetDias: b.regresoOffsetDias, hora: b.regresoHora }) ?? "" : ""} onChange={(e) => cambiar(i, { regresoEditado: e.target.value || null })} /></td>
                      <td className="px-2 py-1.5">
                        <p>Origen: {precio.origen}</p><p>Destino: {precio.destino}</p>
                        {precio.diferente ? <p className="text-amber-300">La tarifa de destino es diferente a la del origen.</p> : null}
                        {precio.monedaDesconocida ? <p className="text-amber-300">Verifica la moneda del origen antes de confirmar.</p> : null}
                        {tarifas.length ? (
                          <select className={celda} disabled={!f.incluida} value={efectiva} onChange={(e) => cambiar(i, { tarifaId: Number(e.target.value) })}>
                            {b.tarifaId != null && !tarifas.some((t) => t.id === b.tarifaId) ? <option value={b.tarifaId}>Tarifa del origen no vigente — seleccione otra</option> : null}
                            {tarifas.map((t) => <option key={t.id} value={t.id}>{t.nombre} · {t.moneda} {t.monto.toLocaleString("es-GT", { minimumFractionDigits: 2 })}</option>)}
                          </select>
                        ) : b.tarifaId != null ? <button type="button" className="underline" disabled={!f.incluida} onClick={() => cambiar(i, { tarifaId: null })}>Tarifa del origen no vigente — quitar</button> : <span className="text-[var(--muted)]" title="Sin tarifa vigente: el viaje se copia sin tarifa">Sin tarifa</span>}
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
                          : f.validacion.estado === "ok" ? (
                            <div className="space-y-0.5">
                              <span className="text-emerald-400">{f.validacion.avisos?.length ? "Se copia con avisos" : "Disponible"}</span>
                              {f.validacion.avisos?.length ? (
                                <div className="text-amber-300">
                                  {(() => {
                                    const rel = [...new Set(f.validacion.avisos.filter((a) => a.tipo === "ventana_incompleta").flatMap((a) => a.filas ?? []))].sort((x, y) => x - y);
                                    return rel.length ? <p>Comparte recursos con la fila(s) {rel.join(", ")} sin hora/regreso válido (se reserva todo el día); se copia igual que el origen.</p> : null;
                                  })()}
                                  {f.validacion.avisos.filter((a) => a.tipo === "destino_ocupado").map((a, k) => <p key={k}>{a.mensaje}</p>)}
                                  <details className="text-[var(--muted)]"><summary className="cursor-pointer">Ver detalle</summary><ul>{f.validacion.avisos.map((a, k) => <li key={k}>{a.mensaje}</li>)}</ul></details>
                                </div>
                              ) : null}
                            </div>
                          )
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
          {conAvisoTarifa > 0 ? (
            <section aria-label="Aviso de tarifas" className="space-y-1 rounded-lg border border-amber-700/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
              <p className="font-medium">⚠ {conAvisoTarifa} viaje(s) usarán una tarifa distinta a la del origen.</p>
              <p>Los montos del viaje origen NO se copian: cada viaje nuevo usa la tarifa vigente del catálogo de su ruta (columna Tarifa muestra origen → destino).</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={tarifasAceptadas === claveTarifas} onChange={(e) => setTarifasAceptadas(e.target.checked ? claveTarifas : "")} />
                Revisé las diferencias de tarifa y acepto crear los viajes con la tarifa del destino
              </label>
            </section>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!puedeConfirmarCopia(filas, validando || confirmando, tarifasAceptadas, avisosAceptados)} onClick={() => void confirmar()} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {confirmando ? "Creando…" : `Confirmar copia (${r.incluidas} viaje${r.incluidas === 1 ? "" : "s"})`}
            </button>
            <span className="text-xs text-[var(--muted)]">Se crean todos o ninguno; los viajes nuevos nacen Programados con tarifa y viáticos vigentes.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
