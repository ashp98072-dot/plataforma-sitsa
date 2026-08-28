"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CuestionarioFields } from "@/components/clientes/cuestionario-fields";
import { FacturasPanel } from "@/components/facturacion/facturas-panel";
import { ViajesPendientesPanel } from "@/components/facturacion/viajes-pendientes-panel";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import type {
  RespuestasFacturacion,
  SeccionFacturacion,
} from "@/lib/facturacion/cuestionario";

type Props = {
  slug: string;
  verEmpresa: boolean;
  editarEmpresa: boolean;
  verClientes: boolean;
  editarClientes: boolean;
  /** Desde menú: Conta → empresa, Ops → clientes. */
  vistaInicial?: "facturas" | "viajes-pendientes" | "empresa" | "clientes" | "ayuda" | null;
};

type KpisFacturacion = {
  viajesPendientes: number;
  valorPendiente: number;
  facturasEmitidas: number;
  valorFacturado: number;
  pendienteCobro: number;
  cobrado: number;
};

function moneda(v: number): string {
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[var(--text)]">{value}</p>
      {sub ? <p className="text-[10px] text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

type ResumenCliente = {
  clienteId: number;
  nombre: string;
  nit: string | null;
  completadoPct: number;
  actualizadoAt: string | null;
};

type Tab = "facturas" | "viajes-pendientes" | "empresa" | "clientes" | "ayuda";

export function FacturacionClient({
  slug,
  verEmpresa,
  editarEmpresa,
  verClientes,
  editarClientes,
  vistaInicial = null,
}: Props) {
  // FACT-1-UI (Fase L) — Facturas/Viajes pendientes se gatean por el
  // permiso propio del módulo "facturacion" (el MISMO que exige
  // requireTenantFacturacion en el backend), nunca por el alcance de rol
  // del cuestionario (empresa/clientes) ni por "tms".
  const { permisos } = useEmpresaSession();
  const puedeVerFacturas = tienePermiso(permisos, "facturacion", "ver");
  const puedeCrearFacturas = tienePermiso(permisos, "facturacion", "crear");
  const puedeEditarFacturas = tienePermiso(permisos, "facturacion", "editar");

  const tabs = useMemo(() => {
    const list: { id: Tab; label: string }[] = [];
    if (puedeVerFacturas) {
      list.push({ id: "facturas", label: "Facturas" });
      list.push({ id: "viajes-pendientes", label: "Viajes pendientes" });
    }
    if (verEmpresa) {
      list.push({ id: "empresa", label: "Configuración empresa" });
    }
    if (verClientes) {
      list.push({ id: "clientes", label: "Requisitos clientes" });
    }
    list.push({ id: "ayuda", label: "Cómo llenarlo" });
    return list;
  }, [puedeVerFacturas, verEmpresa, verClientes]);

  const tabInicial = useMemo((): Tab => {
    if (vistaInicial && tabs.some((t) => t.id === vistaInicial)) {
      return vistaInicial;
    }
    return tabs[0]?.id ?? "ayuda";
  }, [vistaInicial, tabs]);

  const [tab, setTab] = useState<Tab>(tabInicial);

  useEffect(() => {
    setTab(tabInicial);
  }, [tabInicial]);
  const [secciones, setSecciones] = useState<SeccionFacturacion[]>([]);
  const [respuestas, setRespuestas] = useState<RespuestasFacturacion>({});
  const [completadoPct, setCompletadoPct] = useState(0);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [resumen, setResumen] = useState<ResumenCliente[]>([]);
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [clienteNombre, setClienteNombre] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // FACT-1-UI (Fase C) — KPI agregados SIEMPRE con SQL server-side sobre
  // todo el universo de la empresa (GET .../facturas/kpi), nunca
  // calculados aquí sobre una sola página del listado paginado.
  const [kpi, setKpi] = useState<KpisFacturacion | null>(null);
  const cargarKpi = useCallback(async () => {
    if (!puedeVerFacturas) return;
    const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/kpi`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setKpi((data.kpi ?? null) as KpisFacturacion | null);
  }, [slug, puedeVerFacturas]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarKpi();
  }, [cargarKpi]);

  // Cruce Viajes pendientes → Facturas: al crear un Borrador se cambia de
  // pestaña y se le pide a FacturasPanel que lo abra directamente.
  const [facturaAAbrir, setFacturaAAbrir] = useState<number | null>(null);

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) {
      setTab(tabs[0]?.id ?? "ayuda");
    }
  }, [tabs, tab]);

  const cargarEmpresa = useCallback(async () => {
    if (!verEmpresa) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/empresa`);
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "No se pudo cargar el perfil.");
        return;
      }
      setSecciones(data.cuestionario ?? []);
      setRespuestas(data.respuestas ?? {});
      setCompletadoPct(Number(data.completadoPct ?? 0));
      setEmpresaNombre(data.empresa?.nombre ?? "");
    } finally {
      setLoading(false);
    }
  }, [slug, verEmpresa]);

  const cargarResumen = useCallback(async () => {
    if (!verClientes) return;
    const res = await fetch(`/api/empresas/${slug}/facturacion/clientes`);
    const data = await res.json();
    if (res.ok) setResumen(data.clientes ?? []);
    else setMsg(data.error || "No se pudo cargar clientes.");
  }, [slug, verClientes]);

  const cargarCliente = useCallback(
    async (id: number) => {
      if (!verClientes) return;
      setLoading(true);
      setMsg("");
      try {
        const res = await fetch(
          `/api/empresas/${slug}/facturacion/clientes/${id}`,
        );
        const data = await res.json();
        if (!res.ok) {
          setMsg(data.error || "No se pudo cargar el cliente.");
          return;
        }
        setSecciones(data.cuestionario ?? []);
        setRespuestas(data.respuestas ?? {});
        setCompletadoPct(Number(data.completadoPct ?? 0));
        setClienteNombre(data.cliente?.nombre ?? "");
        setClienteId(id);
      } finally {
        setLoading(false);
      }
    },
    [slug, verClientes],
  );

  useEffect(() => {
    if (tab === "empresa") void cargarEmpresa();
    if (tab === "clientes" && clienteId == null) {
      setLoading(true);
      void cargarResumen().finally(() => setLoading(false));
    }
  }, [tab, clienteId, cargarEmpresa, cargarResumen]);

  function setRespuesta(id: string, value: RespuestasFacturacion[string]) {
    setRespuestas((prev) => ({ ...prev, [id]: value }));
  }

  const puedeGuardar =
    (tab === "empresa" && editarEmpresa) ||
    (tab === "clientes" && clienteId != null && editarClientes);

  async function guardar() {
    if (!puedeGuardar || saving) return;
    setSaving(true);
    setMsg("");
    try {
      const url =
        tab === "empresa"
          ? `/api/empresas/${slug}/facturacion/empresa`
          : `/api/empresas/${slug}/facturacion/clientes/${clienteId}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuestas }),
      });
      const data = await res.json();
      setMsg(data.mensaje || data.error || "");
      if (res.ok) {
        setCompletadoPct(Number(data.completadoPct ?? completadoPct));
        if (tab === "clientes") await cargarResumen();
      }
    } finally {
      setSaving(false);
    }
  }

  const subtitulo = puedeVerFacturas
    ? "Agrupa viajes Cerrados en facturas, emítelas y da seguimiento a sus pagos."
    : verEmpresa && !verClientes
      ? "Contabilidad completa cómo factura esta empresa (FEL, cortes, crédito…)."
      : verClientes && !verEmpresa
        ? "Operaciones completa cómo se factura a cada cliente (NIT, OC, tarifa…)."
        : "Contabilidad: empresa. Operaciones: por cliente. Cada uno llena su parte.";

  const mostrarKpi = (tab === "facturas" || tab === "viajes-pendientes") && kpi != null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Facturación
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {puedeVerFacturas ? "Facturación clientes" : verEmpresa && !verClientes
            ? "Facturación de la empresa"
            : verClientes && !verEmpresa
              ? "Facturación por cliente"
              : "Configuración de facturación"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{subtitulo}</p>
      </div>

      {tabs.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setClienteId(null);
                setMsg("");
              }}
              className={[
                "rounded-lg px-3 py-1.5 text-sm",
                tab === t.id
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--border)] text-[var(--muted)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {mostrarKpi && kpi ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Viajes pendientes de facturación" value={String(kpi.viajesPendientes)} />
          <KpiCard label="Valor pendiente de facturación" value={moneda(kpi.valorPendiente)} />
          <KpiCard label="Facturas emitidas" value={String(kpi.facturasEmitidas)} />
          <KpiCard label="Valor facturado" value={moneda(kpi.valorFacturado)} />
          <KpiCard label="Pendiente de cobro" value={moneda(kpi.pendienteCobro)} />
          <KpiCard label="Cobrado" value={moneda(kpi.cobrado)} />
        </section>
      ) : null}

      {tab === "facturas" && puedeVerFacturas ? (
        <FacturasPanel
          slug={slug}
          puedeCrear={puedeCrearFacturas}
          puedeEditar={puedeEditarFacturas}
          abrirFacturaId={facturaAAbrir}
          onAbierta={() => setFacturaAAbrir(null)}
          onCambio={() => void cargarKpi()}
        />
      ) : null}

      {tab === "viajes-pendientes" && puedeVerFacturas ? (
        <ViajesPendientesPanel
          slug={slug}
          puedeCrear={puedeCrearFacturas}
          onFacturaCreada={(facturaId) => {
            setTab("facturas");
            setFacturaAAbrir(facturaId);
            void cargarKpi();
          }}
        />
      ) : null}

      {tab === "ayuda" ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-relaxed">
          <p>
            <strong>Contabilidad</strong> → menú Contabilidad →{" "}
            <em>Facturación empresa</em> (cómo factura esa empresa: FEL, cortes,
            moneda…). Cada empresa tiene su propio perfil.
          </p>
          <p>
            <strong>Operaciones</strong> → menú Operaciones →{" "}
            <em>Facturación clientes</em> (cómo se factura a cada cliente: NIT,
            OC, evidencias, tarifa…). Cada cliente puede ser distinto.
          </p>
          <p>
            El catálogo de clientes es compartido:{" "}
            <Link
              href={`/e/${slug}/clientes`}
              prefetch={false}
              className="text-[var(--accent)] underline"
            >
              módulo Clientes
            </Link>
            .
          </p>
          <p className="text-[var(--muted)]">
            Fuera del sistema pueden usar{" "}
            <code className="text-xs">CUESTIONARIO-FACTURACION.md</code>.
          </p>
        </div>
      ) : null}

      {tab === "clientes" && verClientes && clienteId == null ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">
              Avance del cuestionario por cliente activo.
            </p>
            <Link
              href={`/e/${slug}/clientes`}
              prefetch={false}
              className="text-sm text-[var(--accent)] underline"
            >
              Administrar clientes
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-[var(--muted)]">Cargando…</p>
          ) : (
            <div className="table-scroll rounded-xl border border-[var(--border)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">NIT</th>
                    <th className="px-3 py-2">Avance</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((c) => (
                    <tr
                      key={c.clienteId}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-2 font-medium">{c.nombre}</td>
                      <td className="px-3 py-2">{c.nit || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded bg-[var(--panel)]">
                            <div
                              className="h-full bg-[var(--accent-2)]"
                              style={{ width: `${c.completadoPct}%` }}
                            />
                          </div>
                          <span className="text-xs">{c.completadoPct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-[var(--accent)] underline"
                          onClick={() => void cargarCliente(c.clienteId)}
                        >
                          {editarClientes ? "Llenar / editar" : "Ver"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!resumen.length ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-[var(--muted)]"
                      >
                        No hay clientes activos. Créalos en el módulo Clientes.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {(tab === "empresa" && verEmpresa) ||
      (tab === "clientes" && verClientes && clienteId != null) ? (
        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">
                {tab === "empresa"
                  ? `Empresa: ${empresaNombre || "…"}`
                  : `Cliente: ${clienteNombre}`}
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Completado (campos requeridos): {completadoPct}%
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {tab === "clientes" && clienteId != null ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                  onClick={() => {
                    setClienteId(null);
                    setMsg("");
                  }}
                >
                  Volver al listado
                </button>
              ) : null}
              {puedeGuardar ? (
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void guardar()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                >
                  {saving ? "Guardando…" : "Guardar respuestas"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-[var(--panel)]">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${completadoPct}%` }}
            />
          </div>
          {loading ? (
            <p className="text-sm text-[var(--muted)]">Cargando formulario…</p>
          ) : (
            <CuestionarioFields
              secciones={secciones}
              respuestas={respuestas}
              onChange={setRespuesta}
              readOnly={!puedeGuardar}
            />
          )}
        </div>
      ) : null}

      {msg ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-300">{msg}</p>
      ) : null}
    </div>
  );
}
