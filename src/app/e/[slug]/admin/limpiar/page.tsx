"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  MODULOS_LIMPIEZA,
  MODULO_LIMPIEZA_LABEL,
  MODULO_LIMPIEZA_NOTA,
  type ModuloLimpieza,
} from "@/lib/admin/limpiar-modulo-shared";

type Empresa = { id: number; nombre: string; codigo: string; slug?: string };

/** ADMIN-LIMPIAR-ARCHIVOS-FISICOS — solo viene presente para "pruebas_reinicio_completo" (ver limpiarModuloEmpresa en src/lib/admin/limpiar-modulo.ts). */
type ResultadoArchivos = {
  detectados: number;
  eliminados: number;
  noEncontrados: number;
  conError: number;
  advertencias: string[];
};

export default function LimpiarModuloPage() {
  const slug = String(useParams().slug);
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState(0);
  const [modulo, setModulo] = useState<ModuloLimpieza>("rrhh");
  const [conteos, setConteos] = useState<Record<string, number> | null>(null);
  const [confirmacionEsperada, setConfirmacionEsperada] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [loading, setLoading] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [archivosResultado, setArchivosResultado] = useState<ResultadoArchivos | null>(null);

  const empresaSel = useMemo(
    () => empresas.find((e) => e.id === empresaId) ?? null,
    [empresas, empresaId],
  );

  const otrasEmpresas = useMemo(
    () => empresas.filter((e) => e.id !== empresaId).map((e) => e.codigo),
    [empresas, empresaId],
  );

  const cargarEmpresas = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.user?.rol !== "Admin") {
      setAllowed(false);
      router.replace(`/e/${slug}/dashboard`);
      return;
    }
    setAllowed(true);
    const list: Empresa[] = me.empresas ?? [];
    setEmpresas(list);
    const preferida =
      list.find((e) => e.slug === slug) ||
      list.find((e) => e.codigo.toLowerCase() === "kt") ||
      list[0];
    if (preferida) setEmpresaId(preferida.id);
  }, [router, slug]);

  useEffect(() => {
    const timer = window.setTimeout(() => void cargarEmpresas(), 0);
    return () => window.clearTimeout(timer);
  }, [cargarEmpresas]);

  const cargarConteos = useCallback(async (signal: AbortSignal) => {
    if (!empresaId) return;
    setLoading(true);
    setError("");
    setMsg("");
    setConfirmacion("");
    setConfirmacionEsperada("");
    setArchivosResultado(null);
    try {
      const res = await fetch(
        `/api/admin/limpiar-modulo?empresaId=${empresaId}&modulo=${modulo}`,
        { signal },
      );
      const data = await res.json();
      if (signal.aborted) return;
      if (!res.ok) {
        setError(data.error ?? "No se pudieron cargar conteos");
        setConteos(null);
        return;
      }
      setConteos(data.conteos ?? {});
      setConfirmacionEsperada(data.confirmacionEsperada ?? "");
    } catch {
      if (!signal.aborted) {
        setError("No se pudieron cargar los datos. Vuelve a seleccionar el módulo.");
        setConteos(null);
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [empresaId, modulo]);

  useEffect(() => {
    if (!allowed || !empresaId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void cargarConteos(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [allowed, empresaId, modulo, cargarConteos]);

  async function ejecutar() {
    if (ejecutando || loading || !empresaSel || confirmacionEsperada !== `${empresaSel.codigo} LIMPIAR ${modulo.toUpperCase()}` || confirmacion.trim().toUpperCase() !== confirmacionEsperada.toUpperCase()) return;
    setEjecutando(true);
    setError("");
    setMsg("");
    setArchivosResultado(null);
    try {
      const res = await fetch("/api/admin/limpiar-modulo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId, modulo, confirmacion }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al limpiar");
        return;
      }
      setMsg(
        data.mensaje ??
          `Listo: solo se limpió ${modulo.toUpperCase()} de ${empresaSel?.codigo ?? "la empresa"}.`,
      );
      setConfirmacion("");
      setConteos(data.restantes ?? {});
      // ADMIN-LIMPIAR-ARCHIVOS-FISICOS — solo viene en la respuesta para
      // "pruebas_reinicio_completo"; para el resto de módulos es undefined.
      setArchivosResultado(data.archivos ?? null);
    } catch {
      setError("Error de red.");
    } finally {
      setEjecutando(false);
    }
  }

  if (!allowed) {
    return (
      <p className="text-sm text-[var(--muted)]">Solo administrador…</p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Limpiar por empresa y módulo</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Primero elige la empresa (ej. Ecoplanet / recicladora). Luego el
          módulo (ej. solo RRHH). Las demás empresas no se tocan.
        </p>
        <Link
          href={`/e/${slug}/usuarios`}
          className="mt-2 inline-block text-xs text-[var(--accent)] underline"
        >
          ← Volver a Usuarios
        </Link>
      </div>

      <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div>
          <p className="text-sm font-medium">1. Empresa a limpiar</p>
          <p className="mb-2 text-xs text-[var(--muted)]">
            Solo se borrarán datos de la empresa marcada. Ejemplo: RRHH de
            Ecoplanet no afecta KT ni las demás.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {empresas.map((e) => {
              const activa = empresaId === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={ejecutando}
                  onClick={() => { setConfirmacion(""); setEmpresaId(e.id); }}
                  className={[
                    "rounded-lg border px-3 py-2.5 text-left transition",
                    activa
                      ? "border-sky-500 bg-sky-950/40 ring-1 ring-sky-500/60"
                      : "border-[var(--border)] bg-[var(--input)] hover:border-slate-500",
                  ].join(" ")}
                >
                  <span className="block text-sm font-semibold tracking-wide">
                    {e.codigo}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {e.nombre}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">2. Módulo o dato específico</p>
          <p className="mb-2 text-xs text-[var(--muted)]">
            {MODULO_LIMPIEZA_NOTA[modulo]}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODULOS_LIMPIEZA.map((m) => {
              const activa = modulo === m;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={ejecutando}
                  onClick={() => { setConfirmacion(""); setModulo(m); }}
                  className={[
                    "rounded-lg border px-3 py-2 text-left text-xs font-medium transition",
                    activa
                      ? "border-amber-500 bg-amber-950/40 text-amber-100"
                      : "border-[var(--border)] bg-[var(--input)] text-[var(--muted)] hover:text-[var(--nav-text-strong)]",
                  ].join(" ")}
                >
                  {MODULO_LIMPIEZA_LABEL[m]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {MODULO_LIMPIEZA_LABEL[modulo]}
          </p>
        </div>

        {modulo === "pruebas_reinicio_completo" ? (
          <div className="rounded-lg border-2 border-rose-600 bg-rose-950/40 px-3 py-2.5 text-xs text-rose-100">
            <p className="font-semibold uppercase tracking-wide text-rose-200">
              ⚠ Reinicio completo — la opción más destructiva de esta pantalla
            </p>
            <p className="mt-1">
              Borra, en una sola operación irreversible: facturación (pagos,
              líneas de factura, facturas), solicitudes y paradas del Portal
              del Cliente, viáticos, evidencias y lecturas de viajes,
              planes/viajes TMS y de Flota vinculados, rutas y sus paradas,
              clientes (TMS y facturación) con contactos/ubicaciones/usuarios
              del portal, y los catálogos propios de TMS (pilotos/auxiliares,
              unidades, lugares).
            </p>
            <p className="mt-1 font-medium">
              Nunca toca empleados, vehículos de Flota, usuarios globales del
              sistema ni configuración. Después de confirmar el borrado en
              base de datos, también intenta eliminar los archivos físicos
              asociados (evidencias, firmas de viáticos). Si algún archivo no
              puede eliminarse, se muestra como advertencia — nunca como
              éxito silencioso.
            </p>
          </div>
        ) : null}

        {empresaSel ? (
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100">
            <p className="font-medium">
              Alcance: solo {modulo.toUpperCase()} de {empresaSel.codigo} (
              {empresaSel.nombre})
            </p>
            {otrasEmpresas.length ? (
              <p className="mt-1 text-emerald-200/80">
                No se borrará nada de: {otrasEmpresas.join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--input)] p-3 text-sm">
          <p className="mb-2 text-xs text-[var(--muted)]">
            Registros actuales
            {empresaSel ? ` en ${empresaSel.codigo}` : ""}
            {loading ? "…" : ""}
          </p>
          {conteos ? (
            <ul className="grid grid-cols-2 gap-1 text-xs">
              {Object.entries(conteos).map(([k, v]) => (
                <li key={k}>
                  <span className="text-[var(--muted)]">{k}:</span> {v}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted)]">Sin datos</p>
          )}
        </div>

        <label className="block text-sm text-[var(--muted)]">
          3. Confirmar — escribe exactamente:
          <span className="mt-1 block font-mono text-amber-200">
            {confirmacionEsperada || "…"}
          </span>
          <span className="mt-1 block text-[11px]">
            Ejemplo: si eliges Ecoplanet + Planillas →{" "}
            <span className="font-mono text-amber-100/90">
              ECOPLANET LIMPIAR RRHH_PLANILLAS
            </span>
          </span>
          <input
            className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-2 font-mono text-sm"
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            placeholder={confirmacionEsperada}
            autoComplete="off"
          />
        </label>

        <button
          type="button"
          disabled={
            ejecutando ||
            loading ||
            !empresaSel ||
            confirmacionEsperada !== `${empresaSel?.codigo} LIMPIAR ${modulo.toUpperCase()}` ||
            !confirmacion.trim() ||
            confirmacion.trim().toUpperCase() !==
              confirmacionEsperada.toUpperCase()
          }
          onClick={() => void ejecutar()}
          className="w-full rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-40"
        >
          {ejecutando
            ? "Limpiando…"
            : empresaSel
              ? `Aplicar limpieza solo en ${empresaSel.codigo}`
              : "Elige una empresa"}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {archivosResultado ? (
        <div
          className={[
            "rounded-lg border px-3 py-2.5 text-xs",
            archivosResultado.conError > 0
              ? "border-amber-600 bg-amber-950/40 text-amber-100"
              : "border-emerald-800/40 bg-emerald-950/20 text-emerald-100",
          ].join(" ")}
        >
          <p className="font-medium">
            Limpieza de base de datos completada. Archivos físicos:
          </p>
          <ul className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
            <li>Identificados: {archivosResultado.detectados}</li>
            <li>Eliminados: {archivosResultado.eliminados}</li>
            <li>No encontrados: {archivosResultado.noEncontrados}</li>
            <li>Con error: {archivosResultado.conError}</li>
          </ul>
          {archivosResultado.conError > 0 ? (
            <div className="mt-2 border-t border-amber-700/40 pt-2">
              <p className="font-semibold uppercase tracking-wide text-amber-200">
                ⚠ Quedaron archivos pendientes de eliminar manualmente
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {archivosResultado.advertencias.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
