"use client";
import { useEffect, useState } from "react";

/**
 * GASTOS-REDISENO-VISUAL — listado compacto + detalle expandible de Gastos
 * operativos, con el mismo lenguaje visual que Compras / Repuestos
 * (requerimientos-client.tsx) y Solicitudes de fondo. Es SOLO presentación:
 * cálculos, permisos, estados y endpoints son los de siempre (ver
 * gastos/page.tsx); los formularios de alta/edición siguen siendo propios
 * de Gastos y no viven aquí.
 */
export type GastoLineaVista = {
  id: number;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  metodoPago: string | null;
  numeroCuentaPago: string | null;
  fechaViaje: string | null;
  // El detalle por id trae los nombres resueltos; el tipo de la página (ids solamente) los deja opcionales.
  empleadoNombre?: string | null;
  cargo?: string | null;
  placa?: string | null;
  clienteNombre?: string | null;
};

export type GastoVista = {
  id: number;
  /** Código administrativo persistido (GASTO-000055); si falta (dato antiguo/caché) se muestra "Gasto #id". */
  codigo?: string;
  fechaSolicitud: string;
  fechaViaje: string | null;
  empleadoNombre: string | null;
  empleadoCargo: string | null;
  vehiculoPlaca: string | null;
  clienteNombre: string | null;
  planCodigo: string | null;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  metodoPago: string | null;
  numeroCuentaPago: string | null;
  facturaNombreOriginal: string | null;
  observaciones: string | null;
  estado: string | null;
  motivoRechazo: string | null;
  entidadRequirenteNombre: string | null;
  requirenteNombre: string | null;
  solicitanteNombre: string | null;
  /** `undefined` en el listado (nunca las trae); array (posiblemente vacío) en el detalle por id. */
  lineas?: (GastoLineaVista & { orden?: number })[];
};

export const monedaGasto = (n: number) => `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2 })}`;

/** Gasto sin líneas (simple/histórico): la única "línea" son los campos de cabecera, igual que el PDF/Excel. */
export function lineasDeGasto(g: GastoVista): GastoLineaVista[] {
  if (g.lineas?.length) return g.lineas;
  return [{
    id: 0, categoria: g.categoria, descripcion: g.descripcion, cantidad: g.cantidad, monto: g.monto,
    metodoPago: g.metodoPago, numeroCuentaPago: g.numeroCuentaPago, fechaViaje: g.fechaViaje,
    empleadoNombre: g.empleadoNombre, cargo: g.empleadoCargo, placa: g.vehiculoPlaca, clienteNombre: g.clienteNombre,
  }];
}

const estilo = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1";
const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const colorEstado = (estado: string | null) =>
  estado === "Rechazada" ? "text-red-400" : estado === "Autorizada" ? "text-emerald-400" : estado === "Pendiente" ? "text-amber-400" : "text-[var(--muted)]";

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  return <div><dt className="text-[var(--muted)]">{etiqueta}</dt><dd className="break-words font-medium">{valor?.trim() || "—"}</dd></div>;
}

