"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

export type TipoReporte = "viaje" | "unidad" | "cliente" | "categoria" | "periodo" | "viaticos" | "rentabilidad" | "fondos" | "gastosDetalle";

const TIPOS: { value: TipoReporte; label: string }[] = [
  { value: "viaje", label: "Gastos por viaje" },
  { value: "unidad", label: "Gastos por unidad" },
  { value: "cliente", label: "Gastos por cliente" },
  { value: "categoria", label: "Gastos por categoría" },
  { value: "periodo", label: "Gastos por período" },
  { value: "gastosDetalle", label: "Gastos operativos — detalle" },
  { value: "viaticos", label: "Viáticos — detalle" },
  { value: "rentabilidad", label: "Rentabilidad por viaje" },
  { value: "fondos", label: "Solicitudes de fondo" },
];

/** Tipos que además de Excel también pueden exportarse en PDF (REPORTES-VIATICOS-GASTOS-DETALLE-1, §4). */
const TIPOS_CON_PDF: TipoReporte[] = ["viaticos", "gastosDetalle"];

const ESTADOS_VIATICO = ["PROGRAMADO", "AUTORIZADO", "RECHAZADO", "ENTREGADO", "LIQUIDADO"];

type FilaAgregada = { clave: string; etiqueta: string; registros: number; totalMonto: number };
/** REPORTES-VIATICOS-GASTOS-DETALLE-1 (§1 del ticket) — detalle completo, una fila por viático. */
type FilaViatico = {
  viaticoId: number; fechaRegistro: string; fechaViaje: string; planCodigo: string; rutaDestino: string | null;
  personalNombre: string; cargo: string | null; cuentaBancaria: string | null; placa: string | null;
  clienteNombre: string | null; rol: string; montoSugerido: number; montoAsignado: number; estado: string;
  fechaAutorizacion: string | null; autorizadoPor: string | null; fechaEntrega: string | null; entregadoPor: string | null;
  observaciones: string | null;
};
/** REPORTES-VIATICOS-GASTOS-DETALLE-1 (§2 del ticket) — detalle completo, una fila por gasto operativo. */
type FilaGastoDetalle = {
  id: number; fechaSolicitud: string; fechaViaje: string | null; planCodigo: string | null;
  empleadoNombre: string | null; cargo: string | null; placa: string | null; clienteNombre: string | null;
  categoria: string; descripcion: string | null; cantidad: number; monto: number; total: number;
  activo: boolean; registradoPor: string | null; observaciones: string | null;
};
// TMS-SIN-COSTO-OPERATIVO-1: sin costoOperativo — negocio confirmó que ya no se utiliza.
type FilaRentabilidad = { planCodigo: string; fechaPlan: string; clienteNombre: string | null; tarifaComercial: number; gastos: number; viaticos: number; utilidad: number };
// SOLICITUD-FONDOS-REPORTE-1 — una fila por línea de solicitud de fondo (ver reporteSolicitudesFondo en reportes-gastos.ts).
type FilaSolicitudFondo = {
  lineaId: number; solicitudCodigo: string; fechaSolicitud: string; fechaViaje: string | null;
  empleadoNombre: string | null; cargo: string | null; placa: string | null; clienteNombre: string | null;
  cantidad: number; descripcion: string | null; monto: number; total: number; estadoFondo: string;
};
type ResumenFondos = { cantidad: number; totalSolicitado: number; totalAutorizado: number; totalLiquidado: number; totalRechazado: number };
type ClienteCat = { id: number; nombre: string };
type EmpleadoCat = { id: number; nombre: string };
type VehiculoCat = { id: number; placa: string };
type PlanCat = { id: number; codigo: string };

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
type Props = { tipoFijo?: TipoReporte; titulo?: string };

