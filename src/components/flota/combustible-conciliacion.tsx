"use client";

import { useRef, useState } from "react";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";

/**
 * FLOTA-COMBUSTIBLE-3 — subir el reporte .xlsx real de la gasolinera y
 * conciliarlo contra las cargas registradas por los pilotos. Componente
 * propio (extraído de combustible-revision.tsx para no inflar su diff —
 * mismo criterio de "una vista, un archivo" que ya usa ese panel para
 * ResumenMensualView, solo que esta vista es más grande).
 *
 * Esta operación NUNCA aprueba, rechaza ni modifica cargas de
 * combustible automáticamente — solo compara y guarda un snapshot de la
 * conciliación para consulta/auditoría (ver
 * src/lib/flota/combustible-conciliacion-persistencia.ts).
 */

type EstadoConciliacion = "COINCIDE" | "DIFERENCIA" | "SOLO_GASOLINERA" | "SOLO_SISTEMA" | "AMBIGUO";

type ResumenConciliacion = Record<EstadoConciliacion, number>;

type FilaDescartada = { fila: number; motivo: string };

type RespuestaConciliacion = {
  ok: true;
  conciliacionId: number;
  archivo: string;
  hoja: string;
  periodo: { desde: string; hasta: string };
  filasExcelValidas: number;
  filasDescartadas: number;
  cargasSistema: number;
  filasGuardadas: number;
  resumen: ResumenConciliacion;
  descartadas: FilaDescartada[];
};

function formatoFecha(fecha: string): string {
  if (!fecha) return "—";
  const partes = fecha.split("-");
  if (partes.length !== 3) return fecha;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

export function CombustibleConciliacionView({ slug, puedeConciliar }: { slug: string; puedeConciliar: boolean }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [err, setErr] = useState("");
  const [resultado, setResultado] = useState<RespuestaConciliacion | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function subir() {
    if (!puedeConciliar) return setErr("No tienes permiso para realizar conciliaciones de combustible.");
    if (!archivo) return setErr("Selecciona el archivo .xlsx enviado por la gasolinera.");
    if (!/\.xlsx$/i.test(archivo.name)) return setErr("Solo se aceptan archivos Excel .xlsx.");
    if (archivo.size <= 0) return setErr("El archivo está vacío.");
    if (archivo.size > MAX_UPLOAD_BYTES) return setErr("El archivo supera el máximo de 50 MB.");

    setProcesando(true);
    setErr("");
    setResultado(null);
    try {
      const form = new FormData();
      form.set("file", archivo);
      const res = await fetch(`/api/empresas/${slug}/flota/combustible/conciliaciones`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo realizar la conciliación.");
      setResultado(data as RespuestaConciliacion);
      setArchivo(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo realizar la conciliación.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/30 p-4">
        <h3 className="text-sm font-semibold">Conciliar reporte de gasolinera</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Sube el archivo Excel .xlsx enviado por la gasolinera. El sistema confrontará los vales del reporte contra las cargas registradas por los pilotos.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Esta operación no aprueba, rechaza ni modifica cargas de combustible automáticamente.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">Reporte Excel (.xlsx)
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={procesando || !puedeConciliar}
              className="mt-1 block max-w-full text-sm"
              onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setErr(""); setResultado(null); }}
            />
          </label>
          <button
            type="button"
            disabled={procesando || !puedeConciliar || !archivo}
            onClick={() => void subir()}
            className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {procesando ? "Conciliando…" : "Subir y conciliar"}
          </button>
        </div>

        {archivo ? (
          <p className="mt-2 text-xs text-[var(--muted)]">Archivo seleccionado: <span className="font-medium text-[var(--foreground)]">{archivo.name}</span></p>
        ) : null}

        {!puedeConciliar ? (
          <p className="mt-3 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
            Tu usuario tiene acceso de consulta a combustible, pero no permiso para generar una conciliación.
          </p>
        ) : null}

        {err ? <p className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{err}</p> : null}
      </div>

      {resultado ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/10 p-4">
            <p className="font-medium text-[#8fd4a0]">Conciliación #{resultado.conciliacionId} guardada correctamente.</p>
            <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p><span className="text-[var(--muted)]">Archivo:</span> {resultado.archivo}</p>
              <p><span className="text-[var(--muted)]">Hoja:</span> {resultado.hoja}</p>
              <p><span className="text-[var(--muted)]">Desde:</span> {formatoFecha(resultado.periodo.desde)}</p>
              <p><span className="text-[var(--muted)]">Hasta:</span> {formatoFecha(resultado.periodo.hasta)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/10 p-3">
              <p className="text-xs text-[var(--muted)]">Coinciden</p>
              <p className="text-2xl font-semibold">{resultado.resumen.COINCIDE}</p>
            </div>
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/10 p-3">
              <p className="text-xs text-[var(--muted)]">Diferencias</p>
              <p className="text-2xl font-semibold">{resultado.resumen.DIFERENCIA}</p>
            </div>
            <div className="rounded-lg border border-red-700/50 bg-red-950/10 p-3">
              <p className="text-xs text-[var(--muted)]">Solo gasolinera</p>
              <p className="text-2xl font-semibold">{resultado.resumen.SOLO_GASOLINERA}</p>
            </div>
            <div className="rounded-lg border border-sky-700/50 bg-sky-950/10 p-3">
              <p className="text-xs text-[var(--muted)]">Solo sistema</p>
              <p className="text-2xl font-semibold">{resultado.resumen.SOLO_SISTEMA}</p>
            </div>
            <div className="rounded-lg border border-violet-700/50 bg-violet-950/10 p-3">
              <p className="text-xs text-[var(--muted)]">Ambiguos</p>
              <p className="text-2xl font-semibold">{resultado.resumen.AMBIGUO}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs text-[var(--muted)]">Filas válidas del Excel</p>
              <p className="text-lg font-semibold">{resultado.filasExcelValidas}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs text-[var(--muted)]">Cargas del sistema</p>
              <p className="text-lg font-semibold">{resultado.cargasSistema}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs text-[var(--muted)]">Filas guardadas</p>
              <p className="text-lg font-semibold">{resultado.filasGuardadas}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs text-[var(--muted)]">Filas descartadas</p>
              <p className="text-lg font-semibold">{resultado.filasDescartadas}</p>
            </div>
          </div>

          {resultado.descartadas.length > 0 ? (
            <div className="rounded-lg border border-amber-800/40 p-3">
              <h4 className="text-sm font-semibold">Filas descartadas del Excel</h4>
              <p className="mt-1 text-xs text-[var(--muted)]">Estas filas no pudieron participar en la conciliación y deben revisarse manualmente.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[500px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                      <th className="px-2 py-2">Fila Excel</th>
                      <th className="px-2 py-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.descartadas.map((fila, index) => (
                      <tr key={`${fila.fila}-${index}`} className="border-b border-[var(--border)]">
                        <td className="px-2 py-2">{fila.fila}</td>
                        <td className="px-2 py-2">{fila.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-[var(--muted)]">
            Coincide significa que los datos comparados del vale concuerdan. No significa que la carga haya sido aprobada para pago; la revisión operativa sigue siendo un proceso separado.
          </p>
        </div>
      ) : null}
    </div>
  );
}