/** Vista pura del detalle (sin fetch) — separada para poder probarla sin efectos. */
export function GastoDetalleVista({ slug, gasto }: { slug: string; gasto: GastoVista }) {
  const lineas = lineasDeGasto(gasto);
  const total = gasto.cantidad * gasto.monto;
  return (
    <div className="mt-3 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-xs">
      <section aria-label="Datos generales">
        <h3 className="mb-2 font-semibold uppercase tracking-wide text-[var(--muted)]">Datos generales</h3>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <Dato etiqueta="Gasto" valor={`#${gasto.id}`} />
          <Dato etiqueta="Fecha solicitud" valor={gasto.fechaSolicitud} />
          <Dato etiqueta="Persona" valor={gasto.empleadoNombre} />
          <Dato etiqueta="Empresa requirente" valor={gasto.entidadRequirenteNombre} />
          <Dato etiqueta="Requirente" valor={gasto.requirenteNombre} />
          <Dato etiqueta="Solicitante" valor={gasto.solicitanteNombre} />
          <Dato etiqueta="Estado" valor={gasto.estado ?? "Histórico"} />
          <Dato etiqueta="Método de pago" valor={gasto.metodoPago} />
          <Dato etiqueta="Cuenta / número" valor={gasto.numeroCuentaPago} />
          <Dato etiqueta="Viaje / plan" valor={gasto.planCodigo} />
        </dl>
      </section>

      <section aria-label="Detalle / líneas">
        <h3 className="mb-2 font-semibold uppercase tracking-wide text-[var(--muted)]">Detalle / líneas</h3>
        {/* Escritorio/tablet: tabla compacta con texto envuelto; sin ancho mínimo gigante. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left">
            <thead className="text-[var(--muted)]">
              <tr>
                {["Cargo", "Placa", "Cliente", "Categoría", "Cantidad", "Descripción", "Valor", "Subtotal"].map((t, i) => (
                  <th scope="col" key={t} className={`px-2 py-1 ${i >= 6 ? "text-right" : ""}`}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={`${l.id}-${i}`} className="border-t border-[var(--border)] align-top">
                  <td className="px-2 py-1.5">{l.cargo ?? "—"}</td>
                  <td className="px-2 py-1.5">{l.placa ?? "—"}</td>
                  <td className="px-2 py-1.5">{l.clienteNombre ?? "—"}</td>
                  <td className="px-2 py-1.5">{l.categoria}</td>
                  <td className="px-2 py-1.5">{l.cantidad}</td>
                  <td className="whitespace-normal break-words px-2 py-1.5">{l.descripcion ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right">{monedaGasto(l.monto)}</td>
                  <td className="px-2 py-1.5 text-right">{monedaGasto(l.cantidad * l.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Móvil: una tarjeta por línea, sin scroll horizontal. */}
        <ul className="space-y-2 md:hidden">
          {lineas.map((l, i) => (
            <li key={`${l.id}-${i}`} className="rounded border border-[var(--border)] p-2">
              <p className="font-medium">{l.categoria} · {monedaGasto(l.cantidad * l.monto)}</p>
              <p className="break-words text-[var(--muted)]">{l.descripcion ?? "—"}</p>
              <p className="text-[var(--muted)]">{[l.cargo, l.placa, l.clienteNombre].filter(Boolean).join(" · ") || "—"}</p>
              <p className="text-[var(--muted)]">Cantidad {l.cantidad} × {monedaGasto(l.monto)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-right text-sm font-semibold">Total: {monedaGasto(total)}</p>
      </section>

      {gasto.observaciones ? (
        <section aria-label="Observaciones">
          <h3 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Observaciones</h3>
          <p className="whitespace-pre-wrap break-words">{gasto.observaciones}</p>
        </section>
      ) : null}

      {gasto.facturaNombreOriginal ? (
        <section aria-label="Documentos">
          <h3 className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Documentos</h3>
          <a className="text-[var(--accent)] underline" href={`/api/empresas/${slug}/tms/gastos/${gasto.id}/comprobante`} target="_blank" rel="noreferrer">{gasto.facturaNombreOriginal}</a>
        </section>
      ) : null}
    </div>
  );
}

/** Detalle lazy: pide el gasto por id solo al expandir, con caché por id (mismo patrón que FondoLineasClient/LineasCompraClient). */
export function GastoDetalleClient({ slug, id, cache }: { slug: string; id: number; cache: Map<string, GastoVista> }) {
  const clave = `${slug}/${id}`;
  const [gasto, setGasto] = useState<GastoVista | null>(() => cache.get(clave) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cache.has(clave)) return;
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/tms/gastos/${id}`, { cache: "no-store", signal: controller.signal })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cargar el detalle del gasto.");
        return data.gasto as GastoVista;
      })
      .then(detalle => { if (!controller.signal.aborted) { cache.set(clave, detalle); setGasto(detalle); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo cargar el detalle del gasto."); });
    return () => controller.abort();
  }, [slug, id, cache, clave]);
  if (error) return <p role="alert" className="mt-3 text-red-400">{error} Cierre y vuelva a abrir para reintentar.</p>;
  if (!gasto) return <p role="status" className="mt-3 text-[var(--muted)]">Cargando detalle…</p>;
  return <GastoDetalleVista slug={slug} gasto={gasto} />;
}

export type GastosListadoProps = {
  slug: string;
  gastos: GastoVista[];
  loading: boolean;
  puedeAutorizar: boolean;
  expandido: number | null;
  onToggle: (id: number) => void;
  cache: Map<string, GastoVista>;
  autorizandoId: number | null;
  motivoRechazo: Record<number, string>;
  onMotivoChange: (id: number, valor: string) => void;
  onAutorizar: (id: number) => void;
  onRechazar: (id: number) => void;
  onEditar: (id: number) => void;
  onDesactivar: (id: number) => void;
  onEliminarComprobante: (id: number) => void;
};

export function GastosListado(p: GastosListadoProps) {
  return (
    <div className="space-y-2">
      {p.loading ? <p role="status" className="text-[var(--muted)]">Cargando…</p> : null}
      {!p.gastos.length && !p.loading ? <p className="text-[var(--muted)]">Sin gastos con este filtro.</p> : null}
      {p.gastos.map((g) => (
        <section key={g.id} aria-label={`Gasto ${g.codigo || g.id}`} className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="font-medium">{g.codigo || `Gasto #${g.id}`}</span> · {g.empleadoNombre ?? "—"} · {g.fechaViaje ?? g.fechaSolicitud} ·{" "}
              <span className={colorEstado(g.estado)}>{g.estado ?? "Histórico"}</span> · {monedaGasto(g.cantidad * g.monto)}
              <p className="mt-1 break-words text-xs text-[var(--muted)]">
                {[g.categoria, g.entidadRequirenteNombre, g.metodoPago].filter(Boolean).join(" · ")}
              </p>
              {g.motivoRechazo ? <p className="mt-1 text-xs text-red-400">Motivo de rechazo: {g.motivoRechazo}</p> : null}
              {g.facturaNombreOriginal ? (
                <p className="mt-1 text-xs">
                  Comprobante: <a className="text-[var(--accent)]" href={`/api/empresas/${p.slug}/tms/gastos/${g.id}/comprobante`} target="_blank" rel="noreferrer">{g.facturaNombreOriginal}</a>
                  <button type="button" onClick={() => p.onEliminarComprobante(g.id)} className="ml-2 text-red-400">Quitar</button>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" aria-expanded={p.expandido === g.id} aria-controls={`gasto-detalle-${g.id}`} onClick={() => p.onToggle(g.id)} className="text-[var(--accent)]">
                {p.expandido === g.id ? "Ocultar detalle" : "Ver detalle"}
              </button>
              {/* PDF individual (con firmas) solo una vez autorizado; el endpoint vuelve a validarlo del lado del servidor. */}
              {g.estado === "Autorizada" ? <a href={`/api/empresas/${p.slug}/tms/gastos/${g.id}/pdf`} className={estilo}>Descargar PDF</a> : null}
              <a href={`/api/empresas/${p.slug}/tms/gastos/${g.id}/exportar`} className={estilo}>Exportar Excel</a>
              {/* Editar: Pendiente o histórico (estado null), igual que antes; el backend bloquea Autorizada/Rechazada. */}
              {g.estado === "Pendiente" || g.estado === null ? <button type="button" onClick={() => p.onEditar(g.id)} className={estilo}>Editar</button> : null}
              {/* Desactivar: excepción administrativa aprobada, sin condición de estado. */}
              <button type="button" onClick={() => p.onDesactivar(g.id)} className="text-red-400">Desactivar</button>
            </div>
          </div>
          {p.puedeAutorizar && g.estado === "Pendiente" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2 text-xs">
              <button type="button" onClick={() => p.onAutorizar(g.id)} disabled={p.autorizandoId !== null} className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-50">Autorizar</button>
              <input className={`${inputCls} w-40`} placeholder="Motivo de rechazo" value={p.motivoRechazo[g.id] ?? ""} onChange={(e) => p.onMotivoChange(g.id, e.target.value)} />
              <button type="button" onClick={() => p.onRechazar(g.id)} className="rounded bg-red-600 px-2 py-1 text-white">Rechazar</button>
            </div>
          ) : null}
          {p.expandido === g.id ? <div id={`gasto-detalle-${g.id}`}><GastoDetalleClient key={`${p.slug}/${g.id}`} slug={p.slug} id={g.id} cache={p.cache} /></div> : null}
        </section>
      ))}
    </div>
  );
}
