"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import type { FilaResultadoEdicionRapida } from "@/lib/tms/edicion-rapida-schema";
import { formatearHora12 } from "@/lib/tms/hora-formato";
import {
  agregarAuxiliar,
  confirmarPerdida,
  cuerpoEdicionRapida,
  editarRecursos,
  enviarGuardar,
  enviarValidar,
  errorAntesDeEnviar,
  estadoFila,
  mapaResultados,
  mensajeGuardado,
  MAX_AUXILIARES_EDICION_RAPIDA,
  motivoNoEditable,
  opcionesPersonal,
  opcionesVehiculo,
  puedeGuardar,
  puedeValidar,
  quitarAuxiliar,
  recursosVisibles,
  resumenEdicion,
  subirAuxiliar,
  unidadSinVinculoFlota,
  type Borrador,
  type EntradaBorrador,
  type EstadoEdicionFila,
  type PersonalCatalogo,
  type PlanEdicionRapida,
  type RecursosEditables,
  type VehiculoCatalogo,
} from "./edicion-rapida-helpers";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-3: tabla compacta tipo Excel para cambiar piloto/auxiliares/unidad/TC de los viajes
 * VISIBLES en Programación sin abrir "Ajustar" por viaje. Cambiar un select NO guarda: se mantiene un borrador local y
 * se envía todo el lote (con UN motivo) a /edicion-rapida/validar y /edicion-rapida. No toca fecha, hora, regreso,
 * ruta, cliente, tarifa, paradas, notas ni estado. Toda la lógica decidible sin React vive en edicion-rapida-helpers.ts.
 */
export type FilaEdicionRapidaEntrada = {
  plan: PlanEdicionRapida & { cliente: string | null };
  estadoLabel: string;
  estadoBadge: string;
  ruta: string;
};

const celda = "rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-xs disabled:opacity-50";

const ESTADO_EDICION: Record<EstadoEdicionFila, { texto: string; clase: string; fila: string }> = {
  sin_cambios: { texto: "—", clase: "text-[var(--muted)]", fila: "" },
  modificada: { texto: "Modificada", clase: "text-sky-300", fila: "bg-sky-900/20" },
  ok: { texto: "✓ OK", clase: "text-emerald-300", fila: "bg-emerald-900/10" },
  conflicto: { texto: "Conflicto", clase: "text-rose-300", fila: "bg-rose-900/20" },
};

