"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  borradorPendiente,
  confirmarRevision,
  construirCuerpoMigracion,
  esMigracionUi,
  estadoFiscalUi,
  formatoQ,
  formularioDesdeRevision,
  formularioVacio,
  guardarBorrador,
  resumenAcumulado,
  unaSolaVez,
  urlFiscal,
  type FormularioMigracion,
  type LecturaFiscalUi,
  type PermisosFiscal,
} from "@/lib/rrhh/fiscal-migracion-ui";

/**
 * Ficha del empleado — "7. Fiscal / ISR". Acumulado fiscal inicial de MIGRACIÓN desde el sistema anterior (una sola carga por
 * empleado y ejercicio, sin reconstruir cada planilla histórica). Guardar borrador y Confirmar son operaciones SEPARADAS; una
 * revisión confirmada es de solo lectura: un error se corrige con una NUEVA revisión que, al confirmarse, pasa a ser la vigente.
 */
const input = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm w-full";

// El formulario es un div y no un elemento de formulario HTML: la ficha ya vive dentro de uno (no se pueden anidar).
export function FiscalEmpleadoSeccion({ slug, empleadoId, permisos }: { slug: string; empleadoId: number; permisos: PermisosFiscal }) {
  const hoy = hoyLocal();
  const [ejercicio, setEjercicio] = useState(Number(hoy.slice(0, 4)));
  const [lectura, setLectura] = useState<LecturaFiscalUi | null>(null);
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState<FormularioMigracion>(formularioVacio(ejercicio));
  const [formAbierto, setFormAbierto] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const candado = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(urlFiscal(slug, empleadoId, ejercicio));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo leer la información fiscal."); setLectura(null); return; }
      setLectura(data as LecturaFiscalUi);
    } catch { setError("Error de conexión al leer la información fiscal."); }
    finally { setCargando(false); }
  }, [slug, empleadoId, ejercicio]);

  useEffect(() => {
    const t = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(t);
  }, [cargar]);

  const estado = estadoFiscalUi(lectura);
  const confirmada = lectura?.confirmada ?? null;
  const pendiente = borradorPendiente(lectura);

  function abrirFormulario(desde?: FormularioMigracion) {
    setForm(desde ?? formularioVacio(ejercicio));
    setSucio(false);
    setError("");
    setFormAbierto(true);
  }
  function cambiar(parche: Partial<FormularioMigracion>) {
    setForm((f) => ({ ...f, ...parche }));
    setSucio(true);
    setMensaje("");
  }

  async function guardar() {
    const r0 = construirCuerpoMigracion(form, ejercicio, lectura?.ultima?.revision ?? 0, hoy);
    if ("error" in r0) { setError(r0.error); return; }
    const r = await unaSolaVez(candado, async () => { setOcupado(true); try { return await guardarBorrador((u, i) => fetch(u, i), slug, empleadoId, ejercicio, r0.cuerpo); } finally { setOcupado(false); } });
    if (r === null) return;
    if (r.tipo === "error") { setError(r.error); return; } // el formulario se conserva tal cual
    setError("");
    setMensaje("Borrador guardado. Revísalo y confírmalo para que se use en el cálculo del ISR.");
    setSucio(false);
    await cargar();
  }

  async function confirmar() {
    if (!pendiente) return;
    const r = await unaSolaVez(candado, async () => { setOcupado(true); try { return await confirmarRevision((u, i) => fetch(u, i), slug, empleadoId, ejercicio, pendiente.revision); } finally { setOcupado(false); } });
    if (r === null) return;
    if (r.tipo === "error") { setError(r.error); setConfirmando(false); return; }
    setConfirmando(false);
    setFormAbierto(false);
    setError("");
    setMensaje("Acumulado fiscal confirmado. Se usará para proyectar el ISR de las planillas posteriores.");
    await cargar();
  }

  if (!permisos.puedeVer) return <p className="col-span-full text-sm text-[var(--muted)]">Sin permiso para ver la información fiscal.</p>;

  const resumen = pendiente ? resumenAcumulado(pendiente, ejercicio) : null;
  return (
    <div className="col-span-full space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-[var(--muted)]">
          Ejercicio
          <input type="number" className={`${input} mt-1 w-24`} value={ejercicio} min={2000} max={9999} disabled={ocupado}
            onChange={(e) => { setEjercicio(Number(e.target.value)); setFormAbierto(false); setMensaje(""); setError(""); }} />
        </label>
        <p aria-live="polite">
          Estado fiscal: <strong data-estado-fiscal={estado.clave}>{cargando ? "Cargando…" : estado.etiqueta}</strong>
        </p>
      </div>

      {confirmada ? (
        <div className="rounded-lg border border-[var(--border)] p-3" aria-label="Revisión confirmada (solo lectura)">
          <p className="text-xs text-[var(--muted)]">Revisión {confirmada.revision} · solo lectura · confirmada por {confirmada.confirmadoPor ?? "—"} {confirmada.confirmadoEn ? `el ${String(confirmada.confirmadoEn).slice(0, 10).split("-").reverse().join("/")}` : ""}</p>
          {esMigracionUi(confirmada) ? (
            <ul className="mt-1 space-y-0.5">
              <li>Corte: {String(confirmada.corteAntecedentes ?? "").slice(0, 10).split("-").reverse().join("/")}</li>
              <li>Ingresos gravados: {formatoQ(confirmada.ingresosGravadosPrevios)}</li>
              <li>Ingresos exentos: {formatoQ(confirmada.ingresosExentosPrevios)}</li>
              <li>IGSS laboral: {formatoQ(confirmada.igssLaboralPrevio)}</li>
              <li>ISR retenido: {formatoQ(confirmada.isrRetenidoPrevio)}</li>
              <li className="text-xs text-[var(--muted)]">Origen: {confirmada.datos.migracion?.referenciaOrigen}</li>
            </ul>
          ) : null}
        </div>
      ) : null}

      {mensaje ? <p role="status" className="text-emerald-300">{mensaje}</p> : null}
      {error ? <p role="alert" className="text-red-300">{error}</p> : null}

      {permisos.puedeCapturar && !formAbierto ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-white" disabled={ocupado}
            onClick={() => abrirFormulario(pendiente ? formularioDesdeRevision(pendiente) : confirmada && esMigracionUi(confirmada) ? formularioDesdeRevision(confirmada) : undefined)}>
            {confirmada ? "Nueva revisión del acumulado inicial" : pendiente ? "Continuar borrador del acumulado" : "Cargar acumulado inicial"}
          </button>
        </div>
      ) : null}

      {formAbierto && permisos.puedeCapturar ? (
        <div className="grid gap-3 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-2" data-formulario-migracion>
          <label className="text-xs text-[var(--muted)]">Fecha de corte
            <input type="date" className={`${input} mt-1`} value={form.fechaCorte} max={hoy} onChange={(e) => cambiar({ fechaCorte: e.target.value })} disabled={ocupado} />
          </label>
          <label className="text-xs text-[var(--muted)]">Ingresos gravados acumulados (Q)
            <input inputMode="decimal" className={`${input} mt-1`} value={form.gravado} placeholder="0.00" onChange={(e) => cambiar({ gravado: e.target.value })} disabled={ocupado} />
          </label>
          <label className="text-xs text-[var(--muted)]">Ingresos exentos acumulados (Q)
            <input inputMode="decimal" className={`${input} mt-1`} value={form.exento} placeholder="0.00" onChange={(e) => cambiar({ exento: e.target.value })} disabled={ocupado} />
          </label>
          <label className="text-xs text-[var(--muted)]">IGSS laboral acumulado (Q)
            <input inputMode="decimal" className={`${input} mt-1`} value={form.igss} placeholder="0.00" onChange={(e) => cambiar({ igss: e.target.value })} disabled={ocupado} />
          </label>
          <label className="text-xs text-[var(--muted)]">ISR retenido acumulado (Q)
            <input inputMode="decimal" className={`${input} mt-1`} value={form.isr} placeholder="0.00" onChange={(e) => cambiar({ isr: e.target.value })} disabled={ocupado} />
          </label>
          <label className="text-xs text-[var(--muted)]">Origen / referencia
            <input className={`${input} mt-1`} value={form.referencia} maxLength={1000} onChange={(e) => cambiar({ referencia: e.target.value })} disabled={ocupado} />
          </label>
          <label className="text-xs text-[var(--muted)] sm:col-span-2">Observaciones
            <textarea className={`${input} mt-1`} rows={2} maxLength={1000} value={form.observaciones} onChange={(e) => cambiar({ observaciones: e.target.value })} disabled={ocupado} />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className="rounded bg-[#334155] px-3 py-1.5 text-white disabled:opacity-50" disabled={ocupado} onClick={() => void guardar()}>
              {ocupado ? "Guardando…" : "Guardar borrador"}
            </button>
            <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={ocupado || !pendiente || sucio || !permisos.puedeConfirmar}
              title={!pendiente ? "Primero guarda el borrador" : sucio ? "Guarda los cambios antes de confirmar" : !permisos.puedeConfirmar ? "Sin permiso para confirmar" : undefined}
              onClick={() => setConfirmando(true)}>
              Confirmar acumulado
            </button>
            <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5" disabled={ocupado} onClick={() => setFormAbierto(false)}>Cerrar</button>
          </div>
        </div>
      ) : null}

      {confirmando && resumen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Confirmar acumulado fiscal inicial">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h3 className="text-base font-semibold">{resumen.titulo}</h3>
            <p>{resumen.corte}</p>
            <ul className="space-y-0.5">{resumen.lineas.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="text-xs text-[var(--muted)]">{resumen.aviso}</p>
            {error ? <p role="alert" className="text-red-300">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5" disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
              <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={ocupado} onClick={() => void confirmar()}>
                {ocupado ? "Confirmando…" : "Confirmar acumulado"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
