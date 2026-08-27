"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useParams } from "next/navigation";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";

/**
 * MULTAS-4/5 — UI de Operaciones > Multas y sanciones. Reutiliza el
 * backend transaccional de MULTAS-3/3.1/3.2/5 tal cual — esta pantalla
 * no reimplementa ninguna regla de negocio, solo la consume.
 *
 * MULTAS-5 separa claramente:
 *  1) "Revisión mensual de unidades" (bloque propio, sin cambios de
 *     lógica) de
 *  2) "Expedientes de multas" (sección nueva, con filtros propios y
 *     detalle enriquecido: pago a la autoridad, documentos, RRHH) —
 *     ya NO queda escondida al final de la tabla de unidades.
 * Excel, notificaciones y Portal del piloto siguen fuera de alcance.
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

const TIPOS_DOCUMENTO = [
  { value: "MULTA", label: "Boleta / documento de la multa" },
  { value: "COMPROBANTE_PAGO", label: "Comprobante de pago" },
  { value: "FACTURA", label: "Factura" },
  { value: "OTRO", label: "Otro" },
] as const;
type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]["value"];

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
  estado_pago: "PENDIENTE" | "PAGADA" | "NO_APLICA";
  pagada_en: string | null; monto_pagado: string | null; referencia_pago: string | null;
  observaciones_pago: string | null; pagada_por_nombre: string | null;
  estado_descuento: "NO_APLICA" | "PENDIENTE" | "DESCONTADO";
  observaciones: string | null; descuentoRrhh: DescuentoRrhhResumen | null; rrhh_descuento_id: number | null;
};
type Empleado = { id: number; codigo: string; nombre: string };
type DocumentoMulta = {
  id: number; tipoDocumento: TipoDocumento; nombreOriginal: string; mimeType: string; tamano: number; subidoEn: string;
};

function formatQ(v: string | number | null | undefined): string {
  return `Q${Number(v ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Sección 23 del ticket: vocabulario exacto de los estados visuales de RRHH. */
