"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CuestionarioFields } from "@/components/clientes/cuestionario-fields";
import type {
  RespuestasFacturacion,
  SeccionFacturacion,
} from "@/lib/facturacion/cuestionario";

type Props = { slug: string; puedeEditar: boolean };

type ResumenCliente = {
  clienteId: number;
  nombre: string;
  nit: string | null;
  completadoPct: number;
  actualizadoAt: string | null;
};

type Tab = "empresa" | "clientes" | "ayuda";

export function FacturacionClient({ slug, puedeEditar }: Props) {
  const [tab, setTab] = useState<Tab>("empresa");
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

  const cargarEmpresa = useCallback(async () => {
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
  }, [slug]);

  const cargarResumen = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/facturacion/clientes`);
    const data = await res.json();
    if (res.ok) setResumen(data.clientes ?? []);
  }, [slug]);

  const cargarCliente = useCallback(
    async (id: number) => {
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
    [slug],
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

  async function guardar() {
    if (!puedeEditar || saving) return;
    setSaving(true);
    setMsg("");
    try {
      const url =
        tab === "empresa" || clienteId == null
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

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Facturación
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          Configuración de facturación
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Cada empresa factura distinto y cada cliente también. Completen este
          formulario para dejar las reglas listas antes de emitir facturas en la
          plataforma.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["empresa", "Perfil de la empresa"],
            ["clientes", "Por cliente"],
            ["ayuda", "Cómo llenarlo"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setClienteId(null);
              setMsg("");
            }}
            className={[
              "rounded-lg px-3 py-1.5 text-sm",
              tab === id
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] text-[var(--muted)]",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ayuda" ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-relaxed">
          <p>
            <strong>1.</strong> Empiecen por <em>Perfil de la empresa</em>{" "}
            ({empresaNombre || "esta empresa"}): FEL, quién factura, cortes,
            moneda.
          </p>
          <p>
            <strong>2.</strong> En <em>Clientes</em> den de alta el catálogo
            compartido (Operaciones y Facturación usan el mismo).
          </p>
          <p>
            <strong>3.</strong> Vuelvan aquí → <em>Por cliente</em> y completen
            NIT a facturar, OC, evidencias, tarifa y crédito de cada uno.
          </p>
          <p className="text-[var(--muted)]">
            También pueden compartir el documento{" "}
            <code className="text-xs">CUESTIONARIO-FACTURACION.md</code> del
            repositorio para recolectar respuestas fuera del sistema y luego
            capturarlas aquí.
          </p>
          <Link
            href={`/e/${slug}/clientes`}
            prefetch={false}
            className="inline-block text-[var(--accent)] underline"
          >
            Ir al módulo Clientes
          </Link>
        </div>
      ) : null}

      {tab === "clientes" && clienteId == null ? (
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
                    <tr key={c.clienteId} className="border-t border-[var(--border)]">
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
                          Llenar / editar
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

      {(tab === "empresa" || (tab === "clientes" && clienteId != null)) && (
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
              {puedeEditar ? (
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
              readOnly={!puedeEditar}
            />
          )}
        </div>
      )}

      {msg ? <p className="text-sm text-emerald-600 dark:text-emerald-300">{msg}</p> : null}
    </div>
  );
}
