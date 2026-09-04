"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * FLOTA-COMBUSTIBLE-4 — agrega dos sub-pestañas internas: "Nueva
 * conciliación" (el formulario de subida de arriba, sin cambios) e
 * "Historial", que lista las conciliaciones ya guardadas y permite abrir
 * el detalle vale por vale y descargar el Excel original de forma
 * protegida (GET .../conciliaciones/[id]/archivo — la ruta física del
 * archivo nunca sale del servidor, ver esa ruta). Es una vista de solo
 * lectura: no aprueba/rechaza cargas, no marca nada como pagado, no
 * elimina conciliaciones y no vuelve a calcular el snapshot — lo que
 * está guardado es la verdad histórica.
 */

type EstadoConciliacion = "COINCIDE" | "DIFERENCIA" | "SOLO_GASOLINERA" | "SOLO_SISTEMA" | "AMBIGUO";
type EstadoFilaConciliacion = EstadoConciliacion | "DESCARTADA";
type EstadoSistemaHistorico = "PENDIENTE" | "APROBADO" | "RECHAZADO" | null;

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

type HistorialItem = {
  id: number;
  nombreOriginal: string;
  hoja: string;
  subidoPor: string;
  creadoEn: string;
  periodoDesde: string | null;
  periodoHasta: string | null;
  totalFilas: number;
  descartadas: number;
  coincide: number;
  diferencia: number;
  soloGasolinera: number;
  soloSistema: number;
  ambiguo: number;
};

type SnapshotFila = {
  numeroVale: string | null;
  fechaConsumo: string | null;
  placa: string | null;
  pilotoNombre: string | null;
  producto: string | null;
  galones: number | null;
  precioGalon: number | null;
  monto: number | null;
};

type DiferenciaCampo = {
  campo: "fecha" | "placa" | "producto" | "galones" | "precio" | "monto";
  sistema: string;
  gasolinera: string;
};

type FilaDetalle = {
  id: number;
  filaExcel: number | null;
  estado: EstadoFilaConciliacion;
  motivo: string | null;
  cargaCombustibleId: number | null;
  estadoSistema: EstadoSistemaHistorico;
  gasolinera: SnapshotFila | null;
  sistema: SnapshotFila | null;
  diferencias: DiferenciaCampo[];
};

type ConciliacionDetalle = {
  id: number;
  nombreOriginal: string;
  hoja: string;
  subidoPor: string;
  creadoEn: string;
  periodoDesde: string | null;
  periodoHasta: string | null;
  filas: FilaDetalle[];
};

const ETIQUETA_CAMPO: Record<DiferenciaCampo["campo"], string> = {
  fecha: "Fecha",
  placa: "Placa",
  producto: "Producto",
  galones: "Galones",
  precio: "Precio/gal",
  monto: "Monto",
};

const ETIQUETA_ESTADO_FILA: Record<EstadoFilaConciliacion, string> = {
  COINCIDE: "Coincide",
  DIFERENCIA: "Diferencia",
  SOLO_GASOLINERA: "Solo gasolinera",
  SOLO_SISTEMA: "Solo sistema",
  AMBIGUO: "Ambiguo",
  DESCARTADA: "Descartada",
};

const ESTILO_ESTADO_FILA: Record<EstadoFilaConciliacion, string> = {
  COINCIDE: "border-emerald-700/60 bg-emerald-950/20 text-[#8fd4a0]",
  DIFERENCIA: "border-amber-700/60 bg-amber-950/20 text-amber-200",
  SOLO_GASOLINERA: "border-red-700/60 bg-red-950/20 text-red-300",
  SOLO_SISTEMA: "border-sky-700/60 bg-sky-950/20 text-sky-200",
  AMBIGUO: "border-violet-700/60 bg-violet-950/20 text-violet-200",
  DESCARTADA: "border-[var(--border)] bg-[var(--input)]/40 text-[var(--muted)]",
};

const NOTA_ESTADO_FILA: Partial<Record<EstadoFilaConciliacion, string>> = {
  SOLO_GASOLINERA: "No hubo carga del sistema equivalente a este vale.",
  SOLO_SISTEMA: "No hubo fila equivalente en el reporte de la gasolinera.",
  AMBIGUO: "El número de vale aparece repetido y requiere revisión manual.",
};

