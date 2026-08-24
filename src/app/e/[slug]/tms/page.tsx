"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ViaticosConfigPanel from "@/components/tms/viaticos-config-panel";
import ClienteUbicacionesAdmin from "@/components/tms/cliente-ubicaciones-admin";

/**
 * Operaciones → TMS / Logística — VIAT-1b: centro de configuración/
 * administración/soporte operativo. Programación (src/app/e/[slug]/
 * programacion/) es ahora la pantalla operativa diaria (crear/editar
 * viajes, asignar piloto/auxiliares/unidad, paradas, viáticos, estados) —
 * esta pantalla YA NO duplica ese formulario. Mismo backend/endpoints de
 * siempre (nada se eliminó de la API ni de las tablas), solo se
 * reorganizó la UI en 4 secciones:
 *   1. Configuración de viáticos (ViaticosConfigPanel, sin cambios).
 *   2. Ubicaciones de clientes (ClienteUbicacionesAdmin, nuevo — admin de
 *      tms_cliente_ubicaciones).
 *   3. Catálogos/información operativa (clientes, unidades, personal,
 *      lugares) — resumen de solo lectura de GET /tms/catalogos.
 *   4. Viajes / consulta administrativa — tabla de solo lectura de
 *      GET /tms/planes con filtros, enlace "Ver en Programación", y
 *      evidencia de carga/descarga en el detalle (soporte de campo ya
 *      existente — no reasigna piloto/auxiliares/unidad/paradas, no
 *      cambia estado).
 */

type ClienteCat = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};
type LugarCat = { id: number; nombre: string; tipo: string; direccion?: string | null };
type UnidadCat = { id: number; placa: string; tipo: string; marca?: string | null; modelo?: string | null; estado: string };
type PersonalCat = { id: number; id_empleado?: number | null; codigo?: string | null; nombre: string; tipo: string; telefono?: string | null; estado: string };

