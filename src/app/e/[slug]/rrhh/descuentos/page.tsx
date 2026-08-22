"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/**
 * Fase D1 — Motor de descuentos y cuotas. Reemplaza la pantalla plana
 * anterior (rrhh_descuentos, texto libre). Esa tabla histórica NO se toca
 * ni se borra — solo deja de recibir altas nuevas desde aquí.
 */

const CLASIFICACIONES = ["LEGAL", "AUTORIZADO", "JUDICIAL", "SISTEMA"] as const;
// Fase INV-1: "INVENTARIO" existe en el backend (descuentos generados desde
// RRHH > Inventario > Entregar) pero NO se ofrece aquí como opción de alta
// manual — solo se agrega a la lista de FILTRO, para no duplicar el
// formulario de entrega dentro de Descuentos.
const CLASIFICACIONES_FILTRO = [...CLASIFICACIONES, "INVENTARIO"] as const;
const ESTADOS = ["BORRADOR", "ACTIVO", "PAUSADO", "FINALIZADO", "CANCELADO"] as const;
const PERIODICIDADES = [
  { value: "UNA_VEZ", label: "Una vez" },
  { value: "CADA_QUINCENA", label: "Cada quincena" },
  { value: "SOLO_QUINCENA_1", label: "Solo primera quincena de cada mes" },
  { value: "SOLO_QUINCENA_2", label: "Solo segunda quincena de cada mes" },
  { value: "CADA_N_QUINCENAS", label: "Cada N quincenas" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "MANUAL", label: "Manual (sin calendario automático)" },
] as const;

type Clasificacion = (typeof CLASIFICACIONES)[number];
type ClasificacionFiltro = (typeof CLASIFICACIONES_FILTRO)[number];
type Estado = (typeof ESTADOS)[number];
type Periodicidad = (typeof PERIODICIDADES)[number]["value"];

type Emp = { id: number; codigo: string; nombre: string };

type Descuento = {
  id: number;
  empleadoId: number;
  empleadoCodigo: string;
  empleadoNombre: string;
  codigo: string;
  concepto: string;
  // Fase INV-1: puede venir "INVENTARIO" además de las 4 clasificaciones de
  // alta manual — de ahí ClasificacionFiltro (más amplio que Clasificacion)
  // en vez del tipo usado por el formulario de creación.
  clasificacion: ClasificacionFiltro;
  motivo: string | null;
  montoOriginal: number;
  estado: Estado;
  periodicidad: Periodicidad;
  numeroCuotas: number;
  montoCuota: number;
  cadaNQuincenas: number | null;
  fechaInicio: string;
  documentoId: number | null;
  autorizadoPor: string | null;
  autorizadoEn: string | null;
  motivoPausa: string | null;
  motivoCancelacion: string | null;
  pagado: number;
  saldo: number;
  cuotasTotal: number;
  cuotasAplicadas: number;
  proximaCuota: { numero: number; fecha: string; monto: number } | null;
};

type Cuota = {
  id: number;
  numeroCuota: number;
  fechaProgramada: string;
  montoProgramado: number;
  montoAplicado: number | null;
  estado: "PENDIENTE" | "APLICADA" | "OMITIDA" | "CANCELADA";
  motivoAjuste: string | null;
};

type Abono = {
  id: number;
  monto: number;
  fecha: string;
  motivo: string;
  registradoPor: string | null;
};