function formatoFecha(fecha: string | null): string {
  if (!fecha) return "—";
  const partes = fecha.split("-");
  if (partes.length !== 3) return fecha;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function formatoFechaHora(fecha: string): string {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;
  return d.toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" });
}

function formatoMonto(v: number | null): string {
  return v == null ? "—" : `Q${v.toFixed(2)}`;
}

function formatoGalones(v: number | null): string {
  return v == null ? "—" : v.toFixed(3);
}

function EstadoFilaBadge({ estado }: { estado: EstadoFilaConciliacion }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO_FILA[estado]}`}>
      {ETIQUETA_ESTADO_FILA[estado]}
    </span>
  );
}

function EstadoSistemaBadge({ estado }: { estado: EstadoSistemaHistorico }) {
  if (!estado) return <span className="text-xs text-[var(--muted)]">—</span>;
  const estilo =
    estado === "APROBADO"
      ? "border-emerald-700/60 bg-emerald-950/20 text-[#8fd4a0]"
      : estado === "RECHAZADO"
        ? "border-red-700/60 bg-red-950/20 text-red-300"
        : "border-amber-700/60 bg-amber-950/20 text-amber-200";
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${estilo}`}>{estado}</span>;
}

/** Vale por vale, se usa el valor de la gasolinera como referencia principal y se cae al del sistema cuando no hay fila del reporte (SOLO_SISTEMA). */
function valorPrincipal(fila: FilaDetalle): SnapshotFila | null {
  return fila.gasolinera ?? fila.sistema;
}

function FilaDiferencias({ fila }: { fila: FilaDetalle }) {
  const nota = NOTA_ESTADO_FILA[fila.estado];

  if (fila.estado === "DESCARTADA") {
    return <p className="text-xs text-[var(--muted)]">{fila.motivo || "Sin motivo registrado."}</p>;
  }

  if (fila.diferencias.length === 0) {
    return nota ? <p className="text-xs text-[var(--muted)]">{nota}</p> : <span className="text-xs text-[var(--muted)]">—</span>;
  }

  return (
    <div className="space-y-1.5">
      {fila.diferencias.map((d, index) => (
        <div key={`${d.campo}-${index}`} className="text-xs">
          <p className="font-medium text-[var(--foreground)]">{ETIQUETA_CAMPO[d.campo]}:</p>
          <p className="text-[var(--muted)]">Sistema: {d.sistema}</p>
          <p className="text-[var(--muted)]">Gasolinera: {d.gasolinera}</p>
        </div>
      ))}
    </div>
  );
}

