"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type TipoReporte = "viaje" | "unidad" | "cliente" | "categoria" | "periodo" | "viaticos" | "rentabilidad" | "fondos";

const TIPOS: { value: TipoReporte; label: string }[] = [
  { value: "viaje", label: "Gastos por viaje" },
  { value: "unidad", label: "Gastos por unidad" },
  { value: "cliente", label: "Gastos por cliente" },
  { value: "categoria", label: "Gastos por categoría" },
  { value: "periodo", label: "Gastos por período" },
  { value: "viaticos", label: "Viáticos por viaje/empleado" },
  { value: "rentabilidad", label: "Rentabilidad por viaje" },
  { value: "fondos", label: "Solicitudes de fondo" },
];

type FilaAgregada = { clave: string; etiqueta: string; registros: number; totalMonto: number };
type FilaViatico = { planCodigo: string; fechaPlan: string; personalNombre: string; rol: string; montoSugerido: number; montoAsignado: number; estado: string };
// TMS-SIN-COSTO-OPERATIVO-1: sin costoOperativo — negocio confirmó que ya no se utiliza.
type FilaRentabilidad = { planCodigo: string; fechaPlan: string; clienteNombre: string | null; tarifaComercial: number; gastos: number; viaticos: number; utilidad: number };
// SOLICITUD-FONDOS-REPORTE-1 — una fila por línea de solicitud de fondo (ver reporteSolicitudesFondo en reportes-gastos.ts).
type FilaSolicitudFondo = {
  lineaId: number; solicitudCodigo: string; fechaSolicitud: string; fechaViaje: string | null;
  empleadoNombre: string | null; cargo: string | null; placa: string | null; clienteNombre: string | null;
  cantidad: number; descripcion: string | null; monto: number; total: number; estadoFondo: string;
};
type ClienteCat = { id: number; nombre: string };

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const money = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2 })}`;

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — reportes iniciales de gastos/viáticos/
 * rentabilidad. Solo lectura + exportación a Excel; cada tipo reutiliza el
 * endpoint único /tms/reportes/gastos?tipo=... (mismo criterio de
 * filtros que el exportador, nunca dos parseos que puedan divergir).
 *
 * SOLICITUD-FONDOS-REPORTE-1 — se agrega el tipo "fondos" con sus propios
 * filtros (fecha solicitud/viaje por separado, cliente, placa, empleado,
 * cargo, estado, descripción) — mismo endpoint compartido, nunca un
 * segundo parser de filtros.
 */
export default function ReportesGastosPage() {
  const slug = String(useParams().slug);
  const [tipo, setTipo] = useState<TipoReporte>("viaje");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filas, setFilas] = useState<unknown[]>([]);
  const [etiqueta, setEtiqueta] = useState("Clave");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filtros propios de "fondos" — no afectan a ningún otro tipo.
  const [fSolicitudDesde, setFSolicitudDesde] = useState("");
  const [fSolicitudHasta, setFSolicitudHasta] = useState("");
  const [fViajeDesde, setFViajeDesde] = useState("");
  const [fViajeHasta, setFViajeHasta] = useState("");
  const [fClienteId, setFClienteId] = useState("");
  const [fPlaca, setFPlaca] = useState("");
  const [fEmpleadoNombre, setFEmpleadoNombre] = useState("");
  const [fCargo, setFCargo] = useState("");
  const [fEstadoFondo, setFEstadoFondo] = useState("");
  const [fDescripcion, setFDescripcion] = useState("");
  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);

  useEffect(() => {
    if (tipo !== "fondos" || clientesCat.length) return;
    fetch(`/api/empresas/${slug}/tms/gastos/catalogos`)
      .then((r) => r.json())
      .then((data) => setClientesCat((data.clientes ?? []) as ClienteCat[]))
      .catch(() => undefined);
  }, [slug, tipo, clientesCat.length]);

  /** Filtros de "fondos" — únicos, compartidos por el listado y el export (nunca dos armados que puedan divergir). */
  const paramsFondos = useCallback((p: URLSearchParams) => {
    if (fSolicitudDesde) p.set("fechaSolicitudDesde", fSolicitudDesde);
    if (fSolicitudHasta) p.set("fechaSolicitudHasta", fSolicitudHasta);
    if (fViajeDesde) p.set("fechaViajeDesde", fViajeDesde);
    if (fViajeHasta) p.set("fechaViajeHasta", fViajeHasta);
    if (fClienteId) p.set("clienteId", fClienteId);
    if (fPlaca) p.set("placa", fPlaca);
    if (fEmpleadoNombre) p.set("empleadoNombre", fEmpleadoNombre);
    if (fCargo) p.set("cargo", fCargo);
    if (fEstadoFondo) p.set("estadoFondo", fEstadoFondo);
    if (fDescripcion) p.set("descripcion", fDescripcion);
  }, [fSolicitudDesde, fSolicitudHasta, fViajeDesde, fViajeHasta, fClienteId, fPlaca, fEmpleadoNombre, fCargo, fEstadoFondo, fDescripcion]);

  const cargar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ tipo });
      if (tipo === "fondos") {
        paramsFondos(params);
      } else {
        if (fechaDesde) params.set("fechaDesde", fechaDesde);
        if (fechaHasta) params.set("fechaHasta", fechaHasta);
      }
      const res = await fetch(`/api/empresas/${slug}/tms/reportes/gastos?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el reporte.");
      setFilas(data.filas ?? []);
      setEtiqueta(data.etiqueta ?? "Clave");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, tipo, fechaDesde, fechaHasta, paramsFondos]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function exportarUrl() {
    const params = new URLSearchParams({ tipo });
    if (tipo === "fondos") {
      paramsFondos(params);
    } else {
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
    }
    return `/api/empresas/${slug}/tms/reportes/gastos/exportar?${params.toString()}`;
  }

  const esAgregado = tipo !== "viaticos" && tipo !== "rentabilidad" && tipo !== "fondos";

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Reportes de gastos</h1>
        <a href={exportarUrl()} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">Exportar a Excel</a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoReporte)}>
          {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {tipo !== "fondos" ? (
          <>
            <input type="date" className={inputCls} value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            <input type="date" className={inputCls} value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          </>
        ) : null}
      </div>

      {tipo === "fondos" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
          <label className="text-xs text-[var(--muted)]">Fecha solicitud desde
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fSolicitudDesde} onChange={(e) => setFSolicitudDesde(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">hasta
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fSolicitudHasta} onChange={(e) => setFSolicitudHasta(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">Fecha viaje desde
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fViajeDesde} onChange={(e) => setFViajeDesde(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">hasta
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fViajeHasta} onChange={(e) => setFViajeHasta(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">Cliente
            <select className={`${inputCls} mt-0.5 block`} value={fClienteId} onChange={(e) => setFClienteId(e.target.value)}>
              <option value="">Todos</option>
              {clientesCat.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Placa
            <input className={`${inputCls} mt-0.5 block`} value={fPlaca} onChange={(e) => setFPlaca(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">Empleado
            <input className={`${inputCls} mt-0.5 block`} placeholder="Nombre exacto" value={fEmpleadoNombre} onChange={(e) => setFEmpleadoNombre(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">Cargo
            <input className={`${inputCls} mt-0.5 block`} value={fCargo} onChange={(e) => setFCargo(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">Estado
            <select className={`${inputCls} mt-0.5 block`} value={fEstadoFondo} onChange={(e) => setFEstadoFondo(e.target.value)}>
              <option value="">Todos</option>
              {["Pendiente", "Autorizada", "Rechazada", "Liquidada"].map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Descripción
            <input className={`${inputCls} mt-0.5 block`} placeholder="Búsqueda libre" value={fDescripcion} onChange={(e) => setFDescripcion(e.target.value)} />
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={() => void cargar()}>Buscar</button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}

      {!loading && esAgregado ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]"><tr><th className="px-2 py-1">{etiqueta}</th><th className="px-2 py-1">Registros</th><th className="px-2 py-1">Total</th></tr></thead>
          <tbody>
            {(filas as FilaAgregada[]).map((f) => (
              <tr key={f.clave} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.etiqueta}</td><td className="px-2 py-1">{f.registros}</td><td className="px-2 py-1">{money(f.totalMonto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && tipo === "viaticos" ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]"><tr><th className="px-2 py-1">Viaje</th><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Persona</th><th className="px-2 py-1">Rol</th><th className="px-2 py-1">Sugerido</th><th className="px-2 py-1">Asignado</th><th className="px-2 py-1">Estado</th></tr></thead>
          <tbody>
            {(filas as FilaViatico[]).map((f, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.planCodigo}</td><td className="px-2 py-1">{f.fechaPlan}</td><td className="px-2 py-1">{f.personalNombre}</td>
                <td className="px-2 py-1">{f.rol}</td><td className="px-2 py-1">{money(f.montoSugerido)}</td><td className="px-2 py-1">{money(f.montoAsignado)}</td><td className="px-2 py-1">{f.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && tipo === "rentabilidad" ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]"><tr><th className="px-2 py-1">Viaje</th><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Tarifa comercial</th><th className="px-2 py-1">Gastos</th><th className="px-2 py-1">Viáticos</th><th className="px-2 py-1">Utilidad</th></tr></thead>
          <tbody>
            {(filas as FilaRentabilidad[]).map((f, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.planCodigo}</td><td className="px-2 py-1">{f.fechaPlan}</td><td className="px-2 py-1">{f.clienteNombre ?? "—"}</td>
                <td className="px-2 py-1">{money(f.tarifaComercial)}</td>
                <td className="px-2 py-1">{money(f.gastos)}</td><td className="px-2 py-1">{money(f.viaticos)}</td>
                <td className={`px-2 py-1 ${f.utilidad < 0 ? "text-red-400" : "text-emerald-400"}`}>{money(f.utilidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && tipo === "fondos" ? (
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="px-2 py-1">Fecha solicitud</th><th className="px-2 py-1">Fecha viaje</th><th className="px-2 py-1">Nombre</th>
              <th className="px-2 py-1">Cargo</th><th className="px-2 py-1">Placa</th><th className="px-2 py-1">Cliente</th>
              <th className="px-2 py-1">Cantidad</th><th className="px-2 py-1">Descripción</th><th className="px-2 py-1">Total</th>
              <th className="px-2 py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {(filas as FilaSolicitudFondo[]).map((f) => (
              <tr key={f.lineaId} className="border-t border-[var(--border)]">
                <td className="px-2 py-1">{f.fechaSolicitud}</td><td className="px-2 py-1">{f.fechaViaje ?? "—"}</td>
                <td className="px-2 py-1">{f.empleadoNombre ?? "—"}</td><td className="px-2 py-1">{f.cargo ?? "—"}</td>
                <td className="px-2 py-1">{f.placa ?? "—"}</td><td className="px-2 py-1">{f.clienteNombre ?? "—"}</td>
                <td className="px-2 py-1">{f.cantidad}</td><td className="px-2 py-1">{f.descripcion ?? "—"}</td>
                <td className="px-2 py-1">{money(f.total)}</td><td className="px-2 py-1">{f.estadoFondo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!loading && !filas.length ? <p className="text-[var(--muted)]">Sin datos para este filtro.</p> : null}
    </div>
  );
}