function q(n: number) {
  return n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type FiltrosLista = {
  empleado: number;
  estado: "" | Estado;
  clasificacion: "" | ClasificacionFiltro;
  concepto: string;
  fechaDesde: string;
  fechaHasta: string;
};

type ResultadoLista =
  | { ok: true; empleados: Emp[]; descuentos: Descuento[]; aviso: string }
  | { ok: false; error: string };

/**
 * Fetch puro, sin tocar estado de React — lo reutilizan tanto el efecto de
 * montaje/filtros como la función `cargar()` que disparan las acciones
 * (crear, autorizar, pausar…). Mismo patrón que obtenerProgramacion() en
 * programacion-client.tsx.
 */
async function obtenerListaDescuentos(
  slug: string,
  filtros: FiltrosLista,
): Promise<ResultadoLista> {
  const params = new URLSearchParams();
  if (filtros.empleado) params.set("empleadoId", String(filtros.empleado));
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.clasificacion) params.set("clasificacion", filtros.clasificacion);
  if (filtros.concepto.trim()) params.set("concepto", filtros.concepto.trim());
  if (filtros.fechaDesde) params.set("fechaDesde", filtros.fechaDesde);
  if (filtros.fechaHasta) params.set("fechaHasta", filtros.fechaHasta);
  try {
    const [e, d] = await Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/rrhh/descuentos?${params.toString()}`).then((r) => r.json()),
    ]);
    return {
      ok: true,
      empleados: e.empleados ?? [],
      descuentos: d.descuentos ?? [],
      aviso: d.aviso ?? "",
    };
  } catch {
    return { ok: false, error: "Error de conexión al cargar descuentos." };
  }
}

const ETIQUETA_ESTADO: Record<Estado, string> = {
  BORRADOR: "Borrador",
  ACTIVO: "Activo",
  PAUSADO: "Pausado",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};

const COLOR_ESTADO: Record<Estado, string> = {
  BORRADOR: "text-[var(--muted)]",
  ACTIVO: "text-emerald-400",
  PAUSADO: "text-amber-300",
  FINALIZADO: "text-sky-400",
  CANCELADO: "text-red-400",
};

export default function DescuentosPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Descuento[]>([]);
  const [aviso, setAviso] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Filtros
  const [fEmpleado, setFEmpleado] = useState(0);
  const [fEstado, setFEstado] = useState<"" | Estado>("");
  const [fClasificacion, setFClasificacion] = useState<"" | ClasificacionFiltro>("");
  const [fConcepto, setFConcepto] = useState("");
  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");

  // Formulario de creación
  const [empleadoId, setEmpleadoId] = useState(0);
  const [concepto, setConcepto] = useState("");
  const [clasificacion, setClasificacion] = useState<Clasificacion>("AUTORIZADO");
  const [motivo, setMotivo] = useState("");
  const [montoOriginal, setMontoOriginal] = useState(0);
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>("CADA_QUINCENA");
  const [numeroCuotas, setNumeroCuotas] = useState(1);
  const [cadaNQuincenas, setCadaNQuincenas] = useState(2);
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().slice(0, 10));
  const [documentoId, setDocumentoId] = useState("");

  // Detalle
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<Descuento | null>(null);
  const [cuotas, setCuotas] = useState<Cuota[]>([]);
  const [abonos, setAbonos] = useState<Abono[]>([]);
  const [abonoMonto, setAbonoMonto] = useState(0);
  const [abonoMotivo, setAbonoMotivo] = useState("");
  const [nuevoNumCuotas, setNuevoNumCuotas] = useState(0);

  // Carga inicial + recarga al cambiar filtros: función definida DENTRO del
  // efecto (patrón oficial de React "Fetching data with Effects"), con
  // bandera `ignore` para no aplicar una respuesta obsoleta si los filtros
  // cambian rápido. No llama a `cargar()` de abajo — esa es la que disparan
  // los manejadores de clic (crear, autorizar, pausar…), no un efecto.
  useEffect(() => {
    let ignore = false;
    async function cargarInicial() {
      const r = await obtenerListaDescuentos(slug, {
        empleado: fEmpleado,
        estado: fEstado,
        clasificacion: fClasificacion,
        concepto: fConcepto,
        fechaDesde: fFechaDesde,
        fechaHasta: fFechaHasta,
      });
      if (ignore) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEmpleados(r.empleados);
      setRows(r.descuentos);
      setAviso(r.aviso);
      setEmpleadoId((prev) => (prev ? prev : (r.empleados[0]?.id ?? 0)));
    }
    void cargarInicial();
    return () => {
      ignore = true;
    };
  }, [slug, fEmpleado, fEstado, fClasificacion, fConcepto, fFechaDesde, fFechaHasta]);

  async function cargar() {
    const r = await obtenerListaDescuentos(slug, {
      empleado: fEmpleado,
      estado: fEstado,
      clasificacion: fClasificacion,
      concepto: fConcepto,
      fechaDesde: fFechaDesde,
      fechaHasta: fFechaHasta,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEmpleados(r.empleados);
    setRows(r.descuentos);
    setAviso(r.aviso);
    setEmpleadoId((prev) => (prev ? prev : (r.empleados[0]?.id ?? 0)));
  }

  const cargarDetalle = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/empresas/${slug}/rrhh/descuentos/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo abrir el descuento.");
        return;
      }
      setDetalleId(id);
      setDetalle(data.descuento);
      setCuotas(data.cuotas ?? []);
      setAbonos(data.abonos ?? []);
      setNuevoNumCuotas(
        (data.cuotas ?? []).filter((c: Cuota) => c.estado === "PENDIENTE").length,
      );
    },
    [slug],
  );

  async function onCrear(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const body: Record<string, unknown> = {
      empleadoId,
      concepto,
      clasificacion,
      motivo: motivo || undefined,
      montoOriginal,
      periodicidad,
      numeroCuotas: periodicidad === "UNA_VEZ" || periodicidad === "MANUAL" ? 1 : numeroCuotas,
      fechaInicio,
    };
    if (periodicidad === "CADA_N_QUINCENAS") body.cadaNQuincenas = cadaNQuincenas;
    if (documentoId.trim()) body.documentoId = Number(documentoId.trim());

    const res = await fetch(`/api/empresas/${slug}/rrhh/descuentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    setConcepto("");
    setMotivo("");
    setMontoOriginal(0);
    setNumeroCuotas(1);
    setDocumentoId("");
    await cargar();
    if (data.id) await cargarDetalle(Number(data.id));
  }

  async function accion(
    act:
      | "autorizar"
      | "pausar"
      | "reanudar"
      | "cancelar"
      | "recalcular_cuotas"
      | "registrar_abono",
    body: Record<string, unknown> = {},
  ) {
    if (!detalleId) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/descuentos/${detalleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: act, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      setMsg(data.mensaje);
      if (data.descuento) setDetalle(data.descuento);
      if (data.cuotas) setCuotas(data.cuotas);
      if (data.abonos) setAbonos(data.abonos);
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  function solicitarMotivoYEjecutar(
    act: "pausar" | "cancelar",
    etiqueta: string,
  ) {
    const m = window.prompt(`Motivo para ${etiqueta} (obligatorio):`);
    if (m == null) return;
    if (!m.trim()) {
      setError("Debes indicar un motivo.");
      return;
    }
    void accion(act, { motivo: m.trim() });
  }

  function onRegistrarAbono(e: FormEvent) {
    e.preventDefault();
    if (!abonoMotivo.trim()) {
      setError("Debes indicar un motivo para el abono.");
      return;
    }
    void accion("registrar_abono", {
      monto: abonoMonto,
      fecha: new Date().toISOString().slice(0, 10),
      motivo: abonoMotivo.trim(),
    }).then(() => {
      setAbonoMonto(0);
      setAbonoMotivo("");
    });
  }

  const rowsFiltradas = useMemo(() => rows, [rows]);
  const totales = useMemo(
    () => rows.reduce(
      (acc, r) => ({
        original: acc.original + r.montoOriginal,
        pagado: acc.pagado + r.pagado,
        saldo: acc.saldo + r.saldo,
      }),
      { original: 0, pagado: 0, saldo: 0 },
    ),
    [rows],
  );

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Descuentos</h1>
        <p className="text-sm text-[var(--muted)]">
          Motor de descuentos con cuotas, saldo y autorización.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>

      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      {/* Crear */}
      <form
        onSubmit={onCrear}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <select
          className={input}
          value={empleadoId}
          onChange={(e) => setEmpleadoId(Number(e.target.value))}
        >
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.codigo} — {e.nombre}
            </option>
          ))}
        </select>
        <input
          className={`${input} min-w-[10rem]`}
          placeholder="Concepto"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          required
        />
        <select
          className={input}
          value={clasificacion}
          onChange={(e) => setClasificacion(e.target.value as Clasificacion)}
        >
          {CLASIFICACIONES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.01"
          min={0.01}
          className={`${input} w-28`}
          placeholder="Monto original"
          value={montoOriginal || ""}
          onChange={(e) => setMontoOriginal(Number(e.target.value))}
          required
        />
        <select
          className={input}
          value={periodicidad}
          onChange={(e) => setPeriodicidad(e.target.value as Periodicidad)}
        >
          {PERIODICIDADES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {periodicidad !== "UNA_VEZ" && periodicidad !== "MANUAL" ? (
          <input
            type="number"
            min={1}
            max={60}
            className={`${input} w-20`}
            placeholder="# cuotas"
            value={numeroCuotas || ""}
            onChange={(e) => setNumeroCuotas(Number(e.target.value))}
            required
          />
        ) : null}
        {periodicidad === "CADA_N_QUINCENAS" ? (
          <input
            type="number"
            min={1}
            className={`${input} w-28`}
            placeholder="cada N quincenas"
            value={cadaNQuincenas || ""}
            onChange={(e) => setCadaNQuincenas(Number(e.target.value))}
            required
          />
        ) : null}
        <input
          type="date"
          className={input}
          value={fechaInicio}
          onChange={(e) => setFechaInicio(e.target.value)}
        />
        <input
          className={`${input} w-36`}
          placeholder="ID documento (opc.)"
          value={documentoId}
          onChange={(e) => setDocumentoId(e.target.value)}
        />
        <input
          className={`${input} min-w-[12rem] flex-1`}
          placeholder="Motivo (opcional)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Crear (borrador)
        </button>
      </form>
      <p className="text-xs text-[var(--muted)]">
        El documento (opcional aquí) es obligatorio para autorizar descuentos JUDICIAL — puedes
        consultar el ID en la ficha de documentos del colaborador. IGSS/ISR no se manejan desde
        aquí: siguen calculándose automáticamente en Planillas.
      </p>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select
          className={input}
          value={fEmpleado}
          onChange={(e) => setFEmpleado(Number(e.target.value))}
        >
          <option value={0}>Todos los colaboradores</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.codigo} — {e.nombre}
            </option>
          ))}
        </select>
        <select
          className={input}
          value={fEstado}
          onChange={(e) => setFEstado(e.target.value as "" | Estado)}
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((s) => (
            <option key={s} value={s}>
              {ETIQUETA_ESTADO[s]}
            </option>
          ))}
        </select>
        <select
          className={input}
          value={fClasificacion}
          onChange={(e) => setFClasificacion(e.target.value as "" | ClasificacionFiltro)}
        >
          <option value="">Toda clasificación</option>
          {CLASIFICACIONES_FILTRO.map((c) => (
            <option key={c} value={c}>
              {c === "INVENTARIO" ? "INVENTARIO (origen: Inventario)" : c}
            </option>
          ))}
        </select>
        <input
          className={`${input} min-w-[10rem]`}
          placeholder="Filtrar por concepto…"
          value={fConcepto}
          onChange={(e) => setFConcepto(e.target.value)}
        />
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Desde
          <input type="date" className={input} value={fFechaDesde} onChange={(e) => setFFechaDesde(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Hasta
          <input type="date" className={input} value={fFechaHasta} onChange={(e) => setFFechaHasta(e.target.value)} />
        </label>
        {(fEmpleado || fEstado || fClasificacion || fConcepto || fFechaDesde || fFechaHasta) ? (
          <button type="button" className={`${input} text-[var(--accent)]`} onClick={() => {
            setFEmpleado(0); setFEstado(""); setFClasificacion(""); setFConcepto(""); setFFechaDesde(""); setFFechaHasta("");
          }}>
            Limpiar filtros
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"><p className="text-xs text-[var(--muted)]">Descuentos encontrados</p><p className="text-lg font-semibold">{rows.length}</p></div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"><p className="text-xs text-[var(--muted)]">Total original</p><p className="text-lg font-semibold">Q{q(totales.original)}</p></div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"><p className="text-xs text-[var(--muted)]">Total descontado</p><p className="text-lg font-semibold text-emerald-400">Q{q(totales.pagado)}</p></div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"><p className="text-xs text-[var(--muted)]">Saldo pendiente</p><p className="text-lg font-semibold text-amber-300">Q{q(totales.saldo)}</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        {/* Lista */}
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--card)] text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2">Código</th>
                <th className="px-2 py-2">Colaborador</th>
                <th className="px-2 py-2">Concepto</th>
                <th className="px-2 py-2">Clasif.</th>
                <th className="px-2 py-2">Original</th>
                <th className="px-2 py-2">Pagado</th>
                <th className="px-2 py-2">Saldo</th>
                <th className="px-2 py-2">Cuotas</th>
                <th className="px-2 py-2">Próxima</th>
                <th className="px-2 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => void cargarDetalle(r.id)}
                  className={[
                    "cursor-pointer border-t border-[var(--border)] hover:bg-white/5",
                    detalleId === r.id ? "bg-[var(--accent)]/10" : "",
                  ].join(" ")}
                >
                  <td className="px-2 py-2 font-medium">{r.codigo}</td>
                  <td className="px-2 py-2">
                    {r.empleadoCodigo} — {r.empleadoNombre}
                  </td>
                  <td className="px-2 py-2">
                    <div>{r.concepto}</div>
                    {r.motivo ? <div className="text-xs text-[var(--muted)]">{r.motivo}</div> : null}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {r.clasificacion === "INVENTARIO" ? (
                      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-sky-300">
                        Inventario
                      </span>
                    ) : (
                      r.clasificacion
                    )}
                  </td>
                  <td className="px-2 py-2">Q{q(r.montoOriginal)}</td>
                  <td className="px-2 py-2">Q{q(r.pagado)}</td>
                  <td className="px-2 py-2 font-medium">Q{q(r.saldo)}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.cuotasAplicadas}/{r.cuotasTotal || r.numeroCuotas}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {r.proximaCuota
                      ? `${r.proximaCuota.fecha} · Q${q(r.proximaCuota.monto)}`
                      : "—"}
                  </td>
                  <td className={`px-2 py-2 text-xs font-medium ${COLOR_ESTADO[r.estado]}`}>
                    {ETIQUETA_ESTADO[r.estado]}
                  </td>
                </tr>
              ))}
              {!rowsFiltradas.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-4 text-[var(--muted)]">
                    Sin descuentos con estos filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Detalle */}
        <div className="space-y-3">
          {!detalle ? (
            <p className="text-sm text-[var(--muted)]">
              Selecciona un descuento de la lista para ver su detalle.
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-medium">{detalle.codigo}</h2>
                  <span className={`text-sm font-medium ${COLOR_ESTADO[detalle.estado]}`}>
                    {ETIQUETA_ESTADO[detalle.estado]}
                  </span>
                </div>
                <p className="text-sm text-[var(--muted)]">
                  {detalle.empleadoCodigo} — {detalle.empleadoNombre} · {detalle.concepto} ·{" "}
                  {detalle.clasificacion}
                </p>
                {detalle.motivo ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">Motivo: {detalle.motivo}</p>
                ) : null}

                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-[var(--muted)]">Original</p>
                    <p className="font-medium">Q{q(detalle.montoOriginal)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Pagado</p>
                    <p className="font-medium text-emerald-400">Q{q(detalle.pagado)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)]">Saldo</p>
                    <p className="font-medium">Q{q(detalle.saldo)}</p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-[var(--muted)]">
                  Plan: {detalle.numeroCuotas} cuota(s) de ~Q{q(detalle.montoCuota)} ·{" "}
                  {PERIODICIDADES.find((p) => p.value === detalle.periodicidad)?.label}
                  {detalle.periodicidad === "CADA_N_QUINCENAS" && detalle.cadaNQuincenas
                    ? ` (cada ${detalle.cadaNQuincenas})`
                    : ""}{" "}
                  · Inicio {detalle.fechaInicio}
                </p>
                {detalle.documentoId ? (
                  <p className="text-xs text-[var(--muted)]">
                    Documento vinculado: #{detalle.documentoId}
                  </p>
                ) : (
                  <p className="text-xs text-amber-300">Sin documento vinculado.</p>
                )}
                {detalle.autorizadoPor ? (
                  <p className="text-xs text-[var(--muted)]">
                    Autorizado por {detalle.autorizadoPor} el {detalle.autorizadoEn}
                  </p>
                ) : null}
                {detalle.motivoPausa ? (
                  <p className="text-xs text-amber-300">Pausado: {detalle.motivoPausa}</p>
                ) : null}
                {detalle.motivoCancelacion ? (
                  <p className="text-xs text-red-400">
                    Cancelado: {detalle.motivoCancelacion}
                  </p>
                ) : null}

                {/* Acciones según estado */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {detalle.estado === "BORRADOR" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void accion("autorizar")}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Autorizar
                    </button>
                  ) : null}
                  {detalle.estado === "ACTIVO" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => solicitarMotivoYEjecutar("pausar", "pausar")}
                      className="rounded bg-[#334155] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Pausar
                    </button>
                  ) : null}
                  {detalle.estado === "PAUSADO" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void accion("reanudar")}
                      className="rounded bg-[#334155] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Reanudar
                    </button>
                  ) : null}
                  {["BORRADOR", "ACTIVO", "PAUSADO"].includes(detalle.estado) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => solicitarMotivoYEjecutar("cancelar", "cancelar")}
                      className="rounded bg-red-900/60 px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </div>

              {(detalle.estado === "ACTIVO" || detalle.estado === "PAUSADO") ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                  <h3 className="text-sm font-medium">Recalcular cuotas futuras</h3>
                  <p className="text-xs text-[var(--muted)]">
                    Solo afecta cuotas PENDIENTES. Redistribuye el saldo restante.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      className={`${input} w-28`}
                      value={nuevoNumCuotas || ""}
                      onChange={(e) => setNuevoNumCuotas(Number(e.target.value))}
                      placeholder="# cuotas restantes"
                    />
                    <button
                      type="button"
                      disabled={busy || !nuevoNumCuotas}
                      onClick={() =>
                        void accion("recalcular_cuotas", { numeroCuotas: nuevoNumCuotas })
                      }
                      className="rounded bg-[#334155] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Recalcular
                    </button>
                  </div>

                  <h3 className="mt-4 text-sm font-medium">Abono extraordinario</h3>
                  <form onSubmit={onRegistrarAbono} className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0.01}
                      className={`${input} w-28`}
                      placeholder="Monto"
                      value={abonoMonto || ""}
                      onChange={(e) => setAbonoMonto(Number(e.target.value))}
                      required
                    />
                    <input
                      className={`${input} min-w-[10rem] flex-1`}
                      placeholder="Motivo"
                      value={abonoMotivo}
                      onChange={(e) => setAbonoMotivo(e.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Registrar abono
                    </button>
                  </form>
                </div>
              ) : null}

              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <h3 className="text-sm font-medium">Historial de cuotas</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {cuotas.map((c) => (
                    <li key={c.id} className="flex items-center justify-between">
                      <span>
                        #{c.numeroCuota} · {c.fechaProgramada} · Q
                        {q(c.montoAplicado ?? c.montoProgramado)}
                        {c.motivoAjuste ? ` (ajuste: ${c.motivoAjuste})` : ""}
                      </span>
                      <span
                        className={
                          c.estado === "APLICADA"
                            ? "text-emerald-400"
                            : c.estado === "PENDIENTE"
                              ? "text-[var(--muted)]"
                              : "text-red-400"
                        }
                      >
                        {c.estado}
                      </span>
                    </li>
                  ))}
                  {!cuotas.length ? (
                    <li className="text-[var(--muted)]">
                      Sin cuotas todavía (se generan al autorizar).
                    </li>
                  ) : null}
                </ul>
              </div>

              {abonos.length ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                  <h3 className="text-sm font-medium">Abonos extraordinarios</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {abonos.map((a) => (
                      <li key={a.id}>
                        {a.fecha} · Q{q(a.monto)} · {a.motivo}
                        {a.registradoPor ? ` · ${a.registradoPor}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