export function EdicionRapida({
  slug,
  hoy,
  filas,
  disponibilidadPorFecha,
  vehiculos,
  onPendientesChange,
  onGuardado,
}: {
  slug: string;
  hoy: string;
  /** Solo las filas VISIBLES de Programación (respeta rango y filtros activos). */
  filas: FilaEdicionRapidaEntrada[];
  disponibilidadPorFecha: Map<string, DisponibilidadPersonal[]>;
  /** estadoVehiculos del GET /tms/planes (id = flota_vehiculos.id). */
  vehiculos: VehiculoCatalogo[];
  onPendientesChange: (hayPendientes: boolean) => void;
  /** Refresca Programación desde el servidor. */
  onGuardado: () => Promise<void>;
}) {
  const [personal, setPersonal] = useState<PersonalCatalogo[]>([]);
  const [borrador, setBorrador] = useState<Borrador>(new Map<number, EntradaBorrador>());
  const [resultados, setResultados] = useState<ReadonlyMap<number, FilaResultadoEdicionRapida>>(new Map());
  const [motivo, setMotivo] = useState("");
  const [validando, setValidando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  // Candado síncrono contra doble submit (el `disabled` del botón llega un render tarde).
  const ocupadoRef = useRef(false);
  // Una validación que vuelve después de otra edición ya no describe el borrador actual: se descarta.
  const versionRef = useRef(0);

  // Mismo catálogo de personal que ya expone GET /tms/catalogos (tms_personal con su id real).
  useEffect(() => {
    let ignore = false;
    fetch(`/api/empresas/${slug}/tms/catalogos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (ignore || !data) return;
        setPersonal(
          ((data.personal ?? []) as { id: number; nombre: string; tipo: string; estado?: string | null }[]).map((p) => ({
            id: Number(p.id), nombre: String(p.nombre), tipo: String(p.tipo), estado: p.estado ?? null,
          })),
        );
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [slug]);

  const hayPendientes = borrador.size > 0;
  useEffect(() => {
    onPendientesChange(hayPendientes);
  }, [hayPendientes, onPendientesChange]);

  const resumen = resumenEdicion(borrador, resultados);
  const ocupado = validando || guardando;
  const nombrePersonal = useMemo(() => new Map(personal.map((p) => [p.id, p.nombre])), [personal]);

  function cambiar(plan: PlanEdicionRapida, cambios: Partial<RecursosEditables>) {
    if (guardando) return;
    versionRef.current++;
    setBorrador((b) => editarRecursos(b, plan, cambios));
    setResultados(new Map()); // los cruces entre filas cambian: toda validación previa queda vieja
    setMensaje("");
  }

  function descartar() {
    if (ocupado) return;
    if (!confirmarPerdida(borrador.size > 0, (m) => window.confirm(m))) return;
    versionRef.current++;
    setBorrador(new Map());
    setResultados(new Map());
    setError("");
    setMensaje("");
  }

  async function validar() {
    if (ocupadoRef.current) return;
    const previo = errorAntesDeEnviar(borrador, motivo);
    if (previo) { setError(previo); return; }
    ocupadoRef.current = true;
    const version = versionRef.current;
    setValidando(true);
    setError("");
    setMensaje("");
    try {
      const r = await enviarValidar((u, i) => fetch(u, i), slug, cuerpoEdicionRapida(borrador, motivo));
      if (version !== versionRef.current) return;
      if (r.tipo === "error") { setError(r.error); return; }
      setResultados(mapaResultados(r.filas));
    } finally {
      ocupadoRef.current = false;
      setValidando(false);
    }
  }

  async function guardar() {
    if (ocupadoRef.current) return;
    const previo = errorAntesDeEnviar(borrador, motivo);
    if (previo) { setError(previo); return; }
    ocupadoRef.current = true;
    setGuardando(true);
    setError("");
    setMensaje("");
    try {
      const r = await enviarGuardar((u, i) => fetch(u, i), slug, cuerpoEdicionRapida(borrador, motivo));
      if (r.tipo === "ok") {
        await onGuardado(); // nuevos snapshots reales desde el servidor
        versionRef.current++;
        setBorrador(new Map());
        setResultados(new Map());
        setMotivo("");
        setMensaje(mensajeGuardado(r.guardados));
        return;
      }
      // 409 / error: el borrador se conserva tal cual; los errores por fila se muestran en su fila.
      setError(r.error);
      if (r.tipo === "conflicto" && r.filas.length) setResultados(mapaResultados(r.filas));
    } finally {
      ocupadoRef.current = false;
      setGuardando(false);
    }
  }

  return (
    <section aria-label="Edición rápida" className="space-y-3 rounded-xl border border-[var(--accent)]/60 bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[260px] flex-1 text-xs text-[var(--muted)]">
          Motivo del cambio
          <input
            type="text"
            className={`${celda} mt-1 block w-full text-sm`}
            placeholder="Ej. Piloto no se presentó"
            maxLength={300}
            value={motivo}
            aria-required={hayPendientes}
            disabled={guardando}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
        <p className="text-sm" aria-live="polite">
          Cambios: <strong>{resumen.cambios}</strong> · OK: <strong className="text-emerald-300">{resumen.ok}</strong> · Conflictos:{" "}
          <strong className="text-rose-300">{resumen.conflictos}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={ocupado || !hayPendientes} onClick={descartar} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-40">
            Descartar cambios
          </button>
          <button type="button" disabled={!puedeValidar(borrador, motivo, ocupado)} onClick={() => void validar()} className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white disabled:opacity-40">
            {validando ? "Validando…" : "Validar"}
          </button>
          <button type="button" disabled={!puedeGuardar(borrador, motivo, resultados, ocupado)} onClick={() => void guardar()} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
      {hayPendientes && !motivo.trim() ? <p className="text-xs text-amber-300">El motivo es obligatorio para validar y guardar.</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      {mensaje ? <p role="status" className="rounded border border-emerald-700/60 bg-emerald-900/20 px-3 py-1.5 text-sm text-emerald-300">{mensaje}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-[1150px] text-left text-xs">
          <thead className="bg-[var(--thead)] text-[var(--muted)]">
            <tr>
              {["Estado", "Hora", "Código", "Ruta / Cliente", "Piloto", "Auxiliares", "Unidad", "TC", "Estado de edición"].map((h) => (
                <th key={h} scope="col" className="px-2 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map(({ plan: p, estadoLabel, estadoBadge, ruta }) => {
              const bloqueo = motivoNoEditable(p, hoy);
              const deshabilitado = bloqueo != null || guardando;
              const r = recursosVisibles(borrador, p);
              const estado = estadoFila(p.id, borrador, resultados);
              const vista = ESTADO_EDICION[estado];
              const res = resultados.get(p.id);
              const disp = new Map((disponibilidadPorFecha.get(p.fecha_plan) ?? []).map((d) => [d.personalId, d]));
              const nombreDe = (id: number) =>
                nombrePersonal.get(id) ?? p.auxiliaresDetalle.find((a) => a.personalId === id)?.nombre ?? (p.pilotoId === id ? p.piloto : null) ?? `#${id}`;
              const pilotos = opcionesPersonal(personal, "Piloto", p.pilotoId != null ? [{ id: p.pilotoId, nombre: p.piloto ?? `#${p.pilotoId}` }] : [], disp, p.id);
              const auxiliares = opcionesPersonal(personal, "Auxiliar", p.auxiliaresDetalle.map((a) => ({ id: a.personalId, nombre: a.nombre })), disp, p.id)
                .filter((o) => !r.auxiliarPersonalIds.includes(o.id) && o.id !== r.pilotoPersonalId);
              const unidades = opcionesVehiculo(vehiculos, "unidad", { id: p.flotaVehiculoId ?? null, placa: p.placa });
              const tcs = opcionesVehiculo(vehiculos, "tc", { id: p.tc_vehiculo_id ?? null, placa: p.tc ?? null });
              const unidadLegado = unidadSinVinculoFlota(p);
              return (
                <tr key={p.id} data-estado-edicion={estado} className={`border-t border-[var(--border)] align-top ${bloqueo ? "opacity-60" : vista.fila}`}>
                  <td className={`px-2 py-1.5 ${estado === "conflicto" ? "border-l-2 border-l-rose-500" : ""}`}>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${estadoBadge}`}>{estadoLabel}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {p.hora_carga ? formatearHora12(p.hora_carga) : "—"}
                    <span className="block text-[10px] text-[var(--muted)]">{p.fecha_plan}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-sky-300">{p.codigo}</td>
                  <td className="max-w-[220px] px-2 py-1.5">
                    <span className="block truncate" title={ruta}>{ruta || "—"}</span>
                    <span className="block truncate text-[10px] text-[var(--muted)]">{p.cliente || "—"}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className={celda}
                      aria-label={`Piloto de ${p.codigo}`}
                      disabled={deshabilitado}
                      value={r.pilotoPersonalId ?? ""}
                      onChange={(e) => cambiar(p, { pilotoPersonalId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">— Sin piloto —</option>
                      {pilotos.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.auxiliarPersonalIds.map((id, i) => (
                        <span key={id} className="inline-flex items-center gap-0.5 rounded-full bg-[var(--input)] px-2 py-0.5" title={i === 0 ? "Auxiliar principal" : undefined}>
                          {i === 0 && r.auxiliarPersonalIds.length > 1 ? <span aria-hidden="true">★</span> : null}
                          {nombreDe(id)}
                          {i > 0 ? (
                            <button type="button" aria-label={`Hacer principal a ${nombreDe(id)} en ${p.codigo}`} title="Subir" disabled={deshabilitado} className="ml-0.5 disabled:opacity-40"
                              onClick={() => cambiar(p, { auxiliarPersonalIds: subirAuxiliar(r.auxiliarPersonalIds, id) })}>↑</button>
                          ) : null}
                          <button type="button" aria-label={`Quitar auxiliar ${nombreDe(id)} de ${p.codigo}`} disabled={deshabilitado} className="ml-0.5 disabled:opacity-40"
                            onClick={() => cambiar(p, { auxiliarPersonalIds: quitarAuxiliar(r.auxiliarPersonalIds, id) })}>×</button>
                        </span>
                      ))}
                      {r.auxiliarPersonalIds.length < MAX_AUXILIARES_EDICION_RAPIDA ? (
                        <select
                          className={celda}
                          aria-label={`Agregar auxiliar a ${p.codigo}`}
                          disabled={deshabilitado}
                          value=""
                          onChange={(e) => e.target.value && cambiar(p, { auxiliarPersonalIds: agregarAuxiliar(r.auxiliarPersonalIds, Number(e.target.value)) })}
                        >
                          <option value="">+ auxiliar</option>
                          {auxiliares.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
                        </select>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className={celda}
                      aria-label={`Unidad de ${p.codigo}`}
                      disabled={deshabilitado || unidadLegado}
                      title={unidadLegado ? "Unidad sin vínculo con Flota: cámbiala desde Ajustar." : undefined}
                      value={r.flotaVehiculoId ?? ""}
                      onChange={(e) => cambiar(p, { flotaVehiculoId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">{unidadLegado ? p.placa : "— Sin unidad —"}</option>
                      {unidades.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className={celda}
                      aria-label={`TC de ${p.codigo}`}
                      disabled={deshabilitado}
                      value={r.tcVehiculoId ?? ""}
                      onChange={(e) => cambiar(p, { tcVehiculoId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">— Sin TC —</option>
                      {tcs.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
                    </select>
                  </td>
                  <td className="min-w-[200px] px-2 py-1.5">
                    {bloqueo ? (
                      <span className="rounded bg-[var(--input)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]" title="No editable en Edición rápida">{bloqueo}</span>
                    ) : (
                      <span className={`font-medium ${vista.clase}`}>{res?.estado === "sin_cambios" ? "Sin cambios" : vista.texto}</span>
                    )}
                    {res?.errores.length ? (
                      <ul className="mt-0.5 space-y-0.5 text-rose-300">
                        {res.errores.map((e, k) => <li key={k}>{e.mensaje}</li>)}
                      </ul>
                    ) : null}
                    {res?.advertencias.length ? (
                      <ul className="mt-0.5 space-y-0.5 text-amber-300">
                        {res.advertencias.map((a, k) => <li key={k} title={a.tipo}>⚠ {a.mensaje}</li>)}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!filas.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[var(--muted)]">No hay viajes con este filtro.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
