"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  FORMAS_PAGO,
  etiquetaFormaPago,
  etiquetaTipoContrato,
  type FormaPago,
} from "@/lib/rrhh/contratos-pago";

type TipoPeriodo = "QUINCENA_1" | "QUINCENA_2" | "MENSUAL" | "ESPECIAL";

const TIPOS_PERIODO_OPCIONES: { value: TipoPeriodo; label: string }[] = [
  { value: "QUINCENA_1", label: "Primera quincena" },
  { value: "QUINCENA_2", label: "Segunda quincena" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "ESPECIAL", label: "Especial" },
];

type Periodo = {
  id: number;
  codigo: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
  notas: string | null;
  tipoPeriodo: TipoPeriodo | null;
  numeroQuincena: 1 | 2 | null;
  mes: number | null;
  anio: number | null;
  motivoCancelacion: string | null;
};

type Linea = {
  id: number;
  empleadoId: number;
  codigoEmpleado: string;
  nombreEmpleado: string;
  dpi: string;
  tipoContrato: string;
  formaPago: FormaPago;
  sueldoBase: number;
  bonoIncentivo: number;
  bonoHerramientas: number;
  otrosIngresos: number;
  igssLaboral: number;
  igssPatronal: number;
  descuentos: number;
  isr: number;
  neto: number;
  estadoPago: string;
  refPago: string;
};

type Cuadre = {
  porFormaPago: Record<
    FormaPago,
    { cantidad: number; neto: number; pagado: number; pendiente: number }
  >;
  totales: {
    empleados: number;
    formales: number;
    outsourcing: number;
    sueldoBase: number;
    bonos: number;
    otrosIngresos: number;
    igssLaboral: number;
    igssPatronal: number;
    descuentos: number;
    isr: number;
    neto: number;
    pagado: number;
    pendiente: number;
  };
};

