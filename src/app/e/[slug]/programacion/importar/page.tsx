"use client";

import { useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatearHora12 } from "@/lib/tms/hora-formato";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 6 de 6) — Programación >
 * Importar Excel. Mismo patrón de 2 fases (validar sin escribir, luego
 * importar) que ya usa Rutas > Importar Excel
 * (src/app/e/[slug]/rutas/importar/page.tsx), simplificado porque V1 de
 * Programación es determinístico: no hay decisiones por fila ni por
 * cliente que el usuario deba resolver aquí — cada fila o resuelve
 * limpio contra catálogo (BD), o es un error que bloquea la importación
 * completa (todo o nada), ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-1-
 * PROPUESTA-FINAL.md.
 *
 * Los nombres que se muestran (ruta, cliente, piloto, auxiliares,
 * unidad) son SIEMPRE los que el backend ya resolvió contra BD
 * (`fila.resuelto`) — nunca el texto crudo del Excel, salvo en filas con
 * error (ahí no hay nada "resuelto" que mostrar, así que se muestra el
 * crudo como respaldo visual para que el usuario vea qué escribió).
 */

type DatosResueltosFila = {
  rutaId: number;
  rutaCodigo: string;
  clienteId: number;
  clienteNombre: string;
  pilotoEmpleadoId: number;
  pilotoNombre: string;
  pilotoPersonalId: number | null;
  auxiliares: { empleadoId: number; nombre: string; personalId: number | null }[];
  unidadPlaca: string;
  /** TC INTERNO resuelto por el backend (solo si la fila trae TC). */
  tcVehiculoId?: number;
  tcPlaca?: string;
  unidadId: number | null;
  tarifaVigente: number;
  regresoEstimado: string | null;
  lugarCargaTexto: string | null;
  destinoDescripcion: string | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
};

type EstadoFila = "ok" | "error";

type FilaValidar = {
  filaExcel: number;
  estado: EstadoFila;
  errores: string[];
  advertencias: string[];
  fechaSalidaExcel: string | null;
  horaSalidaExcel: string | null;
  codigoRutaExcel: string;
  clienteExcel: string;
  pilotoCodigoExcel: string;
  placaExcel: string;
  auxiliar1CodigoExcel: string;
  auxiliar2CodigoExcel: string;
  tipoTrasladoExcel: string;
  tarifaExcel: number | null;
  fechaRegresoExcel: string | null;
  horaRegresoExcel: string | null;
  observacionesExcel: string;
  tcExcel?: string;
  resuelto: DatosResueltosFila | null;
};

type ResumenPreview = { totalFilas: number; filasOk: number; filasConError: number };

type RespuestaValidar = { accion: "validar"; filas: FilaValidar[]; resumen: ResumenPreview };

type ResultadoImportar =
  | { resultado: "exitoso"; filasTotales: number; filasImportadas: number; planIds: number[] }
  | { resultado: "error"; mensaje: string; erroresPorFila?: { filaExcel: number; errores: string[] }[] };

type RespuestaImportar = { accion: "importar"; resultado: ResultadoImportar };

const input = "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm";