function badgeRrhh(m: Multa): { texto: string; clase: string } {
  if (m.resolucion_economica !== "COLABORADOR" && m.resolucion_economica !== "COMPARTIDO") {
    return { texto: "No aplica", clase: "bg-[var(--input)] text-[var(--muted)]" };
  }
  if (!m.rrhh_descuento_id || !m.descuentoRrhh) return { texto: "Pendiente RRHH", clase: "bg-amber-900/50 text-amber-200" };
  if (m.descuentoRrhh.saldo <= 0.004) return { texto: "Completado", clase: "bg-emerald-900/50 text-emerald-200" };
  if (m.descuentoRrhh.cuotasAplicadas > 0) return { texto: "En curso", clase: "bg-sky-900/50 text-sky-200" };
  return { texto: "Programado", clase: "bg-violet-900/50 text-violet-200" };
}
function badgePago(m: Multa): { texto: string; clase: string } {
  if (m.estado_pago === "NO_APLICA") return { texto: "No aplica", clase: "bg-[var(--input)] text-[var(--muted)]" };
  if (m.estado_pago === "PAGADA") return { texto: "Pagada", clase: "bg-emerald-900/50 text-emerald-200" };
  return { texto: "Pendiente pago", clase: "bg-amber-900/50 text-amber-200" };
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
type FormMultaState = typeof formVacio;

/**
 * Bug UX (feedback de Operaciones): con >100 unidades, el formulario
 * renderizado al final de la página quedaba fuera de vista al pulsar
 * "Registrar multa" cerca del principio de la tabla. Se extrae el bloque
 * de campos a este componente local (mismas reglas, mismo formVacio, sin
 * segundo formulario) para poder montarlo INLINE, en una fila justo
 * debajo de la unidad seleccionada — igual que ya hacía "Registrar
 * revisión" — en vez de en una sección aparte al final.
 */
function FormularioMulta({
  placa, form, setForm, esPersonal, empleados, guardando, onGuardar, onCancelar,
}: {
  placa: string;
  form: FormMultaState;
  setForm: Dispatch<SetStateAction<FormMultaState>>;
  esPersonal: boolean;
  empleados: Empleado[] | null;
  guardando: boolean;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--accent)] bg-[var(--card)] p-4">
      <h3 className="mb-2 text-sm font-semibold">Nueva multa — {placa}</h3>
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
        <button type="button" disabled={guardando} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={onGuardar}>
          {guardando ? "Guardando…" : "Registrar multa"}
        </button>
        <button type="button" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

/**
 * MULTAS-5 (sección 13) — expediente completo de una multa: monto/
 * responsabilidad (solo lectura, ya fijados al crear/resolver), pago a
 * la autoridad, documentos, RRHH, y anulación. Un solo componente para
 * no repetir este bloque grande entre "Expedientes" y cualquier otra
 * vista que lo necesite.
 */
function ExpedienteDetalle({
  m, puedeAnularConDescuento, puedeRegistrarPago,
  motivoAnular, setMotivoAnular, anulando, onAnular,
  pagoForm, setPagoForm, pagando, onRegistrarPago,
  documentos, cargandoDocumentos, tipoSubida, setTipoSubida, subiendo, onSubirDocumento, onEliminarDocumento,
  onVerDocumento,
}: {
  m: Multa;
  puedeAnularConDescuento: boolean;
  puedeRegistrarPago: boolean;
  motivoAnular: string; setMotivoAnular: (v: string) => void; anulando: boolean; onAnular: () => void;
  pagoForm: { referencia_pago: string; observaciones_pago: string };
  setPagoForm: Dispatch<SetStateAction<{ referencia_pago: string; observaciones_pago: string }>>;
  pagando: boolean; onRegistrarPago: () => void;
  documentos: DocumentoMulta[]; cargandoDocumentos: boolean;
  tipoSubida: TipoDocumento; setTipoSubida: (v: TipoDocumento) => void; subiendo: boolean;
  onSubirDocumento: (file: File) => void; onEliminarDocumento: (docId: number) => void;
  onVerDocumento: (docId: number) => void;
}) {
  return (
    <div className="space-y-4 text-xs">
      <div className="grid gap-1 sm:grid-cols-2">
        <p><span className="text-[var(--muted)]">Unidad:</span> {m.placa_actual}</p>
        <p><span className="text-[var(--muted)]">Fecha:</span> {m.fecha_infraccion}</p>
        <p><span className="text-[var(--muted)]">Boleta:</span> {m.referencia_boleta ?? "—"}</p>
        <p><span className="text-[var(--muted)]">Tipo:</span> {m.tipo_multa}</p>
        <p><span className="text-[var(--muted)]">Lugar:</span> {m.lugar ?? "—"}</p>
        <p className="sm:col-span-2"><span className="text-[var(--muted)]">Descripción:</span> {m.descripcion}</p>
      </div>

      <div className="rounded-md border border-[var(--border)] p-3">
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Monto</h4>
        <div className="grid gap-1 sm:grid-cols-3">
          <p><span className="text-[var(--muted)]">Total:</span> {formatQ(m.monto_total)}</p>
          <p><span className="text-[var(--muted)]">Empresa:</span> {formatQ(m.monto_empresa)}</p>
          <p><span className="text-[var(--muted)]">Colaborador:</span> {formatQ(m.monto_colaborador)}</p>
        </div>
      </div>

      <div className="rounded-md border border-[var(--border)] p-3">
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Responsabilidad</h4>
        <p><span className="text-[var(--muted)]">Tipo:</span> {RESPONSABILIDADES.find((r) => r.value === m.tipo_responsabilidad)?.label ?? m.tipo_responsabilidad}</p>
        <p><span className="text-[var(--muted)]">Colaborador responsable:</span> {m.empleado_responsable_nombre ?? m.responsable_texto ?? "—"}</p>
        <p><span className="text-[var(--muted)]">Resolución:</span> {RESOLUCIONES.find((r) => r.value === m.resolucion_economica)?.label ?? m.resolucion_economica}</p>
      </div>

      <div className="rounded-md border border-[var(--border)] p-3">
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Pago de la multa (a la autoridad)</h4>
        {m.estado_pago === "PAGADA" ? (
          <div className="grid gap-1 sm:grid-cols-2">
            <p><span className="text-[var(--muted)]">Estado:</span> Pagada</p>
            <p><span className="text-[var(--muted)]">Fecha:</span> {m.pagada_en ? String(m.pagada_en).slice(0, 10) : "—"}</p>
            <p><span className="text-[var(--muted)]">Monto:</span> {formatQ(m.monto_pagado)}</p>
            <p><span className="text-[var(--muted)]">Referencia:</span> {m.referencia_pago ?? "—"}</p>
            <p><span className="text-[var(--muted)]">Registrado por:</span> {m.pagada_por_nombre ?? "—"}</p>
            {m.observaciones_pago ? <p className="sm:col-span-2"><span className="text-[var(--muted)]">Observaciones:</span> {m.observaciones_pago}</p> : null}
            {!documentos.some((d) => d.tipoDocumento === "COMPROBANTE_PAGO") ? (
              <p className="sm:col-span-2 text-amber-300">Pago registrado sin comprobante.</p>
            ) : null}
          </div>
        ) : m.estado_pago === "NO_APLICA" ? (
          <p>No aplica.</p>
        ) : puedeRegistrarPago ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1">Referencia de pago (opcional)
              <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={pagoForm.referencia_pago} onChange={(e) => setPagoForm((f) => ({ ...f, referencia_pago: e.target.value }))} />
            </label>
            <label className="min-w-[12rem] flex-1">Observaciones (opcional)
              <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={pagoForm.observaciones_pago} onChange={(e) => setPagoForm((f) => ({ ...f, observaciones_pago: e.target.value }))} />
            </label>
            <button type="button" disabled={pagando} className="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-50" onClick={onRegistrarPago}>
              {pagando ? "Registrando…" : `Registrar pago (${formatQ(m.monto_total)})`}
            </button>
            <p className="w-full text-[10px] text-[var(--muted)]">La empresa paga el total de la multa a la autoridad — sin pagos parciales en esta fase.</p>
          </div>
        ) : (
          <p className="text-[var(--muted)]">Pendiente de pago — requiere permiso para registrar pagos.</p>
        )}
      </div>

      <div className="rounded-md border border-[var(--border)] p-3">
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Documentos</h4>
        {cargandoDocumentos ? <p className="text-[var(--muted)]">Cargando…</p> : (
          <>
            {!documentos.length ? <p className="text-[var(--muted)]">Sin documentos todavía.</p> : (
              <ul className="mb-2 space-y-1">
                {documentos.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="rounded bg-[var(--input)] px-1.5 py-0.5 text-[10px] font-medium">{TIPOS_DOCUMENTO.find((t) => t.value === d.tipoDocumento)?.label ?? d.tipoDocumento}</span>
                      {" "}
                      <button type="button" className="text-[var(--accent)] underline" onClick={() => onVerDocumento(d.id)}>{d.nombreOriginal}</button>
                    </span>
                    <button type="button" className="text-rose-300 underline" onClick={() => onEliminarDocumento(d.id)}>Eliminar</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label>Tipo
                <select className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={tipoSubida} onChange={(e) => setTipoSubida(e.target.value as TipoDocumento)}>
                  {TIPOS_DOCUMENTO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label>Archivo (JPG, PNG o PDF)
                <input
                  type="file" accept=".jpg,.jpeg,.png,.pdf"
                  className="mt-0.5 block text-[var(--muted)]"
                  disabled={subiendo}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onSubirDocumento(f); e.target.value = ""; }}
                />
              </label>
              {subiendo ? <span className="text-[var(--muted)]">Subiendo…</span> : null}
            </div>
          </>
        )}
      </div>

      <div className="rounded-md border border-[var(--border)] p-3">
        <h4 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">RRHH</h4>
        {m.descuentoRrhh ? (
          <div className="grid gap-1 sm:grid-cols-2">
            <p><span className="text-[var(--muted)]">Código descuento:</span> {m.descuentoRrhh.codigo}</p>
            <p><span className="text-[var(--muted)]">Cuotas:</span> {m.descuentoRrhh.cuotasAplicadas}/{m.descuentoRrhh.numeroCuotas}</p>
            <p><span className="text-[var(--muted)]">Monto recuperado:</span> {formatQ(m.descuentoRrhh.pagado)}</p>
            <p><span className="text-[var(--muted)]">Saldo:</span> {formatQ(m.descuentoRrhh.saldo)}</p>
            <p><span className="text-[var(--muted)]">Próxima cuota:</span> {m.descuentoRrhh.proximaCuota ? `#${m.descuentoRrhh.proximaCuota.numero} · ${m.descuentoRrhh.proximaCuota.fecha} · ${formatQ(m.descuentoRrhh.proximaCuota.monto)}` : "—"}</p>
          </div>
        ) : (m.resolucion_economica === "COLABORADOR" || m.resolucion_economica === "COMPARTIDO") ? (
          <p className="text-[var(--muted)]">
            {m.estado_pago === "PAGADA" ? "Pendiente de que RRHH genere el descuento." : "Se habilita para RRHH en cuanto la empresa registre el pago de la multa."}
          </p>
        ) : (
          <p className="text-[var(--muted)]">No aplica.</p>
        )}
      </div>

      {m.estado !== "ANULADA" && (!m.rrhh_descuento_id || puedeAnularConDescuento) ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
          <label className="min-w-[16rem] flex-1">Motivo de anulación
            <input className="mt-0.5 block w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} />
          </label>
          <button type="button" disabled={anulando} className="rounded-md bg-rose-800 px-3 py-1.5 font-medium text-white disabled:opacity-50" onClick={onAnular}>
            {anulando ? "Anulando…" : m.rrhh_descuento_id ? "Anular y cancelar descuento RRHH" : "Anular multa"}
          </button>
        </div>
      ) : m.estado !== "ANULADA" && m.rrhh_descuento_id ? (
        <p className="border-t border-[var(--border)] pt-3 text-[var(--muted)]">
          Esta multa tiene un descuento RRHH vinculado — anularla requiere permiso de RRHH (editar descuentos).
        </p>
      ) : null}
    </div>
  );
}

export default function MultasPage() {
  const { slug } = useParams<{ slug: string }>();
  const { rol, permisos } = useEmpresaSession();
  // Anular una multa CON descuento RRHH vinculado cancela una obligación
  // de RRHH (regla congelada: RRHH controla el descuento real) — exige
  // además rrhh:descuentos:editar (el backend ya lo exige; esto solo
  // evita ofrecer un botón que va a rebotar en 403).
  const puedeAnularConDescuento = rol === "Admin" || tienePermiso(permisos, "descuentos", "editar");
  // MULTAS-5 (sección 15) — MVP: multas:editar (mismo permiso que el
  // resto de escrituras de Operaciones sobre Multas) basta para
  // registrar el pago a la autoridad. Recomendación documentada en el
  // reporte del PR: si el negocio quiere separar "quién edita el
  // expediente" de "quién autoriza pagos a la autoridad", un permiso
  // propio (ej. multas_pagar:editar, mismo patrón que viaticos_pagar)
  // sería el siguiente paso — no se crea aquí por no existir todavía.
  const puedeRegistrarPago = rol === "Admin" || tienePermiso(permisos, "multas", "editar") || permisos.length === 0;
  const [motivoAnular, setMotivoAnular] = useState("");
  const [anulando, setAnulando] = useState(false);
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
  const [expedienteAbierto, setExpedienteAbierto] = useState<number | null>(null);
  const [revisionAbierta, setRevisionAbierta] = useState<number | null>(null); // vehiculoId
  const [obsRevision, setObsRevision] = useState("");
  const [multaFormPara, setMultaFormPara] = useState<{ vehiculoId: number; revisionId: number; placa: string } | null>(null);
  const [form, setForm] = useState(formVacio);
  const [guardando, setGuardando] = useState(false);

  // Filtros de "Expedientes de multas" (sección 12): mes/año ya acotan
  // la consulta al backend (paginada); placa/responsable/estado son
  // client-side sobre ese mismo período (máx. 100 filas por diseño de
  // listarMultas) — no son "decorativos": el dataset ya está acotado por
  // el backend, filtrar en memoria sobre ≤100 filas es correcto, no un
  // riesgo de crecimiento sin límite.
  const [fPlaca, setFPlaca] = useState("");
  const [fResponsable, setFResponsable] = useState("");
  const [fEstadoMulta, setFEstadoMulta] = useState("");
  const [fEstadoPago, setFEstadoPago] = useState("");
  const [fEstadoRrhh, setFEstadoRrhh] = useState("");

  // Pago
  const [pagoForm, setPagoForm] = useState({ referencia_pago: "", observaciones_pago: "" });
  const [pagando, setPagando] = useState(false);

  // Documentos
  const [documentosPorMulta, setDocumentosPorMulta] = useState<Record<number, DocumentoMulta[]>>({});
  const [cargandoDocumentos, setCargandoDocumentos] = useState(false);
  const [tipoSubida, setTipoSubida] = useState<TipoDocumento>("MULTA");
  const [subiendo, setSubiendo] = useState(false);

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

  async function anularMulta(m: Multa) {
    if (!motivoAnular.trim()) { setError("Indica un motivo de anulación."); return; }
    setAnulando(true);
    setError("");
    try {
      const url = m.rrhh_descuento_id
        ? `/api/empresas/${slug}/operaciones/multas/${m.id}/anular-con-descuento`
        : `/api/empresas/${slug}/operaciones/multas/${m.id}`;
      const res = await fetch(url, {
        method: m.rrhh_descuento_id ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          m.rrhh_descuento_id ? { motivo_anulacion: motivoAnular.trim() } : { accion: "anular", motivo_anulacion: motivoAnular.trim() },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo anular la multa.");
      setMsg(`Multa #${m.id} anulada.`);
      setMotivoAnular("");
      setExpedienteAbierto(null);
      await cargarPanel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la multa.");
    } finally {
      setAnulando(false);
    }
  }

  async function registrarPago(m: Multa) {
    setPagando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/operaciones/multas/${m.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "pagar",
          referencia_pago: pagoForm.referencia_pago.trim() || undefined,
          observaciones_pago: pagoForm.observaciones_pago.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar el pago.");
      setMsg(`Pago de la multa #${m.id} registrado.`);
      setPagoForm({ referencia_pago: "", observaciones_pago: "" });
      await cargarPanel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setPagando(false);
    }
  }

  const cargarDocumentos = useCallback(async (multaId: number) => {
    setCargandoDocumentos(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/operaciones/multas/${multaId}/documentos`);
      const data = await res.json();
      if (res.ok) setDocumentosPorMulta((prev) => ({ ...prev, [multaId]: data.documentos ?? [] }));
    } catch { /* silencioso: la sección de documentos queda vacía */ }
    finally { setCargandoDocumentos(false); }
  }, [slug]);

  function abrirExpediente(multaId: number) {
    if (expedienteAbierto === multaId) { setExpedienteAbierto(null); return; }
    setExpedienteAbierto(multaId);
    setMotivoAnular("");
    setPagoForm({ referencia_pago: "", observaciones_pago: "" });
    setTipoSubida("MULTA");
    void cargarDocumentos(multaId);
  }

  async function subirDocumento(multaId: number, file: File) {
    setSubiendo(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("tipo", tipoSubida);
      const res = await fetch(`/api/empresas/${slug}/operaciones/multas/${multaId}/documentos`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir el documento.");
      await cargarDocumentos(multaId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el documento.");
    } finally {
      setSubiendo(false);
    }
  }

  async function eliminarDocumento(multaId: number, docId: number) {
    try {
      const res = await fetch(`/api/empresas/${slug}/operaciones/multas/documentos/${docId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: "Eliminado desde el expediente" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo eliminar el documento.");
      await cargarDocumentos(multaId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar el documento.");
    }
  }

  function verDocumento(docId: number) {
    window.open(`/api/empresas/${slug}/operaciones/multas/documentos/${docId}`, "_blank", "noopener,noreferrer");
  }

  const anios = Array.from({ length: 5 }, (_, i) => hoy.getFullYear() - 2 + i);

  const multasFiltradas = multas.filter((m) => {
    if (fPlaca.trim() && !m.placa_actual.toLowerCase().includes(fPlaca.trim().toLowerCase())) return false;
    if (fResponsable.trim()) {
      const resp = (m.empleado_responsable_nombre ?? m.responsable_texto ?? "").toLowerCase();
      if (!resp.includes(fResponsable.trim().toLowerCase())) return false;
    }
    if (fEstadoMulta && m.estado !== fEstadoMulta) return false;
    if (fEstadoPago && m.estado_pago !== fEstadoPago) return false;
    if (fEstadoRrhh && badgeRrhh(m).texto !== fEstadoRrhh) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Multas y sanciones</h1>
        <p className="text-sm text-[var(--muted)]">Expediente completo: revisión mensual, registro de multas, pago a la autoridad, documentos y recuperación al colaborador vía RRHH.</p>
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

      {/* Sección 10: "Expedientes de multas" — bloque propio, visible sin
          tener que desplazarse más allá de la tabla de unidades. */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Expedientes de multas — {MESES[mes - 1]} {anio}</h2>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
          <label>Placa
            <input className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={fPlaca} onChange={(e) => setFPlaca(e.target.value)} />
          </label>
          <label>Responsable
            <input className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={fResponsable} onChange={(e) => setFResponsable(e.target.value)} />
          </label>
          <label>Estado multa
            <select className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={fEstadoMulta} onChange={(e) => setFEstadoMulta(e.target.value)}>
              <option value="">Todos</option>
              {["PENDIENTE", "EN_REVISION", "RESUELTA", "ANULADA"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>Estado pago
            <select className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={fEstadoPago} onChange={(e) => setFEstadoPago(e.target.value)}>
              <option value="">Todos</option>
              <option value="PENDIENTE">Pendiente pago</option>
              <option value="PAGADA">Pagada</option>
              <option value="NO_APLICA">No aplica</option>
            </select>
          </label>
          <label>Estado RRHH
            <select className="mt-0.5 block rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={fEstadoRrhh} onChange={(e) => setFEstadoRrhh(e.target.value)}>
              <option value="">Todos</option>
              {["No aplica", "Pendiente RRHH", "Programado", "En curso", "Completado"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        {!multasFiltradas.length ? <p className="text-sm text-[var(--muted)]">Sin expedientes que coincidan con los filtros.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Unidad</th><th className="py-2 pr-3">Boleta</th>
                  <th className="py-2 pr-3">Tipo</th><th className="py-2 pr-3">Responsable</th><th className="py-2 pr-3">Monto</th>
                  <th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">Pago</th><th className="py-2 pr-3">RRHH</th><th className="py-2 pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {multasFiltradas.map((m) => {
                  const rrhh = badgeRrhh(m);
                  const pago = badgePago(m);
                  return (
                    <>
                      <tr key={m.id} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3">{m.fecha_infraccion}</td>
                        <td className="py-2 pr-3">{m.placa_actual}</td>
                        <td className="py-2 pr-3">{m.referencia_boleta ?? "—"}</td>
                        <td className="py-2 pr-3">{m.tipo_multa}</td>
                        <td className="py-2 pr-3">{m.empleado_responsable_nombre ?? m.responsable_texto ?? "—"}</td>
                        <td className="py-2 pr-3">{formatQ(m.monto_total)}</td>
                        <td className="py-2 pr-3">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ESTADO_BADGE[m.estado] ?? "bg-[var(--input)] text-[var(--muted)]"}`}>{m.estado}</span>
                        </td>
                        <td className="py-2 pr-3"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${pago.clase}`}>{pago.texto}</span></td>
                        <td className="py-2 pr-3"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${rrhh.clase}`}>{rrhh.texto}</span></td>
                        <td className="py-2 pr-3">
                          <button type="button" className="text-xs text-[var(--accent)] underline" onClick={() => abrirExpediente(m.id)}>
                            {expedienteAbierto === m.id ? "Ocultar" : "Ver expediente"}
                          </button>
                        </td>
                      </tr>
                      {expedienteAbierto === m.id ? (
                        <tr key={`${m.id}-exp`} className="border-t border-[var(--border)] bg-[var(--input)]/30">
                          <td colSpan={10} className="py-3 pr-3">
                            <ExpedienteDetalle
                              m={m}
                              puedeAnularConDescuento={puedeAnularConDescuento}
                              puedeRegistrarPago={puedeRegistrarPago}
                              motivoAnular={motivoAnular} setMotivoAnular={setMotivoAnular}
                              anulando={anulando} onAnular={() => void anularMulta(m)}
                              pagoForm={pagoForm} setPagoForm={setPagoForm}
                              pagando={pagando} onRegistrarPago={() => void registrarPago(m)}
                              documentos={documentosPorMulta[m.id] ?? []} cargandoDocumentos={cargandoDocumentos}
                              tipoSubida={tipoSubida} setTipoSubida={setTipoSubida} subiendo={subiendo}
                              onSubirDocumento={(file) => void subirDocumento(m.id, file)}
                              onEliminarDocumento={(docId) => void eliminarDocumento(m.id, docId)}
                              onVerDocumento={verDocumento}
                            />
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

      {/* Sección "Revisión mensual de unidades" — bloque propio, sin
          cambios de lógica respecto a MULTAS-4. */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Revisión mensual de unidades — {MESES[mes - 1]} {anio}</h2>
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
                            onClick={() => {
                              setMultaFormPara(null);
                              setRevisionAbierta(revisionAbierta === u.vehiculoId ? null : u.vehiculoId);
                              setObsRevision("");
                            }}>
                            {revisionAbierta === u.vehiculoId ? "Cerrar" : "Registrar revisión"}
                          </button>
                        ) : (
                          <button type="button" className="rounded-md border border-[var(--border)] px-3 py-1 text-xs font-medium"
                            onClick={() => {
                              setRevisionAbierta(null);
                              setMultaFormPara(
                                multaFormPara?.vehiculoId === u.vehiculoId ? null : { vehiculoId: u.vehiculoId, revisionId: u.revisionId!, placa: u.placa },
                              );
                              setForm(formVacio);
                            }}>
                            {multaFormPara?.vehiculoId === u.vehiculoId ? "Cerrar" : "Registrar multa"}
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
                    {multaFormPara?.vehiculoId === u.vehiculoId ? (
                      <tr key={`${u.vehiculoId}-multa`} className="border-t border-[var(--border)] bg-[var(--input)]/30">
                        <td colSpan={7} className="py-3 pr-3">
                          <FormularioMulta
                            placa={multaFormPara.placa}
                            form={form}
                            setForm={setForm}
                            esPersonal={esPersonal}
                            empleados={empleados}
                            guardando={guardando}
                            onGuardar={() => void guardarMulta()}
                            onCancelar={() => { setMultaFormPara(null); setForm(formVacio); }}
                          />
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
    </div>
  );
}