export function ReportesGastosView({ tipoFijo, titulo }: Props) {
  const slug = String(useParams().slug);
  const [tipo, setTipo] = useState<TipoReporte>(tipoFijo ?? "viaje");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filas, setFilas] = useState<unknown[]>([]);
  const [etiqueta, setEtiqueta] = useState("Clave");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resumenFondos, setResumenFondos] = useState<ResumenFondos | null>(null);

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
  const [empleadosCat, setEmpleadosCat] = useState<EmpleadoCat[]>([]);
  const [vehiculosCat, setVehiculosCat] = useState<VehiculoCat[]>([]);
  const [planesCat, setPlanesCat] = useState<PlanCat[]>([]);

  // REPORTES-VIATICOS-GASTOS-DETALLE-1 (§3 del ticket) — "mantener los
  // filtros de pantalla en la exportación": cliente/placa(unidad)/
  // empleado/estado/viaje-plan, propios de "viaticos"/"gastosDetalle" —
  // el mismo bloque de filtros alimenta el listado Y la exportación
  // (nunca dos armados que puedan divergir), mismo criterio que "fondos".
  const [fClienteId2, setFClienteId2] = useState("");
  const [fVehiculoId, setFVehiculoId] = useState("");
  const [fEmpleadoIdGasto, setFEmpleadoIdGasto] = useState("");
  const [fEmpleadoNombreViatico, setFEmpleadoNombreViatico] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fEstadoViatico, setFEstadoViatico] = useState("");
  const [fActivoGasto, setFActivoGasto] = useState(""); // "" = todos, "1" = activos, "0" = anulados
  const [fPlanId, setFPlanId] = useState("");

  const necesitaCatalogos = tipo === "fondos" || tipo === "viaticos" || tipo === "gastosDetalle";
  useEffect(() => {
    if (!necesitaCatalogos || clientesCat.length) return;
    fetch(`/api/empresas/${slug}/tms/gastos/catalogos`)
      .then((r) => r.json())
      .then((data) => {
        setClientesCat((data.clientes ?? []) as ClienteCat[]);
        setEmpleadosCat((data.empleados ?? []) as EmpleadoCat[]);
        setVehiculosCat((data.vehiculos ?? []) as VehiculoCat[]);
        setPlanesCat((data.planes ?? []) as PlanCat[]);
      })
      .catch(() => undefined);
  }, [slug, necesitaCatalogos, clientesCat.length]);

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

  /**
   * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§3 del ticket) — filtros de
   * "viaticos"/"gastosDetalle": fecha desde/hasta (genéricas, igual que
   * los reportes agregados) + cliente/estado/viaje-plan (compartidos) +
   * placa/empleado, que en el backend usan una llave distinta según el
   * tipo (viáticos: `placa` texto exacto de la unidad + `empleadoNombre`
   * parcial; gastos: `vehiculoId`/`empleadoId` reales) — nunca se manda
   * el filtro equivocado al tipo equivocado.
   */
  const paramsDetalle = useCallback((p: URLSearchParams, t: TipoReporte) => {
    if (fechaDesde) p.set("fechaDesde", fechaDesde);
    if (fechaHasta) p.set("fechaHasta", fechaHasta);
    if (fClienteId2) p.set("clienteId", fClienteId2);
    if (fPlanId) p.set("planId", fPlanId);
    if (t === "viaticos") {
      if (fVehiculoId) {
        const v = vehiculosCat.find((x) => String(x.id) === fVehiculoId);
        if (v) p.set("placa", v.placa);
      }
      if (fEmpleadoNombreViatico.trim()) p.set("empleadoNombre", fEmpleadoNombreViatico.trim());
      if (fEstadoViatico) p.set("estadoViatico", fEstadoViatico);
    } else {
      if (fVehiculoId) p.set("vehiculoId", fVehiculoId);
      if (fEmpleadoIdGasto) p.set("empleadoId", fEmpleadoIdGasto);
      if (fCategoria) p.set("categoria", fCategoria);
      if (fActivoGasto) p.set("activo", fActivoGasto);
    }
  }, [fechaDesde, fechaHasta, fClienteId2, fPlanId, fVehiculoId, vehiculosCat, fEmpleadoNombreViatico, fEstadoViatico, fEmpleadoIdGasto, fCategoria, fActivoGasto]);

  const cargar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ tipo });
      if (tipo === "fondos") {
        paramsFondos(params);
      } else if (tipo === "viaticos" || tipo === "gastosDetalle") {
        paramsDetalle(params, tipo);
      } else {
        if (fechaDesde) params.set("fechaDesde", fechaDesde);
        if (fechaHasta) params.set("fechaHasta", fechaHasta);
      }
      const res = await fetch(`/api/empresas/${slug}/tms/reportes/gastos?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el reporte.");
      setFilas(data.filas ?? []);
      setResumenFondos(tipo === "fondos" ? data.resumen ?? null : null);
      setEtiqueta(data.etiqueta ?? "Clave");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, tipo, fechaDesde, fechaHasta, paramsFondos, paramsDetalle]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function exportarUrl(formato?: "pdf") {
    const params = new URLSearchParams({ tipo });
    if (tipo === "fondos") {
      paramsFondos(params);
    } else if (tipo === "viaticos" || tipo === "gastosDetalle") {
      paramsDetalle(params, tipo);
    } else {
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
    }
    if (formato) params.set("formato", formato);
    return `/api/empresas/${slug}/tms/reportes/gastos/exportar?${params.toString()}`;
  }

  const esAgregado = tipo !== "viaticos" && tipo !== "rentabilidad" && tipo !== "fondos" && tipo !== "gastosDetalle";

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{titulo ?? "Reportes de gastos"}</h1>
        <div className="flex gap-2">
          <a href={exportarUrl()} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">Exportar a Excel</a>
          {/* REPORTES-VIATICOS-GASTOS-DETALLE-1 (§4 del ticket) — PDF solo para los reportes de detalle (viáticos/gastos operativos). */}
          {TIPOS_CON_PDF.includes(tipo) ? (
            <a href={exportarUrl("pdf")} className="rounded border border-[var(--border)] px-3 py-2 text-sm">Exportar a PDF</a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!tipoFijo ? (
          <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoReporte)}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        ) : null}
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

      {/*
        REPORTES-VIATICOS-GASTOS-DETALLE-1 (§3 del ticket) — "mantener
        los filtros de pantalla en la exportación": cliente/placa
        (unidad)/empleado/estado/viaje-plan, propios de "viaticos" y
        "gastosDetalle". Mismo endpoint/parseo que el listado (paramsDetalle) —
        nunca dos armados que puedan divergir.
      */}
      {tipo === "viaticos" || tipo === "gastosDetalle" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
          <label className="text-xs text-[var(--muted)]">Cliente
            <select className={`${inputCls} mt-0.5 block`} value={fClienteId2} onChange={(e) => setFClienteId2(e.target.value)}>
              <option value="">Todos</option>
              {clientesCat.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Placa / unidad
            <select className={`${inputCls} mt-0.5 block`} value={fVehiculoId} onChange={(e) => setFVehiculoId(e.target.value)}>
              <option value="">Todas</option>
              {vehiculosCat.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
            </select>
          </label>
          {tipo === "viaticos" ? (
            <>
              <label className="text-xs text-[var(--muted)]">Empleado
                <input className={`${inputCls} mt-0.5 block`} placeholder="Nombre (búsqueda parcial)" value={fEmpleadoNombreViatico} onChange={(e) => setFEmpleadoNombreViatico(e.target.value)} />
              </label>
              <label className="text-xs text-[var(--muted)]">Estado
                <select className={`${inputCls} mt-0.5 block`} value={fEstadoViatico} onChange={(e) => setFEstadoViatico(e.target.value)}>
                  <option value="">Todos</option>
                  {ESTADOS_VIATICO.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="text-xs text-[var(--muted)]">Empleado
                <select className={`${inputCls} mt-0.5 block`} value={fEmpleadoIdGasto} onChange={(e) => setFEmpleadoIdGasto(e.target.value)}>
                  <option value="">Todos</option>
                  {empleadosCat.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </label>
              <label className="text-xs text-[var(--muted)]">Categoría
                <input className={`${inputCls} mt-0.5 block`} value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} />
              </label>
              <label className="text-xs text-[var(--muted)]">Estado
                <select className={`${inputCls} mt-0.5 block`} value={fActivoGasto} onChange={(e) => setFActivoGasto(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="1">Activo</option>
                  <option value="0">Anulado</option>
                </select>
              </label>
            </>
          )}
          <label className="text-xs text-[var(--muted)]">Viaje / plan
            <select className={`${inputCls} mt-0.5 block`} value={fPlanId} onChange={(e) => setFPlanId(e.target.value)}>
              <option value="">Todos</option>
              {planesCat.map((p) => <option key={p.id} value={p.id}>{p.codigo}</option>)}
            </select>
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={() => void cargar()}>Buscar</button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}

      {!loading && tipo === "fondos" && resumenFondos ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[["Solicitudes", String(resumenFondos.cantidad)], ["Total solicitado", money(resumenFondos.totalSolicitado)], ["Total autorizado", money(resumenFondos.totalAutorizado)], ["Total liquidado", money(resumenFondos.totalLiquidado)], ["Total rechazado", money(resumenFondos.totalRechazado)]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3"><p className="text-xs text-[var(--muted)]">{label}</p><p className="font-semibold">{value}</p></div>
          ))}
        </div>
      ) : null}

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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1">Fecha viaje</th><th className="px-2 py-1">Viaje</th><th className="px-2 py-1">Ruta/destino</th>
                <th className="px-2 py-1">Nombre</th><th className="px-2 py-1">Cargo</th><th className="px-2 py-1">Cuenta</th>
                <th className="px-2 py-1">Placa</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Concepto</th>
                <th className="px-2 py-1">Monto</th><th className="px-2 py-1">Estado</th>
                <th className="px-2 py-1">Autorización</th><th className="px-2 py-1">Entrega</th>
              </tr>
            </thead>
            <tbody>
              {(filas as FilaViatico[]).map((f) => (
                <tr key={f.viaticoId} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1">{f.fechaViaje}</td><td className="px-2 py-1">{f.planCodigo}</td><td className="px-2 py-1">{f.rutaDestino ?? "—"}</td>
                  <td className="px-2 py-1">{f.personalNombre}</td><td className="px-2 py-1">{f.cargo ?? "—"}</td><td className="px-2 py-1">{f.cuentaBancaria ?? "—"}</td>
                  <td className="px-2 py-1">{f.placa ?? "—"}</td><td className="px-2 py-1">{f.clienteNombre ?? "—"}</td><td className="px-2 py-1">{f.rol}</td>
                  <td className="px-2 py-1">{money(f.montoAsignado)}</td><td className="px-2 py-1">{f.estado}</td>
                  <td className="px-2 py-1">{f.fechaAutorizacion ? `${f.fechaAutorizacion} · ${f.autorizadoPor ?? "—"}` : "—"}</td>
                  <td className="px-2 py-1">{f.fechaEntrega ? `${f.fechaEntrega} · ${f.entregadoPor ?? "—"}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && tipo === "gastosDetalle" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Fecha viaje</th><th className="px-2 py-1">Viaje</th>
                <th className="px-2 py-1">Empleado</th><th className="px-2 py-1">Cargo</th><th className="px-2 py-1">Placa</th>
                <th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Categoría</th><th className="px-2 py-1">Descripción</th>
                <th className="px-2 py-1">Cantidad</th><th className="px-2 py-1">Monto</th><th className="px-2 py-1">Total</th>
                <th className="px-2 py-1">Estado</th><th className="px-2 py-1">Registrado por</th>
              </tr>
            </thead>
            <tbody>
              {(filas as FilaGastoDetalle[]).map((f) => (
                <tr key={f.id} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1">{f.fechaSolicitud}</td><td className="px-2 py-1">{f.fechaViaje ?? "—"}</td><td className="px-2 py-1">{f.planCodigo ?? "—"}</td>
                  <td className="px-2 py-1">{f.empleadoNombre ?? "—"}</td><td className="px-2 py-1">{f.cargo ?? "—"}</td><td className="px-2 py-1">{f.placa ?? "—"}</td>
                  <td className="px-2 py-1">{f.clienteNombre ?? "—"}</td><td className="px-2 py-1">{f.categoria}</td><td className="px-2 py-1">{f.descripcion ?? "—"}</td>
                  <td className="px-2 py-1">{f.cantidad}</td><td className="px-2 py-1">{money(f.monto)}</td><td className="px-2 py-1">{money(f.total)}</td>
                  <td className={`px-2 py-1 ${f.activo ? "" : "text-red-400"}`}>{f.activo ? "Activo" : "Anulado"}</td>
                  <td className="px-2 py-1">{f.registradoPor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

      {/* §1 del ticket — total general + cantidad de registros, visible también en pantalla (no solo en el export). */}
      {!loading && tipo === "viaticos" && filas.length ? (
        <p className="text-sm font-medium">Total general: {money((filas as FilaViatico[]).reduce((s, f) => s + f.montoAsignado, 0))} · {filas.length} registro(s)</p>
      ) : null}
      {!loading && tipo === "gastosDetalle" && filas.length ? (
        <p className="text-sm font-medium">Total general: {money((filas as FilaGastoDetalle[]).reduce((s, f) => s + f.total, 0))} · {filas.length} registro(s)</p>
      ) : null}

      {!loading && !filas.length ? <p className="text-[var(--muted)]">Sin datos para este filtro.</p> : null}
    </div>
  );
}

export default function ReportesGastosPage() {
  return <ReportesGastosView tipoFijo="gastosDetalle" titulo="Reporte de gastos operativos" />;
}