async function leerJsonSeguro(res: Response): Promise<Record<string, unknown>> {
  const texto = await res.text();
  if (!texto.trim()) return {};
  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Verifica en runtime la forma de la respuesta de accion=validar antes de guardarla en el estado — un contrato roto no debe tumbar la página con un `.map` sobre `undefined`. */
export function respuestaValidarValida(data: Record<string, unknown>): data is RespuestaValidar {
  return (
    data.accion === "validar" &&
    Array.isArray(data.filas) &&
    typeof data.resumen === "object" &&
    data.resumen !== null
  );
}

export function respuestaImportarValida(data: Record<string, unknown>): data is RespuestaImportar {
  return data.accion === "importar" && typeof data.resultado === "object" && data.resultado !== null;
}

/** "YYYY-MM-DDTHH:mm" (mismo contrato que usa el resto de Programación) -> "YYYY-MM-DD hh:mm AM/PM". Nunca usa fmtTs/zona horaria: este valor ya es hora de pared, no un timestamp con zona. */
export function formatearFechaHoraSimple(value: string | null): string {
  if (!value) return "—";
  const [fecha, hora] = value.split("T");
  if (!fecha) return "—";
  const horaFmt = formatearHora12(hora ?? null);
  return horaFmt === "—" ? fecha : `${fecha} ${horaFmt}`;
}

export function formatearSalidaExcel(fecha: string | null, hora: string | null): string {
  if (!fecha) return "—";
  const horaFmt = formatearHora12(hora);
  return horaFmt === "—" ? fecha : `${fecha} ${horaFmt}`;
}

/**
 * Regla "mientras existan errores, NO permitir confirmar" (advertencias
 * SÍ permiten continuar) — extraída a función pura para poder probarla
 * directamente, sin renderizar el componente (este proyecto no tiene
 * harness de componentes React, ver vitest.config.mts: environment
 * "node", solo incluye `*.test.ts`).
 */
export function puedeConfirmarImportacion(preview: { resumen: ResumenPreview } | null): boolean {
  if (!preview) return false;
  return preview.resumen.filasConError === 0 && preview.resumen.filasOk > 0;
}

export default function ImportarProgramacionPage() {
  const slug = String(useParams().slug);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [validando, setValidando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<RespuestaValidar | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportar | null>(null);

  function cambiarArchivo(e: ChangeEvent<HTMLInputElement>) {
    setArchivo(e.target.files?.[0] ?? null);
    setPreview(null);
    setResultado(null);
    setConfirmando(false);
    setError("");
  }

  async function validar() {
    if (validando || importando) return; // doble submit
    if (!archivo) {
      setError("Selecciona un archivo Excel (.xlsx).");
      return;
    }
    setError("");
    setResultado(null);
    setConfirmando(false);
    setValidando(true);
    try {
      const formData = new FormData();
      formData.set("archivo", archivo);
      formData.set("accion", "validar");
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/importar`, {
        method: "POST",
        body: formData,
      });
      if (res.status === 413) {
        setError("El archivo es demasiado grande (máximo 15 MB).");
        return;
      }
      const data = await leerJsonSeguro(res);
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo validar el archivo.");
        return;
      }
      if (!respuestaValidarValida(data)) {
        console.error("Respuesta de accion=validar con forma inesperada:", data);
        setError("No se pudo interpretar la previsualización. Intenta nuevamente.");
        return;
      }
      setPreview(data);
    } catch {
      setError("Error de conexión al validar el archivo.");
    } finally {
      setValidando(false);
    }
  }

  async function importar() {
    if (importando || validando) return; // doble submit
    if (!archivo || !preview) return;
    setError("");
    setImportando(true);
    setConfirmando(false);
    try {
      const formData = new FormData();
      formData.set("archivo", archivo);
      formData.set("accion", "importar");
      const res = await fetch(`/api/empresas/${slug}/tms/programacion/importar`, {
        method: "POST",
        body: formData,
      });
      if (res.status === 413) {
        setError("El archivo es demasiado grande (máximo 15 MB).");
        return;
      }
      const data = await leerJsonSeguro(res);
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo completar la importación.");
        return;
      }
      if (!respuestaImportarValida(data)) {
        console.error("Respuesta de accion=importar con forma inesperada:", data);
        setError("No se pudo interpretar el resultado de la importación. Verifica en Programación antes de reintentar.");
        return;
      }
      // Nunca se muestra como éxito lo que el backend marcó como error —
      // se guarda tal cual, y el render de abajo distingue ambos casos.
      setResultado(data.resultado);
    } catch {
      setError("Error de conexión al importar.");
    } finally {
      setImportando(false);
    }
  }

  const filas = preview?.filas ?? [];
  const resumen = preview?.resumen ?? { totalFilas: 0, filasOk: 0, filasConError: 0 };
  const hayErrores = resumen.filasConError > 0;
  const puedeConfirmar = puedeConfirmarImportacion(preview);
  const exito = resultado?.resultado === "exitoso";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Importar Programación desde Excel</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Cada fila del Excel es un viaje a crear. Primero se valida sin guardar nada; solo se
            escribe al confirmar, y solo si TODAS las filas pasan la validación (todo o nada).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/empresas/${slug}/tms/programacion/importar`}
            className="rounded bg-[#1F6AA5] px-3 py-2 text-xs text-white"
          >
            Descargar plantilla Excel
          </a>
          <Link href={`/e/${slug}/programacion`} className="rounded border border-[var(--border)] px-3 py-2 text-xs">
            ← Volver a Programación
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
        <p>
          La plantilla incluye hojas de referencia (Rutas, Vehiculos, TC, Empleados, Clientes) — son
          solo ayuda para llenar el Excel, nunca fuente de verdad: al importar siempre se revalida
          todo contra el sistema real. Código de ruta, código de piloto/auxiliares y placa deben
          existir previamente — esta importación nunca crea catálogo nuevo.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input type="file" accept=".xlsx" onChange={cambiarArchivo} className={input} />
          <button
            type="button"
            disabled={!archivo || validando || importando}
            onClick={() => void validar()}
            className="self-end rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {validando ? "Validando…" : "Validar archivo"}
          </button>
        </div>
        {archivo ? <p className="text-xs text-[var(--muted)]">Archivo seleccionado: {archivo.name}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {preview ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <ResumenCard label="Total de filas" value={resumen.totalFilas} />
              <ResumenCard label="Filas válidas" value={resumen.filasOk} className="text-emerald-300" />
              <ResumenCard label="Filas con error" value={resumen.filasConError} className="text-red-300" />
            </div>

            {hayErrores ? (
              <p className="rounded-lg border border-red-700/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                Hay {resumen.filasConError} fila(s) con error — no se puede confirmar la importación
                hasta corregir el Excel y volver a validarlo. Ninguna fila se importa mientras haya
                errores (todo o nada).
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-[var(--thead)] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2">Fila</th>
                    <th className="px-2 py-2">Estado</th>
                    <th className="px-2 py-2">Ruta</th>
                    <th className="px-2 py-2">Cliente</th>
                    <th className="px-2 py-2">Piloto</th>
                    <th className="px-2 py-2">Auxiliares</th>
                    <th className="px-2 py-2">Placa</th>
                    <th className="px-2 py-2">TC / Caja / Remolque</th>
                    <th className="px-2 py-2">Tarifa</th>
                    <th className="px-2 py-2">Salida</th>
                    <th className="px-2 py-2">Regreso estimado</th>
                    <th className="px-2 py-2">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <FilaPreviewRow key={f.filaExcel} fila={f} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!puedeConfirmar || importando || validando || confirmando}
                onClick={() => setConfirmando(true)}
                className="rounded bg-[#1B5E20] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                title={hayErrores ? "Corrige los errores y vuelve a validar antes de confirmar." : undefined}
              >
                Confirmar importación
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setConfirmando(false);
                }}
                disabled={importando}
                className="rounded border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50"
              >
                Limpiar vista previa
              </button>
            </div>

            {confirmando ? (
              <div className="space-y-2 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 text-sm">
                <p>
                  Vas a crear <strong>{resumen.filasOk}</strong> viaje(s) de Programación a partir de
                  este archivo. Esta acción no se puede deshacer desde aquí. ¿Confirmas?
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={importando}
                    onClick={() => void importar()}
                    className="rounded bg-[#1B5E20] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {importando ? "Importando…" : `Sí, importar ${resumen.filasOk} viaje(s)`}
                  </button>
                  <button
                    type="button"
                    disabled={importando}
                    onClick={() => setConfirmando(false)}
                    className="rounded border border-[var(--border)] px-4 py-2 text-xs disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {resultado ? (
          <div
            className={`rounded-lg border p-3 text-sm ${
              exito ? "border-emerald-700/50 bg-emerald-950/20" : "border-red-700/50 bg-red-950/20"
            }`}
          >
            {exito && resultado.resultado === "exitoso" ? (
              <>
                <p className="font-medium text-emerald-300">Importación completada</p>
                <p className="mt-1 text-[var(--muted)]">
                  {resultado.filasImportadas} de {resultado.filasTotales} viaje(s) importado(s)
                  correctamente.
                </p>
                <Link
                  href={`/e/${slug}/programacion`}
                  className="mt-3 inline-block rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white"
                >
                  Ver Programación
                </Link>
              </>
            ) : resultado.resultado === "error" ? (
              <>
                <p className="font-medium text-red-300">No se importó ninguna fila</p>
                <p className="mt-1 text-[var(--muted)]">{resultado.mensaje}</p>
                {resultado.erroresPorFila?.length ? (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--muted)]">
                    {resultado.erroresPorFila.map((f) => (
                      <li key={f.filaExcel}>
                        Fila {f.filaExcel}: {f.errores.join(" ")}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ResumenCard({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-[10px] text-[var(--muted)]">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function FilaPreviewRow({ fila }: { fila: FilaValidar }) {
  const ok = fila.estado === "ok";
  const r = fila.resuelto;
  return (
    <tr className={`border-t border-[var(--border)] align-top ${ok ? "" : "bg-red-950/10"}`}>
      <td className="px-2 py-2">{fila.filaExcel}</td>
      <td className={`px-2 py-2 font-medium ${ok ? "text-emerald-300" : "text-red-300"}`}>
        {ok ? "OK" : "Error"}
      </td>
      <td className="px-2 py-2">{ok ? r?.rutaCodigo : fila.codigoRutaExcel || "—"}</td>
      <td className="px-2 py-2">{ok ? r?.clienteNombre : fila.clienteExcel || "—"}</td>
      <td className="px-2 py-2">{ok ? r?.pilotoNombre : fila.pilotoCodigoExcel || "—"}</td>
      <td className="px-2 py-2">
        {ok
          ? r?.auxiliares.length
            ? r.auxiliares.map((a) => a.nombre).join(", ")
            : "—"
          : [fila.auxiliar1CodigoExcel, fila.auxiliar2CodigoExcel].filter(Boolean).join(", ") || "—"}
      </td>
      <td className="px-2 py-2">{ok ? r?.unidadPlaca : fila.placaExcel || "—"}</td>
      <td className="px-2 py-2">
        {ok ? (r?.tcPlaca ? `${r.tcPlaca} (Propio)` : "—") : fila.tcExcel || "—"}
      </td>
      <td className="px-2 py-2">
        {ok
          ? r != null
            ? `Q${r.tarifaVigente.toFixed(2)}`
            : "—"
          : fila.tarifaExcel != null
            ? `Q${fila.tarifaExcel.toFixed(2)}`
            : "—"}
      </td>
      <td className="px-2 py-2">{formatearSalidaExcel(fila.fechaSalidaExcel, fila.horaSalidaExcel)}</td>
      <td className="px-2 py-2">
        {ok ? formatearFechaHoraSimple(r?.regresoEstimado ?? null) : formatearSalidaExcel(fila.fechaRegresoExcel, fila.horaRegresoExcel)}
      </td>
      <td className="px-2 py-2">
        {fila.errores.length ? (
          <ul className="space-y-0.5 text-red-300">
            {fila.errores.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        {fila.advertencias.length ? (
          <ul className="mt-1 space-y-0.5 text-amber-300">
            {fila.advertencias.map((a, i) => (
              <li key={i}>⚠ {a}</li>
            ))}
          </ul>
        ) : null}
        {!fila.errores.length && !fila.advertencias.length ? <span className="text-[var(--muted)]">—</span> : null}
      </td>
    </tr>
  );
}