function DetalleConciliacionView({
  slug,
  conciliacionId,
  onVolver,
}: {
  slug: string;
  conciliacionId: number;
  onVolver: () => void;
}) {
  const [detalle, setDetalle] = useState<ConciliacionDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetalle(null);
    setErr("");
    setCargando(true);
    fetch(`/api/empresas/${slug}/flota/combustible/conciliaciones/${conciliacionId}`, { signal: ac.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (ac.signal.aborted) return;
        if (!res.ok) throw new Error(data.error ?? "No se pudo obtener el detalle de la conciliación.");
        setDetalle(data.item as ConciliacionDetalle);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "No se pudo obtener el detalle de la conciliación.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setCargando(false);
      });
    return () => ac.abort();
  }, [slug, conciliacionId]);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onVolver}
        className="text-sm text-sky-300 hover:underline"
      >
        ← Volver al historial
      </button>

      {cargando ? <p className="text-sm text-[var(--muted)]">Cargando detalle…</p> : null}
      {err ? <p className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{err}</p> : null}

      {detalle ? (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/30 p-4">
            <h3 className="text-sm font-semibold">Conciliación #{detalle.id}</h3>
            <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p><span className="text-[var(--muted)]">Archivo:</span> {detalle.nombreOriginal}</p>
              <p><span className="text-[var(--muted)]">Hoja:</span> {detalle.hoja}</p>
              <p><span className="text-[var(--muted)]">Subido por:</span> {detalle.subidoPor}</p>
              <p><span className="text-[var(--muted)]">Subido el:</span> {formatoFechaHora(detalle.creadoEn)}</p>
              <p><span className="text-[var(--muted)]">Período desde:</span> {formatoFecha(detalle.periodoDesde)}</p>
              <p><span className="text-[var(--muted)]">Período hasta:</span> {formatoFecha(detalle.periodoHasta)}</p>
            </div>
            <a
              href={`/api/empresas/${slug}/flota/combustible/conciliaciones/${detalle.id}/archivo`}
              className="mt-3 inline-block rounded border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--input)]"
            >
              Descargar Excel original
            </a>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Coincide indica coincidencia de datos. No significa aprobación para pago.
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                  <th className="px-2 py-2">Estado conciliación</th>
                  <th className="px-2 py-2">Estado sistema</th>
                  <th className="px-2 py-2">Fila Excel</th>
                  <th className="px-2 py-2">Vale</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Placa</th>
                  <th className="px-2 py-2">Producto</th>
                  <th className="px-2 py-2">Galones</th>
                  <th className="px-2 py-2">Precio/gal</th>
                  <th className="px-2 py-2">Monto</th>
                  <th className="px-2 py-2">Diferencias</th>
                </tr>
              </thead>
              <tbody>
                {detalle.filas.map((fila) => {
                  const valor = valorPrincipal(fila);
                  return (
                    <tr key={fila.id} className="border-b border-[var(--border)] align-top">
                      <td className="px-2 py-2"><EstadoFilaBadge estado={fila.estado} /></td>
                      <td className="px-2 py-2"><EstadoSistemaBadge estado={fila.estadoSistema} /></td>
                      <td className="px-2 py-2">{fila.filaExcel ?? "—"}</td>
                      <td className="px-2 py-2">{valor?.numeroVale ?? "—"}</td>
                      <td className="px-2 py-2">{formatoFecha(valor?.fechaConsumo ?? null)}</td>
                      <td className="px-2 py-2">{valor?.placa ?? "—"}</td>
                      <td className="px-2 py-2">{valor?.producto ?? "—"}</td>
                      <td className="px-2 py-2">{formatoGalones(valor?.galones ?? null)}</td>
                      <td className="px-2 py-2">{formatoMonto(valor?.precioGalon ?? null)}</td>
                      <td className="px-2 py-2">{formatoMonto(valor?.monto ?? null)}</td>
                      <td className="px-2 py-2 min-w-[220px]"><FilaDiferencias fila={fila} /></td>
                    </tr>
                  );
                })}
                {detalle.filas.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-2 py-4 text-center text-sm text-[var(--muted)]">Sin filas guardadas.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function HistorialConciliacionView({
  slug,
  refrescarSenal,
  detalleInicial,
}: {
  slug: string;
  refrescarSenal: number;
  detalleInicial: number | null;
}) {
  const [items, setItems] = useState<HistorialItem[]>([]);
  const [cargando, setCargando] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [err, setErr] = useState("");
  const [detalleId, setDetalleId] = useState<number | null>(detalleInicial);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr("");
    try {
      const res = await fetch(`/api/empresas/${slug}/flota/combustible/conciliaciones`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo obtener el historial de conciliaciones.");
      setItems((data.items ?? []) as HistorialItem[]);
      setCargado(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo obtener el historial de conciliaciones.");
    } finally {
      setCargando(false);
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [refrescarSenal, cargar]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (detalleInicial != null) setDetalleId(detalleInicial);
  }, [detalleInicial]);

  if (detalleId != null) {
    return <DetalleConciliacionView slug={slug} conciliacionId={detalleId} onVolver={() => setDetalleId(null)} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        Coincide indica coincidencia de datos. No significa aprobación para pago.
      </p>

      {err ? <p className="rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-sm text-red-300" role="alert">{err}</p> : null}
      {cargando && !cargado ? <p className="text-sm text-[var(--muted)]">Cargando historial…</p> : null}

      {cargado && items.length === 0 && !err ? (
        <p className="text-sm text-[var(--muted)]">Todavía no se ha guardado ninguna conciliación.</p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2">Archivo</th>
                <th className="px-2 py-2">Hoja</th>
                <th className="px-2 py-2">Período</th>
                <th className="px-2 py-2">Coinciden</th>
                <th className="px-2 py-2">Diferencias</th>
                <th className="px-2 py-2">Solo gasolinera</th>
                <th className="px-2 py-2">Solo sistema</th>
                <th className="px-2 py-2">Ambiguos</th>
                <th className="px-2 py-2">Descartadas</th>
                <th className="px-2 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[var(--border)]">
                  <td className="px-2 py-2 whitespace-nowrap">{formatoFechaHora(item.creadoEn)}</td>
                  <td className="px-2 py-2">{item.nombreOriginal}</td>
                  <td className="px-2 py-2">{item.hoja}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{formatoFecha(item.periodoDesde)} – {formatoFecha(item.periodoHasta)}</td>
                  <td className="px-2 py-2">{item.coincide}</td>
                  <td className="px-2 py-2">{item.diferencia}</td>
                  <td className="px-2 py-2">{item.soloGasolinera}</td>
                  <td className="px-2 py-2">{item.soloSistema}</td>
                  <td className="px-2 py-2">{item.ambiguo}</td>
                  <td className="px-2 py-2">{item.descartadas}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDetalleId(item.id)}
                        className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--input)]"
                      >
                        Ver detalle
                      </button>
                      <a
                        href={`/api/empresas/${slug}/flota/combustible/conciliaciones/${item.id}/archivo`}
                        className="rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--input)]"
                      >
                        Descargar Excel
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function CombustibleConciliacionView({ slug, puedeConciliar }: { slug: string; puedeConciliar: boolean }) {
  const [sub, setSub] = useState<"nueva" | "historial">("nueva");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [err, setErr] = useState("");
  const [resultado, setResultado] = useState<RespuestaConciliacion | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Se incrementa cada vez que el historial debe refrescarse (montaje de
  // la sub-pestaña Historial + cada conciliación nueva guardada con
  // éxito) — HistorialConciliacionView lo observa para volver a pedir la
  // lista.
  const [refrescarHistorial, setRefrescarHistorial] = useState(0);
  const [detalleAbrir, setDetalleAbrir] = useState<number | null>(null);

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
      // FLOTA-COMBUSTIBLE-4: refrescar automáticamente el historial tras
      // guardar con éxito — no cambia de sub-pestaña, solo mantiene el
      // historial al día para cuando el usuario lo abra.
      setRefrescarHistorial((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo realizar la conciliación.");
    } finally {
      setProcesando(false);
    }
  }

  function verDetalleRecienCreado() {
    if (!resultado) return;
    setDetalleAbrir(resultado.conciliacionId);
    setSub("historial");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSub("nueva")}
          className={`rounded border p-2 text-center text-sm font-medium transition ${sub === "nueva" ? "border-sky-500 bg-sky-950/20 text-sky-200" : "border-[var(--border)] hover:bg-[var(--input)]"}`}
        >
          Nueva conciliación
        </button>
        <button
          type="button"
          onClick={() => {
            // Un clic manual en la pestaña siempre muestra la lista —
            // solo "Ver detalle" (verDetalleRecienCreado) debe abrir un
            // detalle específico directamente.
            setDetalleAbrir(null);
            setSub("historial");
          }}
          className={`rounded border p-2 text-center text-sm font-medium transition ${sub === "historial" ? "border-sky-500 bg-sky-950/20 text-sky-200" : "border-[var(--border)] hover:bg-[var(--input)]"}`}
        >
          Historial
        </button>
      </div>

      {sub === "historial" ? (
        <HistorialConciliacionView slug={slug} refrescarSenal={refrescarHistorial} detalleInicial={detalleAbrir} />
      ) : null}

      {sub === "nueva" ? (
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-[#8fd4a0]">Conciliación #{resultado.conciliacionId} guardada correctamente.</p>
                  <button
                    type="button"
                    onClick={verDetalleRecienCreado}
                    className="rounded border border-emerald-700/60 px-3 py-1.5 text-xs font-medium text-[#8fd4a0] hover:bg-emerald-950/20"
                  >
                    Ver detalle
                  </button>
                </div>
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
      ) : null}
    </div>
  );
}
