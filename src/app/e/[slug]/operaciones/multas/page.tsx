"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

/**
 * MULTAS-4 base (secciones 21-29) — primera UI funcional de Operaciones >
 * Multas y sanciones. Reutiliza el backend transaccional de MULTAS-3/3.1/
 * 3.2 tal cual (GET/POST/PATCH ya existentes + /panel para el dashboard) —
 * esta pantalla no reimplementa ninguna regla de negocio, solo la
 * consume. Documentos/evidencias, Excel, notificaciones y Portal del
 * piloto quedan fuera de esta fase (sección 30).
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const RESPONSABILIDADES = [
  { value: "PILOTO", label: "Piloto" },
  { value: "LOGISTICA", label: "Logística" },
  { value: "OTRO_COLABORADOR", label: "Otro colaborador" },
  { value: "EMPRESA", label: "Empresa (sin responsable personal)" },
  { value: "POR_DEFINIR", label: "Por definir" },
] as const;
const RESOLUCIONES = [
  { value: "PENDIENTE", label: "Pendiente de resolver" },
  { value: "EMPRESA", label: "Empresa asume el total" },
  { value: "COLABORADOR", label: "Colaborador asume el total" },
  { value: "COMPARTIDO", label: "Compartido (empresa + colaborador)" },
  { value: "NO_APLICA", label: "No aplica (exonerada/anulada por la autoridad)" },
] as const;
type Responsabilidad = (typeof RESPONSABILIDADES)[number]["value"];
type Resolucion = (typeof RESOLUCIONES)[number]["value"];

type Indicadores = {
  unidadesActivas: number; revisadas: number; pendientesRevision: number; unidadesConMultas: number;
  cantidadMultasMes: number; montoTotalMes: number;
  acumulados: { cantidadMultas: number; montoTotal: number; montoEmpresa: number; montoColaborador: number; pendienteResolucion: number };
};
type UnidadPanel = {
  vehiculoId: number; placa: string; revisionId: number | null;
  estadoRevision: "PENDIENTE" | "SIN_MULTAS" | "CON_MULTAS";
  cantidadMultas: number; montoTotal: number; ultimaRevision: string | null; verificadoPor: string | null;
};
type DescuentoRrhhResumen = {
  id: number; codigo: string; estado: string; montoOriginal: number; numeroCuotas: number;
  cuotasAplicadas: number; pagado: number; saldo: number;
  proximaCuota: { numero: number; fecha: string; monto: number } | null;
};
type Multa = {
  id: number; fecha_infraccion: string; placa_actual: string; placa_historica: string;
  referencia_boleta: string | null; tipo_multa: string; descripcion: string; lugar: string | null;
  monto_total: string; monto_empresa: string | null; monto_colaborador: string | null;
  tipo_responsabilidad: Responsabilidad; empleado_responsable_nombre: string | null; responsable_texto: string | null;
  resolucion_economica: Resolucion; estado: "PENDIENTE" | "EN_REVISION" | "RESUELTA" | "ANULADA";
  estado_pago: "PENDIENTE" | "PAGADA" | "NO_APLICA"; estado_descuento: "NO_APLICA" | "PENDIENTE" | "DESCONTADO";
  observaciones: string | null; descuentoRrhh: DescuentoRrhhResumen | null; rrhh_descuento_id: number | null;
};
type Empleado = { id: number; codigo: string; nombre: string };

function formatQ(v: string | number | null | undefined): string {
  return `Q${Number(v ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function badgeRrhh(m: Multa): { texto: string; clase: string } | null {
  if (m.resolucion_economica !== "COLABORADOR" && m.resolucion_economica !== "COMPARTIDO") return null;
  if (!m.rrhh_descuento_id || !m.descuentoRrhh) return { texto: "Pendiente RRHH", clase: "bg-amber-900/50 text-amber-200" };
  if (m.descuentoRrhh.saldo <= 0.004) return { texto: "Descuento completado", clase: "bg-emerald-900/50 text-emerald-200" };
  if (m.descuentoRrhh.cuotasAplicadas > 0) return { texto: "Descuento en curso", clase: "bg-sky-900/50 text-sky-200" };
  return { texto: "Descuento programado", clase: "bg-violet-900/50 text-violet-200" };
}

const ESTADO_BADGE: Record<string, string> = {
  PENDIENTE: "bg-[var(--input)] text-[var(--muted)]", EN_REVISION: "bg-sky-900/50 text-sky-200",
  RESUELTA: "bg-emerald-900/50 text-emerald-200", ANULADA: "bg-rose-900/50 text-rose-200",
};

const formVacio = {
  fecha_infraccion: new Date().toISOString().slice(0, 10), referencia_boleta: "", tipo_multa: "", descripcion: "",
  lugar: "", monto_total: "", tipo_responsabilidad: "POR_DEFINIR" as Responsabilidad, empleado_responsable_id: "" as string | number,
  responsable_texto: "", resolucion_economica: "PENDIENTE" as Resolucion, monto_empresa: "", monto_colaborador: "",
  observaciones: "",
};

export default function MultasPage() {
  const { slug } = useParams<{ slug: string }>();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [indicadores, setIndicadores] = useState<Indicadores | null>(null);
  const [unidades, setUnidades] = useState<UnidadPanel[]>([]);
  const [multas, setMultas] = useState<Multa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [empleados, setEmpleados] = useState<Empleado[] | null>(null); // null = catálogo no disponible (fallback a texto libre)
  const [detalleAbierto, setDetalleAbierto] = useState<number | null>(null);
  const [revisionAbierta, setRevisionAbierta] = useState<number | null>(null); // vehiculoId
  const [obsRevision, setObsRevision] = useState("");
  const [multaFormPara, setMultaFormPara] = useState<{ vehiculoId: number; revisionId: number; placa: string } | null>(null);
  const [form, setForm] = useState(formVacio);
  const [guardando, setGuardando] = useState(false);

  const cargarPanel = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [rPanel, rMultas] = await Promise.all([
        fetch(`/api/empresas/${slug}/operaciones/multas/panel?anio=${anio}&mes=${mes}`),
        fetch(`/api/empresas/${slug}/operaciones/multas?anio=${anio}&mes=${mes}`),
      ]);
      const dPanel = await rPanel.json();
      const dMultas = await rMultas.json();
      if (!rPanel.ok) throw new Error(dPanel.error ?? "No se pudo cargar el panel.");
      if (!rMultas.ok) throw new Error(dMultas.error ?? "No se pudieron cargar las multas.");
      setIndicadores(dPanel.indicadores);
      setUnidades(dPanel.unidades ?? []);
      setMultas(dMultas.multas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el panel.");
    } finally {
      setCargando(false);
    }
  }, [slug, anio, mes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarPanel();
  }, [cargarPanel]);

  // Catálogo de empleados: best-effort. Un usuario de Operaciones puede no
  // tener permiso RRHH — si el catálogo no está disponible (403/],
  // el formulario cae a responsable_texto (sección 26: "texto libre solo
  // como fallback cuando backend lo permita").
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/empleados?estado=Activo`);
        if (!res.ok) { if (!ignore) setEmpleados(null); return; }
        const data = await res.json();
        if (!ignore) setEmpleados((data.empleados ?? []).map((e: { id: number; codigo: string; nombre: string }) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre })));
      } catch { if (!ignore) setEmpleados(null); }
    })();
    return () => { ignore = true; };
  }, [slug]);

  const esPersonal = form.tipo_responsabilidad === "PILOTO" || form.tipo_responsabilidad === "LOGISTICA" || form.tipo_responsabilidad === "OTRO_COLABORADOR";

  // Sección 25: monto_empresa/monto_colaborador derivados automáticamente,
  // igual que obligaciones()/validarMulta() en el backend — el usuario solo
  // los edita cuando la resolución es COMPARTIDO.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => {
      if (f.resolucion_economica === "COMPARTIDO") return f;
      const total = f.monto_total || "0";
      if (f.resolucion_economica === "EMPRESA") return { ...f, monto_empresa: total, monto_colaborador: "0.00" };
      if (f.resolucion_economica === "COLABORADOR") return { ...f, monto_empresa: "0.00", monto_colaborador: total };
      if (f.resolucion_economica === "NO_APLICA") return { ...f, monto_empresa: "0.00", monto_colaborador: "0.00" };
      return { ...f, monto_empresa: "", monto_colaborador: "" };
    });
  }, [form.resolucion_economica, form.monto_total]);

  async function registrarRevision(vehiculoId: number) {
    setGuardando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/operaciones/multas/revisiones`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehiculo_id: vehiculoId, anio, mes, observaciones: obsRevision.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar la revisión.");
      setRevisionAbierta(null);
      setObsRevision("");
      const placa = unidades.find((u) => u.vehiculoId === vehiculoId)?.placa ?? "";
      setMultaFormPara({ vehiculoId, revisionId: data.id, placa });
      setForm(formVacio);
      await cargarPanel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la revisión.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarMulta() {
    if (!multaFormPara) return;
    setGuardando(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        revision_id: multaFormPara.revisionId, vehiculo_id: multaFormPara.vehiculoId,
        fecha_infraccion: form.fecha_infraccion, referencia_boleta: form.referencia_boleta.trim() || undefined,
        tipo_multa: form.tipo_multa.trim(), descripcion: form.descripcion.trim(), lugar: form.lugar.trim() || undefined,
        monto_total: form.monto_total, tipo_responsabilidad: form.tipo_responsabilidad,
        resolucion_economica: form.resolucion_economica, observaciones: form.observaciones.trim() || undefined,
      };
      if (esPersonal) {
        if (empleados && form.empleado_responsable_id) body.empleado_responsable_id = Number(form.empleado_responsable_id);
        else body.responsable_texto = form.responsable_texto.trim();
      }
      if (form.resolucion_economica !== "PENDIENTE") {
        body.monto_empresa = form.monto_empresa; body.monto_colaborador = form.monto_colaborador;
      }
      const res = await fetch(`/api/empresas/${slug}/operaciones/multas`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar la multa.");
      setMsg(`Multa #${data.id} registrada.`);
      setMultaFormPara(null);
      setForm(formVacio);
      await cargarPanel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la multa.");
    } finally {
      setGuardando(false);
    }
  }

  const anios = Array.from({ length: 5 }, (_, i) => hoy.getFullYear() - 2 + i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Multas y sanciones</h1>
        <p className="text-sm text-[var(--muted)]">Revisión mensual por unidad, registro de multas y su resolución económica.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)]">
          Mes
          <select className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Año
          <select className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}

      {indicadores ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Actividad del mes</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-[var(--muted)]">Unidades activas</dt><dd className="font-medium">{indicadores.unidadesActivas}</dd></div>
              <div><dt className="text-[var(--muted)]">Revisadas</dt><dd className="font-medium">{indicadores.revisadas}</dd></div>
              <div><dt className="text-[var(--muted)]">Pendientes de revisión</dt><dd className="font-medium">{indicadores.pendientesRevision}</dd></div>
              <div><dt className="text-[var(--muted)]">Unidades con multas</dt><dd className="font-medium">{indicadores.unidadesConMultas}</dd></div>
              <div><dt className="text-[var(--muted)]">Cantidad de multas</dt><dd className="font-medium">{indicadores.cantidadMultasMes}</dd></div>
              <div><dt className="text-[var(--muted)]">Monto total</dt><dd className="font-medium">{formatQ(indicadores.montoTotalMes)}</dd></div>
            </dl>
          </section>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Pendientes acumulados (todos los períodos)</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-[var(--muted)]">Cantidad de multas</dt><dd className="font-medium">{indicadores.acumulados.cantidadMultas}</dd></div>
              <div><dt className="text-[var(--muted)]">Monto total</dt><dd className="font-medium">{formatQ(indicadores.acumulados.montoTotal)}</dd></div>
              <div><dt className="text-[var(--muted)]">Monto empresa</dt><dd className="font-medium">{formatQ(indicadores.acumulados.montoEmpresa)}</dd></div>
              <div><dt className="text-[var(--muted)]">Monto colaborador</dt><dd className="font-medium">{formatQ(indicadores.acumulados.montoColaborador)}</dd></div>
              <div><dt className="text-[var(--muted)]">Pendiente de resolución</dt><dd className="font-medium">{indicadores.acumulados.pendienteResolucion}</dd></div>
            </dl>
          </section>
        </div>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Unidades — {MESES[mes - 1]} {anio}</h2>
        {cargando ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3">Placa</th><th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">Multas</th>
                  <th className="py-2 pr-3">Monto total</th><th className="py-2 pr-3">Última revisión</th><th className="py-2 pr-3">Verificado por</th>
                  <th className="py-2 pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => (
                  <>
                    <tr key={u.vehiculoId} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-3">{u.placa}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${u.estadoRevision === "PENDIENTE" ? "bg-[var(--input)] text-[var(--muted)]" : u.estadoRevision === "CON_MULTAS" ? "bg-amber-900/50 text-amber-200" : "bg-emerald-900/50 text-emerald-200"}`}>
                          {u.estadoRevision === "PENDIENTE" ? "Pendiente de revisión" : u.estadoRevision === "CON_MULTAS" ? "Revisada con multas" : "Revisada sin multas"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{u.cantidadMultas}</td>
                      <td className="py-2 pr-3">{formatQ(u.montoTotal)}</td>
                      <td className="py-2 pr-3">{u.ultimaRevision ?? "—"}</td>
                      <td className="py-2 pr-3">{u.verificadoPor ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {u.estadoRevision === "PENDIENTE" ? (
                          <button type="button" className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white"
                            onClick={() => { setRevisionAbierta(revisionAbierta === u.vehiculoId ? null : u.vehiculoId); setObsRevision(""); }}>
                            {revisionAbierta === u.vehiculoId ? "Cerrar" : "Registrar revisión"}
                          </button>
                        ) : (
                          <button type="button" className="rounded-md border border-[var(--border)] px-3 py-1 text-xs font-medium"
                            onClick={() => { setMultaFormPara({ vehiculoId: u.vehiculoId, revisionId: u.revisionId!, placa: u.placa }); setForm(formVacio); }}>
                            Registrar multa
                          </button>
                        )}
                      </td>
                    </tr>
                    {revisionAbierta === u.vehiculoId ? (
                      <tr key={`${u.vehiculoId}-rev`} className="border-t border-[var(--border)] bg-[var(--input)]/30">
                        <td colSpan={7} className="py-3 pr-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="min-w-[16rem] flex-1 text-xs text-[var(--muted)]">
                              Observaciones (opcional)
                              <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm" value={obsRevision} onChange={(e) => setObsRevision(e.target.value)} />
                            </label>
                            <button type="button" disabled={guardando} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => void registrarRevision(u.vehiculoId)}>
                              {guardando ? "Guardando…" : "Confirmar revisión"}
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted)]">Después de confirmar podrás registrar multas para {u.placa}, o dejarla como “sin multas” si no registras ninguna.</p>
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {multaFormPara ? (
        <section className="rounded-xl border border-[var(--accent)] bg-[var(--card)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Nueva multa — {multaFormPara.placa}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--muted)]">Fecha de infracción
              <input type="date" className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.fecha_infraccion} onChange={(e) => setForm((f) => ({ ...f, fecha_infraccion: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Referencia de boleta
              <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.referencia_boleta} onChange={(e) => setForm((f) => ({ ...f, referencia_boleta: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Tipo de multa
              <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.tipo_multa} onChange={(e) => setForm((f) => ({ ...f, tipo_multa: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Lugar
              <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.lugar} onChange={(e) => setForm((f) => ({ ...f, lugar: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-2">Descripción
              <textarea className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" rows={2} value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Monto (Q)
              <input inputMode="decimal" className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.monto_total} onChange={(e) => setForm((f) => ({ ...f, monto_total: e.target.value }))} placeholder="0.00" />
            </label>
            <label className="text-xs text-[var(--muted)]">Responsabilidad
              <select className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.tipo_responsabilidad} onChange={(e) => setForm((f) => ({ ...f, tipo_responsabilidad: e.target.value as Responsabilidad, empleado_responsable_id: "", responsable_texto: "" }))}>
                {RESPONSABILIDADES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            {esPersonal ? (
              empleados ? (
                <label className="text-xs text-[var(--muted)]">Colaborador responsable
                  <select className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.empleado_responsable_id} onChange={(e) => setForm((f) => ({ ...f, empleado_responsable_id: e.target.value }))}>
                    <option value="">— Seleccionar —</option>
                    {empleados.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
                  </select>
                </label>
              ) : (
                <label className="text-xs text-[var(--muted)]">Responsable (nombre)
                  <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.responsable_texto} onChange={(e) => setForm((f) => ({ ...f, responsable_texto: e.target.value }))} />
                </label>
              )
            ) : null}
            <label className="text-xs text-[var(--muted)]">Resolución económica
              <select className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.resolucion_economica} onChange={(e) => setForm((f) => ({ ...f, resolucion_economica: e.target.value as Resolucion }))}>
                {RESOLUCIONES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            {form.resolucion_economica === "COMPARTIDO" ? (
              <>
                <label className="text-xs text-[var(--muted)]">Monto a cargo de la empresa (Q)
                  <input inputMode="decimal" className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.monto_empresa} onChange={(e) => setForm((f) => ({ ...f, monto_empresa: e.target.value }))} />
                </label>
                <label className="text-xs text-[var(--muted)]">Monto a cargo del colaborador (Q)
                  <input inputMode="decimal" className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" value={form.monto_colaborador} onChange={(e) => setForm((f) => ({ ...f, monto_colaborador: e.target.value }))} />
                </label>
              </>
            ) : null}
            <label className="text-xs text-[var(--muted)] sm:col-span-2">Observaciones (obligatorio si NO_APLICA)
              <textarea className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm" rows={2} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={guardando} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => void guardarMulta()}>
              {guardando ? "Guardando…" : "Registrar multa"}
            </button>
            <button type="button" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => setMultaFormPara(null)}>Cancelar</button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Multas — {MESES[mes - 1]} {anio}</h2>
        {!multas.length ? <p className="text-sm text-[var(--muted)]">Sin multas en este período.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Unidad</th><th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Monto</th><th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">RRHH</th><th className="py-2 pr-3">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {multas.map((m) => {
                  const badge = badgeRrhh(m);
                  return (
                    <>
                      <tr key={m.id} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3">{m.fecha_infraccion}</td>
                        <td className="py-2 pr-3">{m.placa_actual}</td>
                        <td className="py-2 pr-3">{m.tipo_multa}</td>
                        <td className="py-2 pr-3">{formatQ(m.monto_total)}</td>
                        <td className="py-2 pr-3">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ESTADO_BADGE[m.estado] ?? "bg-[var(--input)] text-[var(--muted)]"}`}>{m.estado}</span>
                        </td>
                        <td className="py-2 pr-3">{badge ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.clase}`}>{badge.texto}</span> : "—"}</td>
                        <td className="py-2 pr-3">
                          <button type="button" className="text-xs text-[var(--accent)] underline" onClick={() => setDetalleAbierto(detalleAbierto === m.id ? null : m.id)}>
                            {detalleAbierto === m.id ? "Ocultar" : "Ver"}
                          </button>
                        </td>
                      </tr>
                      {detalleAbierto === m.id ? (
                        <tr key={`${m.id}-det`} className="border-t border-[var(--border)] bg-[var(--input)]/30">
                          <td colSpan={7} className="py-3 pr-3 text-xs">
                            <div className="grid gap-1 sm:grid-cols-2">
                              <p><span className="text-[var(--muted)]">Descripción:</span> {m.descripcion}</p>
                              <p><span className="text-[var(--muted)]">Lugar:</span> {m.lugar ?? "—"}</p>
                              <p><span className="text-[var(--muted)]">Boleta:</span> {m.referencia_boleta ?? "—"}</p>
                              <p><span className="text-[var(--muted)]">Responsable:</span> {m.empleado_responsable_nombre ?? m.responsable_texto ?? "—"}</p>
                              <p><span className="text-[var(--muted)]">Resolución:</span> {m.resolucion_economica} (Empresa {formatQ(m.monto_empresa)} · Colaborador {formatQ(m.monto_colaborador)})</p>
                              <p><span className="text-[var(--muted)]">Pago de la multa:</span> {m.estado_pago}</p>
                              {m.descuentoRrhh ? (
                                <p className="sm:col-span-2"><span className="text-[var(--muted)]">Descuento RRHH:</span> {m.descuentoRrhh.codigo} · {m.descuentoRrhh.cuotasAplicadas}/{m.descuentoRrhh.numeroCuotas} cuota(s) aplicada(s) · saldo {formatQ(m.descuentoRrhh.saldo)}</p>
                              ) : null}
                              {m.observaciones ? <p className="sm:col-span-2"><span className="text-[var(--muted)]">Observaciones:</span> {m.observaciones}</p> : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