type ParadaPlan = {
  id: number;
  orden: number;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

type Plan = {
  id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  estado: string;
  tipo_traslado: string | null;
  regreso_estimado: string | null;
  tarifa_comercial: number | null;
  referencia_cliente: string | null;
  notas: string | null;
  cliente: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliar: string | null;
  auxiliares?: string[];
  paradas?: ParadaPlan[];
  paradasPendientes?: number;
  evidencias: number;
};

type AudRow = {
  id: number;
  usuario: string | null;
  accion: string;
  modulo: string | null;
  detalle: string | null;
  creadoEn: string;
};

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

function labelAccionAud(accion: string): string {
  switch (accion) {
    case "crear_ruta":
      return "Creó ruta";
    case "editar_ruta":
      return "Editó ruta";
    case "cancelar_ruta":
      return "Canceló ruta";
    case "salida_viaje":
      return "Salida (piloto)";
    case "llegada_viaje":
      return "Llegada / cierre";
    case "eliminar_evidencia":
      return "Eliminó evidencia";
    case "config_viatico":
      return "Configuró viático";
    case "editar_viatico":
      return "Editó viático";
    default:
      return accion;
  }
}

export default function TmsPage() {
  const slug = String(useParams().slug);

  // --- Sección 3: catálogos (fuente única para el resumen y para el
  // buscador de cliente de la sección 2) ---
  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  const [lugaresCat, setLugaresCat] = useState<LugarCat[]>([]);
  const [unidadesCat, setUnidadesCat] = useState<UnidadCat[]>([]);
  const [personalCat, setPersonalCat] = useState<PersonalCat[]>([]);
  const [catalogoMsg, setCatalogoMsg] = useState("");

  const cargarCatalogos = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setClientesCat((data.clientes ?? []) as ClienteCat[]);
      setLugaresCat((data.lugares ?? []) as LugarCat[]);
      setUnidadesCat((data.unidades ?? []) as UnidadCat[]);
      setPersonalCat((data.personal ?? []) as PersonalCat[]);
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarCatalogos();
  }, [cargarCatalogos]);

  const pilotosCat = useMemo(() => personalCat.filter((p) => p.tipo === "Piloto"), [personalCat]);
  const auxiliaresCat = useMemo(() => personalCat.filter((p) => p.tipo === "Auxiliar"), [personalCat]);

  // --- Sección 4: viajes / consulta administrativa ---
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [loadingPlanes, setLoadingPlanes] = useState(true);
  const [fCodigo, setFCodigo] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fFecha, setFFecha] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [expandido, setExpandido] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const cargarPlanes = useCallback(async () => {
    setLoadingPlanes(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPlanes((data.planes ?? []) as Plan[]);
    } finally {
      setLoadingPlanes(false);
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarPlanes();
  }, [cargarPlanes]);

  const planesFiltrados = useMemo(() => {
    return planes.filter((p) => {
      if (fCodigo && !p.codigo.toLowerCase().includes(fCodigo.trim().toLowerCase())) return false;
      if (fCliente && !(p.cliente ?? "").toLowerCase().includes(fCliente.trim().toLowerCase())) return false;
      if (fFecha && String(p.fecha_plan).slice(0, 10) !== fFecha) return false;
      if (fEstado && p.estado !== fEstado) return false;
      return true;
    });
  }, [planes, fCodigo, fCliente, fFecha, fEstado]);

  const estadosDisponibles = useMemo(
    () => [...new Set(planes.map((p) => p.estado))].sort(),
    [planes],
  );

  // --- Evidencia de carga/descarga (soporte de campo — no reasigna
  // personal/unidad/paradas, no cambia estado). Misma lógica que ya
  // existía en el formulario retirado de esta pantalla. ---
  async function subirEvidencia(planId: number, tipo: "Carga" | "Descarga") {
    const inputEl = document.createElement("input");
    inputEl.type = "file";
    inputEl.accept = "image/*";
    inputEl.onchange = async () => {
      const file = inputEl.files?.[0];
      if (!file) return;
      let latitud: number | undefined;
      let longitud: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }),
        );
        latitud = pos.coords.latitude;
        longitud = pos.coords.longitude;
      } catch {
        /* geo opcional */
      }
      const fd = new FormData();
      fd.set("planId", String(planId));
      fd.set("tipo", tipo);
      fd.set("file", file);
      if (latitud != null) fd.set("latitud", String(latitud));
      if (longitud != null) fd.set("longitud", String(longitud));
      const res = await fetch(`/api/empresas/${slug}/tms/evidencias`, { method: "POST", body: fd });
      const data = await res.json();
      setMsg(data.mensaje || data.error);
      if (res.ok) await cargarPlanes();
    };
    inputEl.click();
  }

  // --- Bitácora (administración avanzada) ---
  const [bitacora, setBitacora] = useState<AudRow[]>([]);
  const [mostrarBitacora, setMostrarBitacora] = useState(false);
  const cargarBitacora = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/auditoria?modulo=tms&limite=150`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setBitacora((data.auditoria ?? []) as AudRow[]);
  }, [slug]);

  async function crearClienteRapido() {
    const nombre = window.prompt("Nombre del cliente:");
    if (!nombre?.trim()) return;
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "cliente", nombre: nombre.trim() }),
    });
    const data = await res.json();
    setCatalogoMsg(data.mensaje || data.error);
    if (res.ok) await cargarCatalogos();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">TMS / Logística</h1>
        <p className="text-sm text-[var(--muted)]">
          Configuración, catálogos y consulta administrativa. Para crear o
          editar un viaje (cliente, unidad, piloto, auxiliares, paradas,
          viáticos, estado) usa{" "}
          <Link href={`/e/${slug}/programacion`} className="text-[var(--accent)] underline">
            Operaciones → Programación
          </Link>
          .
        </p>
      </div>

      {/* 1. Configuración de viáticos */}
      <ViaticosConfigPanel slug={slug} />

      {/* 2. Ubicaciones de clientes */}
      <ClienteUbicacionesAdmin slug={slug} clientes={clientesCat} />

      {/* 3. Catálogos / información operativa */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Catálogos / información operativa</p>
          <button type="button" className="rounded bg-[#334155] px-2 py-1 text-xs text-white" onClick={() => void crearClienteRapido()}>
            + Cliente rápido
          </button>
        </div>
        {catalogoMsg ? <p className="mt-1 text-xs text-emerald-300">{catalogoMsg}</p> : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Clientes ({clientesCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {clientesCat.map((c) => (
                <li key={c.id} className="border-t border-[var(--border)] py-1">
                  {c.codigo ? `${c.codigo} · ` : ""}
                  {c.nombre}
                  {c.nit ? ` · NIT ${c.nit}` : ""}
                </li>
              ))}
              {!clientesCat.length ? <li className="py-1 text-[var(--muted)]">Sin clientes.</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Unidades ({unidadesCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {unidadesCat.map((u) => (
                <li key={u.id} className="border-t border-[var(--border)] py-1">
                  <span className="font-mono">{u.placa}</span> · {u.tipo}
                  {u.marca || u.modelo ? ` · ${[u.marca, u.modelo].filter(Boolean).join(" ")}` : ""} · {u.estado}
                </li>
              ))}
              {!unidadesCat.length ? <li className="py-1 text-[var(--muted)]">Sin unidades.</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Pilotos ({pilotosCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {pilotosCat.map((p) => (
                <li key={p.id} className="border-t border-[var(--border)] py-1">
                  {p.nombre} {p.codigo ? `(${p.codigo})` : ""} · {p.estado}
                  {p.id_empleado ? " · RRHH" : ""}
                </li>
              ))}
              {!pilotosCat.length ? <li className="py-1 text-[var(--muted)]">Sin pilotos.</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Auxiliares ({auxiliaresCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {auxiliaresCat.map((p) => (
                <li key={p.id} className="border-t border-[var(--border)] py-1">
                  {p.nombre} {p.codigo ? `(${p.codigo})` : ""} · {p.estado}
                  {p.id_empleado ? " · RRHH" : ""}
                </li>
              ))}
              {!auxiliaresCat.length ? <li className="py-1 text-[var(--muted)]">Sin auxiliares.</li> : null}
            </ul>
          </div>
          <div className="lg:col-span-2">
            <p className="text-xs font-medium text-[var(--muted)]">Lugares/paradas ({lugaresCat.length})</p>
            <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
              {lugaresCat.map((l) => (
                <li key={l.id} className="border-t border-[var(--border)] py-1">
                  {l.nombre} · {l.tipo}
                  {l.direccion ? ` · ${l.direccion}` : ""}
                </li>
              ))}
              {!lugaresCat.length ? <li className="py-1 text-[var(--muted)]">Sin lugares registrados.</li> : null}
            </ul>
          </div>
        </div>
      </div>

      {/* 4. Viajes / consulta administrativa */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm font-medium">Viajes / consulta administrativa</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Solo lectura, más evidencia de carga/descarga. Para crear, reasignar o reprogramar, usa Programación.
        </p>
        {msg ? <p className="mt-1 text-xs text-emerald-300">{msg}</p> : null}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            Código
            <input className={`${inputCls} mt-0.5 block w-36`} value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Cliente
            <input className={`${inputCls} mt-0.5 block w-40`} value={fCliente} onChange={(e) => setFCliente(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Fecha
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fFecha} onChange={(e) => setFFecha(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Estado
            <select className={`${inputCls} mt-0.5 block`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
              <option value="">Todos</option>
              {estadosDisponibles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
            disabled={loadingPlanes}
            onClick={() => void cargarPlanes()}
          >
            {loadingPlanes ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#1F6AA5] text-white">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Piloto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Evid.</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {planesFiltrados.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 py-2">{p.codigo}</td>
                    <td className="px-3 py-2">{String(p.fecha_plan).slice(0, 10)}</td>
                    <td className="px-3 py-2">{p.cliente ?? "—"}</td>
                    <td className="px-3 py-2">{p.placa ?? "—"}</td>
                    <td className="px-3 py-2">{p.piloto ?? "—"}</td>
                    <td className="px-3 py-2">{p.estado}</td>
                    <td className="px-3 py-2">{Number(p.evidencias ?? 0)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          className="text-sky-300 hover:underline"
                          onClick={() => setExpandido((cur) => (cur === p.id ? null : p.id))}
                        >
                          {expandido === p.id ? "Cerrar" : "Detalle"}
                        </button>
                        <Link href={`/e/${slug}/programacion?plan=${p.id}`} className="text-[var(--accent)] hover:underline">
                          Ver en Programación
                        </Link>
                      </div>
                    </td>
                  </tr>
                  {expandido === p.id ? (
                    <tr key={`${p.id}-detalle`} className="border-t border-[var(--border)] bg-black/10">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                              Datos comerciales
                            </p>
                            <p className="text-xs">Cliente: {p.cliente ?? "—"}</p>
                            <p className="text-xs">
                              Tarifa comercial:{" "}
                              {p.tarifa_comercial != null
                                ? `Q${Number(p.tarifa_comercial).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "—"}
                            </p>
                            <p className="text-xs">Referencia cliente: {p.referencia_cliente || "—"}</p>
                            <p className="text-xs">Tipo de traslado: {p.tipo_traslado || "—"}</p>
                            <p className="text-xs">
                              Regreso estimado: {p.regreso_estimado ? p.regreso_estimado.replace("T", " · ") : "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                              Personal y paradas
                            </p>
                            <p className="text-xs">
                              Auxiliares: {(p.auxiliares ?? []).length ? p.auxiliares!.join(", ") : p.auxiliar || "—"}
                            </p>
                            <p className="text-xs">Notas: {p.notas || "—"}</p>
                            {(p.paradas ?? []).length ? (
                              <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                                {p.paradas!.map((pp) => (
                                  <li key={pp.id}>
                                    {pp.orden}. {pp.lugar_nombre} ({pp.tipo}) ·{" "}
                                    {pp.evidencias > 0 ? `${pp.evidencias} foto(s)` : pp.requiere_evidencia ? "pendiente" : "sin evidencia req."}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[11px] text-[var(--muted)]">Sin paradas registradas.</p>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void subirEvidencia(p.id, "Carga")}
                            className="rounded bg-[#0d9488] px-3 py-1 text-xs text-white"
                          >
                            Evidencia carga
                          </button>
                          <button
                            type="button"
                            onClick={() => void subirEvidencia(p.id, "Descarga")}
                            className="rounded bg-[#0f766e] px-3 py-1 text-xs text-white"
                          >
                            Evidencia descarga
                          </button>
                        </div>
                        <p className="mt-2 text-[10px] text-amber-200/80">
                          Información interna: los viáticos de este viaje NO se muestran aquí ni en ninguna vista de
                          cliente — se administran desde Programación.
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!planesFiltrados.length && !loadingPlanes ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-[var(--muted)]">
                    Sin viajes con este filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bitácora — administración avanzada */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">Bitácora de rutas</h2>
            <p className="text-[11px] text-[var(--muted)]">
              Quién crea, edita, cancela, sale, cierra o elimina evidencias — con fecha y hora.
            </p>
          </div>
          <button
            type="button"
            className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
            onClick={() => {
              const next = !mostrarBitacora;
              setMostrarBitacora(next);
              if (next) void cargarBitacora();
            }}
          >
            {mostrarBitacora ? "Ocultar bitácora" : "Ver bitácora"}
          </button>
        </div>
        {mostrarBitacora ? (
          <div className="max-h-80 overflow-auto rounded border border-[var(--border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#1e293b] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-1.5">Fecha / hora</th>
                  <th className="px-2 py-1.5">Usuario</th>
                  <th className="px-2 py-1.5">Acción</th>
                  <th className="px-2 py-1.5">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {bitacora.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--border)] align-top">
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-sky-300">{a.creadoEn || "—"}</td>
                    <td className="px-2 py-1.5 font-medium">{a.usuario || "—"}</td>
                    <td className="px-2 py-1.5 text-amber-200">{labelAccionAud(a.accion)}</td>
                    <td className="px-2 py-1.5 text-[var(--muted)]">{a.detalle || "—"}</td>
                  </tr>
                ))}
                {!bitacora.length ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-3 text-[var(--muted)]">
                      Aún no hay movimientos registrados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