function q(n: number) {
  return n.toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PlanillasPage() {
  const slug = String(useParams().slug);
  const [rows, setRows] = useState<Periodo[]>([]);
  const [empleadosActivos, setEmpleadosActivos] = useState(0);
  const [empleadosFormales, setEmpleadosFormales] = useState(0);
  const [empleadosOutsourcing, setEmpleadosOutsourcing] = useState(0);
  const [aviso, setAviso] = useState("");
  const [codigo, setCodigo] = useState("");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notas, setNotas] = useState("");
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo | "">("");
  const [mesSel, setMesSel] = useState(new Date().getMonth() + 1);
  const [anioSel, setAnioSel] = useState(new Date().getFullYear());
  const [sugiriendo, setSugiriendo] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [periodoId, setPeriodoId] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cuadre, setCuadre] = useState<Cuadre | null>(null);
  const [filtro, setFiltro] = useState("");
  const [filtroForma, setFiltroForma] = useState<"todas" | FormaPago>("todas");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/rrhh/planillas`);
    const data = await res.json();
    setRows(data.planillas ?? []);
    setEmpleadosActivos(Number(data.empleadosActivos ?? 0));
    setEmpleadosFormales(Number(data.empleadosFormales ?? 0));
    setEmpleadosOutsourcing(Number(data.empleadosOutsourcing ?? 0));
    setAviso(data.aviso ?? "");
  }, [slug]);

  const cargarDetalle = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/empresas/${slug}/rrhh/planillas/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo abrir el periodo.");
        return;
      }
      setPeriodoId(id);
      setPeriodo(data.periodo);
      setLineas(data.lineas ?? []);
      setCuadre(data.cuadre ?? null);
    },
    [slug],
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Fase P0: sugiere fechaInicio/fechaFin al elegir tipo+mes+año (reutiliza
  // ciclo_quincenal vía el endpoint /planillas/sugerir). El usuario sigue
  // pudiendo ajustar las fechas a mano antes de crear — esto solo pre-llena.
  useEffect(() => {
    if (!tipoPeriodo || tipoPeriodo === "ESPECIAL") return;
    let ignore = false;
    (async () => {
      setSugiriendo(true);
      try {
        const res = await fetch(
          `/api/empresas/${slug}/rrhh/planillas/sugerir?tipo=${tipoPeriodo}&mes=${mesSel}&anio=${anioSel}`,
        );
        const data = await res.json();
        if (!ignore && res.ok) {
          setFechaInicio(data.fechaInicio);
          setFechaFin(data.fechaFin);
        }
      } catch {
        /* si falla, el usuario captura las fechas a mano */
      } finally {
        if (!ignore) setSugiriendo(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [slug, tipoPeriodo, mesSel, anioSel]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/planillas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigo,
        fechaInicio,
        fechaFin,
        notas,
        ...(tipoPeriodo ? { tipoPeriodo } : {}),
        ...(tipoPeriodo === "QUINCENA_1" ? { numeroQuincena: 1 } : {}),
        ...(tipoPeriodo === "QUINCENA_2" ? { numeroQuincena: 2 } : {}),
        ...(tipoPeriodo && tipoPeriodo !== "ESPECIAL"
          ? { mes: mesSel, anio: anioSel }
          : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    setCodigo("");
    setNotas("");
    setTipoPeriodo("");
    await cargar();
    if (data.id) await cargarDetalle(Number(data.id));
  }

  async function accion(
    act:
      | "generar"
      | "marcar_pagados"
      | "marcar_pendientes"
      | "cerrar"
      | "reabrir"
      | "cancelar",
    formaPago?: "todas" | FormaPago,
    motivo?: string,
  ) {
    if (!periodoId) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/planillas/${periodoId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accion: act,
            formaPago: formaPago ?? "todas",
            conservarPagos: true,
            ...(motivo != null ? { motivo } : {}),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      setMsg(data.mensaje);
      if (data.periodo) setPeriodo(data.periodo);
      if (data.lineas) setLineas(data.lineas);
      if (data.cuadre) setCuadre(data.cuadre);
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  async function patchLinea(
    lineaId: number,
    body: Record<string, unknown>,
  ) {
    if (!periodoId) return;
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/planillas/${periodoId}/lineas/${lineaId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "No se pudo actualizar la línea.");
      return;
    }
    if (data.lineas) setLineas(data.lineas);
    if (data.cuadre) setCuadre(data.cuadre);
  }

  const lineasFiltradas = useMemo(() => {
    const term = filtro.trim().toLowerCase();
    return lineas.filter((l) => {
      if (filtroForma !== "todas" && l.formaPago !== filtroForma) return false;
      if (!term) return true;
      return `${l.codigoEmpleado} ${l.nombreEmpleado} ${l.dpi}`
        .toLowerCase()
        .includes(term);
    });
  }, [lineas, filtro, filtroForma]);

  function solicitarCancelacion() {
    const motivo = window.prompt("Motivo de la cancelación (obligatorio):");
    if (motivo == null) return;
    if (!motivo.trim()) {
      setError("Debes indicar un motivo para cancelar el periodo.");
      return;
    }
    void accion("cancelar", undefined, motivo.trim());
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";
  // Fase P0: Cancelado se trata como bloqueado igual que Cerrada/Pagada —
  // ningún periodo terminal (en cualquiera de estos 3 sentidos) es editable.
  const cerrada =
    periodo?.estado === "Cerrada" ||
    periodo?.estado === "Pagada" ||
    periodo?.estado === "Cancelado";
  const cancelada = periodo?.estado === "Cancelado";
  const puedeCancelar =
    periodo?.estado === "Borrador" || periodo?.estado === "Generada";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Planillas / Nómina</h1>
        <p className="text-sm text-[var(--muted)]">
          Control de pagos (efectivo, cheque, transferencia), IGSS operativo y
          cuadres. Activos: {empleadosActivos} · Formales: {empleadosFormales} ·
          Outsourcing: {empleadosOutsourcing}.{" "}
          <Link
            href={`/e/${slug}/dashboard-rrhh`}
            className="text-[var(--accent)] underline"
          >
            Dashboard RRHH
          </Link>
        </p>
      </div>

      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <input
          className={input}
          placeholder="Código (ej. 2026-08)"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          required
        />
        <select
          className={input}
          value={tipoPeriodo}
          onChange={(e) => setTipoPeriodo(e.target.value as TipoPeriodo | "")}
        >
          <option value="">Tipo de periodo (opcional)</option>
          {TIPOS_PERIODO_OPCIONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {tipoPeriodo && tipoPeriodo !== "ESPECIAL" ? (
          <>
            <select
              className={input}
              value={mesSel}
              onChange={(e) => setMesSel(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="number"
              className={`${input} w-24`}
              value={anioSel}
              onChange={(e) => setAnioSel(Number(e.target.value))}
            />
            {sugiriendo ? (
              <span className="self-center text-xs text-[var(--muted)]">
                Calculando fechas…
              </span>
            ) : null}
          </>
        ) : null}
        <input
          type="date"
          className={input}
          value={fechaInicio}
          onChange={(e) => setFechaInicio(e.target.value)}
          required
        />
        <input
          type="date"
          className={input}
          value={fechaFin}
          onChange={(e) => setFechaFin(e.target.value)}
          required
        />
        <input
          className={`${input} min-w-[12rem]`}
          placeholder="Notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Crear periodo
        </button>
      </form>
      {tipoPeriodo && tipoPeriodo !== "ESPECIAL" ? (
        <p className="text-xs text-[var(--muted)]">
          Fechas sugeridas para {TIPOS_PERIODO_OPCIONES.find((t) => t.value === tipoPeriodo)?.label.toLowerCase()} de {mesSel}/{anioSel}: {fechaInicio} → {fechaFin}. Puedes ajustarlas antes de crear.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void cargarDetalle(r.id)}
                className={[
                  "w-full rounded border px-3 py-2 text-left",
                  periodoId === r.id
                    ? "border-[var(--accent)] bg-[var(--accent)]/15"
                    : "border-[var(--border)] hover:bg-white/5",
                ].join(" ")}
              >
                <span className="font-medium">{r.codigo}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  {r.fechaInicio} → {r.fechaFin} · {r.estado}
                </span>
              </button>
            </li>
          ))}
          {!rows.length ? (
            <li className="text-[var(--muted)]">Sin periodos aún.</li>
          ) : null}
        </ul>

        <div className="space-y-4">
          {!periodo ? (
            <p className="text-sm text-[var(--muted)]">
              Selecciona un periodo o crea uno nuevo. Luego genera la nómina
              desde empleados activos (incluye outsourcing).
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-medium">
                  {periodo.codigo}{" "}
                  <span
                    className={[
                      "text-sm font-normal",
                      cancelada ? "text-red-400" : "text-[var(--muted)]",
                    ].join(" ")}
                  >
                    · {periodo.estado}
                    {periodo.tipoPeriodo
                      ? ` · ${TIPOS_PERIODO_OPCIONES.find((t) => t.value === periodo.tipoPeriodo)?.label ?? periodo.tipoPeriodo}`
                      : ""}
                  </span>
                </h2>
                {!cancelada ? (
                  <button
                    type="button"
                    disabled={busy || cerrada}
                    onClick={() => void accion("generar")}
                    className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Generar / actualizar líneas
                  </button>
                ) : null}
                <a
                  href={`/api/empresas/${slug}/rrhh/planillas/${periodo.id}/export`}
                  className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white"
                >
                  Exportar Excel + cuadre
                </a>
                {periodo.estado === "Generada" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void accion("cerrar")}
                    className="rounded bg-[#334155] px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Cerrar planilla
                  </button>
                ) : null}
                {periodo.estado === "Cerrada" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void accion("reabrir")}
                    className="rounded bg-[#334155] px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Reabrir
                  </button>
                ) : null}
                {puedeCancelar ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={solicitarCancelacion}
                    className="rounded bg-red-900/60 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Cancelar periodo
                  </button>
                ) : null}
              </div>

              {cancelada ? (
                <p className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                  Periodo cancelado. Motivo: {periodo.motivoCancelacion || "—"}
                </p>
              ) : null}

              <p className="text-xs text-[var(--muted)]">
                Guatemala: IGSS laboral 4.83% y patronal 12.67% sobre sueldo
                ordinario (sin bono incentivo Q250). Outsourcing no calcula IGSS.
                ISR se edita manualmente por línea (RetenISR/SAT).
              </p>

              {cuadre ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {(
                    ["transferencia", "cheque", "efectivo"] as FormaPago[]
                  ).map((f) => {
                    const b = cuadre.porFormaPago[f];
                    return (
                      <div
                        key={f}
                        className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm"
                      >
                        <p className="font-medium">{etiquetaFormaPago(f)}</p>
                        <p className="text-[var(--muted)]">
                          {b.cantidad} pers. · Neto Q{q(b.neto)}
                        </p>
                        <p className="text-xs text-emerald-400">
                          Pagado Q{q(b.pagado)}
                        </p>
                        <p className="text-xs text-amber-300">
                          Pendiente Q{q(b.pendiente)}
                        </p>
                        {!cerrada ? (
                          <button
                            type="button"
                            disabled={busy}
                            className="mt-2 text-xs text-[var(--accent)] underline disabled:opacity-50"
                            onClick={() =>
                              void accion("marcar_pagados", f)
                            }
                          >
                            Marcar pagados ({etiquetaFormaPago(f)})
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                    <p className="font-medium">Totales</p>
                    <p>Neto Q{q(cuadre.totales.neto)}</p>
                    <p className="text-xs text-[var(--muted)]">
                      IGSS lab. Q{q(cuadre.totales.igssLaboral)} · Patronal Q
                      {q(cuadre.totales.igssPatronal)}
                    </p>
                    <p className="text-xs">
                      Formales {cuadre.totales.formales} · Outsourcing{" "}
                      {cuadre.totales.outsourcing}
                    </p>
                    {!cerrada ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="mt-2 text-xs text-[var(--accent)] underline disabled:opacity-50"
                        onClick={() => void accion("marcar_pagados", "todas")}
                      >
                        Marcar todos pagados
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <input
                  className={`${input} min-w-[14rem] flex-1`}
                  placeholder="Filtrar por nombre, código o DPI…"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                />
                <select
                  className={input}
                  value={filtroForma}
                  onChange={(e) =>
                    setFiltroForma(e.target.value as "todas" | FormaPago)
                  }
                >
                  <option value="todas">Todas las formas de pago</option>
                  {FORMAS_PAGO.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[var(--card)] text-[var(--muted)]">
                    <tr>
                      <th className="px-2 py-2">Empleado</th>
                      <th className="px-2 py-2">Contrato</th>
                      <th className="px-2 py-2">Forma pago</th>
                      <th className="px-2 py-2">Neto</th>
                      <th className="px-2 py-2">ISR</th>
                      <th className="px-2 py-2">Estado</th>
                      <th className="px-2 py-2">Ref.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineasFiltradas.map((l) => (
                      <tr
                        key={l.id}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-2 py-2">
                          <div className="font-medium">{l.nombreEmpleado}</div>
                          <div className="text-xs text-[var(--muted)]">
                            {l.codigoEmpleado}
                            {l.dpi ? ` · DPI ${l.dpi}` : ""}
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            Base {q(l.sueldoBase)} · IGSS {q(l.igssLaboral)} ·
                            Desc. {q(l.descuentos)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {etiquetaTipoContrato(l.tipoContrato)}
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className={input}
                            disabled={cerrada}
                            value={l.formaPago}
                            onChange={(e) =>
                              void patchLinea(l.id, {
                                formaPago: e.target.value,
                              })
                            }
                          >
                            {FORMAS_PAGO.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 font-medium">Q{q(l.neto)}</td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className={`${input} w-24`}
                            disabled={cerrada}
                            defaultValue={l.isr}
                            key={`isr-${l.id}-${l.isr}`}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v !== l.isr) {
                                void patchLinea(l.id, { isr: v });
                              }
                            }}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className={input}
                            disabled={cerrada}
                            value={l.estadoPago}
                            onChange={(e) =>
                              void patchLinea(l.id, {
                                estadoPago: e.target.value,
                              })
                            }
                          >
                            <option value="Pendiente">Pendiente</option>
                            <option value="Pagado">Pagado</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className={`${input} w-28`}
                            disabled={cerrada}
                            placeholder="Cheque # / ref"
                            defaultValue={l.refPago}
                            key={`ref-${l.id}-${l.refPago}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v !== l.refPago) {
                                void patchLinea(l.id, { refPago: v });
                              }
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                    {!lineasFiltradas.length ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-4 text-[var(--muted)]"
                        >
                          {lineas.length
                            ? "Sin coincidencias en el filtro."
                            : "Sin líneas. Pulsa «Generar / actualizar líneas»."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
